// connection.js — SSE 연결 + 이벤트 라우팅 (ES Module)

// ─── DOM 요소 ─────────────────────────────────────
var connectionDot = document.getElementById("connection-dot")
var connectionStatus = document.getElementById("connection-status")

// ─── 패널 리사이즈 (monitor-agent 페이지에만 존재) ──────
;(function () {
  var handle = document.getElementById("resize-activity")
  var panel = document.querySelector(".activity-panel")
  // /usage 등 이 요소가 없는 페이지에서는 스킵 (이후 connect() 실행이 안 끊기도록)
  if (!handle || !panel) return
  var dragging = false
  handle.addEventListener("mousedown", function (e) {
    dragging = true
    handle.classList.add("active")
    document.body.style.cursor = "ns-resize"
    document.body.style.userSelect = "none"
    e.preventDefault()
  })
  document.addEventListener("mousemove", function (e) {
    if (!dragging) return
    var main = document.querySelector(".main-content")
    if (!main) return
    var rect = main.getBoundingClientRect()
    var pct = ((e.clientY - rect.top) / rect.height) * 100
    panel.style.height = Math.max(10, Math.min(70, pct)) + "%"
  })
  document.addEventListener("mouseup", function () {
    if (!dragging) return
    dragging = false
    handle.classList.remove("active")
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  })
})()

// 모델 이름 정규화: "claude-opus-4-6" → "Opus 4.6", "claude-haiku-4-5-20251001" → "Haiku 4.5"
function formatModelName(raw) {
  if (!raw) return ""
  var m = String(raw).match(/claude-(opus|sonnet|haiku)-(\d+)-(\d+)/)
  if (!m) return raw
  var fam = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return fam + " " + m[2] + "." + m[3]
}

// ─── Stats 핸들러 ───────────────────────────────────
// Running/Done/Errors/Elapsed 카운터는 제거됨. 활성 모델만 footer에 표시.
var loadInfo = { totalEvents: 0, totalBytes: 0, totalPrompts: 0, loadedPrompts: 0 }

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + "B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB"
  return (bytes / 1024 / 1024).toFixed(2) + "MB"
}

function updateStats(stats) {
  var modelEl = document.getElementById("event-count")
  if (!modelEl) return
  var parts = []
  var raw = stats && stats.currentModel
  if (raw) parts.push("Model: " + formatModelName(raw))
  if (loadInfo.totalEvents > 0) parts.push(loadInfo.totalEvents + " events")
  if (loadInfo.totalBytes > 0) parts.push(formatBytes(loadInfo.totalBytes))
  modelEl.textContent = parts.join(" · ")
}

// ─── SSE 연결 ─────────────────────────────────────
function connect() {
  var es = new EventSource("/events")

  es.onopen = function () {
    connectionDot.className = "connection-dot connected"
    connectionStatus.textContent = "Connected"
  }

  es.onerror = function () {
    connectionDot.className = "connection-dot disconnected"
    connectionStatus.textContent = "Reconnecting..."
  }

  // 페이지네이션 상태
  var loadedStartIdx = 0
  var hasMoreEvents = false
  var loadMoreBtn = null

  // 숫자 포맷 (5000 → "5,000"). toLocaleString 실패 시 원본 반환.
  function fmtNum(n) {
    try {
      return Number(n).toLocaleString("en-US")
    } catch (e) {
      return String(n)
    }
  }

  // Load more 버튼 라벨 갱신: "▲ Load 100 more prompts  (showing X of Y prompts)"
  // totalPrompts 미제공 시 카운트 span 생략.
  function setLoadMoreLabel(btn) {
    if (!btn) return
    btn.textContent = ""
    var main = document.createElement("span")
    main.textContent = "▲ Load 100 more prompts"
    btn.appendChild(main)
    var total = loadInfo.totalPrompts || 0
    if (total > 0) {
      var loaded = Math.min(total, loadInfo.loadedPrompts || 0)
      var count = document.createElement("span")
      count.className = "load-count"
      count.textContent = " (showing " + fmtNum(loaded) + " of " + fmtNum(total) + " prompts)"
      btn.appendChild(count)
    }
  }

  function insertLoadMoreBtn() {
    if (loadMoreBtn) loadMoreBtn.remove()
    loadMoreBtn = document.createElement("button")
    loadMoreBtn.className = "load-more-btn"
    setLoadMoreLabel(loadMoreBtn)
    loadMoreBtn.onclick = function () {
      loadMoreBtn.textContent = "Loading..."
      loadMoreBtn.disabled = true
      fetch("/api/events?before=" + loadedStartIdx + "&prompts=100")
        .then(function (r) {
          return r.json()
        })
        .then(function (data) {
          if (data.events && data.events.length > 0) {
            var scrollH = window.activityList.scrollHeight
            var scrollT = window.activityList.scrollTop
            // 역순으로 삽입 (오래된 것부터)
            var firstChild = window.activityList.firstChild
            // loadMore 버튼 다음 요소가 첫 그룹
            var insertBefore = loadMoreBtn.nextSibling
            if (window.feed) window.feed.startBatch()
            for (var i = 0; i < data.events.length; i++) {
              window.addActivityItemBefore(data.events[i], insertBefore)
            }
            if (window.feed) window.feed.endBatch()
            loadedStartIdx = data.startIdx
            hasMoreEvents = data.hasMore
            // Load More: 새 슬라이스의 prompt 수를 누적
            if (typeof data.slicePrompts === "number")
              loadInfo.loadedPrompts = (loadInfo.loadedPrompts || 0) + data.slicePrompts
            if (typeof data.totalPrompts === "number") loadInfo.totalPrompts = data.totalPrompts
            // 스크롤 위치 유지
            var newScrollH = window.activityList.scrollHeight
            window.activityList.scrollTop = scrollT + (newScrollH - scrollH)
          }
          if (hasMoreEvents) {
            setLoadMoreLabel(loadMoreBtn)
            loadMoreBtn.disabled = false
          } else {
            loadMoreBtn.remove()
            loadMoreBtn = null
          }
        })
        .catch(function () {
          setLoadMoreLabel(loadMoreBtn)
          loadMoreBtn.disabled = false
        })
    }
    if (window.activityList) {
      window.activityList.insertBefore(loadMoreBtn, window.activityList.firstChild)
    }
  }

  // 초기 데이터
  es.addEventListener("init", function (e) {
    var data = JSON.parse(e.data)

    if (data.recentEvents) {
      if (window.wilson) window.wilson.startBatch()
      if (window.feed) window.feed.startBatch()
      for (var i = 0; i < data.recentEvents.length; i++) {
        if (window.addActivityItem) window.addActivityItem(data.recentEvents[i])
        if (window.wilson) window.wilson.onEvent(data.recentEvents[i])
      }
      if (window.feed) window.feed.endBatch()
      if (window.wilson) window.wilson.endBatch()
    }

    // 페이지네이션 상태 설정 (feed.js 로드된 페이지에서만)
    loadedStartIdx = data.startIdx
    hasMoreEvents = data.hasMore

    // 버튼 라벨 카운트용 — 버튼 생성 전에 저장.
    if (data.totalEvents) loadInfo.totalEvents = data.totalEvents
    if (typeof data.totalPrompts === "number") loadInfo.totalPrompts = data.totalPrompts
    // init: 슬라이스 prompt 수가 곧 초기 로드된 개수
    if (typeof data.slicePrompts === "number") loadInfo.loadedPrompts = data.slicePrompts
    if (data.totalTranscriptBytes) loadInfo.totalBytes = data.totalTranscriptBytes

    if (hasMoreEvents && typeof insertLoadMoreBtn === "function") insertLoadMoreBtn()

    if (data.stats && typeof updateStats === "function") updateStats(data.stats)
    if (window.activityList) window.activityList.scrollTop = window.activityList.scrollHeight
  })

  // 실시간 활동
  es.addEventListener("activity", function (e) {
    var ev = JSON.parse(e.data)
    if (window.addActivityItem) window.addActivityItem(ev)
    if (window.wilson) window.wilson.onEvent(ev)
    if (window.toolTimeline) window.toolTimeline.onEvent(ev)
  })

  // 파일 콘텐츠 (viewer.js 로드된 페이지에서만)
  es.addEventListener("file_content", function (e) {
    var fileData = JSON.parse(e.data)
    if (window.fileCache) window.fileCache.set(fileData.filePath, fileData)
    if (window.displayCode) window.displayCode(fileData)
  })

  // Diff (viewer.js 로드된 페이지에서만)
  es.addEventListener("file_diff", function (e) {
    var data = JSON.parse(e.data)
    if (window.displayDiff) window.displayDiff(data)
    if (window.wilson) window.wilson.onFileDiff(data)
  })

  // 스크린샷 (viewer.js 로드된 페이지에서만)
  es.addEventListener("screenshot", function (e) {
    var data = JSON.parse(e.data)
    if (window.displayScreenshot) window.displayScreenshot(data)
  })

  // 통계
  es.addEventListener("stats", function (e) {
    var stats = JSON.parse(e.data)
    updateStats(stats)
  })

  return es
}

connect()
