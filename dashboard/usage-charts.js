/* ─── monitor-usage 페이지 차트 모듈 (Phase 3+4) ─────────
 * 역할:
 *   1) Daily Usage bar (모델별 색상 스택)
 *   2) Top Projects horizontal bar (상위 5개, 토큰 기준)
 *   3) Hourly Activity heatmap (요일 × 시간)
 *
 * 원칙:
 *   - Chart.js 4.4.1 UMD (CDN) 사용. 미로드 시 silent return + 경고.
 *   - 차트 인스턴스는 모듈 레벨에서 캐싱 → 재렌더시 chart.data 갱신 + chart.update() (flicker 최소화).
 *   - 토큰 색상 스킴: 파랑 계열 스케일 통일.
 *
 * 공개 API: window.usageCharts.*
 *   - renderDailyUsageChart(usageData, period)
 *   - renderTopProjects(usageData, period)
 *   - renderHourlyHeatmap(usageData, period)
 *   - renderAll(usageData, period)
 */

// usage-charts.js — monitor-usage 차트 (ES Module)

// ── 모듈 상태 ──────────────────────────────────────────
let dailyUsageChart = null
let topProjectsChart = null
let lastPeriod = "month"

// ── 색상 스킴 ──────────────────────────────────────────
const COLORS = {
  // 모델 색상은 MODEL_COLORS(아래)로 이관. 여기 남은 키 중 unknown만 사용 중.
  // (input/cacheRead/cacheWrite/project: 구 4-stack·Top Projects 잔재 — 현재 미사용)
  input: "#93c5fd",
  cacheRead: "#60a5fa",
  cacheWrite: "#3b82f6",
  unknown: "#9ca3af",
  project: "#3b82f6",
}

// ── 모델별 색상·라벨 (Daily 스택 막대 + Model 도넛 공용 SSOT) ──
// 키 = normalizeModel 결과 (날짜·[1m] suffix 제거된 형태)
// opus 4.8=보라(최신) · 4.7=파랑 · 4.6=와인(legacy) · sonnet 4.6=녹색 · haiku 4.5=노랑
const MODEL_COLORS = {
  "claude-opus-4-8": "#a855f7",
  "claude-opus-4-7": "#2563eb",
  "claude-opus-4-6": "#8e1e3a",
  "claude-sonnet-4-6": "#22c55e",
  "claude-haiku-4-5": "#eab308",
}
const MODEL_LABELS = {
  "claude-opus-4-8": "Opus 4.8",
  "claude-opus-4-7": "Opus 4.7",
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5",
}

/** byModel 키 → 표시 라벨 ("Opus 4.8"). 미등록은 claude- 접두 제거 fallback. */
function modelLabel(key) {
  if (MODEL_LABELS[key]) return MODEL_LABELS[key]
  return (key || "unknown").replace(/^claude-/, "")
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

// ── Phase 3: Daily Usage 모델별 스택 바 (모델 분해, 사용자 요청 2026-05-29) ──
/**
 * period 내 날짜별 × 모델별 토큰 (input + output) 스택.
 * Claude Desktop /code 와 동일 규칙 — cacheRead/cacheWrite 제외.
 * 모델당 dataset 1개 (stacked): Opus 4.8/4.7/4.6, Sonnet 4.6, Haiku 4.5 색상 구분.
 * Day 뷰는 일 단위 데이터 특성상 시간대 분할 불가 → 최근 7일로 대체 표시.
 */
function buildDailySeries(usageData, period) {
  const effectivePeriod = period === "day" ? "week" : period
  const [start, end] = rangeForPeriod(effectivePeriod)
  const days = enumerateDays(start, end)
  const byDate = (usageData && usageData.byDate) || {}

  // 1) 기간 내 등장한 모델별 총 토큰 (표시 대상 + 스택 순서 결정)
  const modelTotals = {}
  days.forEach((k) => {
    const day = byDate[k]
    if (!day || !day.byModel) return
    Object.keys(day.byModel).forEach((mkey) => {
      const t = (day.byModel[mkey] && day.byModel[mkey].tokens) || {}
      modelTotals[mkey] = (modelTotals[mkey] || 0) + (t.input || 0) + (t.output || 0)
    })
  })
  // 토큰 많은 모델이 스택 바닥 → 내림차순
  const models = Object.keys(modelTotals)
    .filter((m) => modelTotals[m] > 0)
    .sort((a, b) => modelTotals[b] - modelTotals[a])

  // 2) 모델별 dataset (일자별 토큰) + 일자별 cost 동봉 ($segCosts — 툴팁용)
  const datasets = models.map((mkey) => {
    const data = []
    const segCosts = []
    days.forEach((k) => {
      const m = byDate[k] && byDate[k].byModel && byDate[k].byModel[mkey]
      const t = (m && m.tokens) || {}
      data.push((t.input || 0) + (t.output || 0))
      segCosts.push((m && m.costUSD) || 0)
    })
    return {
      label: modelLabel(mkey),
      data,
      backgroundColor: modelColor(mkey),
      $segCosts: segCosts,
      stack: "tokens",
    }
  })

  // 3) 일자별 총합 (툴팁 footer "합계 …" 용) — byModel 합산으로 스택과 정합
  const dayTotals = days.map((k) => {
    const day = byDate[k]
    let tok = 0
    let cost = 0
    if (day && day.byModel) {
      Object.keys(day.byModel).forEach((mk) => {
        const t = (day.byModel[mk] && day.byModel[mk].tokens) || {}
        tok += (t.input || 0) + (t.output || 0)
        cost += (day.byModel[mk] && day.byModel[mk].costUSD) || 0
      })
    }
    return { tok, cost }
  })

  return {
    labels: days.map(shortLabel),
    rawDates: days,
    datasets,
    dayTotals,
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
    dailyUsageChart.$dayTotals = series.dayTotals
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
        legend: {
          display: true,
          position: "bottom",
          labels: { boxWidth: 12, font: { size: 11 } },
        },
        tooltip: {
          // 0 토큰 세그먼트는 툴팁에서 숨김
          filter: (item) => (item.parsed.y || 0) > 0,
          callbacks: {
            // 세그먼트별: "Opus 4.8: 1.2M · $12.34"
            label: (ctx) => {
              const v = ctx.parsed.y || 0
              const segCosts = ctx.dataset && ctx.dataset.$segCosts
              const cost = segCosts ? segCosts[ctx.dataIndex] || 0 : 0
              return `${ctx.dataset.label}: ${formatTokens(v)} · ${formatCost(cost)}`
            },
            // 그날 전체 합계 (모델 합산)
            footer: (items) => {
              if (!items || !items.length) return ""
              const totals = dailyUsageChart && dailyUsageChart.$dayTotals
              const t = totals ? totals[items[0].dataIndex] : null
              if (!t) return ""
              return `합계 ${formatTokens(t.tok)} · ${formatCost(t.cost)}`
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
  dailyUsageChart.$dayTotals = series.dayTotals
}

// ── 모델 색상 헬퍼 (Daily 스택 바 공용) ─────────────────
function modelColor(name) {
  // 1) 정규화 키 정확 매칭 (SSOT)
  if (MODEL_COLORS[name]) return MODEL_COLORS[name]
  // 2) 날짜/[1m] suffix가 붙은 변형 등 — 부분 문자열 fallback
  const n = (name || "").toLowerCase()
  if (n.includes("opus")) {
    if (n.includes("4-8") || n.includes("4.8")) return MODEL_COLORS["claude-opus-4-8"]
    if (n.includes("4-6") || n.includes("4.6")) return MODEL_COLORS["claude-opus-4-6"]
    return MODEL_COLORS["claude-opus-4-7"] // 그 외 opus는 파랑 기본
  }
  if (n.includes("sonnet")) return MODEL_COLORS["claude-sonnet-4-6"]
  if (n.includes("haiku")) return MODEL_COLORS["claude-haiku-4-5"]
  return COLORS.unknown
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

// ── Hourly Heatmap (요일 × 시간) — #32 ──────────────────
// byHour 는 UTC 기준. matrix[weekday(0=Sun..6=Sat)][hour(0..23)] = tokens 누적.
function sumTokenObj(tokens) {
  if (!tokens) return 0
  let total = 0
  for (const k of Object.keys(tokens)) total += tokens[k] || 0
  return total
}

function buildHourlyHeatmap(usageData, period) {
  const [start, end] = rangeForPeriod(period === "day" ? "week" : period)
  const startKey = isoDate(start)
  const endKey = isoDate(end)
  const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const byDate = (usageData && usageData.byDate) || {}
  let maxVal = 0
  for (const dateKey of Object.keys(byDate)) {
    if (dateKey < startKey || dateKey > endKey) continue
    const day = byDate[dateKey]
    if (!day || !day.byHour) continue
    const d = new Date(`${dateKey}T00:00:00Z`)
    const wd = d.getUTCDay()
    for (const hourKey of Object.keys(day.byHour)) {
      const hr = day.byHour[hourKey]
      if (!hr || !hr.tokens) continue
      const t = sumTokenObj(hr.tokens)
      const h = parseInt(hourKey, 10)
      if (h < 0 || h > 23) continue
      matrix[wd][h] += t
      if (matrix[wd][h] > maxVal) maxVal = matrix[wd][h]
    }
  }
  return { matrix, maxVal }
}

function renderHourlyHeatmap(usageData, period) {
  const container = document.querySelector("#hourly-heatmap-chart .heatmap-grid")
  if (!container) return
  const { matrix, maxVal } = buildHourlyHeatmap(usageData, period)
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const out = []
  // 헤더 행: 시간 라벨 (4시간 간격)
  out.push('<div class="hh-row hh-header"><span class="hh-day-label"></span>')
  for (let h = 0; h < 24; h++) {
    const label = h % 4 === 0 ? String(h).padStart(2, "0") : ""
    out.push(`<span class="hh-hour-label">${label}</span>`)
  }
  out.push("</div>")
  // 7 요일 행
  for (let w = 0; w < 7; w++) {
    out.push(`<div class="hh-row"><span class="hh-day-label">${weekdayLabels[w]}</span>`)
    for (let h = 0; h < 24; h++) {
      const v = matrix[w][h]
      const intensity = maxVal > 0 ? v / maxVal : 0
      const hourStr = String(h).padStart(2, "0")
      const tooltip = `${weekdayLabels[w]} ${hourStr}:00 UTC · ${formatTokens(v)}`
      out.push(
        `<span class="hh-cell" style="--hh-intensity:${intensity.toFixed(3)}" data-tooltip="${tooltip}"></span>`,
      )
    }
    out.push("</div>")
  }
  container.innerHTML = out.join("")
}

// ── 일괄 렌더 ──────────────────────────────────────────
function renderAll(usageData, period) {
  if (!usageData) return
  lastPeriod = period || "month"
  renderDailyUsageChart(usageData, lastPeriod)
  renderTopProjects(usageData, lastPeriod)
  renderHourlyHeatmap(usageData, lastPeriod)
}

// ── 전역 API 노출 ──────────────────────────────────────
export const usageCharts = {
  renderDailyUsageChart,
  renderTopProjects,
  renderHourlyHeatmap,
  renderAll,
}
if (typeof window !== "undefined") window.usageCharts = usageCharts
