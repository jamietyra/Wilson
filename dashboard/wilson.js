// ─── Wilson — AI Companion Character (ES Module) ──────

// ─── Constants ───────────────────────────────────────
var _cfg = window.wilsonConfig || {}
var WAIT_TIMEOUT = 5000
var SLEEP_TIMEOUT = 600000
var TIP_DISPLAY_TIME = _cfg.TIP_DISPLAY_MS || 15000
var ACTION_LINGER_TIME = _cfg.ACTION_LINGER_MS || 15000
var MAX_RECENT_FILES = _cfg.MAX_RECENT_FILES || 100

// ─── SVGs (5 states) ────────────────────────────────
// 3D 구 조명: 좌상단에서 빛, 우하단으로 음영 — 공이 회전해도 조명은 그 자리(픽스드)
var BALL_LIGHT_DEFS =
  "<defs>" +
  '<radialGradient id="wilsonLight" cx="32%" cy="28%" r="75%">' +
  '<stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>' +
  '<stop offset="45%" stop-color="#ffffff" stop-opacity="0"/>' +
  '<stop offset="100%" stop-color="#000000" stop-opacity="0.35"/>' +
  "</radialGradient>" +
  "</defs>"
var BALL_LIGHT_OVERLAY =
  '<circle cx="24" cy="24" r="22" fill="url(#wilsonLight)" pointer-events="none"/>'
var SVG_START =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Wilson character">' +
  "<title>Wilson</title>" +
  BALL_LIGHT_DEFS +
  '<circle cx="24" cy="24" r="22" fill="#f0ebe0" stroke="#d8d0c4" stroke-width="0.8"/>' +
  '<path d="M11 14 C9 9 13 5 17 7 C19 4 22 3 25 5 C27 3 31 4 33 7 C36 5 40 9 37 14 C41 18 43 24 41 31 C39 38 33 44 24 44 C15 44 9 38 7 31 C5 24 7 18 11 14 Z" fill="#8B1A1A"/>'
var SVG_END =
  '<circle cx="24" cy="28" r="1" fill="white" opacity="0.25"/>' +
  '<path d="M18 35 Q24 39 30 35" fill="none" stroke="white" stroke-width="1" opacity="0.35" stroke-linecap="round"/>' +
  BALL_LIGHT_OVERLAY +
  "</svg>"
// Solving 전용 — 강한 외부 aura(drop-shadow)와 겹쳐도 구형 음영이 튀지 않도록 내부 조명을 약하게
var SVG_END_SOLVING =
  '<circle cx="24" cy="28" r="1" fill="white" opacity="0.25"/>' +
  '<path d="M18 35 Q24 39 30 35" fill="none" stroke="white" stroke-width="1" opacity="0.35" stroke-linecap="round"/>' +
  '<circle cx="24" cy="24" r="22" fill="url(#wilsonLight)" opacity="0.55" pointer-events="none"/>' +
  "</svg>"
// Searching 전용 — 돋보기가 얼굴 위를 천천히 움직임 (눈동자는 집중 상태로 고정)
var SVG_END_SEARCHING =
  '<circle cx="24" cy="28" r="1" fill="white" opacity="0.25"/>' +
  '<path d="M18 35 Q24 39 30 35" fill="none" stroke="white" stroke-width="1" opacity="0.35" stroke-linecap="round"/>' +
  BALL_LIGHT_OVERLAY +
  '<g id="wilsonMagnifier">' +
  // 손잡이 (렌즈 우하단 방향으로)
  '<line x1="29.5" y1="29.5" x2="36" y2="36" stroke="#3a2a1a" stroke-width="2.8" stroke-linecap="round"/>' +
  // 렌즈 유리 (반투명 하늘색)
  '<circle cx="24" cy="24" r="7.5" fill="#b4dcff" fill-opacity="0.22" stroke="#3a2a1a" stroke-width="1.5"/>' +
  // 유리 하이라이트
  '<path d="M 20 21 Q 22 19.5 25 21" fill="none" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.7"/>' +
  "</g>" +
  "</svg>"

// Eyes: normal (centered pupils)
var EYES_NORMAL =
  '<path d="M12 19 Q14 14 19 16 Q22 18 20 23 Q17 26 13 23 Q11 21 12 19 Z" fill="white" opacity="0.9"/>' +
  '<circle cx="16" cy="20" r="2" fill="#1a1a2e"/>' +
  '<path d="M28 16 Q33 14 36 19 Q37 22 35 24 Q31 27 28 23 Q26 19 28 16 Z" fill="white" opacity="0.9"/>' +
  '<circle cx="32" cy="20" r="2" fill="#1a1a2e"/>'
// Eyes: looking up (thinking)
var EYES_UP =
  '<path d="M12 19 Q14 14 19 16 Q22 18 20 23 Q17 26 13 23 Q11 21 12 19 Z" fill="white" opacity="0.9"/>' +
  '<circle cx="17" cy="18" r="2" fill="#1a1a2e"/>' +
  '<path d="M28 16 Q33 14 36 19 Q37 22 35 24 Q31 27 28 23 Q26 19 28 16 Z" fill="white" opacity="0.9"/>' +
  '<circle cx="33" cy="18" r="2" fill="#1a1a2e"/>'
// Eyes: sparkle (solving)
var EYES_SPARKLE =
  '<path d="M12 19 Q14 14 19 16 Q22 18 20 23 Q17 26 13 23 Q11 21 12 19 Z" fill="white" opacity="0.9"/>' +
  '<circle cx="16" cy="20" r="2" fill="#1a1a2e"/>' +
  '<circle cx="17.5" cy="18" r="1.5" fill="white" opacity="0.95"/>' +
  '<path d="M28 16 Q33 14 36 19 Q37 22 35 24 Q31 27 28 23 Q26 19 28 16 Z" fill="white" opacity="0.9"/>' +
  '<circle cx="32" cy="20" r="2" fill="#1a1a2e"/>' +
  '<circle cx="33.5" cy="18" r="1.5" fill="white" opacity="0.95"/>'
// Eyes: closed (sleeping)
var EYES_CLOSED =
  '<path d="M13 21 Q16 23 20 21" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>' +
  '<path d="M28 21 Q31 23 35 21" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>'

var SVGS = {
  waiting: SVG_START + EYES_NORMAL + SVG_END,
  thinking: SVG_START + EYES_NORMAL + SVG_END, // 동공 위치는 JS가 실시간 변경
  working: SVG_START + EYES_SPARKLE + SVG_END, // 눈 반짝이 + jitter 애니메이션
  searching: SVG_START + EYES_NORMAL + SVG_END_SEARCHING, // 돋보기 궤적 + 눈동자 추적
  solving: SVG_START + EYES_SPARKLE + SVG_END_SOLVING, // 내부 음영 약함 + 외부 aura 강함
  sleeping: SVG_START + EYES_CLOSED + SVG_END,
}

// 도구 분류 — tool_start 시 상태 분기에 사용
var SEARCH_TOOLS = { Grep: 1, Glob: 1, WebSearch: 1, WebFetch: 1 }
function isSearchTool(name) {
  if (!name) return false
  if (SEARCH_TOOLS[name]) return true
  if (name.indexOf("Playwright:") === 0) return true
  return false
}
// Read는 "읽고 이해" 성격 → thinking
function isReadTool(name) {
  return name === "Read"
}

// ─── JS Animations (requestAnimationFrame) ───────────
var animFrame = null

function animate(state) {
  if (animFrame) cancelAnimationFrame(animFrame)
  // solving에서 설정한 inline filter를 다른 상태 진입 시 클리어
  if (state !== "solving" && svgWrap) svgWrap.style.filter = ""
  var start = performance.now()
  function tick(now) {
    // Wilson 영역이 숨겨지면 애니메이션 중단 (CPU 절약)
    if (!svgWrap.offsetParent) {
      animFrame = null
      return
    }
    var t = now - start
    var s, r
    switch (state) {
      case "waiting": // 4s breathing (속도 절반)
        s = 1 + 0.04 * Math.sin((t * Math.PI * 2) / 4000)
        svgWrap.style.transform = "scale(" + s + ")"
        svgWrap.style.opacity = ""
        break
      case "thinking": // 눈동자 회전 + 약한 흔들림
        r = 3 * Math.sin((t * Math.PI * 2) / 800)
        var ang = (t / 600) * Math.PI * 2
        var dx = 2 * Math.cos(ang)
        var dy = 2 * Math.sin(ang)
        // pupils는 thinking 진입 시 cache됨 (svgWrap._pupils)
        if (svgWrap._pupils && svgWrap._pupils.length >= 2) {
          svgWrap._pupils[0].setAttribute("cx", 16 + dx)
          svgWrap._pupils[0].setAttribute("cy", 20 + dy)
          svgWrap._pupils[1].setAttribute("cx", 32 + dx)
          svgWrap._pupils[1].setAttribute("cy", 20 + dy)
        }
        svgWrap.style.transform = "rotate(" + r + "deg)"
        svgWrap.style.opacity = ""
        break
      case "working": {
        // 좌우로 튕기듯 불규칙 흔들림 — 비정수비 주파수 sine 3개 합성으로 자연스러운 jitter
        var jx = 8 * Math.sin(t * 0.011) + 5 * Math.sin(t * 0.023) + 3.5 * Math.sin(t * 0.037)
        var jy = 2.2 * Math.sin(t * 0.017) + 1.3 * Math.sin(t * 0.031)
        var jr = 2.5 * Math.sin(t * 0.019) + 1.2 * Math.sin(t * 0.041)
        svgWrap.style.transform =
          "translate(" +
          jx.toFixed(2) +
          "px, " +
          jy.toFixed(2) +
          "px) rotate(" +
          jr.toFixed(2) +
          "deg)"
        svgWrap.style.opacity = ""
        break
      }
      case "searching": {
        // 탐색 — 돋보기가 얼굴 위를 느린 궤적으로 이동, 눈동자가 돋보기를 따라 움직임
        if (!svgWrap._magnifier) svgWrap._magnifier = svgWrap.querySelector("#wilsonMagnifier")
        // 비정수비 주기로 자연스러운 탐색 느낌 (x: 8초, y: 11초)
        var mx = 10 * Math.sin((t * Math.PI * 2) / 8000)
        var my = 6 * Math.sin((t * Math.PI * 2) / 11000 + 1.5)
        if (svgWrap._magnifier) {
          svgWrap._magnifier.setAttribute(
            "transform",
            "translate(" + mx.toFixed(2) + ", " + my.toFixed(2) + ")",
          )
        }
        // 눈동자가 돋보기 중심(24+mx, 24+my)을 바라봄 — 소켓 범위 ±2 클램프
        if (svgWrap._pupils && svgWrap._pupils.length >= 2) {
          var magX = 24 + mx,
            magY = 24 + my
          var clamp = function (v) {
            return v < -2 ? -2 : v > 2 ? 2 : v
          }
          var lx = clamp((magX - 16) * 0.2)
          var ly = clamp((magY - 20) * 0.5)
          var rx = clamp((magX - 32) * 0.2)
          var ry = clamp((magY - 20) * 0.5)
          svgWrap._pupils[0].setAttribute("cx", (16 + lx).toFixed(2))
          svgWrap._pupils[0].setAttribute("cy", (20 + ly).toFixed(2))
          svgWrap._pupils[1].setAttribute("cx", (32 + rx).toFixed(2))
          svgWrap._pupils[1].setAttribute("cy", (20 + ry).toFixed(2))
        }
        svgWrap.style.transform = ""
        svgWrap.style.opacity = ""
        break
      }
      case "solving": // 황금 오로라 발광 (1s)
        s = 1 + 0.05 * Math.sin((t * Math.PI * 2) / 1000)
        var glow = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 1000)
        var blur1 = 4 + 14 * glow
        var blur2 = 10 + 24 * glow
        var alpha = 0.4 + 0.5 * glow
        svgWrap.style.transform = "scale(" + s + ")"
        svgWrap.style.filter =
          "drop-shadow(0 0 " +
          blur1 +
          "px rgba(255, 215, 80, " +
          alpha +
          ")) " +
          "drop-shadow(0 0 " +
          blur2 +
          "px rgba(255, 180, 50, " +
          alpha * 0.7 +
          "))"
        svgWrap.style.opacity = ""
        break
      case "sleeping": // 5s slow breathe
        s = 1 + 0.02 * Math.sin((t * Math.PI * 2) / 5000)
        svgWrap.style.transform = "scale(" + s + ")"
        svgWrap.style.opacity = "0.6"
        break
    }
    animFrame = requestAnimationFrame(tick)
  }
  animFrame = requestAnimationFrame(tick)
}

// ─── Tips — /tips.json lazy fetch (500 concepts, offloaded ~15KB) ─
var TIPS = ["Everything in memory is bits"] // bootstrap fallback; replaced on lazy load
var _tipsLoadStarted = false
function loadTips() {
  if (_tipsLoadStarted) return
  _tipsLoadStarted = true
  fetch("/tips.json")
    .then(function (r) {
      return r.ok ? r.json() : null
    })
    .then(function (data) {
      if (Array.isArray(data) && data.length > 0) TIPS = data
    })
    .catch(function () {})
}
if (typeof requestIdleCallback === "function") {
  requestIdleCallback(loadTips, { timeout: 2000 })
} else {
  setTimeout(loadTips, 500)
}

// ─── State ───────────────────────────────────────────
var currentState = "waiting"
var recentFiles = []
var bubbleMode = "idle"
var waitTimer = null
var sleepTimer = null
var bubbleTimer = null
var dotTimer = null
var dotCount = 1
var isBatchLoading = false

// ─── DOM Refs ────────────────────────────────────────
var panel = document.getElementById("wilson-panel")
var svgWrap = document.getElementById("wilson-svg-wrap")
var bubbleEl = document.getElementById("wilson-bubble")
var recentListEl = document.getElementById("wilson-recent-list")

// ─── Init SVG + Status Text ──────────────────────────
var STATE_TOOLTIPS = {
  waiting: "대기 중 — 어떤 작업도 진행되지 않음",
  thinking: "판단 중 — Read로 코드 읽기, 새 prompt 접수 등",
  working: "도구 실행 중 — 파일 편집·명령 실행 등",
  searching: "탐색 중 — Grep / Glob / Web / Playwright",
  solving: "tool_error 발생 — 문제 해결 중",
  sleeping: "10분 이상 무활동 — 휴면",
}
var statusEl = document.createElement("div")
statusEl.className = "wilson-status"
if (svgWrap && svgWrap.parentNode) {
  svgWrap.parentNode.insertBefore(statusEl, svgWrap)
}
if (svgWrap) {
  svgWrap.innerHTML = SVGS.waiting
  svgWrap.setAttribute("role", "button")
  svgWrap.setAttribute("tabindex", "0")
  svgWrap.setAttribute("aria-label", "Wilson — 클릭하면 개발 팁이 나옵니다")
  animate("waiting")
  svgWrap.addEventListener("click", onWilsonClick)
  svgWrap.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onWilsonClick()
    }
  })
}

// ─── State Machine ──────────────────────────────────
function setState(newState) {
  if (currentState === newState) return
  currentState = newState
  // Swap SVG
  if (svgWrap && SVGS[newState]) {
    svgWrap.innerHTML = SVGS[newState]
    // Cache pupil refs once per SVG swap (thinking 최적화)
    svgWrap._pupils = svgWrap.querySelectorAll('circle[fill="#1a1a2e"]')
    // 돋보기 refresh — 이전 SVG의 stale 참조 방지 (searching 진입 시 querySelector로 재캐시)
    svgWrap._magnifier = null
  }
  // Start JS animation
  if (svgWrap) animate(newState)
  // Tooltip
  if (statusEl && STATE_TOOLTIPS[newState]) {
    statusEl.title = STATE_TOOLTIPS[newState]
  }
  // Body 클래스 (panel-wide state emphasis)
  document.body.className = document.body.className.replace(/wilson-state-\w+/g, "").trim()
  document.body.classList.add("wilson-state-" + newState)
  // Reset dot
  dotCount = 0
  // 텍스트 즉시 갱신 (setInterval 다음 tick까지 기다리지 않음)
  if (window._wilsonUpdateStatusText) window._wilsonUpdateStatusText()
}

// Status text — 차분한 효과 (긴 사용 시간 피로 감소)
var RAINBOW = ["var(--accent)", "var(--cyan)", "var(--green)", "var(--magenta)"]
var colorIdx = 0

function updateStatusText() {
  if (!statusEl) return
  dotCount = (dotCount % 3) + 1

  switch (currentState) {
    case "waiting":
    case "sleeping":
      statusEl.style.color = "var(--text-dim)"
      statusEl.textContent = currentState + ".".repeat(dotCount)
      break
    case "working":
      statusEl.style.color = "var(--yellow)"
      statusEl.textContent = currentState
      break
    case "searching":
      statusEl.style.color = "var(--cyan)"
      statusEl.textContent = currentState + ".".repeat(dotCount)
      break
    case "solving":
      // 단일 크림슨, 미묘한 opacity pulse (깜빡임 제거)
      statusEl.style.color = "var(--accent)"
      statusEl.style.opacity = dotCount % 2 === 1 ? "1" : "0.65"
      statusEl.textContent = currentState
      break
    case "thinking":
      statusEl.style.opacity = "1"
      colorIdx = (colorIdx + 1) % RAINBOW.length
      var word = "thinking"
      var html = ""
      for (var i = 0; i < word.length; i++) {
        var c = RAINBOW[(i + colorIdx) % RAINBOW.length]
        html += '<span style="color:' + c + '">' + word[i] + "</span>"
      }
      statusEl.innerHTML = html
      break
  }
  if (currentState !== "solving") statusEl.style.opacity = "1"
}

dotTimer = setInterval(updateStatusText, 2500) // 점 애니메이션 주기
// setState 에서도 즉시 호출 (텍스트 지연 제거)
window._wilsonUpdateStatusText = updateStatusText
// 초기 1회 즉시 호출 (첫 tick 2.5s 대기 제거)
updateStatusText()

function resetTimers() {
  clearTimeout(sleepTimer)
  // 상태는 다음 이벤트까지 유지, sleeping만 장시간 무활동 시 전환
  sleepTimer = setTimeout(function () {
    setState("sleeping")
  }, SLEEP_TIMEOUT)
}

// ─── Event Handler ──────────────────────────────────
function onEvent(ev) {
  if (!ev) return

  // Track files always
  if (ev.filePath) trackFile(ev)

  // Skip state changes during batch (init replay)
  if (isBatchLoading) return

  resetTimers()
  var type = ev.type

  // State transitions — 행동 → 결과 → 판단 구조
  if (type === "prompt") {
    setState("thinking")
    return
  }
  if (type === "tool_start") {
    var nextState = isReadTool(ev.name)
      ? "thinking"
      : isSearchTool(ev.name)
        ? "searching"
        : "working"
    setState(nextState)
    showAction(ev.name, ev.target)
    return
  }
  if (type === "tool_done") {
    // turn 유지 — assistant_text가 올 때까지 현재 상태 지속
    return
  }
  if (type === "tool_error") {
    setState("solving")
    showAction("Error: " + (ev.name || ""), ev.target)
    return
  }
  if (type === "assistant_text") {
    setState("waiting")
    return
  }
}

// ─── Speech Bubble ──────────────────────────────────
function showBubble(text, mode) {
  if (!bubbleEl) return
  clearTimeout(bubbleTimer)
  bubbleMode = mode
  var isAction = mode === "action"
  // action/tip 구분 dot 제거 — 텍스트만 표시 (사용자 요청)
  bubbleEl.innerHTML = escHtml(text)
  bubbleEl.classList.add("visible")
}

function hideBubble() {
  if (!bubbleEl) return
  bubbleEl.classList.remove("visible")
  bubbleMode = "idle"
}

function showAction(toolName, target) {
  var text = toolName || ""
  if (target) {
    var fileName = target.split(/[/\\]/).pop()
    text += ": " + fileName
  }
  if (text.length > 40) text = text.slice(0, 37) + "..."
  showBubble(text, "action")
}

function onWilsonClick() {
  // Wobble
  if (panel) {
    panel.classList.add("wilson-wobble")
    setTimeout(function () {
      panel.classList.remove("wilson-wobble")
    }, 500)
  }
  // 언제든 팁 표시 (action 중에도 덮어쓰기)
  var tip = TIPS[Math.floor(Math.random() * TIPS.length)]
  showBubble(tip, "tip")
}

// ─── Recent Files ───────────────────────────────────
function trackFile(ev) {
  if (!ev.filePath) return
  var fileName = ev.target || ev.filePath.split(/[/\\]/).pop()
  var action
  if (ev.fileAction === "delete" || ev.fileAction === "move") {
    // file_action 이벤트 (Bash rm/mv, MCP move_file 등)
    action = ev.fileAction
  } else {
    // 일반 tool_start (Read/Write/Edit)
    action = "read"
    var name = (ev.name || "").toLowerCase()
    if (/write|create/.test(name)) action = "write"
    else if (/edit/.test(name)) action = "edit"
  }

  var diffData = null
  if (ev.diff) {
    diffData = { filePath: ev.filePath, fileName: fileName, diff: ev.diff, time: ev.time }
  }

  // Dedupe by filePath — move to top, preserve existing diffData if new one is null
  var existing = null
  recentFiles = recentFiles.filter(function (f) {
    if (f.filePath === ev.filePath) {
      existing = f
      return false
    }
    return true
  })
  recentFiles.unshift({
    filePath: ev.filePath,
    fileName: fileName,
    action: action === "delete" || action === "move" ? action : diffData ? "edit" : action,
    time: ev.time,
    diffData: diffData || (existing && existing.diffData) || null,
    isDeleted: action === "delete",
  })
  // 시간순 정렬 (최신이 위)
  recentFiles.sort(function (a, b) {
    return (a.time || "") > (b.time || "") ? 1 : (a.time || "") < (b.time || "") ? -1 : 0
  })
  if (recentFiles.length > MAX_RECENT_FILES) recentFiles.length = MAX_RECENT_FILES

  if (!isBatchLoading) renderRecentFiles()
}

function renderRecentFiles() {
  if (!recentListEl) return
  if (recentFiles.length === 0) {
    recentListEl.innerHTML =
      '<div class="wilson-file-empty">아직 파일 이벤트가 없습니다<br><small>Claude Code가 Read/Write/Edit 할 때 여기 쌓입니다</small></div>'
    return
  }
  var html = ""
  for (var i = 0; i < recentFiles.length; i++) {
    var f = recentFiles[i]
    var timeStr = f.time && window.formatTime ? window.formatTime(f.time) : ""
    var icon =
      f.action === "edit"
        ? "\u270E"
        : f.action === "write"
          ? "+"
          : f.action === "delete"
            ? "\u2717"
            : f.action === "move"
              ? "\u2192"
              : "\u25C7"
    html +=
      '<div class="wilson-file-item" data-idx="' +
      i +
      '">' +
      '<span class="wilson-file-icon">' +
      icon +
      "</span>" +
      '<span class="wilson-file-name">' +
      escHtml(f.fileName) +
      "</span>" +
      '<span class="wilson-file-action ' +
      f.action +
      '">' +
      f.action +
      "</span>" +
      '<span class="wilson-file-time">' +
      timeStr +
      "</span>" +
      "</div>"
  }
  recentListEl.innerHTML = html
  // 최신(하단)으로 자동 스크롤
  recentListEl.scrollTop = recentListEl.scrollHeight
}

// Event delegation for file clicks
if (recentListEl) {
  recentListEl.addEventListener("click", function (e) {
    var item = e.target.closest(".wilson-file-item")
    if (!item) return
    var idx = parseInt(item.dataset.idx, 10)
    var f = recentFiles[idx]
    if (!f) return

    // Highlight active
    var prev = recentListEl.querySelector(".wilson-file-item.active")
    if (prev) prev.classList.remove("active")
    item.classList.add("active")

    // 삭제된 파일: 코드뷰어에 안내만 표시 (요청 안 함)
    if (f.isDeleted) {
      window.pendingHighlight = null
      if (window.displayOutput) {
        window.displayOutput({
          name: "Deleted",
          target: f.fileName,
          output: "(이 파일은 삭제되어 내용을 표시할 수 없습니다)\n\n경로: " + f.filePath,
          time: f.time,
        })
      }
      return
    }

    // Reuse existing viewer flow
    if (f.diffData) {
      window.pendingHighlight = f.diffData
      window.displayDiff(f.diffData)
    } else {
      window.pendingHighlight = null
    }
    window.fileCache.delete(f.filePath)
    window.requestFileContent(f.filePath)
  })
}

// Handle file_diff SSE event
function onFileDiff(data) {
  if (!data || !data.filePath) return
  trackFile({
    filePath: data.filePath,
    target: data.fileName,
    name: "Edit",
    type: "tool_done",
    diff: data.diff,
    time: data.time,
  })
}

// ─── Batch Loading Flag ─────────────────────────────
function startBatch() {
  isBatchLoading = true
}
function endBatch() {
  isBatchLoading = false
  renderRecentFiles()
}

// ─── Panel Toggles ──────────────────────────────────
var TOGGLE_MAP = {
  wilson: [".wilson-character"],
  file: [".wilson-recent"],
  feed: [".activity-panel", ".resize-handle"],
  diff: [".code-viewer", ".diff-panel"],
}

function initToggles() {
  var toggleState = {}
  try {
    var saved = localStorage.getItem("panel-toggles")
    if (saved) toggleState = JSON.parse(saved)
  } catch (e) {}

  var buttons = document.querySelectorAll(".panel-toggle")
  for (var i = 0; i < buttons.length; i++) {
    ;(function (btn) {
      var key = btn.dataset.panel
      // Restore saved state
      if (toggleState[key] === false) {
        btn.classList.remove("active")
        applyToggle(key, false)
      }
      btn.setAttribute("aria-pressed", btn.classList.contains("active"))
      btn.addEventListener("click", function () {
        var isActive = btn.classList.toggle("active")
        btn.setAttribute("aria-pressed", isActive)
        applyToggle(key, isActive)
        saveToggleState()
      })
    })(buttons[i])
  }
}

function applyToggle(key, visible) {
  var selectors = TOGGLE_MAP[key]
  if (!selectors) return
  for (var i = 0; i < selectors.length; i++) {
    var els = document.querySelectorAll(selectors[i])
    for (var j = 0; j < els.length; j++) {
      if (visible) {
        els[j].classList.remove("panel-hidden")
      } else {
        els[j].classList.add("panel-hidden")
      }
    }
  }
  // Wilson 캐릭터 재표시 시 애니메이션 재개
  if (key === "wilson" && visible && svgWrap && !animFrame) {
    animate(currentState)
  }
}

function saveToggleState() {
  var state = {}
  var buttons = document.querySelectorAll(".panel-toggle")
  for (var i = 0; i < buttons.length; i++) {
    state[buttons[i].dataset.panel] = buttons[i].classList.contains("active")
  }
  try {
    localStorage.setItem("panel-toggles", JSON.stringify(state))
  } catch (e) {}
}

// ─── Utility ─────────────────────────────────────────
function escHtml(str) {
  if (window.escapeHtml) return window.escapeHtml(str)
  var d = document.createElement("div")
  d.textContent = str
  return d.innerHTML
}

// ─── Theme Switcher ──────────────────────────────────
var THEMES = ["beige", "white", "dark"]
var THEME_LABELS = { beige: "Beige", white: "White", dark: "Dark" }

function applyTheme(name) {
  if (name === "beige") {
    document.body.removeAttribute("data-theme")
  } else {
    document.body.setAttribute("data-theme", name)
  }
  var btn = document.getElementById("theme-switch")
  if (btn) btn.textContent = THEME_LABELS[name] || "Beige"
  try {
    localStorage.setItem("wilson-theme", name)
  } catch (e) {}
}

function initTheme() {
  var saved = "beige"
  try {
    saved = localStorage.getItem("wilson-theme") || "beige"
  } catch (e) {}
  if (THEMES.indexOf(saved) === -1) saved = "beige"
  applyTheme(saved)

  var btn = document.getElementById("theme-switch")
  if (btn) {
    btn.addEventListener("click", function () {
      var curr = localStorage.getItem("wilson-theme") || "beige"
      var next = THEMES[(THEMES.indexOf(curr) + 1) % THEMES.length]
      applyTheme(next)
    })
  }
}

// ─── Init ────────────────────────────────────────────
resetTimers()
// initToggles(); — panel-toggles 기능 제거됨 (사용자 요청 2026-04-14)
initTheme()

// ─── Public API ──────────────────────────────────────
export const wilson = {
  onEvent: onEvent,
  onFileDiff: onFileDiff,
  startBatch: startBatch,
  endBatch: endBatch,
}
if (typeof window !== "undefined") window.wilson = wilson
