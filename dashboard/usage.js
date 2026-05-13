/* ─── monitor-usage 페이지 로직 ───────────────────────────
 * 역할:
 *   1) /api/usage fetch → window.usageData 저장 + 각 렌더러 호출
 *   2) Day Drilldown 모달 이벤트 바인딩 (usage:day-clicked → openDayModal)
 *   3) SSE usage_delta 수신 시 캘린더/카드/세션 실시간 diff 갱신
 *
 * 타이틀 클릭 네비게이션은 page-nav.js가 담당 (Step 5 분리).
 */

// usage.js — monitor-usage 페이지 로직 (ES Module)

/**
 * /api/usage 호출해서 집계 데이터를 로드하고 window.usageData에 저장.
 * 응답 구조는 docs/specs/2026-04-13-monitor-usage-design.md 섹션 5a 참조:
 *   { scanCursor, byDate: { 'YYYY-MM-DD': { tokens, costUSD, activeMs, prompts, byProject, bySession, bySubagent } } }
 */
// 데이터 변경 감지용 지문 — 동일 응답이면 재렌더 스킵 (리프레시 깜빡임/CPU 절약)
let lastDataFingerprint = null
function fingerprintOf(data) {
  if (!data) return ""
  // scanCursor는 aggregator가 증분마다 갱신 — 이게 가장 싸고 신뢰할 지표
  const cursor = data.scanCursor || {}
  let acc = ""
  const keys = Object.keys(cursor).sort()
  for (const k of keys) acc += k + ":" + cursor[k] + ";"
  return acc
}

async function loadUsageData() {
  try {
    const res = await fetch("/api/usage")
    if (!res.ok) {
      console.warn("[usage] /api/usage 응답 실패:", res.status)
      return null
    }
    const data = await res.json()
    window.usageData = data
    const days = data && data.byDate ? Object.keys(data.byDate).length : 0

    // 응답이 이전과 동일(새 이벤트 없음) → 재렌더 스킵
    const fp = fingerprintOf(data)
    if (fp && fp === lastDataFingerprint) {
      console.log("usage data unchanged — render skipped")
      return data
    }
    lastDataFingerprint = fp

    console.log("usage data loaded", days, "days")
    renderAll(data)
    reopenModalIfNeeded(data)
    return data
  } catch (err) {
    console.warn("[usage] fetch 오류:", err && err.message)
    return null
  }
}

// ── 렌더링 위임 ────────────────────────────────────────

function renderAll(data) {
  renderHeatmap(data)
  renderMonthGrid(data)
  renderSummaryCards(data)
  renderSessionsPanel(data)
  renderCharts(data)
}

// Phase 3+4 — Chart.js 차트 3종 렌더 위임 (usage-charts.js)
function renderCharts(data) {
  if (window.usageCharts && typeof window.usageCharts.renderAll === "function") {
    const period = (window.usageSessions && window.usageSessions.currentPeriod) || "month"
    window.usageCharts.renderAll(data || window.usageData, period)
  }
}

// Step 3 — 365일 연간 히트맵 렌더링 위임 (usage-calendar.js)
function renderHeatmap(data) {
  if (window.usageCalendar && typeof window.usageCalendar.renderHeatmap === "function") {
    window.usageCalendar.renderHeatmap(data || window.usageData)
  }
}

// Step 3 — 월 격자 렌더링 위임 (usage-calendar.js)
function renderMonthGrid(data) {
  if (window.usageCalendar && typeof window.usageCalendar.renderMonthGrid === "function") {
    window.usageCalendar.renderMonthGrid(data || window.usageData)
  }
}

// Step 4 — Summary cards 렌더 위임 (usage-sessions.js)
function renderSummaryCards(data) {
  if (window.usageSessions && typeof window.usageSessions.renderSummaryCards === "function") {
    window.usageSessions.renderSummaryCards(
      data || window.usageData,
      window.usageSessions.currentPeriod,
    )
  }
}

// Step 4 — Sessions 2-level 접기 트리 렌더 위임 (usage-sessions.js)
function renderSessionsPanel(data) {
  if (window.usageSessions && typeof window.usageSessions.renderSessionsPanel === "function") {
    window.usageSessions.renderSessionsPanel(data || window.usageData)
  }
}

// ── Day Drilldown 모달 이벤트 바인딩 ───────────────────
function bindDayClicked() {
  document.addEventListener("usage:day-clicked", (e) => {
    const date = e && e.detail && e.detail.date
    if (!date) return
    if (window.usageSessions && typeof window.usageSessions.openDayModal === "function") {
      window.usageSessions.openDayModal(window.usageData, date)
    }
  })
}

/** 이미 열려 있는 Day 모달이 있으면 최신 데이터로 다시 그린다. */
function reopenModalIfNeeded(data) {
  const sess = window.usageSessions
  if (!sess || !sess._state) return
  const openDate = sess._state.modalDate
  if (!openDate) return
  const modal = document.getElementById("day-modal")
  if (!modal || modal.classList.contains("hidden")) return
  // 동일 날짜로 재렌더 — openDayModal 내부가 innerHTML을 갱신함
  try {
    sess.openDayModal(data || window.usageData, openDate)
  } catch (err) {
    console.warn("[usage] modal reopen 실패:", err && err.message)
  }
}

// ── SSE 실시간 업데이트 (usage_delta) ──────────────────
/**
 * 서버가 새 usage 이벤트 1건을 집계한 뒤 브로드캐스트한다.
 * 페이로드 스펙:
 *   {
 *     date: 'YYYY-MM-DD',
 *     sessionId, isSidechain, agentId, project,
 *     tokens: {input, cacheWrite1h, cacheWrite5m, cacheRead, output},
 *     costUSD, timestamp
 *   }
 *
 * 우리는 delta를 window.usageData.byDate에 직접 merge한 뒤 뷰를 패치한다.
 * 단, activeMs 재계산은 전체 파일 스캔이 필요해 클라이언트에서는 생략 (다음 /api/usage에서 반영).
 */
function applyUsageDelta(delta) {
  if (!delta || !delta.date) return
  const data = window.usageData
  if (!data) return
  if (!data.byDate) data.byDate = {}

  let day = data.byDate[delta.date]
  if (!day) {
    day = {
      tokens: { input: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0 },
      costUSD: 0,
      activeMs: 0,
      prompts: 0,
      byProject: {},
      bySession: {},
      bySubagent: {},
    }
    data.byDate[delta.date] = day
  }

  // 1) day 전체 누적
  addTokens(day.tokens, delta.tokens)
  day.costUSD += delta.costUSD || 0

  // 2) byProject
  const project = delta.project || "unknown"
  if (!day.byProject[project]) {
    day.byProject[project] = {
      tokens: { input: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0 },
      costUSD: 0,
      prompts: 0,
    }
  }
  addTokens(day.byProject[project].tokens, delta.tokens)
  day.byProject[project].costUSD += delta.costUSD || 0

  // 3) 서브에이전트 / 메인 세션 분기
  if (delta.isSidechain && delta.agentId) {
    const aid = delta.agentId
    if (!day.bySubagent[aid]) {
      day.bySubagent[aid] = {
        parentSessionId: delta.parentSessionId || null,
        agentType: delta.agentType || "Agent",
        tokens: { input: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0 },
        costUSD: 0,
        prompts: 0,
      }
    }
    addTokens(day.bySubagent[aid].tokens, delta.tokens)
    day.bySubagent[aid].costUSD += delta.costUSD || 0
    day.bySubagent[aid].prompts += 1
  } else if (delta.sessionId) {
    const sid = delta.sessionId
    if (!day.bySession[sid]) {
      day.bySession[sid] = {
        project,
        startTime: delta.timestamp,
        endTime: delta.timestamp,
        activeMs: 0,
        prompts: 0,
        tokens: { input: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0 },
        costUSD: 0,
        slug: delta.slug || null,
      }
    }
    const s = day.bySession[sid]
    addTokens(s.tokens, delta.tokens)
    s.costUSD += delta.costUSD || 0
    s.prompts += 1
    // slug 백필 (첫 non-null 값)
    if (!s.slug && delta.slug) s.slug = delta.slug
    if (delta.timestamp && delta.timestamp < s.startTime) s.startTime = delta.timestamp
    if (delta.timestamp && delta.timestamp > s.endTime) s.endTime = delta.timestamp

    day.byProject[project].prompts += 1
    day.prompts += 1
  }
}

function addTokens(dst, src) {
  if (!src) return
  dst.input += src.input || 0
  dst.cacheWrite1h += src.cacheWrite1h || 0
  dst.cacheWrite5m += src.cacheWrite5m || 0
  dst.cacheRead += src.cacheRead || 0
  dst.output += src.output || 0
}

// ── Debounce 재렌더 (연속 delta 발생 시 UI 깜빡임 방지) ───
// 셀 패치는 즉시, 카드/세션/차트/모달 재렌더는 800ms trailing debounce로 묶음
const RERENDER_DEBOUNCE_MS = 800
let rerenderTimer = null
let pendingModalDate = null

function scheduleFullRerender(modalCandidateDate) {
  if (modalCandidateDate) pendingModalDate = modalCandidateDate
  if (rerenderTimer) clearTimeout(rerenderTimer)
  rerenderTimer = setTimeout(() => {
    rerenderTimer = null
    const data = window.usageData
    if (!data) return

    // 카드/세션은 DOM 재생성 — debounce 끝에 1회만 실행
    renderSummaryCards(data)
    renderSessionsPanel(data)
    // 차트는 내부적으로 chart.update() — 가벼움
    renderCharts(data)

    // 모달이 해당 날짜로 열려있으면 재오픈
    const d = pendingModalDate
    pendingModalDate = null
    if (!d) return
    const sess = window.usageSessions
    if (sess && sess._state && sess._state.modalDate === d) {
      const modal = document.getElementById("day-modal")
      if (modal && !modal.classList.contains("hidden")) {
        try {
          sess.openDayModal(data, d)
        } catch (err) {
          console.warn("[usage] delta modal reopen 실패:", err && err.message)
        }
      }
    }
  }, RERENDER_DEBOUNCE_MS)
}

/** SSE usage_delta 이벤트 처리 — 셀 패치는 즉시, 그 외는 debounce. */
function handleUsageDelta(raw) {
  let delta
  try {
    delta = JSON.parse(raw)
  } catch {
    return
  }
  applyUsageDelta(delta)

  const data = window.usageData
  if (!data) return
  const dayData = data.byDate[delta.date]

  // 1) 월 격자 셀 즉시 부분 패치 (가벼움, 깜빡임 없음)
  if (window.usageCalendar && typeof window.usageCalendar.patchCell === "function") {
    window.usageCalendar.patchCell(delta.date, dayData)
  }

  // 2) 카드/세션/차트/모달은 debounce로 묶어 한 번에 재렌더
  scheduleFullRerender(delta.date)
}

// ── 새로고침 UI / 자동 주기 ─────────────────────────
// SSE usage_delta 실시간 갱신은 비활성 — 너무 잦은 재렌더로 깜빡임 이슈
// 대신 15분 주기 자동 새로고침 + 수동 Refresh 버튼 제공
const AUTO_REFRESH_MS = 15 * 60 * 1000
let autoRefreshTimer = null
let lastRefreshedAt = null
let refreshTickTimer = null

function formatRelTime(date) {
  if (!date) return "—"
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (diffSec < 5) return "방금"
  if (diffSec < 60) return diffSec + "초 전"
  const min = Math.floor(diffSec / 60)
  if (min < 60) return min + "분 전"
  const h = Math.floor(min / 60)
  const m = min % 60
  return h + "시간 " + (m ? m + "분 " : "") + "전"
}

function updateLastRefreshedDisplay() {
  const el = document.getElementById("last-refreshed")
  if (!el) return
  if (!lastRefreshedAt) {
    el.textContent = "—"
    return
  }
  const hh = String(lastRefreshedAt.getHours()).padStart(2, "0")
  const mm = String(lastRefreshedAt.getMinutes()).padStart(2, "0")
  el.textContent = formatRelTime(lastRefreshedAt) + " · " + hh + ":" + mm
}

async function triggerRefresh() {
  const btn = document.getElementById("refresh-usage")
  if (btn) btn.disabled = true
  try {
    await loadUsageData()
    lastRefreshedAt = new Date()
    updateLastRefreshedDisplay()
  } finally {
    if (btn) btn.disabled = false
  }
}

function bindRefreshButton() {
  const btn = document.getElementById("refresh-usage")
  if (btn) btn.addEventListener("click", () => triggerRefresh())
}

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer)
  autoRefreshTimer = setInterval(triggerRefresh, AUTO_REFRESH_MS)
  // "N분 전" 표시가 살아 움직이도록 30초마다 갱신
  if (refreshTickTimer) clearInterval(refreshTickTimer)
  refreshTickTimer = setInterval(updateLastRefreshedDisplay, 30 * 1000)
}

// ── 초기화 ─────────────────────────────────────────────
async function init() {
  bindDayClicked()
  bindRefreshButton()

  // 첫 로드 중 로딩 상태 표시 (/api/usage는 콜드 캐시 시 5~10초 소요 가능)
  const lastEl = document.getElementById("last-refreshed")
  if (lastEl) {
    lastEl.textContent = "Loading…"
    lastEl.classList.add("is-loading")
  }
  const btn = document.getElementById("refresh-usage")
  if (btn) btn.disabled = true

  try {
    await loadUsageData()
    lastRefreshedAt = new Date()
    updateLastRefreshedDisplay()
  } finally {
    if (lastEl) lastEl.classList.remove("is-loading")
    if (btn) btn.disabled = false
    startAutoRefresh()
  }
}

// SPA #13 — init은 router가 usage route 진입 시 트리거. 자동 호출 제거.
// 직접 /usage.html 접근(레거시) 시에는 data-page="usage"가 세팅돼 있으면 init 자동 실행.
if (document.body && document.body.dataset.page === "usage" && !document.body.dataset.route) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
}

// 디버그/후속 Step에서 재호출 가능하도록 전역 노출
export const usagePage = {
  init,
  loadUsageData,
  renderAll,
  renderHeatmap,
  renderMonthGrid,
  renderSummaryCards,
  renderSessionsPanel,
  applyUsageDelta,
  handleUsageDelta,
}
if (typeof window !== "undefined") window.usagePage = usagePage
