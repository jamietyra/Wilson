/**
 * tool-timeline.js v4 — Wilson 패널 하단 가로 Tool Timeline
 *
 * v4 변경: CSS keyframe 대신 requestAnimationFrame 으로 `left` 직접 계산.
 * calc(px ↔ %) 혼합 보간 이슈 제거, 진단 배지(ID='timeline-count') 추가.
 *
 * ES Module — export { toolTimeline }
 */

var ALLOWED_WINDOWS = [60000, 300000, 600000]
var MAX_WINDOW_MS = 600000 // 메모리 유지 한계 (=가장 큰 윈도우). 1m/5m로 좁혀도 이 범위 안 아이콘은 보관 → 10m 재선택 시 복원
var DEFAULT_WINDOW_MS = 600000
var WINDOW_MS = DEFAULT_WINDOW_MS
var LANES = 6
var STORAGE_KEY = "toolTimeline.state.v1"
var RANGE_STORAGE_KEY = "toolTimeline.range.v1"

var track = null
var clearBtn = null
var countEl = null
var axisEl = null
var rangeGroupEl = null
var ready = false
var rafHandle = 0

// 상태
var icons = [] // [{ el, ts, id, status, lane }]
var idToIcon = new Map() // ev.id → record
var activeSessions = new Map() // sid → lastEventMs
var laneAssignment = new Array(LANES).fill(null)
var laneLastInsert = new Array(LANES).fill(0)

// ── SVG 아이콘 세트 (24×24 stroke) ────────────────────
var ICONS = {
  Read: '<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6"/>',
  Write: '<path d="M3 21v-4l11-11 4 4-11 11z"/><path d="M14 6l4 4"/>',
  Edit: '<path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18 2l4 4-10 10H8v-4z"/>',
  Bash: '<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>',
  Task: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  Glob: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  Web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  Todo: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
  Skill: '<path d="M12 3l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.4l6-.9z"/>',
  Playwright:
    '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M6 7.5h1.5M9 7.5h1.5M12 7.5h1.5"/>',
  // 기본 — 육각형 (기타 도구) — 다른 아이콘과 구분되는 명확한 형태
  _default: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>',
}

function normalizeName(name) {
  if (!name) return "_default"
  var lower = String(name).toLowerCase()
  // TodoWrite는 "write"보다 먼저 매칭 (우선순위 중요)
  if (lower.indexOf("todo") >= 0) return "Todo"
  if (lower.indexOf("playwright") >= 0 || lower.indexOf("browser") >= 0) return "Playwright"
  if (lower === "skill") return "Skill"
  if (lower.indexOf("read") >= 0) return "Read"
  if (lower.indexOf("write") >= 0) return "Write"
  if (lower.indexOf("edit") >= 0) return "Edit"
  if (lower.indexOf("bash") >= 0 || lower.indexOf("shell") >= 0) return "Bash"
  if (lower.indexOf("task") >= 0 || lower === "agent") return "Task"
  if (lower.indexOf("glob") >= 0 || lower.indexOf("grep") >= 0 || lower.indexOf("search") >= 0)
    return "Glob"
  if (
    lower.indexOf("fetch") >= 0 ||
    lower.indexOf("web") >= 0 ||
    lower.indexOf("http") >= 0 ||
    lower.indexOf("url") >= 0
  )
    return "Web"
  return "_default"
}

function svgFor(name) {
  var key = normalizeName(name)
  var inner = ICONS[key] || ICONS._default
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">' +
    inner +
    "</svg>"
  )
}

// ── 로그 스케일(윈도우 비례): 0→0%, W/20→5%, W/10→10%, W/5→20%, W/2→50%, W→100% ──
function elapsedToPercent(elapsedMs) {
  var r = elapsedMs / WINDOW_MS
  if (r <= 0.05) return (r / 0.05) * 5
  if (r <= 0.1) return 5 + ((r - 0.05) / 0.05) * 5
  if (r <= 0.2) return 10 + ((r - 0.1) / 0.1) * 10
  if (r <= 0.5) return 20 + ((r - 0.2) / 0.3) * 30
  if (r <= 1.0) return 50 + ((r - 0.5) / 0.5) * 50
  return 100
}

function fmtSec(s) {
  if (s < 60) return "-" + Math.round(s) + "s"
  var m = s / 60
  if (m === Math.floor(m)) return "-" + m + "m"
  return "-" + m.toFixed(1) + "m"
}

function renderAxis() {
  if (!axisEl) return
  var w = WINDOW_MS / 1000
  var labels = ["now", fmtSec(w / 10), fmtSec(w / 5), fmtSec(w / 2), fmtSec(w)]
  var spans = axisEl.querySelectorAll("span")
  for (var i = 0; i < spans.length && i < labels.length; i++) {
    spans[i].textContent = labels[i]
  }
}

function renderRangeButtons() {
  if (!rangeGroupEl) return
  var btns = rangeGroupEl.querySelectorAll(".timeline-range")
  for (var i = 0; i < btns.length; i++) {
    var ms = parseInt(btns[i].dataset.range, 10)
    if (ms === WINDOW_MS) btns[i].classList.add("active")
    else btns[i].classList.remove("active")
  }
}

function setRange(ms) {
  if (ALLOWED_WINDOWS.indexOf(ms) < 0) return
  if (ms === WINDOW_MS) return
  WINDOW_MS = ms
  try {
    sessionStorage.setItem(RANGE_STORAGE_KEY, String(ms))
  } catch (e) {}
  // 아이콘 제거하지 않음 — tick() 루프가 현재 윈도우 밖이면 숨기고, MAX_WINDOW_MS 초과 시에만 제거.
  // 더 큰 윈도우로 재선택하면 숨겨졌던 아이콘이 다시 보임.
  renderAxis()
  renderRangeButtons()
  updateCount()
}

// ── 레인 분배 — 전 세션 공용 (2026-04-17) ─────────────────
// 이전: 세션별 파티셔닝 (3 세션 → 각 2레인) → 세션 적을 때 빈 레인 발생
// 현재: 모든 레인을 '_shared'로 두어 어떤 세션이든 전체 6레인 사용
function allocateLanes() {
  laneAssignment = new Array(LANES).fill("_shared")
}

function updateActiveSessions(sid, nowMs) {
  activeSessions.set(sid, nowMs)
  var cutoff = nowMs - MAX_WINDOW_MS
  activeSessions.forEach(function (last, s) {
    if (last < cutoff) activeSessions.delete(s)
  })
  allocateLanes()
}

function pickLane(sid) {
  var candidates = []
  for (var i = 0; i < LANES; i++) {
    if (laneAssignment[i] === sid || laneAssignment[i] === "_shared") candidates.push(i)
  }
  if (candidates.length === 0) {
    for (var j = 0; j < LANES; j++) {
      if (laneAssignment[j] === null) candidates.push(j)
    }
  }
  if (candidates.length === 0) candidates = [0, 1, 2, 3, 4, 5]
  var pick = candidates[0]
  var oldest = laneLastInsert[pick]
  for (var c = 1; c < candidates.length; c++) {
    var idx2 = candidates[c]
    if (laneLastInsert[idx2] < oldest) {
      pick = idx2
      oldest = laneLastInsert[idx2]
    }
  }
  return pick
}

// ── 아이콘 DOM ─────────────────────────────────────────
function makeIconEl(ev, lane) {
  var el = document.createElement("div")
  el.className = "timeline-icon"
  el.dataset.tool = normalizeName(ev.name)
  el.dataset.status = "running"

  // lane 중앙
  var laneFrac = (lane + 0.5) / LANES
  el.style.top = "calc(" + laneFrac * 100 + "% - 11px)"
  el.style.left = "0px"
  el.style.opacity = "1"

  // 세션 색 border
  if (window.sessionTag && typeof window.sessionTag.assign === "function") {
    var pal = window.sessionTag.assign(ev.project || "_shared")
    if (pal && pal.bg) el.style.borderColor = pal.bg
  }

  el.innerHTML = svgFor(ev.name)

  var targetFull = ev.target ? String(ev.target) : ""
  var lines = [ev.name || "?"]
  if (targetFull) lines.push(targetFull)
  if (ev.project) lines.push("[" + ev.project + "]")
  el.dataset.tooltip = lines.join("\n")

  return el
}

function updateCount() {
  if (!countEl) return
  var running = 0
  for (var i = 0; i < icons.length; i++) if (icons[i].status === "running") running++
  countEl.textContent = running + "/" + icons.length
}

// ── rAF 루프: 모든 아이콘 위치/opacity 매 프레임 갱신 ──
function tick() {
  if (!ready || icons.length === 0) {
    rafHandle = 0
    return
  }
  rafHandle = requestAnimationFrame(tick)
  var now = Date.now()
  var alive = []
  for (var i = 0; i < icons.length; i++) {
    var it = icons[i]
    var elapsed = now - it.ts
    // 최대 윈도우(10m) 초과 시에만 실제 제거 — 더 작은 윈도우로 좁혔다가 다시 넓혔을 때 복원 가능하도록
    if (elapsed >= MAX_WINDOW_MS) {
      if (it.el.parentNode) it.el.parentNode.removeChild(it.el)
      if (it.id) idToIcon.delete(it.id)
      continue
    }
    // 현재 선택 윈도우 밖 — DOM 은 유지한 채 숨김 (재선택 시 복귀)
    if (elapsed >= WINDOW_MS) {
      if (it.el.style.display !== "none") it.el.style.display = "none"
      alive.push(it)
      continue
    }
    if (it.el.style.display === "none") it.el.style.display = ""
    var pct = elapsedToPercent(elapsed)
    // 양쪽 5% 마진 (아이콘이 끝 clipping 없이 완전히 보임)
    var visualPct = 5 + pct * 0.9 // 0%→5%, 100%→95%
    it.el.style.left = "calc(" + visualPct.toFixed(3) + "% - 11px)"
    // fade-in 0-400ms + fade-out 끝 5%
    var op
    if (elapsed < 400) op = Math.max(0, elapsed / 400)
    else if (pct > 95) op = Math.max(0, (100 - pct) / 5)
    else op = 1
    var opStr = op.toFixed(2)
    if (it.el.style.opacity !== opStr) it.el.style.opacity = opStr
    alive.push(it)
  }
  if (alive.length !== icons.length) {
    icons = alive
    updateCount()
  }
}

// ── 이벤트 처리 ────────────────────────────────────────
function onEvent(ev) {
  if (!ev) return
  // 진단 로그 (DevTools Console 에서 확인 가능)
  try {
    console.debug("[toolTimeline]", ev.type, ev.name, ev.id)
  } catch (e) {}
  if (!ready) {
    console.warn("[toolTimeline] not ready, dropped event")
    return
  }

  var type = ev.type
  if (type === "tool_start") {
    var sid = ev.project || "_shared"
    var now = Date.now()
    updateActiveSessions(sid, now)
    var lane = pickLane(sid)
    laneLastInsert[lane] = now
    var el = makeIconEl(ev, lane)
    track.appendChild(el)
    var record = {
      el: el,
      ts: now,
      id: ev.id,
      status: "running",
      lane: lane,
      name: ev.name,
      target: ev.target,
      project: ev.project,
    }
    icons.push(record)
    if (ev.id) idToIcon.set(ev.id, record)
    updateCount()
    if (!rafHandle) rafHandle = requestAnimationFrame(tick)
  } else if (type === "tool_done" || type === "tool_error") {
    var existing = ev.id ? idToIcon.get(ev.id) : null
    if (existing) {
      existing.status = type === "tool_error" ? "error" : "done"
      existing.el.dataset.status = existing.status
      idToIcon.delete(ev.id)
      updateCount()
    }
  }
}

function clear() {
  while (track && track.firstChild) track.removeChild(track.firstChild)
  icons = []
  idToIcon.clear()
  activeSessions.clear()
  laneAssignment = new Array(LANES).fill(null)
  laneLastInsert = new Array(LANES).fill(0)
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch (e) {}
  updateCount()
}

// ── sessionStorage persistence (페이지 네비 간 유지) ──
function saveState() {
  try {
    var now = Date.now()
    var data = icons
      .filter(function (it) {
        return now - it.ts < MAX_WINDOW_MS
      })
      .map(function (it) {
        return {
          ts: it.ts,
          id: it.id,
          status: it.status,
          lane: it.lane,
          name: it.name,
          target: it.target,
          project: it.project,
        }
      })
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    /* quota or private mode */
  }
}

function restoreState() {
  try {
    var raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return 0
    var data = JSON.parse(raw)
    var now = Date.now()
    var restored = 0
    data.forEach(function (rec) {
      if (now - rec.ts >= MAX_WINDOW_MS) return // stale
      var sid = rec.project || "_shared"
      updateActiveSessions(sid, rec.ts)
      var lane = rec.lane != null && rec.lane >= 0 && rec.lane < LANES ? rec.lane : pickLane(sid)
      var el = makeIconEl(
        { name: rec.name, target: rec.target, project: rec.project, id: rec.id },
        lane,
      )
      // 복원된 아이콘은 항상 done 처리 (페이지 리로드로 tool_done 놓쳤을 수 있음)
      el.dataset.status = "done"
      track.appendChild(el)
      icons.push({
        el: el,
        ts: rec.ts,
        id: rec.id,
        status: "done",
        lane: lane,
        name: rec.name,
        target: rec.target,
        project: rec.project,
      })
      restored++
    })
    if (restored > 0)
      console.info("[toolTimeline] restored " + restored + " icons from sessionStorage")
    return restored
  } catch (e) {
    console.warn("[toolTimeline] restoreState failed", e)
    return 0
  }
}

function init() {
  track = document.getElementById("timeline-track")
  clearBtn = document.getElementById("timeline-clear")
  countEl = document.getElementById("timeline-count")
  axisEl = document.getElementById("timeline-axis")
  rangeGroupEl = document.getElementById("timeline-ranges")
  if (!track) {
    console.warn("[toolTimeline] #timeline-track not found")
    return
  }
  if (clearBtn) clearBtn.addEventListener("click", clear)

  // 저장된 range 복원
  try {
    var savedRange = parseInt(sessionStorage.getItem(RANGE_STORAGE_KEY), 10)
    if (ALLOWED_WINDOWS.indexOf(savedRange) >= 0) WINDOW_MS = savedRange
  } catch (e) {}

  // range 버튼 이벤트 위임
  if (rangeGroupEl) {
    rangeGroupEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".timeline-range")
      if (!btn) return
      var ms = parseInt(btn.dataset.range, 10)
      if (ms) setRange(ms)
    })
  }

  renderAxis()
  renderRangeButtons()

  // 공용 툴팁 바인딩 (빠른 지연 150ms) — feed.js의 window.hoverTooltip 사용
  if (window.hoverTooltip && typeof window.hoverTooltip.bind === "function") {
    window.hoverTooltip.bind(track, 150)
  }

  ready = true
  restoreState()
  updateCount()
  rafHandle = requestAnimationFrame(tick)
  // 페이지 떠날 때 저장 — pagehide 가 iOS/Safari 포함 가장 범용
  window.addEventListener("pagehide", saveState)
  window.addEventListener("beforeunload", saveState)
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") saveState()
  })
  console.info("[toolTimeline] v6 initialized (range selector " + WINDOW_MS / 60000 + "m)")
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init)
} else {
  init()
}

export const toolTimeline = {
  onEvent: onEvent,
  clear: clear,
  setRange: setRange,
  _debug: function () {
    return {
      ready: ready,
      windowMs: WINDOW_MS,
      icons: icons.length,
      running: icons.filter(function (i) {
        return i.status === "running"
      }).length,
      track: !!track,
    }
  },
}
if (typeof window !== "undefined") window.toolTimeline = toolTimeline
