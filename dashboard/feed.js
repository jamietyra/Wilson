// feed.js — 실시간 이벤트 피드 (ES Module)

var activityList = document.getElementById("activity-list")
var sessionFiltersEl = document.getElementById("session-filters")
var knownSessions = new Set()
var activeSessionFilter = null // null = 전체

function addSessionFilterBtn(project) {
  var name = project || "IT"
  if (knownSessions.has(name)) return
  knownSessions.add(name)

  var btn = document.createElement("button")
  btn.className = "session-filter-btn active"
  btn.textContent = name
  // 공유 session-tag 모듈 사용 (monitor-usage와 색 동기화)
  var color = window.sessionTag?.assign ? window.sessionTag.assign(name) : getSessionColor(name)
  btn.style.color = color.fg
  btn.style.background = color.bg
  btn.dataset.session = name

  btn.onclick = () => {
    if (activeSessionFilter === name) {
      // 이미 선택된 필터 해제 → 전체 보기
      activeSessionFilter = null
      sessionFiltersEl.querySelectorAll(".session-filter-btn").forEach((b) => {
        b.classList.add("active")
      })
    } else {
      // 이 세션만 필터
      activeSessionFilter = name
      sessionFiltersEl.querySelectorAll(".session-filter-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.session === name)
      })
    }
    applyFilters()
  }

  sessionFiltersEl.appendChild(btn)
}

// Toggle all expand/collapse
var allExpanded = false
var toggleAllBtn = document.getElementById("toggle-all")
toggleAllBtn.onclick = () => {
  allExpanded = !allExpanded
  toggleAllBtn.textContent = allExpanded ? "▼ All" : "▶ All"
  var groups = activityList.querySelectorAll(".prompt-group")
  for (var i = 0; i < groups.length; i++) {
    var toggle = groups[i].querySelector(".prompt-toggle")
    var tools = groups[i].querySelector(".prompt-tools")
    if (allExpanded) {
      if (toggle) toggle.classList.remove("collapsed")
      if (tools) tools.classList.remove("collapsed")
    } else {
      if (toggle) toggle.classList.add("collapsed")
      if (tools) tools.classList.add("collapsed")
    }
  }
}

var searchInput = document.getElementById("activity-search")
var searchTimer = null
searchInput.addEventListener("input", () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(applyFilters, 150)
})

function applyFilters() {
  var q = searchInput.value.toLowerCase().trim()
  var groups = activityList.querySelectorAll(".prompt-group")
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i]
    var show = true
    // 세션 필터
    if (activeSessionFilter && group.dataset.session !== activeSessionFilter) {
      show = false
    }
    // 검색어 필터
    if (show && q) {
      var text = group.textContent.toLowerCase()
      if (!text.includes(q)) show = false
    }
    group.style.display = show ? "" : "none"
  }
}

function formatTime(isoStr) {
  var d = new Date(isoStr)
  return d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function formatDuration(seconds) {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  var m = Math.floor(seconds / 60)
  var s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

function formatElapsed(ms) {
  var s = Math.floor(ms / 1000)
  var m = Math.floor(s / 60)
  var h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m ${s % 60}s`
}

var sessionColorCache = {}
var SESSION_COLORS = [
  { bg: "#1a3a5c", fg: "#569cd6" },
  { bg: "#3c1a1a", fg: "#f44747" },
  { bg: "#2d1a3c", fg: "#c586c0" },
  { bg: "#1a3c2d", fg: "#4ec9b0" },
  { bg: "#3c3a1a", fg: "#dcdcaa" },
  { bg: "#1a3c3c", fg: "#4fc1ff" },
  { bg: "#3c2a1a", fg: "#ce9178" },
  { bg: "#2a1a3c", fg: "#b48ead" },
]

function getSessionColor(project) {
  if (!project) project = "default"
  if (sessionColorCache[project]) return sessionColorCache[project]
  var hash = 0
  for (var i = 0; i < project.length; i++) hash = ((hash << 5) - hash + project.charCodeAt(i)) | 0
  var color = SESSION_COLORS[Math.abs(hash) % SESSION_COLORS.length]
  sessionColorCache[project] = color
  return color
}

function makeSessionTag(project) {
  var name = project || "IT"
  // 공유 모듈 우선 — monitor-usage와 색상 동기화 (session-tag.js, localStorage 슬롯 배정)
  if (window.sessionTag && typeof window.sessionTag.render === "function") {
    return window.sessionTag.render(name)
  }
  // 로드 실패 시 폴백 (기존 hash 팔레트)
  var color = getSessionColor(name)
  return (
    '<span class="session-tag" style="background:' +
    color.bg +
    ";color:" +
    color.fg +
    '">' +
    escapeHtml(name) +
    "</span>"
  )
}

// 세션별 현재 활성 그룹 상태 (멀티세션 + subagent 지원)
// key: project명 (일반) / "SUB:" + agentId (서브에이전트)
var sessionStates = {}
var toolItemMap = new Map() // tool_id → DOM element cache
var isBatchLoading = false
var IDLE_CLOSE_MS = window.wilsonConfig?.IDLE_CLOSE_MS || 10000 // 최종 메시지 후 10초 무활동 시 그룹 자동 접힘
var MAX_FEED_GROUPS = window.wilsonConfig?.MAX_FEED_GROUPS || 500 // #5 virtualization — DOM 그룹 상한

// #5 — DOM 상한 초과 시 가장 오래된 그룹부터 FIFO 제거 (toolItemMap/sessionStates/close timer 정리)
function enforceGroupCap() {
  var groups = activityList.querySelectorAll(".prompt-group")
  if (groups.length <= MAX_FEED_GROUPS) return
  var toRemove = groups.length - MAX_FEED_GROUPS
  for (var i = 0; i < toRemove; i++) {
    var g = groups[i]
    // 이 그룹 안의 tool id 매핑 제거 (dangling DOM 참조 방지)
    var items = g.querySelectorAll("[data-tool-id]")
    for (var j = 0; j < items.length; j++) {
      toolItemMap.delete(items[j].dataset.toolId)
    }
    // sessionStates가 이 그룹을 가리키면 초기화 → 다음 이벤트가 새 그룹 생성
    for (var key in sessionStates) {
      if (sessionStates[key].group === g) {
        sessionStates[key].group = null
        sessionStates[key].toolsContainer = null
        sessionStates[key].toolCount = 0
      }
    }
    if (g._closeTimer) {
      clearTimeout(g._closeTimer)
      g._closeTimer = null
    }
    g.remove()
  }
}

function openGroup(group) {
  if (!group) return
  var toggle = group.querySelector(".prompt-toggle")
  var tools = group.querySelector(".prompt-tools")
  if (toggle) toggle.classList.remove("collapsed")
  if (tools) tools.classList.remove("collapsed")
}
function closeGroup(group) {
  if (!group) return
  var toggle = group.querySelector(".prompt-toggle")
  var tools = group.querySelector(".prompt-tools")
  if (toggle) toggle.classList.add("collapsed")
  if (tools) tools.classList.add("collapsed")
}
function cancelGroupCloseTimer(group) {
  if (group?._closeTimer) {
    clearTimeout(group._closeTimer)
    group._closeTimer = null
  }
}
function _armCloseTimer(group, delayMs) {
  group._closeTimer = setTimeout(() => {
    closeGroup(group)
    group._closeTimer = null
  }, delayMs)
}
function scheduleGroupClose(group, delayMs) {
  cancelGroupCloseTimer(group)
  if (!group) return
  group._closeDelay = delayMs
  _armCloseTimer(group, delayMs)
  // 호버/포커스 시 타이머 취소, 이탈 시 재시작 — 읽는 중 갑작스런 접힘 방지
  if (!group._hoverBound) {
    group._hoverBound = true
    group.addEventListener("mouseenter", () => {
      cancelGroupCloseTimer(group)
    })
    group.addEventListener("mouseleave", () => {
      cancelGroupCloseTimer(group)
      if (group._closeDelay) _armCloseTimer(group, group._closeDelay)
    })
    group.addEventListener("focusin", () => {
      cancelGroupCloseTimer(group)
    })
    group.addEventListener("focusout", () => {
      if (group.matches(":hover")) return // 호버 유지 시 타이머 없음 유지
      cancelGroupCloseTimer(group)
      if (group._closeDelay) _armCloseTimer(group, group._closeDelay)
    })
  }
}

function getSessionKey(ev) {
  if (ev?.isSubagent && ev.agentId) return `SUB:${ev.agentId}`
  return ev?.project ? ev.project : "IT"
}

function getSessionState(key) {
  var name = key || "IT"
  if (!sessionStates[name]) {
    sessionStates[name] = { group: null, toolsContainer: null, toolCount: 0 }
  }
  return sessionStates[name]
}

function _collapseSessionGroup(key) {
  var s = getSessionState(key)
  if (!s.group) return
  var toggle = s.group.querySelector(".prompt-toggle")
  var tools = s.group.querySelector(".prompt-tools")
  if (toggle) toggle.classList.add("collapsed")
  if (tools) tools.classList.add("collapsed")
}

function createGroup(timeStr, text, promptId, ev) {
  var key = getSessionKey(ev)
  var project = ev?.project
  // 모든 그룹은 기본 접힘 — 활동 발생 시 자동 펼침
  var sessionName = project || "IT"
  addSessionFilterBtn(sessionName)

  var group = document.createElement("div")
  group.className = "prompt-group"
  if (ev?.isSubagent) group.classList.add("subagent-group")
  group.dataset.session = sessionName
  if (promptId) group.dataset.promptId = promptId
  if (ev?.agentId) group.dataset.agentId = ev.agentId

  var header = document.createElement("div")
  header.className = "prompt-header"

  var subBadge = ""
  if (ev?.isSubagent) {
    var label = ev.agentType || "Agent"
    subBadge =
      '<span class="sub-badge" title="' +
      escapeHtml(ev.agentDescription || "") +
      '">SUB: ' +
      escapeHtml(label) +
      "</span>"
  }

  var fullPromptText = ev?.text ? ev.text : text
  header.innerHTML = [
    '<span class="prompt-toggle">▼</span>',
    makeSessionTag(project),
    subBadge,
    `<span class="prompt-time">${timeStr}</span>`,
    '<span class="prompt-text" data-tooltip="' +
      escapeHtml(fullPromptText) +
      '">' +
      escapeHtml(text) +
      "</span>",
    '<span class="prompt-count">0</span>',
  ].join("")

  var tools = document.createElement("div")
  tools.className = "prompt-tools"

  header.onclick = function () {
    var toggle = this.querySelector(".prompt-toggle")
    toggle.classList.toggle("collapsed")
    tools.classList.toggle("collapsed")
  }

  group.appendChild(header)
  group.appendChild(tools)
  activityList.appendChild(group)
  enforceGroupCap() // #5 — 신규 그룹 추가 후 상한 체크

  // 실시간 prompt 이벤트는 펼친 상태로 시작 (활동이 보이도록).
  // batch loading (새로고침/초기 init) 중에는 모든 그룹을 접힌 상태로.
  // (previous) 등 fallback 그룹도 접힌 상태로.
  if (isBatchLoading || !ev || ev.type !== "prompt") {
    header.querySelector(".prompt-toggle").classList.add("collapsed")
    tools.classList.add("collapsed")
  }

  var s = getSessionState(key)
  s.group = group
  s.toolsContainer = tools
  s.toolCount = 0
}

function ensurePromptGroup(ev) {
  if (ev.type === "prompt") {
    var timeStr = ev.time ? formatTime(ev.time) : ""
    var previewText = ev.text.replace(/\n/g, " ").slice(0, 160) || "(prompt)"
    createGroup(timeStr, previewText, ev.promptId, ev)
    // 새 prompt — isNearBottom 조건 무시하고 즉시 하단으로 강제 스크롤
    activityList.scrollTop = activityList.scrollHeight
    return
  }

  var s = getSessionState(getSessionKey(ev))
  if (!s.group) {
    createGroup("", "(previous)", null, ev)
  }
}

function updateGroupCount(ev) {
  var s = getSessionState(getSessionKey(ev))
  if (!s.group) return
  var countEl = s.group.querySelector(".prompt-count")
  if (countEl) countEl.textContent = s.toolCount
}

// 활동 발생 시 그룹 자동 펼침 / 최종 메시지 후 자동 접힘 타이머
function notifyGroupActivity(s, ev) {
  if (isBatchLoading) return
  if (!s?.group) return
  openGroup(s.group)
  if (ev.type === "assistant_text") {
    scheduleGroupClose(s.group, IDLE_CLOSE_MS)
  } else {
    cancelGroupCloseTimer(s.group)
  }
}

function autoScroll() {
  var isNearBottom =
    activityList.scrollHeight - activityList.scrollTop - activityList.clientHeight < 80
  if (isNearBottom) activityList.scrollTop = activityList.scrollHeight
}

function escapeHtml(str) {
  if (!str) return ""
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function addActivityItem(ev) {
  // file_action은 Recent Files 전용 — Feeds에 표시 안 함
  if (ev.type === "file_action") return

  // prompt 이벤트 처리
  if (ev.type === "prompt") {
    ensurePromptGroup(ev)
    return
  }

  // assistant 텍스트 → 현재 그룹에 추가 (CSS line-clamp 3으로 자동 3줄 미리보기)
  if (ev.type === "assistant_text") {
    ensurePromptGroup(ev)
    var item = document.createElement("div")
    item.className = "assistant-text-item"
    var fullText = ev.text || ""
    item.innerHTML =
      '<span class="assistant-icon">\u25CF</span><span class="assistant-text" data-tooltip="' +
      escapeHtml(fullText) +
      '">' +
      escapeHtml(fullText) +
      "</span>"
    // 모든 메시지 길이 무관하게 클릭 가능 — 코드뷰어에 전체 내용
    item.style.cursor = "pointer"
    item._outputData = { name: "Assistant", target: "", output: fullText, time: ev.time }
    item.onclick = function () {
      window.displayCode._clickedEl = this
      if (window.displayOutput) window.displayOutput(this._outputData)
    }
    var sAt = getSessionState(getSessionKey(ev))
    sAt.toolsContainer.appendChild(item)
    notifyGroupActivity(sAt, ev)
    autoScroll()
    return
  }

  // tool_done/tool_error → 기존 줄 업데이트 (Map lookup O(1))
  if ((ev.type === "tool_done" || ev.type === "tool_error") && ev.id) {
    var existing = toolItemMap.get(ev.id)
    if (existing) {
      var iconEl = existing.querySelector(".activity-icon")
      if (ev.type === "tool_done") {
        iconEl.textContent = "\u2713"
        iconEl.className = "activity-icon icon-done"
      } else {
        iconEl.textContent = "\u2717"
        iconEl.className = "activity-icon icon-error"
        existing.classList.add("error-item")
      }
      var endTime = ev.time ? formatTime(ev.time) : ""
      var duration = ev.duration != null ? formatDuration(ev.duration) : ""
      var endTimeEl = existing.querySelector(".activity-end-time")
      if (endTimeEl) endTimeEl.textContent = endTime
      var durationEl = existing.querySelector(".activity-duration")
      if (durationEl) durationEl.textContent = duration

      if (ev.filePath && !existing.dataset.filePath) {
        existing.dataset.filePath = ev.filePath
        existing.style.cursor = "pointer"
        existing.onclick = function () {
          window.displayCode._clickedEl = this
          if (this._diffData) {
            window.pendingHighlight = this._diffData
            window.displayDiff(this._diffData)
          } else {
            window.pendingHighlight = null
          }
          window.fileCache.delete(ev.filePath)
          window.requestFileContent(ev.filePath)
        }
      }

      // output이 있고 filePath 클릭이 아직 없으면 output 클릭 추가
      if (ev.output && !existing.dataset.filePath) {
        existing.style.cursor = "pointer"
        existing._outputData = {
          name: ev.name,
          target: ev.target,
          output: ev.output,
          time: ev.time,
        }
        existing.onclick = function () {
          window.displayCode._clickedEl = this
          if (window.displayOutput) window.displayOutput(this._outputData)
        }
      }
      return
    }
  }

  // tool_start → 그룹 안에 새 줄 생성
  if (ev.type !== "tool_start") return

  ensurePromptGroup(ev)

  var item = document.createElement("div")
  item.className = "activity-item"
  if (ev.id) {
    item.dataset.toolId = ev.id
    toolItemMap.set(ev.id, item)
  }

  if (ev.diff)
    item._diffData = {
      filePath: ev.filePath,
      fileName: ev.target,
      diff: ev.diff,
      time: ev.time,
      language: ev.language,
    }

  if (ev.filePath) {
    item.dataset.filePath = ev.filePath
    item.style.cursor = "pointer"
    item.onclick = function () {
      window.displayCode._clickedEl = this
      if (this._diffData) {
        window.pendingHighlight = this._diffData
        window.displayDiff(this._diffData)
      } else {
        window.pendingHighlight = null
      }
      window.fileCache.delete(ev.filePath) // 최신 파일 내용 로드
      window.requestFileContent(ev.filePath)
    }
  }

  var timeStr = ev.time ? formatTime(ev.time) : ""
  var target = ev.target || ""

  item.innerHTML = [
    `<span class="activity-time">${timeStr}</span>`,
    '<span class="activity-icon icon-start">\u25b6</span>',
    `<span class="activity-name">${escapeHtml(ev.name)}</span>`,
    '<span class="activity-target" data-tooltip="' +
      escapeHtml(target) +
      '">' +
      escapeHtml(target) +
      "</span>",
    '<span class="activity-end-time"></span>',
    '<span class="activity-duration"></span>',
  ].join("")

  // filePath 클릭이 없으면 명령/target 내용을 코드뷰어에 표시하는 클릭 부착
  // tool_done에 output이 오면 그때 output으로 교체됨 (기존 로직 유지)
  if (!ev.filePath) {
    item.style.cursor = "pointer"
    item._outputData = {
      name: ev.name,
      target: target,
      output: target || "(no content)",
      time: ev.time,
    }
    item.onclick = function () {
      window.displayCode._clickedEl = this
      if (window.displayOutput) window.displayOutput(this._outputData)
    }
  }

  var s = getSessionState(getSessionKey(ev))
  s.toolsContainer.appendChild(item)
  s.toolCount++
  updateGroupCount(ev)
  notifyGroupActivity(s, ev)
  autoScroll()
}

// 이전 이벤트를 특정 위치 앞에 삽입 (Load more용)
var prevGroup = null
var prevToolsContainer = null
var prevToolCount = 0

function addActivityItemBefore(ev, beforeEl) {
  if (ev.type === "prompt") {
    var sessionName = ev.project || "IT"
    addSessionFilterBtn(sessionName)
    var group = document.createElement("div")
    group.className = "prompt-group"
    group.dataset.session = sessionName
    if (ev.promptId) group.dataset.promptId = ev.promptId
    var header = document.createElement("div")
    header.className = "prompt-header"
    var timeStr = ev.time ? formatTime(ev.time) : ""
    var fullPromptText = ev.text || ""
    var previewText = fullPromptText.replace(/\n/g, " ").slice(0, 160) || "(prompt)"
    header.innerHTML = [
      '<span class="prompt-toggle collapsed">▼</span>',
      makeSessionTag(ev.project),
      `<span class="prompt-time">${timeStr}</span>`,
      '<span class="prompt-text" data-tooltip="' +
        escapeHtml(fullPromptText) +
        '">' +
        escapeHtml(previewText) +
        "</span>",
      '<span class="prompt-count">0</span>',
    ].join("")
    var tools = document.createElement("div")
    tools.className = "prompt-tools collapsed"
    header.onclick = function () {
      var toggle = this.querySelector(".prompt-toggle")
      toggle.classList.toggle("collapsed")
      tools.classList.toggle("collapsed")
    }
    group.appendChild(header)
    group.appendChild(tools)
    activityList.insertBefore(group, beforeEl)
    prevGroup = group
    prevToolsContainer = tools
    prevToolCount = 0
    return
  }

  if (ev.type === "assistant_text") {
    if (!prevToolsContainer) return
    var aItem = document.createElement("div")
    aItem.className = "assistant-text-item"
    var aFull = ev.text || ""
    aItem.innerHTML =
      '<span class="assistant-icon">\u25CF</span><span class="assistant-text" data-tooltip="' +
      escapeHtml(aFull) +
      '">' +
      escapeHtml(aFull) +
      "</span>"
    aItem.style.cursor = "pointer"
    aItem._outputData = { name: "Assistant", target: "", output: aFull, time: ev.time }
    aItem.onclick = function () {
      window.displayCode._clickedEl = this
      if (window.displayOutput) window.displayOutput(this._outputData)
    }
    prevToolsContainer.appendChild(aItem)
    return
  }

  if ((ev.type === "tool_done" || ev.type === "tool_error") && ev.id) {
    var existing = toolItemMap.get(ev.id)
    if (existing) {
      var iconEl = existing.querySelector(".activity-icon")
      if (ev.type === "tool_done") {
        iconEl.textContent = "\u2713"
        iconEl.className = "activity-icon icon-done"
      } else {
        iconEl.textContent = "\u2717"
        iconEl.className = "activity-icon icon-error"
        existing.classList.add("error-item")
      }
      var endTime = ev.time ? formatTime(ev.time) : ""
      var duration = ev.duration != null ? formatDuration(ev.duration) : ""
      var etEl = existing.querySelector(".activity-end-time")
      if (etEl) etEl.textContent = endTime
      var dEl = existing.querySelector(".activity-duration")
      if (dEl) dEl.textContent = duration
      return
    }
  }

  if (ev.type !== "tool_start") return
  if (!prevGroup) {
    addActivityItemBefore(
      { type: "prompt", text: "(previous)", project: ev.project, time: ev.time },
      beforeEl,
    )
  }
  var item = document.createElement("div")
  item.className = "activity-item"
  if (ev.id) {
    item.dataset.toolId = ev.id
    toolItemMap.set(ev.id, item)
  }
  if (ev.diff)
    item._diffData = {
      filePath: ev.filePath,
      fileName: ev.target,
      diff: ev.diff,
      time: ev.time,
      language: ev.language,
    }
  if (ev.filePath) {
    item.dataset.filePath = ev.filePath
    item.style.cursor = "pointer"
    item.onclick = function () {
      window.displayCode._clickedEl = this
      if (this._diffData) {
        window.pendingHighlight = this._diffData
        window.displayDiff(this._diffData)
      } else {
        window.pendingHighlight = null
      }
      window.fileCache.delete(ev.filePath)
      window.requestFileContent(ev.filePath)
    }
  }
  var timeStr = ev.time ? formatTime(ev.time) : ""
  var target = ev.target || ""
  item.innerHTML = [
    `<span class="activity-time">${timeStr}</span>`,
    '<span class="activity-icon icon-start">\u25b6</span>',
    `<span class="activity-name">${escapeHtml(ev.name)}</span>`,
    '<span class="activity-target" data-tooltip="' +
      escapeHtml(target) +
      '">' +
      escapeHtml(target) +
      "</span>",
    '<span class="activity-end-time"></span>',
    '<span class="activity-duration"></span>',
  ].join("")
  // Load-more 경로도 filePath 없으면 command/target을 코드뷰어에 표시하도록 클릭 부착
  if (!ev.filePath) {
    item.style.cursor = "pointer"
    item._outputData = {
      name: ev.name,
      target: target,
      output: target || "(no content)",
      time: ev.time,
    }
    item.onclick = function () {
      window.displayCode._clickedEl = this
      if (window.displayOutput) window.displayOutput(this._outputData)
    }
  }
  prevToolsContainer.appendChild(item)
  prevToolCount++
  var countEl = prevGroup.querySelector(".prompt-count")
  if (countEl) countEl.textContent = prevToolCount
}

// 공용 툴팁 모듈 (tooltip.js)에 활동 리스트 바인딩 — 느린 지연 1500ms
if (window.hoverTooltip && typeof window.hoverTooltip.bind === "function") {
  window.hoverTooltip.bind(activityList, 1500)
}

// ─── ES Module exports ───────────────────────────
export {
  activityList,
  addActivityItem,
  addActivityItemBefore,
  escapeHtml,
  formatDuration,
  formatElapsed,
  formatTime,
}
export const feed = {
  startBatch: () => {
    isBatchLoading = true
  },
  endBatch: () => {
    isBatchLoading = false
  },
}

// COMPAT — 다른 모듈이 window.* 여전히 참조
if (typeof window !== "undefined") {
  window.addActivityItem = addActivityItem
  window.addActivityItemBefore = addActivityItemBefore
  window.feed = feed
  window.escapeHtml = escapeHtml
  window.formatTime = formatTime
  window.formatDuration = formatDuration
  window.formatElapsed = formatElapsed
  window.activityList = activityList
}
