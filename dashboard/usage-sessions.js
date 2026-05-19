/* ─── monitor-usage Sessions / Summary / Day Drilldown 모듈 ─────
 * Step 4 범위:
 *   1) renderSummaryCards(usageData, period) — 상단 3 카드 + 토글
 *   2) renderSessionsPanel(usageData) — 왼쪽 하단 2-level 트리
 *   3) openDayModal(usageData, date) — 날짜 드릴다운 모달
 *
 * 설계 스펙: docs/specs/2026-04-13-monitor-usage-design.md §8d, §8e, §8f, §5a
 * 네임스페이스: window.usageSessions
 *
 * 주의:
 *   - 시간대별 스택 바는 V1에서는 프로젝트 비율 단일 수평 막대로 단순화
 *     (usage-index.json에 시간대 정보 없어 시간 빈 집계 불가능)
 *   - 모달 열려있는 동안 usageData 갱신 시 재렌더 (최근 열린 date 기준)
 */

// usage-sessions.js — monitor-usage Sessions/Summary/Day Drilldown (ES Module)

// ── 상태 ────────────────────────────────────────────
// localStorage 키 — 세션간 사용자 UI 선호 보존
const LS_KEY = "wilson.usage-sessions.v1"

function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function savePersisted(s) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        currentPeriod: s.currentPeriod,
        expandedProjects: s.expandedProjects,
        expandedSessions: s.expandedSessions,
      }),
    )
  } catch {
    /* quota/private 모드 — 무시 */
  }
}

const _persisted = loadPersisted()
const state = {
  currentPeriod: (_persisted && _persisted.currentPeriod) || "month",
  expandedProjects: (_persisted && _persisted.expandedProjects) || Object.create(null),
  expandedSessions: (_persisted && _persisted.expandedSessions) || Object.create(null),
  modalDate: null,
  escBound: false,
}

// ── 공통 헬퍼 (calendar.js와 중복되는 일부는 재정의) ──
// 프로젝트 색상은 session-tag.js 팔레트(localStorage 슬롯)에 위임 — 하드코딩 금지
function projectColor(name) {
  if (window.sessionTag && typeof window.sessionTag.assign === "function") {
    const pal = window.sessionTag.assign(name)
    return (pal && pal.bg) || "#6b7280"
  }
  return "#6b7280"
}

// 공유 모듈(session-tag.js)로 위임 — feed.js와 동일 슬롯 배정 + localStorage 동기화
function sessionTagColor(name) {
  if (window.sessionTag && typeof window.sessionTag.assign === "function") {
    return window.sessionTag.assign(name)
  }
  return { bg: "#2a3a5c", fg: "#9cdcfe" } // 모듈 미로드 폴백
}
function makeSessionTag(name) {
  if (window.sessionTag && typeof window.sessionTag.render === "function") {
    return window.sessionTag.render(name)
  }
  const safe = String(name || "IT")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return '<span class="session-tag">' + safe + "</span>"
}

// format.js 공용 헬퍼 재사용
const formatTokens = window.wilsonFormat.formatTokens
const formatCost = window.wilsonFormat.formatCost
const formatDuration = window.wilsonFormat.formatDuration
const isoDate = window.wilsonFormat.isoDate
function sumTokenObj(t) {
  if (!t) return 0
  // Claude Desktop /code 규칙과 일치: input + output 만 집계
  // (cacheRead/cacheWrite 는 Daily Usage 상세 차트에서만 표시)
  return (t.input || 0) + (t.output || 0)
}
function mergeTokens(target, src) {
  if (!src) return target
  target.input = (target.input || 0) + (src.input || 0)
  target.cacheWrite1h = (target.cacheWrite1h || 0) + (src.cacheWrite1h || 0)
  target.cacheWrite5m = (target.cacheWrite5m || 0) + (src.cacheWrite5m || 0)
  target.cacheRead = (target.cacheRead || 0) + (src.cacheRead || 0)
  target.output = (target.output || 0) + (src.output || 0)
  return target
}
function emptyTotals() {
  return {
    tokens: { input: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0 },
    costUSD: 0,
    activeMs: 0,
    prompts: 0, // assistant 응답 수 (내부 흐름용, 카드엔 노출하지 않음)
    userPrompts: 0, // 실제 사용자가 보낸 프롬프트 수 (Prompts 카드)
  }
}

// ── 기간 필터: 'month' | 'week' | 'day' → [startKey, endKey] ──
function datesForPeriod(period) {
  const now = new Date()
  const todayKey = isoDate(now)
  if (period === "day") {
    return [todayKey, todayKey]
  }
  if (period === "week") {
    const start = new Date(now)
    start.setDate(start.getDate() - 6) // 오늘 포함 7일
    return [isoDate(start), todayKey]
  }
  // month: 이번 달 1일 ~ 오늘
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  return [isoDate(first), todayKey]
}

/**
 * 이전 기간 범위 계산 (Phase 2 — 델타 비교용).
 *   - month: 지난 달 1일 ~ 지난 달 (오늘과 같은 일수까지).
 *            예) 오늘이 4/13 → current=04-01..04-13, prev=03-01..03-13.
 *            지난 달 말일이 오늘 일자보다 작으면 말일까지 (ex. 3/31 → 2/28).
 *   - week:  최근 7일 → 그 이전 7일.
 *   - day:   오늘 → 어제.
 *   - nowDate: 테스트 주입용 (기본 new Date()).
 * return: [startKey, endKey] 혹은 현재 기간을 구할 수 없으면 null.
 */
function computePrevRange(period, nowDate) {
  const now = nowDate || new Date()
  if (period === "day") {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    const k = isoDate(y)
    return [k, k]
  }
  if (period === "week") {
    // current: now-6 ~ now → prev: now-13 ~ now-7
    const end = new Date(now)
    end.setDate(end.getDate() - 7)
    const start = new Date(now)
    start.setDate(start.getDate() - 13)
    return [isoDate(start), isoDate(end)]
  }
  // month (기본)
  const todayDom = now.getDate() // 오늘의 일자 (1~31)
  const prevMonthFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  // 지난 달 마지막 날 = 이번 달 0일
  const prevMonthLastDom = new Date(now.getFullYear(), now.getMonth(), 0).getDate()
  const endDom = Math.min(todayDom, prevMonthLastDom)
  const prevMonthEnd = new Date(prevMonthFirst.getFullYear(), prevMonthFirst.getMonth(), endDom)
  return [isoDate(prevMonthFirst), isoDate(prevMonthEnd)]
}

/** byDate에서 startKey~endKey 사이 날짜들의 합계 집계 */
function aggregateRange(usageData, startKey, endKey) {
  const byDate = (usageData && usageData.byDate) || {}
  const totals = emptyTotals()
  Object.keys(byDate).forEach((dateKey) => {
    if (dateKey < startKey || dateKey > endKey) return
    const day = byDate[dateKey]
    if (!day) return
    mergeTokens(totals.tokens, day.tokens)
    totals.costUSD += day.costUSD || 0
    totals.activeMs += day.activeMs || 0
    totals.prompts += day.prompts || 0
    totals.userPrompts += day.userPrompts || 0
  })
  return totals
}

// ── 델타 포맷/색상 헬퍼 (Phase 2) ───────────────────
/**
 * 델타 포맷: 백분율 vs 절대값 + 색상 규칙.
 *   - kind='percent'  : ((cur-prev)/prev)*100 → "+24% ↑" / "-12% ↓"
 *   - kind='absolute' : (cur-prev)            → "+3 ↑" / "-2 ↓"
 *   - invertColor=true(Cost/Tokens/ActiveTime): 증가=red, 감소=green
 *   - invertColor=false(Sessions/Prompts): 증가=green, 감소=gray(neutral)
 *   - prev===0 또는 동일값: "—" neutral.
 * return: { text, cls } — cls는 CSS 클래스명.
 */
function formatDelta(cur, prev, kind /* invertColor ignored — 통일 규칙 적용 */) {
  // 0 나눗셈/동등 엣지: prev가 0이거나 값이 완전히 동일하면 "—" (neutral)
  if (kind === "percent") {
    if (!prev || prev <= 0) return { text: "—", cls: "delta-neutral" }
  }
  const diff = (cur || 0) - (prev || 0)
  if (diff === 0) return { text: "—", cls: "delta-neutral" }

  let text
  if (kind === "percent") {
    const pct = (diff / prev) * 100
    const rounded = Math.round(pct)
    const arrow = diff > 0 ? " \u2191" : " \u2193"
    const sign = diff > 0 ? "+" : ""
    text = sign + rounded + "%" + arrow
  } else {
    const arrow = diff > 0 ? " \u2191" : " \u2193"
    const sign = diff > 0 ? "+" : ""
    text = sign + diff + arrow
  }
  // 통일 규칙: 상승=빨강, 하락=녹색, 동일=회색 (5카드 모두)
  const cls = diff > 0 ? "delta-negative" : "delta-positive"
  return { text, cls }
}

// ── Summary Cards 렌더 (Phase 2 — 5장 + 델타) ──────
function renderSummaryCards(usageData, period) {
  const root = document.getElementById("summary-cards")
  if (!root) return
  if (period) state.currentPeriod = period
  root.classList.remove("usage-placeholder")
  root.innerHTML = ""

  // 토글 버튼 영역
  const toggle = document.createElement("div")
  toggle.className = "period-toggle"
  ;["month", "week", "day"].forEach((p) => {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "period-btn"
    if (p === state.currentPeriod) btn.classList.add("is-active")
    btn.textContent = p.charAt(0).toUpperCase() + p.slice(1)
    btn.addEventListener("click", () => {
      state.currentPeriod = p
      savePersisted(state)
      renderSummaryCards(usageData, p)
      // Phase 3+4 — 차트 3종도 동일 period로 재렌더
      if (window.usageCharts && typeof window.usageCharts.renderAll === "function") {
        window.usageCharts.renderAll(usageData, p)
      }
    })
    toggle.appendChild(btn)
  })
  root.appendChild(toggle)

  // 현재/이전 기간 집계 (_aggregateRange 재사용 — 중복 구현 회피)
  const [startKey, endKey] = datesForPeriod(state.currentPeriod)
  const totals = aggregateRange(usageData, startKey, endKey)
  const [pStartKey, pEndKey] = computePrevRange(state.currentPeriod)
  const prevTotals = aggregateRange(usageData, pStartKey, pEndKey)

  // bySession 개수는 byDate 순회가 필요 — 세션은 여러 날에 걸칠 수 있어
  // dedup set으로 구간 내 unique session 수를 계산
  function countSessions(usage, sKey, eKey) {
    const byDate = (usage && usage.byDate) || {}
    const set = new Set()
    Object.keys(byDate).forEach((k) => {
      if (k < sKey || k > eKey) return
      const d = byDate[k]
      if (!d || !d.bySession) return
      Object.keys(d.bySession).forEach((sid) => {
        set.add(sid)
      })
    })
    return set.size
  }
  const curSessions = countSessions(usageData, startKey, endKey)
  const prevSessions = countSessions(usageData, pStartKey, pEndKey)

  const curTokens = sumTokenObj(totals.tokens)
  const prevTokens = sumTokenObj(prevTotals.tokens)

  // 5 카드 정의 — metric 키로 delta 규칙 분기
  const cards = [
    {
      metric: "cost",
      label: "Cost",
      value: formatCost(totals.costUSD),
      delta: formatDelta(totals.costUSD, prevTotals.costUSD, "percent", true),
    },
    {
      metric: "tokens",
      label: "Tokens",
      value: formatTokens(curTokens),
      delta: formatDelta(curTokens, prevTokens, "percent", true),
    },
    {
      metric: "activeTime",
      label: "Active Time",
      value: formatDuration(totals.activeMs),
      delta: formatDelta(totals.activeMs, prevTotals.activeMs, "percent", true),
    },
    {
      metric: "sessions",
      label: "Sessions",
      // 5개 카드 모두 동일 규칙: 상승=빨강, 하락=녹색, 동일=회색
      delta: formatDelta(curSessions, prevSessions, "absolute", true),
      value: String(curSessions),
    },
    {
      metric: "prompts",
      label: "Prompts",
      // 실제 사용자가 보낸 프롬프트 수 (assistant 응답 수가 아님).
      value: String(totals.userPrompts || 0),
      delta: formatDelta(totals.userPrompts || 0, prevTotals.userPrompts || 0, "absolute", true),
    },
  ]

  const cardsWrap = document.createElement("div")
  cardsWrap.className = "summary-cards-row"

  cards.forEach((c) => {
    const card = document.createElement("div")
    card.className = "summary-card"
    card.setAttribute("data-metric", c.metric)

    const label = document.createElement("div")
    label.className = "summary-label summary-card-label"
    label.textContent = c.label

    const value = document.createElement("div")
    value.className = "summary-value summary-card-value"
    value.textContent = c.value

    const delta = document.createElement("div")
    delta.className = "summary-delta " + c.delta.cls
    delta.textContent = c.delta.text

    card.appendChild(label)
    card.appendChild(value)
    card.appendChild(delta)
    cardsWrap.appendChild(card)
  })
  root.appendChild(cardsWrap)
}

// ── Sessions Panel 데이터 집계 ──────────────────────
/**
 * usageData.byDate를 순회하며 프로젝트별 → 세션별 → 서브에이전트별 집계 트리 생성.
 * return: [{
 *   project, totals: {tokens, costUSD, prompts, activeMs},
 *   sessions: [{
 *     sessionId, date, startTime, totals,
 *     subagents: [{agentId, agentType, totals}]
 *   }]
 * }]
 */
function buildSessionTree(usageData) {
  const byDate = (usageData && usageData.byDate) || {}
  const projects = Object.create(null) // name → { totals, sessionsMap }
  let orphanSkipCount = 0 // orphan subagent 건너뛴 수 (한 번만 warn)

  Object.keys(byDate).forEach((dateKey) => {
    const day = byDate[dateKey]
    if (!day) return

    // 세션 수집
    const bySession = day.bySession || {}
    Object.keys(bySession).forEach((sid) => {
      const s = bySession[sid]
      if (!s) return
      const projectName = s.project || "unknown"
      if (!projects[projectName]) {
        projects[projectName] = {
          project: projectName,
          totals: emptyTotals(),
          sessionsMap: Object.create(null),
        }
      }
      const proj = projects[projectName]
      // 세션 레코드
      if (!proj.sessionsMap[sid]) {
        proj.sessionsMap[sid] = {
          sessionId: sid,
          date: dateKey,
          startTime: s.startTime || null,
          slug: s.slug || null,
          firstPromptSummary: s.firstPromptSummary || null,
          totals: emptyTotals(),
          subagents: [],
        }
      }
      const sess = proj.sessionsMap[sid]
      // slug: 여러 날짜 bucket 중 하나에만 있어도 반영
      if (!sess.slug && s.slug) sess.slug = s.slug
      // firstPromptSummary: 여러 날짜 bucket 중 하나에만 있어도 반영
      if (!sess.firstPromptSummary && s.firstPromptSummary) {
        sess.firstPromptSummary = s.firstPromptSummary
      }
      // startTime이 더 이른 값이면 업데이트 (여러 날에 걸친 세션)
      if (s.startTime && (!sess.startTime || s.startTime < sess.startTime)) {
        sess.startTime = s.startTime
        sess.date = dateKey
      }
      mergeTokens(sess.totals.tokens, s.tokens)
      sess.totals.costUSD += s.costUSD || 0
      sess.totals.activeMs += s.activeMs || 0
      sess.totals.prompts += s.prompts || 0

      mergeTokens(proj.totals.tokens, s.tokens)
      proj.totals.costUSD += s.costUSD || 0
      proj.totals.activeMs += s.activeMs || 0
      proj.totals.prompts += s.prompts || 0
    })

    // 서브에이전트 수집 → 부모 세션에 붙임. 부모 매칭 실패시 skip (_orphan 프로젝트 안 만듦).
    const bySub = day.bySubagent || {}
    Object.keys(bySub).forEach((aid) => {
      const a = bySub[aid]
      if (!a) return
      const parent = a.parentSessionId
      // 부모 세션의 project 찾기
      let parentProj = null
      let parentSess = null
      Object.keys(projects).forEach((pname) => {
        if (projects[pname].sessionsMap[parent]) {
          parentProj = projects[pname]
          parentSess = projects[pname].sessionsMap[parent]
        }
      })
      if (!parentSess) {
        // orphan: parent 못 찾은 subagent는 프로젝트 추가 없이 완전 skip.
        // (사용자 요청 — 대부분 $0이라 노이즈만 늘어남)
        orphanSkipCount++
        return
      }
      parentSess.subagents.push({
        agentId: aid,
        agentType: a.agentType || "agent",
        totals: {
          tokens: Object.assign({}, a.tokens || {}),
          costUSD: a.costUSD || 0,
          prompts: a.prompts || 0,
          activeMs: a.activeMs || 0,
        },
      })
    })
  })

  if (orphanSkipCount > 0) {
    // eslint-disable-next-line no-console
    console.warn("orphan subagent skipped: " + orphanSkipCount)
  }

  // 프로젝트 배열화 + 세션 배열 정렬 (startTime 내림차순)
  const list = Object.keys(projects).map((name) => {
    const p = projects[name]
    const sessions = Object.values(p.sessionsMap).sort((a, b) => {
      const ta = a.startTime || a.date || ""
      const tb = b.startTime || b.date || ""
      return tb.localeCompare(ta)
    })
    return { project: p.project, totals: p.totals, sessions }
  })
  // 프로젝트 정렬: 총 토큰 내림차순
  list.sort((a, b) => sumTokenObj(b.totals.tokens) - sumTokenObj(a.totals.tokens))
  return list
}

// ── Sessions Panel 렌더 ────────────────────────────
function renderSessionsPanel(usageData) {
  const root = document.getElementById("sessions-panel")
  if (!root) return

  // panel-title은 유지, 내부 리스트만 교체
  let title = root.querySelector(".panel-title")
  root.innerHTML = ""
  if (!title) {
    title = document.createElement("div")
    title.className = "panel-title"
    title.textContent = "Sessions"
  }
  root.appendChild(title)

  const tree = buildSessionTree(usageData)
  if (tree.length === 0) {
    const empty = document.createElement("div")
    empty.className = "usage-empty"
    empty.textContent = "세션 데이터 없음"
    root.appendChild(empty)
    return
  }

  const listEl = document.createElement("div")
  listEl.className = "sessions-list"

  tree.forEach((proj) => {
    // 기본 펼침 (state 미정인 경우)
    if (state.expandedProjects[proj.project] === undefined) {
      state.expandedProjects[proj.project] = true
    }
    const projExpanded = state.expandedProjects[proj.project]

    const projRow = document.createElement("div")
    projRow.className = "sess-row sess-project"
    const caret = document.createElement("span")
    caret.className = "sess-caret"
    caret.textContent = projExpanded ? "▼" : "▶"
    const label = document.createElement("span")
    label.className = "sess-label"
    // session-tag 스타일로 통일 (monitor-agent Feeds와 동일 시각)
    label.innerHTML = makeSessionTag(proj.project)
    const stats = document.createElement("span")
    stats.className = "sess-stats"
    stats.textContent =
      proj.totals.prompts +
      " pr · " +
      formatTokens(sumTokenObj(proj.totals.tokens)) +
      " · " +
      formatCost(proj.totals.costUSD)
    projRow.appendChild(caret)
    projRow.appendChild(label)
    projRow.appendChild(stats)
    projRow.addEventListener("click", () => {
      state.expandedProjects[proj.project] = !projExpanded
      savePersisted(state)
      renderSessionsPanel(usageData)
    })
    listEl.appendChild(projRow)

    if (!projExpanded) return

    proj.sessions.forEach((sess) => {
      // 기본 접힘
      if (state.expandedSessions[sess.sessionId] === undefined) {
        state.expandedSessions[sess.sessionId] = false
      }
      const sessExpanded = state.expandedSessions[sess.sessionId]

      const sessRow = document.createElement("div")
      sessRow.className = "sess-row sess-session"
      const sCaret = document.createElement("span")
      sCaret.className = "sess-caret"
      sCaret.textContent = sessExpanded ? "▼" : "▶"
      // 캐럿 클릭 → 펼침 토글 (이벤트 stopPropagation)
      sCaret.addEventListener("click", (e) => {
        e.stopPropagation()
        state.expandedSessions[sess.sessionId] = !sessExpanded
        savePersisted(state)
        renderSessionsPanel(usageData)
      })

      const sLabel = document.createElement("span")
      sLabel.className = "sess-label"
      // 신규 포맷: [MM/DD | 첫 프롬프트 요약]
      // fallback: firstPromptSummary → slug → sessionId 앞 8자
      // 툴팁에는 기존처럼 시간(MM-DD HH:mm) + sessionId 앞 8자 + slug 노출
      let mmdd = ""
      let timeLabel = sess.date || ""
      if (sess.startTime) {
        const d = new Date(sess.startTime)
        if (!Number.isNaN(d.getTime())) {
          const mm = String(d.getMonth() + 1).padStart(2, "0")
          const dd = String(d.getDate()).padStart(2, "0")
          const hh = String(d.getHours()).padStart(2, "0")
          const mi = String(d.getMinutes()).padStart(2, "0")
          mmdd = mm + "/" + dd
          timeLabel = mm + "-" + dd + " " + hh + ":" + mi
        }
      }
      if (!mmdd && sess.date) {
        // YYYY-MM-DD → MM/DD
        const parts = sess.date.split("-")
        if (parts.length === 3) mmdd = parts[1] + "/" + parts[2]
        else mmdd = sess.date
      }
      const shortId = (sess.sessionId || "").slice(0, 8)
      const summaryText = sess.firstPromptSummary || sess.slug || shortId || "(no prompt)"
      sLabel.textContent = "[" + mmdd + " | " + summaryText + "]"
      // 툴팁: 시간 + sessionId 앞 8자 + slug (참고용으로 보존)
      const tooltipParts = [timeLabel]
      if (shortId) tooltipParts.push(shortId)
      if (sess.slug) tooltipParts.push(sess.slug)
      sLabel.title = tooltipParts.filter(Boolean).join(" · ")

      const sStats = document.createElement("span")
      sStats.className = "sess-stats"
      sStats.textContent =
        sess.totals.prompts +
        " pr · " +
        formatTokens(sumTokenObj(sess.totals.tokens)) +
        " · " +
        formatCost(sess.totals.costUSD)

      sessRow.appendChild(sCaret)
      sessRow.appendChild(sLabel)
      sessRow.appendChild(sStats)
      // 본문 클릭(캐럿 제외) → Day 모달 열기
      sessRow.addEventListener("click", () => {
        document.dispatchEvent(
          new CustomEvent("usage:day-clicked", {
            detail: { date: sess.date },
          }),
        )
      })
      listEl.appendChild(sessRow)

      if (!sessExpanded) return

      sess.subagents.forEach((sub) => {
        const subRow = document.createElement("div")
        subRow.className = "sess-row sess-subagent"
        const pad = document.createElement("span")
        pad.className = "sess-caret"
        pad.textContent = "└"
        const sName = document.createElement("span")
        sName.className = "sess-label"
        sName.textContent = "SUB " + sub.agentType
        const sStat = document.createElement("span")
        sStat.className = "sess-stats"
        sStat.textContent =
          sub.totals.prompts +
          " pr · " +
          formatTokens(sumTokenObj(sub.totals.tokens)) +
          " · " +
          formatCost(sub.totals.costUSD)
        subRow.appendChild(pad)
        subRow.appendChild(sName)
        subRow.appendChild(sStat)
        listEl.appendChild(subRow)
      })
    })
  })

  root.appendChild(listEl)
}

// ── Day Drilldown 모달 ─────────────────────────────
function openDayModal(usageData, date) {
  if (!date) return
  state.modalDate = date
  const modal = document.getElementById("day-modal")
  if (!modal) return
  modal.classList.remove("hidden")
  modal.innerHTML = ""

  const byDate = (usageData && usageData.byDate) || {}
  const day = byDate[date]

  // 모달 카드
  const card = document.createElement("div")
  card.className = "modal-card"
  card.addEventListener("click", (e) => e.stopPropagation())

  // 헤더
  const header = document.createElement("div")
  header.className = "modal-header"
  const title = document.createElement("div")
  title.className = "modal-title"
  title.textContent = date
  const closeBtn = document.createElement("button")
  closeBtn.type = "button"
  closeBtn.className = "modal-close"
  closeBtn.textContent = "×"
  closeBtn.title = "닫기 (ESC)"
  closeBtn.addEventListener("click", closeDayModal)
  header.appendChild(title)
  header.appendChild(closeBtn)
  card.appendChild(header)

  if (!day) {
    const empty = document.createElement("div")
    empty.className = "modal-empty"
    empty.textContent = "해당 날짜 데이터 없음"
    card.appendChild(empty)
    modal.appendChild(card)
    bindBackdropClose(modal)
    return
  }

  // 요약 줄
  const totalTok = sumTokenObj(day.tokens)
  const summary = document.createElement("div")
  summary.className = "modal-summary"
  summary.textContent =
    formatTokens(totalTok) +
    " tokens · " +
    formatCost(day.costUSD) +
    " · " +
    formatDuration(day.activeMs) +
    " · " +
    (day.prompts || 0) +
    " prompts"
  card.appendChild(summary)

  // 프로젝트 비율 스택 바 (수평 단일 막대) — 시간대별 집계 불가로 V1 단순화
  const byProject = day.byProject || {}
  const projectEntries = Object.keys(byProject)
    .map((name) => ({
      name,
      tokens: sumTokenObj(byProject[name].tokens),
      costUSD: byProject[name].costUSD || 0,
    }))
    .filter((p) => p.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)

  if (projectEntries.length > 0) {
    const breakdownTitle = document.createElement("div")
    breakdownTitle.className = "modal-section-title"
    breakdownTitle.textContent = "Project breakdown"
    card.appendChild(breakdownTitle)

    // 범례
    const legend = document.createElement("div")
    legend.className = "modal-legend"
    projectEntries.forEach((p) => {
      const chip = document.createElement("span")
      chip.className = "legend-chip"
      const sw = document.createElement("span")
      sw.className = "legend-swatch"
      sw.style.background = projectColor(p.name)
      const txt = document.createElement("span")
      txt.textContent = p.name + " " + formatTokens(p.tokens)
      chip.appendChild(sw)
      chip.appendChild(txt)
      legend.appendChild(chip)
    })
    card.appendChild(legend)

    // 수평 스택 바
    const bar = document.createElement("div")
    bar.className = "modal-stack-bar"
    const total = projectEntries.reduce((s, p) => s + p.tokens, 0)
    projectEntries.forEach((p) => {
      const seg = document.createElement("div")
      seg.className = "modal-stack-seg"
      seg.style.width = ((p.tokens / total) * 100).toFixed(2) + "%"
      seg.style.background = projectColor(p.name)
      seg.title = p.name + ": " + formatTokens(p.tokens) + " tokens · " + formatCost(p.costUSD)
      bar.appendChild(seg)
    })
    card.appendChild(bar)
  }

  // Active sessions 리스트
  const sessTitle = document.createElement("div")
  sessTitle.className = "modal-section-title"
  sessTitle.textContent = "Active sessions"
  card.appendChild(sessTitle)

  const sessList = document.createElement("div")
  sessList.className = "modal-sessions"

  // 세션 배열화
  const sessions = Object.keys(day.bySession || {})
    .map((sid) => {
      const s = day.bySession[sid]
      return Object.assign({ sessionId: sid }, s)
    })
    .sort((a, b) => {
      const ta = a.startTime || ""
      const tb = b.startTime || ""
      return tb.localeCompare(ta)
    })

  // 서브에이전트를 parent 별로 그룹
  const subsByParent = Object.create(null)
  Object.keys(day.bySubagent || {}).forEach((aid) => {
    const a = day.bySubagent[aid]
    const parent = a.parentSessionId || "_none"
    if (!subsByParent[parent]) subsByParent[parent] = []
    subsByParent[parent].push(Object.assign({ agentId: aid }, a))
  })

  if (sessions.length === 0) {
    const empty = document.createElement("div")
    empty.className = "modal-empty"
    empty.textContent = "세션 없음"
    sessList.appendChild(empty)
  }

  sessions.forEach((s) => {
    const row = document.createElement("div")
    row.className = "modal-session-row"
    let hhmm = ""
    if (s.startTime) {
      const d = new Date(s.startTime)
      if (!Number.isNaN(d.getTime())) {
        hhmm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
      }
    }
    const proj = s.project || "unknown"
    const tagSw = document.createElement("span")
    tagSw.className = "modal-proj-tag"
    tagSw.textContent = "[" + proj + "]"
    tagSw.style.color = projectColor(proj)

    const timeEl = document.createElement("span")
    timeEl.className = "modal-sess-time"
    timeEl.textContent = hhmm || "--:--"

    const statEl = document.createElement("span")
    statEl.className = "modal-sess-stats"
    statEl.textContent =
      (s.prompts || 0) +
      " pr · " +
      formatTokens(sumTokenObj(s.tokens)) +
      " · " +
      formatCost(s.costUSD)

    row.appendChild(timeEl)
    row.appendChild(tagSw)
    row.appendChild(statEl)
    sessList.appendChild(row)

    // 서브에이전트 들여쓰기
    const subs = subsByParent[s.sessionId] || []
    subs.forEach((sub) => {
      const subRow = document.createElement("div")
      subRow.className = "modal-subagent-row"
      const head = document.createElement("span")
      head.textContent = "└ SUB " + (sub.agentType || "agent")
      const st = document.createElement("span")
      st.className = "modal-sess-stats"
      st.textContent =
        (sub.prompts || 0) +
        " pr · " +
        formatTokens(sumTokenObj(sub.tokens)) +
        " · " +
        formatCost(sub.costUSD)
      subRow.appendChild(head)
      subRow.appendChild(st)
      sessList.appendChild(subRow)
    })
  })

  card.appendChild(sessList)
  modal.appendChild(card)
  bindBackdropClose(modal)
  bindEscOnce()
}

function closeDayModal() {
  const modal = document.getElementById("day-modal")
  if (!modal) return
  modal.classList.add("hidden")
  state.modalDate = null
  modal.innerHTML = ""
}

function bindBackdropClose(modal) {
  // backdrop 클릭 → 닫기 (카드 내부 click은 stopPropagation됨)
  modal.onclick = (e) => {
    if (e.target === modal) closeDayModal()
  }
}

function bindEscOnce() {
  if (state.escBound) return
  state.escBound = true
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.modalDate) closeDayModal()
  })
}

// ── 전역 노출 ──────────────────────────────────────
export const usageSessions = {
  renderSummaryCards,
  renderSessionsPanel,
  openDayModal,
  closeDayModal,
  makeSessionTag,
  sessionTagColor,
  get currentPeriod() {
    return state.currentPeriod
  },
  set currentPeriod(v) {
    state.currentPeriod = v
  },
  _state: state,
  _buildSessionTree: buildSessionTree,
  _aggregateRange: aggregateRange,
  _computePrevRange: computePrevRange,
  _formatDelta: formatDelta,
}
if (typeof window !== "undefined") window.usageSessions = usageSessions
