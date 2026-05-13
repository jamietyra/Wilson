/* ─── monitor-usage 페이지 차트 모듈 (Phase 3+4) ─────────
 * 역할:
 *   1) Daily Usage 4-stack bar (input/cacheRead/cacheWrite/output)
 *   2) Model Breakdown donut (tokens/cost 토글)
 *   3) Top Projects horizontal bar (상위 5개, 토큰 기준)
 *
 * 원칙:
 *   - Chart.js 4.4.1 UMD (CDN) 사용. 미로드 시 silent return + 경고.
 *   - 차트 인스턴스는 모듈 레벨에서 캐싱 → 재렌더시 chart.data 갱신 + chart.update() (flicker 최소화).
 *   - 토큰 색상 스킴: 파랑 계열 스케일 통일.
 *
 * 공개 API: window.usageCharts.*
 *   - renderDailyUsageChart(usageData, period)
 *   - renderModelBreakdown(usageData, period, mode?)
 *   - renderTopProjects(usageData, period)
 *   - renderAll(usageData, period)
 *   - currentMode (getter/setter — Model Breakdown 토글 상태)
 */

// usage-charts.js — monitor-usage 차트 (ES Module)

// ── 모듈 상태 ──────────────────────────────────────────
let dailyUsageChart = null
let modelBreakdownChart = null
let topProjectsChart = null
let currentMode = "tokens" // 'tokens' | 'cost' (Model Breakdown 토글)
let lastUsageData = null
let lastPeriod = "month"
let toggleBound = false

// ── 색상 스킴 ──────────────────────────────────────────
const COLORS = {
  // Daily 4-stack (입력/캐시/출력 파랑 계열)
  input: "#93c5fd",
  cacheRead: "#60a5fa",
  cacheWrite: "#3b82f6",
  output: "#2563eb",
  // Model 도넛 — opus 4.7=파랑, opus 4.6=와인, sonnet=녹색, haiku=노랑
  opus: "#2563eb",
  opusLegacy: "#8e1e3a",
  sonnet: "#22c55e",
  haiku: "#eab308",
  unknown: "#9ca3af",
  // Top Projects
  project: "#3b82f6",
}

// ── 공통 유틸 ──────────────────────────────────────────
function hasChart() {
  if (typeof window.Chart === "undefined") {
    console.warn("[usage-charts] Chart.js 미로드 — 차트 렌더 skip")
    return false
  }
  return true
}

// format.js 공용 헬퍼 재사용
const isoDate = window.wilsonFormat.isoDate
const formatTokens = window.wilsonFormat.formatTokens
const formatCost = window.wilsonFormat.formatCost

/** period → [startDate, endDate] (Date 객체) — byDate 키는 'YYYY-MM-DD' */
function rangeForPeriod(period) {
  const now = new Date()
  if (period === "week") {
    const start = new Date(now)
    start.setDate(start.getDate() - 6) // 오늘 포함 7일
    return [start, now]
  }
  if (period === "day") {
    // Day 뷰는 시간대 분할 불가 → Daily 차트에선 최근 7일로 대체
    // (이 함수는 raw range만 반환 — Daily 렌더러가 day일 때 week으로 바꿔 사용)
    return [new Date(now), now]
  }
  // month: 이번달 1일 ~ 오늘
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  return [first, now]
}

/** [start, end] 사이 모든 날짜의 YYYY-MM-DD 배열 (오름차순) */
function enumerateDays(start, end) {
  const out = []
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  while (d.getTime() <= last.getTime()) {
    out.push(isoDate(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** 라벨용: 'YYYY-MM-DD' → 'MM-DD' */
function shortLabel(dateKey) {
  return dateKey.slice(5)
}

// ── Phase 3: Daily Usage 단일 총합 바 (분해 제거, 사용자 요청 2026-04-14) ──
/**
 * period 내 날짜별 토큰 (input + output).
 * Claude Desktop /code 와 동일 규칙 — cacheRead/cacheWrite 제외.
 * Day 뷰는 일 단위 데이터 특성상 시간대 분할 불가 → 최근 7일로 대체 표시.
 */
function buildDailySeries(usageData, period) {
  const effectivePeriod = period === "day" ? "week" : period
  const [start, end] = rangeForPeriod(effectivePeriod)
  const days = enumerateDays(start, end)
  const byDate = (usageData && usageData.byDate) || {}

  const totals = []
  const costs = []

  days.forEach((k) => {
    const day = byDate[k]
    if (!day || !day.tokens) {
      totals.push(0)
      costs.push(0)
      return
    }
    const t = day.tokens
    const sum = (t.input || 0) + (t.output || 0)
    totals.push(sum)
    costs.push(day.costUSD || 0)
  })

  return {
    labels: days.map(shortLabel),
    rawDates: days,
    costs,
    datasets: [{ label: "tokens", data: totals, backgroundColor: COLORS.output }],
  }
}

function renderDailyUsageChart(usageData, period) {
  if (!hasChart()) return
  const canvas = document.querySelector("#daily-usage-chart canvas")
  if (!canvas) return

  const series = buildDailySeries(usageData, period)
  const data = { labels: series.labels, datasets: series.datasets }

  if (dailyUsageChart) {
    dailyUsageChart.data = data
    dailyUsageChart.$costs = series.costs
    dailyUsageChart.update()
    return
  }

  const ctx = canvas.getContext("2d")
  dailyUsageChart = new window.Chart(ctx, {
    type: "bar",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y || 0
              const costs = dailyUsageChart && dailyUsageChart.$costs
              const idx = ctx.dataIndex
              const cost = costs ? costs[idx] || 0 : 0
              return `${formatTokens(v)} · ${formatCost(cost)}`
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          ticks: { callback: (v) => formatTokens(v) },
          grid: { color: "rgba(148,163,184,0.12)" },
        },
      },
    },
  })
  dailyUsageChart.$costs = series.costs
}

// ── Phase 4: Model Breakdown donut ─────────────────────
function modelColor(name) {
  const n = (name || "").toLowerCase()
  if (n.includes("opus")) {
    // 4.7은 새 파랑, 4.6은 와인 (구분)
    if (n.includes("4-6") || n.includes("4.6")) return COLORS.opusLegacy
    return COLORS.opus
  }
  if (n.includes("sonnet")) return COLORS.sonnet
  if (n.includes("haiku")) return COLORS.haiku
  return COLORS.unknown
}

function buildModelSeries(usageData, period, mode) {
  // Day 포함 — period 그대로 (기간 내 모든 byDate 순회)
  const [start, end] = period === "day" ? [new Date(), new Date()] : rangeForPeriod(period)
  const startKey = isoDate(start)
  const endKey = isoDate(end)
  const byDate = (usageData && usageData.byDate) || {}

  const agg = {} // modelKey → {tokens, cost}
  Object.keys(byDate).forEach((k) => {
    if (k < startKey || k > endKey) return
    const day = byDate[k]
    if (!day || !day.byModel) return
    Object.keys(day.byModel).forEach((mkey) => {
      const m = day.byModel[mkey]
      if (!m) return
      if (!agg[mkey]) agg[mkey] = { tokens: 0, cost: 0 }
      const t = m.tokens || {}
      // input + output 만 집계 (Claude Desktop /code 규칙)
      agg[mkey].tokens += (t.input || 0) + (t.output || 0)
      agg[mkey].cost += m.costUSD || 0
    })
  })

  // 정렬 (현재 모드 기준 내림차순)
  const entries = Object.entries(agg)
    .map(([name, v]) => ({ name, tokens: v.tokens, cost: v.cost }))
    .filter((e) => (mode === "cost" ? e.cost > 0 : e.tokens > 0))
    .sort((a, b) => (mode === "cost" ? b.cost - a.cost : b.tokens - a.tokens))

  return {
    labels: entries.map((e) => e.name),
    data: entries.map((e) => (mode === "cost" ? e.cost : e.tokens)),
    colors: entries.map((e) => modelColor(e.name)),
    raw: entries,
  }
}

function renderModelBreakdown(usageData, period, mode) {
  if (!hasChart()) return
  if (mode) currentMode = mode
  const canvas = document.querySelector("#model-breakdown-chart canvas")
  if (!canvas) return

  // 토글 버튼 active 클래스 동기화
  const panel = document.getElementById("model-breakdown-chart")
  if (panel) {
    panel.querySelectorAll(".chart-mode-btn").forEach((btn) => {
      if (btn.dataset.mode === currentMode) btn.classList.add("active")
      else btn.classList.remove("active")
    })
  }

  const series = buildModelSeries(usageData, period, currentMode)
  const total = series.data.reduce((a, b) => a + b, 0)

  const data = {
    labels: series.labels,
    datasets: [
      {
        data: series.data,
        backgroundColor: series.colors,
        borderWidth: 0,
      },
    ],
  }

  if (modelBreakdownChart) {
    modelBreakdownChart.data = data
    modelBreakdownChart.$mode = currentMode
    modelBreakdownChart.$total = total
    modelBreakdownChart.update()
    return
  }

  const ctx = canvas.getContext("2d")
  modelBreakdownChart = new window.Chart(ctx, {
    type: "doughnut",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "55%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            // "opus-4-6: 123K tokens (32%)" 또는 "opus-4-6: $1.23 (32%)"
            label: (ctx) => {
              const label = ctx.label
              const v = ctx.parsed || 0
              const tot = modelBreakdownChart && modelBreakdownChart.$total
              const pct = tot > 0 ? Math.round((v / tot) * 100) : 0
              const mode = (modelBreakdownChart && modelBreakdownChart.$mode) || "tokens"
              const body = mode === "cost" ? formatCost(v) : formatTokens(v) + " tokens"
              return `${label}: ${body} (${pct}%)`
            },
          },
        },
      },
    },
  })
  modelBreakdownChart.$mode = currentMode
  modelBreakdownChart.$total = total
}

// ── Phase 4: Top Projects horizontal bar ───────────────
function buildProjectSeries(usageData, period) {
  const [start, end] = period === "day" ? [new Date(), new Date()] : rangeForPeriod(period)
  const startKey = isoDate(start)
  const endKey = isoDate(end)
  const byDate = (usageData && usageData.byDate) || {}

  const agg = {}
  Object.keys(byDate).forEach((k) => {
    if (k < startKey || k > endKey) return
    const day = byDate[k]
    if (!day || !day.byProject) return
    Object.keys(day.byProject).forEach((name) => {
      // '_orphan' / 빈 프로젝트 필터링
      if (!name || name === "_orphan" || name === "unknown") return
      const p = day.byProject[name]
      if (!p) return
      if (!agg[name]) agg[name] = { tokens: 0, cost: 0 }
      const t = p.tokens || {}
      // input + output 만 집계 (Claude Desktop /code 규칙)
      agg[name].tokens += (t.input || 0) + (t.output || 0)
      agg[name].cost += p.costUSD || 0
    })
  })

  const list = Object.entries(agg)
    .map(([name, v]) => ({ name, tokens: v.tokens, cost: v.cost }))
    .filter((e) => e.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)

  return {
    labels: list.map((e) => e.name),
    tokens: list.map((e) => e.tokens),
    costs: list.map((e) => e.cost),
  }
}

/**
 * Top Projects — Chart.js 대신 HTML 리스트로 렌더 (사용자 요청 2026-04-14).
 * 각 행: session-tag (Feeds 스타일) + 진행 바 + 토큰/비용.
 */
function renderTopProjects(usageData, period) {
  const panel = document.getElementById("top-projects-chart")
  if (!panel) return
  const body = panel.querySelector(".chart-body")
  if (!body) return

  const series = buildProjectSeries(usageData, period)
  const maxTokens = series.tokens[0] || 1

  // 기존 Chart.js 인스턴스 남아있으면 해제 (canvas가 곧 교체됨)
  if (topProjectsChart) {
    try {
      topProjectsChart.destroy()
    } catch (_) {
      /* skip */
    }
    topProjectsChart = null
  }

  const makeTag =
    window.usageSessions && window.usageSessions.makeSessionTag
      ? window.usageSessions.makeSessionTag
      : (n) => '<span class="session-tag">' + String(n) + "</span>"

  if (series.labels.length === 0) {
    body.innerHTML = '<div class="tp-empty">데이터 없음</div>'
    return
  }

  let html = '<div class="top-projects-list">'
  series.labels.forEach((name, i) => {
    const tokens = series.tokens[i]
    const cost = series.costs[i]
    const pct = Math.max(2, (tokens / maxTokens) * 100)
    html +=
      '<div class="tp-row">' +
      '<div class="tp-tag">' +
      makeTag(name) +
      "</div>" +
      '<div class="tp-bar"><div class="tp-bar-fill" style="width:' +
      pct +
      '%"></div></div>' +
      '<div class="tp-stats">' +
      formatTokens(tokens) +
      " · " +
      formatCost(cost) +
      "</div>" +
      "</div>"
  })
  html += "</div>"
  body.innerHTML = html
}

// ── Model Breakdown 토글 클릭 핸들러 (1회만 바인딩) ──
function bindModelToggle() {
  if (toggleBound) return
  const panel = document.getElementById("model-breakdown-chart")
  if (!panel) return
  const btns = panel.querySelectorAll(".chart-mode-btn")
  if (!btns.length) return
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode
      if (!mode || mode === currentMode) return
      currentMode = mode
      // 최신 데이터로 재렌더
      renderModelBreakdown(lastUsageData, lastPeriod, mode)
    })
  })
  toggleBound = true
}

// ── 일괄 렌더 ──────────────────────────────────────────
function renderAll(usageData, period) {
  if (!usageData) return
  lastUsageData = usageData
  lastPeriod = period || "month"
  bindModelToggle()
  renderDailyUsageChart(usageData, lastPeriod)
  renderModelBreakdown(usageData, lastPeriod, currentMode)
  renderTopProjects(usageData, lastPeriod)
}

// ── 전역 API 노출 ──────────────────────────────────────
export const usageCharts = {
  renderDailyUsageChart,
  renderModelBreakdown,
  renderTopProjects,
  renderAll,
  get currentMode() {
    return currentMode
  },
  set currentMode(v) {
    currentMode = v
  },
}
if (typeof window !== "undefined") window.usageCharts = usageCharts
