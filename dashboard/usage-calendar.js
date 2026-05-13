/* ─── monitor-usage 캘린더 전용 모듈 ─────────────────────
 * Step 3 범위:
 *   1) renderHeatmap(usageData) — no-op stub (year heatmap은 2026-04-13 제거됨, export 유지)
 *   2) renderMonthGrid(usageData, year, month) — 월 격자 (#month-grid)
 *   3) navigateMonth(delta) — 월 좌/우 이동
 *   4) 셀 클릭 시 'usage:day-clicked' 커스텀 이벤트 emit (Step 4 모달이 수신)
 *
 * 설계 스펙: docs/specs/2026-04-13-monitor-usage-design.md §8b, §8c, §5a
 * 네임스페이스: window.usageCalendar
 *
 * 주의:
 *   - 매 호출마다 DOM을 깨끗이 비우고 다시 그림 (SSE/refresh 대응)
 *   - 미래 날짜는 빈 셀 처리
 *   - 색상 함수는 inline style로 적용 (5단계 임계치 기반)
 */

// usage-calendar.js — monitor-usage 캘린더 (ES Module)

// ── 색상 팔레트 ────────────────────────────────────
// 비용 기반 5단계: <$200 초록, $200~$500 빨강, $500~$1K 오로라, $1K~$2K 실버, $2K+ 골드
const COLOR_NONE = "transparent"
const COLOR_LOW = "#22c55e" // <$200
const COLOR_HIGH = "#ef4444" // $200 ~ $500
// 오로라 — 쿨 다색 그라데이션 (다른 단계와 색상 영역 겹침 없음: 초록·빨강·회색·노랑 배제)
const COLOR_AURORA =
  "linear-gradient(90deg, #22d3ee 0%, #60a5fa 28%, #a78bfa 50%, #e879f9 75%, #f472b6 100%)"
// 크롬 실버 — 깊은 쿨 섀도우 → 반사 피크(#fff) → 트로프 → 보조 하이라이트 (폴리시드 크롬)
const COLOR_SILVER =
  "linear-gradient(90deg, #7a838c 0%, #e8edf1 20%, #ffffff 38%, #c5ced6 55%, #8a939c 72%, #eef3f8 100%)"
// 폴리시드 골드 — 실버와 동일 구조, 따뜻한 팔레트 (브론즈 섀도우 → 크림 피크)
const COLOR_GOLD =
  "linear-gradient(90deg, #8a5a0f 0%, #fcd34d 20%, #fef3c7 38%, #eab308 55%, #92630a 72%, #fde68a 100%)"

/** 일 비용(USD) 기반 5단계 색상 (CSS background 문자열). */
function colorForCost(cost) {
  if (!cost || cost <= 0) return COLOR_NONE
  if (cost < 200) return COLOR_LOW
  if (cost < 500) return COLOR_HIGH
  if (cost < 1000) return COLOR_AURORA
  if (cost < 2000) return COLOR_SILVER
  return COLOR_GOLD
}

// ── 포맷 헬퍼 ───────────────────────────────────────
// dashboard/format.js의 공용 구현 재사용 (IIFE 내부로 끌어와서 기존 코드 변경 최소화)
const formatTokens = window.wilsonFormat.formatTokens
const formatCost = window.wilsonFormat.formatCost
const formatDuration = window.wilsonFormat.formatDuration
const isoDate = window.wilsonFormat.isoDate

/** 'YYYY-MM-DD' 오늘 문자열 */
function todayStr() {
  return isoDate(new Date())
}

/** byDate[dateStr] → 토큰 합계 (input + output, Claude Desktop /code 규칙) */
function totalTokensOf(dayEntry) {
  if (!dayEntry || !dayEntry.tokens) return 0
  const t = dayEntry.tokens
  return (t.input || 0) + (t.output || 0)
}

/** Anthropic dislike 뱃지 조건 — 일일 비용 $2000 이상 (gold tier) */
function hasCostBadge(dayEntry) {
  return !!(dayEntry && typeof dayEntry.costUSD === "number" && dayEntry.costUSD >= 2000)
}

// ── 상태 ─────────────────────────────────────────────
// 현재 표시 중인 달 (기본 = 오늘이 속한 달)
const _now = new Date()
const currentMonth = { year: _now.getFullYear(), month: _now.getMonth() + 1 }

// 가장 최근 렌더링 시 사용한 데이터 (navigateMonth 재렌더용)
let _lastUsageData = null

// ── 히트맵 렌더링 (no-op) ───────────────────────────────
// Year heatmap 제거됨 (사용자 요청, 2026-04-13).
// 호출부(usage.js renderAll)에서 여전히 호출해도 무해하도록 stub만 유지.
// window.usageCalendar.renderHeatmap export도 유지 — 외부 호출부가 깨지지 않게.
function renderHeatmap(usageData) {
  // 최근 데이터만 보관 (patchCell 등에서 참조 가능성 대비)
  if (usageData) _lastUsageData = usageData
}

// ── 월 격자 렌더링 ─────────────────────────────────────
/**
 * #month-grid 영역을 비우고 {year, month} 월의 7열 격자를 생성.
 * 헤더: ◀  YYYY-MM  ▶
 * 각 셀: 날짜, 토큰, $·시간, 하단 색상 막대 (스펙 §8c)
 */
function renderMonthGrid(usageData, year, month) {
  _lastUsageData = usageData || _lastUsageData
  if (typeof year === "number" && typeof month === "number") {
    currentMonth.year = year
    currentMonth.month = month
  }

  const root = document.getElementById("month-grid")
  if (!root) return

  root.innerHTML = ""
  root.classList.remove("usage-placeholder")
  root.classList.add("monthgrid-root")

  const byDate = (usageData && usageData.byDate) || {}
  const y = currentMonth.year
  const m = currentMonth.month // 1-12

  // ── 헤더 (◀ YYYY-MM ▶) ──
  const header = document.createElement("div")
  header.className = "monthgrid-header"

  const prevBtn = document.createElement("button")
  prevBtn.type = "button"
  prevBtn.className = "monthgrid-nav"
  prevBtn.textContent = "◀"
  prevBtn.title = "이전 달"
  prevBtn.addEventListener("click", () => navigateMonth(-1))

  const label = document.createElement("span")
  label.className = "monthgrid-label"
  label.textContent = y + "-" + String(m).padStart(2, "0")

  const nextBtn = document.createElement("button")
  nextBtn.type = "button"
  nextBtn.className = "monthgrid-nav"
  nextBtn.textContent = "▶"
  nextBtn.title = "다음 달"
  nextBtn.addEventListener("click", () => navigateMonth(+1))

  // 미래 달은 다음 버튼 비활성
  const todayD = new Date()
  const isFutureMonthAhead =
    y > todayD.getFullYear() || (y === todayD.getFullYear() && m >= todayD.getMonth() + 1)
  if (isFutureMonthAhead) {
    nextBtn.disabled = true
    nextBtn.classList.add("is-disabled")
  }

  header.appendChild(prevBtn)
  header.appendChild(label)
  header.appendChild(nextBtn)
  root.appendChild(header)

  // ── 요일 헤더 (일~토) ──
  const dowRow = document.createElement("div")
  dowRow.className = "monthgrid-dow"
  ;["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((name) => {
    const c = document.createElement("div")
    c.className = "monthgrid-dow-cell"
    c.textContent = name
    dowRow.appendChild(c)
  })
  root.appendChild(dowRow)

  // ── 월 격자 본체 ──
  const grid = document.createElement("div")
  grid.className = "monthgrid-body"

  // 1일 요일 (0=일~6=토)
  const first = new Date(y, m - 1, 1)
  const firstDow = first.getDay()
  const daysInMonth = new Date(y, m, 0).getDate()

  // 앞쪽 빈 칸
  for (let i = 0; i < firstDow; i++) {
    const empty = document.createElement("div")
    empty.className = "monthgrid-cell is-empty"
    grid.appendChild(empty)
  }

  const todayKey = todayStr()

  for (let day = 1; day <= daysInMonth; day++) {
    const key = y + "-" + String(m).padStart(2, "0") + "-" + String(day).padStart(2, "0")
    const entry = byDate[key]
    const total = totalTokensOf(entry)

    // 미래 날짜 판별
    const cellDate = new Date(y, m - 1, day)
    cellDate.setHours(0, 0, 0, 0)
    const isFuture = cellDate > todayD

    const cell = document.createElement("div")
    cell.className = "monthgrid-cell"
    cell.dataset.date = key
    if (key === todayKey) cell.classList.add("is-today")
    if (isFuture) cell.classList.add("is-future")
    if (!entry) cell.classList.add("is-blank")

    // 좌상: 날짜 + 우상: 서브에이전트 뱃지
    const topRow = document.createElement("div")
    topRow.className = "cell-top"
    const dateEl = document.createElement("span")
    dateEl.className = "cell-date"
    dateEl.textContent = String(day)
    topRow.appendChild(dateEl)

    if (hasCostBadge(entry)) {
      const badge = document.createElement("span")
      badge.className = "cell-cost-badge"
      badge.textContent = "A"
      badge.title = "Anthropic dislikes it"
      topRow.appendChild(badge)
    }
    cell.appendChild(topRow)

    // 중간: 토큰 수 + $·시간
    if (entry && total > 0) {
      const tokensEl = document.createElement("div")
      tokensEl.className = "cell-tokens"
      tokensEl.textContent = formatTokens(total) + " tokens"
      cell.appendChild(tokensEl)

      const metaEl = document.createElement("div")
      metaEl.className = "cell-meta"
      const costSpan = document.createElement("strong")
      costSpan.textContent = formatCost(entry.costUSD)
      metaEl.appendChild(costSpan)
      metaEl.appendChild(document.createTextNode(" · " + formatDuration(entry.activeMs)))
      cell.appendChild(metaEl)

      // 하단 색상 막대 (비용 기반)
      const bar = document.createElement("div")
      bar.className = "cell-bar"
      bar.style.background = colorForCost(entry.costUSD)
      cell.appendChild(bar)

      // 클릭 → 이벤트 emit
      cell.addEventListener("click", () => emitDayClicked(key))
    }

    grid.appendChild(cell)
  }

  root.appendChild(grid)
}

// ── 월 이동 ────────────────────────────────────────────
function navigateMonth(delta) {
  let y = currentMonth.year
  let m = currentMonth.month + delta
  while (m < 1) {
    m += 12
    y -= 1
  }
  while (m > 12) {
    m -= 12
    y += 1
  }

  // 미래 달은 막기 (오늘 기준)
  const today = new Date()
  if (y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth() + 1)) {
    return
  }

  currentMonth.year = y
  currentMonth.month = m
  renderMonthGrid(_lastUsageData, y, m)
}

// ── 셀 클릭 → 이벤트 emit (Step 4 모달 수신) ─────────────
function emitDayClicked(dateStr) {
  document.dispatchEvent(
    new CustomEvent("usage:day-clicked", {
      detail: { date: dateStr },
    }),
  )
}

// ── 단일 셀 부분 패치 (SSE usage_delta 대응) ──────────────
/**
 * 해당 날짜의 월 격자 셀의 색상/텍스트만 in-place 업데이트.
 * 전체 DOM 재렌더 대신 최소 비용으로 반영.
 *
 * 셀이 존재하지 않으면 (예: 다른 달을 보고 있거나 새 날짜) 풀 재렌더로 fallback.
 * (Year heatmap 제거됨 — 2026-04-13. 이제 month grid만 패치.)
 *
 * @param {string} dateStr — 'YYYY-MM-DD' (UTC 또는 로컬 — /api/usage와 동일 규칙)
 * @param {object} dayData — usageData.byDate[dateStr]
 */
function patchCell(dateStr, dayData) {
  if (!dateStr) return
  _lastUsageData = _lastUsageData || window.usageData || null

  const total = totalTokensOf(dayData)
  const color = colorForCost(dayData && dayData.costUSD)
  const costTxt = formatCost(dayData && dayData.costUSD)
  const tokTxt = formatTokens(total)
  const durTxt = formatDuration(dayData && dayData.activeMs)

  // ── 월 격자 셀만 패치 (year heatmap은 제거됨) ──────────
  const mgCell = document.querySelector('#month-grid .monthgrid-cell[data-date="' + dateStr + '"]')
  if (!mgCell) {
    // 현재 보고 있는 달이 아니면 히트맵만 업데이트하고 종료 (정상 경로)
    // 단, 현재 달인데 is-blank 상태였다면 풀 재렌더로 해당 셀을 추가
    if (_lastUsageData && isInCurrentMonth(dateStr)) {
      renderMonthGrid(_lastUsageData)
    }
    return
  }

  if (dayData && total > 0) {
    mgCell.classList.remove("is-blank")

    // 토큰 텍스트
    let tokensEl = mgCell.querySelector(".cell-tokens")
    if (!tokensEl) {
      tokensEl = document.createElement("div")
      tokensEl.className = "cell-tokens"
      mgCell.appendChild(tokensEl)
    }
    tokensEl.textContent = tokTxt + " tokens"

    // $·시간
    let metaEl = mgCell.querySelector(".cell-meta")
    if (!metaEl) {
      metaEl = document.createElement("div")
      metaEl.className = "cell-meta"
      mgCell.appendChild(metaEl)
    }
    metaEl.innerHTML = ""
    const costSpan = document.createElement("strong")
    costSpan.textContent = costTxt
    metaEl.appendChild(costSpan)
    metaEl.appendChild(document.createTextNode(" · " + durTxt))

    // 하단 바
    let bar = mgCell.querySelector(".cell-bar")
    if (!bar) {
      bar = document.createElement("div")
      bar.className = "cell-bar"
      mgCell.appendChild(bar)
    }
    bar.style.background = color

    // Anthropic dislike 뱃지 ($2000+)
    const topRow = mgCell.querySelector(".cell-top")
    if (topRow) {
      let badge = topRow.querySelector(".cell-cost-badge")
      const shouldShow = hasCostBadge(dayData)
      if (shouldShow && !badge) {
        badge = document.createElement("span")
        badge.className = "cell-cost-badge"
        badge.textContent = "A"
        badge.title = "Anthropic dislikes it"
        topRow.appendChild(badge)
      } else if (!shouldShow && badge) {
        badge.remove()
      }
    }

    // 클릭 핸들러 1회 부착
    if (!mgCell._usagePatchBound) {
      mgCell._usagePatchBound = true
      mgCell.addEventListener("click", () => emitDayClicked(dateStr))
    }
  }
}

/** 현재 보고 있는 달에 해당 날짜가 포함되는지 */
function isInCurrentMonth(dateStr) {
  const parts = dateStr.split("-")
  if (parts.length < 2) return false
  const y = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  return y === currentMonth.year && m === currentMonth.month
}

// ── 전역 노출 ──────────────────────────────────────────
export const usageCalendar = {
  renderHeatmap,
  renderMonthGrid,
  navigateMonth,
  patchCell,
  currentMonth,
  _formatTokens: formatTokens,
  _formatCost: formatCost,
  _formatDuration: formatDuration,
  _colorForCost: colorForCost,
}
if (typeof window !== "undefined") window.usageCalendar = usageCalendar
