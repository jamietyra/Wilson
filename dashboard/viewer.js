// viewer.js — 코드/Diff/Screenshot 뷰어 (ES Module)
// ─── DOM 요소 ─────────────────────────────────────
var codeFilename = document.getElementById("code-filename")
var codeInfo = document.getElementById("code-info")
var codeContent = document.getElementById("code-content")
var browserViewer = document.getElementById("browser-viewer")
var browserContent = document.getElementById("browser-content")
var screenshotTime = document.getElementById("screenshot-time")
var diffPanel = document.getElementById("diff-panel")
var diffFilename = document.getElementById("diff-filename")
var diffTime = document.getElementById("diff-time")
var diffContent = document.getElementById("diff-content")

// ─── Prism Web Worker (백그라운드 하이라이트) ────────
var prismWorker = null
var prismWorkerListener = false
var pendingPrismJobs = {}
var nextPrismId = 0

function highlightWithWorker(codeEl, code, language, done) {
  if (!language || language === "plaintext") {
    if (done) done()
    return
  }
  if (!prismWorker) {
    try {
      prismWorker = new Worker("/prism-worker.js")
    } catch (e) {
      prismWorker = null
    }
    if (!prismWorker) {
      if (done) done()
      return
    }
  }
  if (!prismWorkerListener) {
    prismWorker.addEventListener("message", function (e) {
      var job = pendingPrismJobs[e.data.id]
      if (!job) return
      delete pendingPrismJobs[e.data.id]
      if (job.el && e.data.html != null) job.el.innerHTML = e.data.html
      if (job.done) job.done()
    })
    prismWorkerListener = true
  }
  var id = ++nextPrismId
  pendingPrismJobs[id] = { el: codeEl, done: done }
  prismWorker.postMessage({ id: id, code: code, language: language })
}

// ─── Code Viewer ──────────────────────────────────
var pendingHighlight = null

function formatSize(bytes) {
  if (bytes == null) return ""
  if (bytes < 1024) return bytes + "B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB"
  return (bytes / 1024 / 1024).toFixed(2) + "MB"
}

function formatAge(mtimeMs) {
  if (!mtimeMs) return ""
  var diff = Date.now() - mtimeMs
  if (diff < 0) return "just now"
  var s = Math.floor(diff / 1000)
  if (s < 60) return s + "s ago"
  var m = Math.floor(s / 60)
  if (m < 60) return m + "m ago"
  var h = Math.floor(m / 60)
  if (h < 24) return h + "h ago"
  var d = Math.floor(h / 24)
  return d + "d ago"
}

function clearDiff() {
  diffFilename.textContent = "Diff"
  diffTime.textContent = ""
  diffContent.innerHTML =
    '<span style="color: var(--text-dim)">Click an Edit item to see changes</span>'
}

function displayCode(fileData) {
  codeFilename.textContent = fileData.fileName
  var parts = [fileData.totalLines + " lines"]
  if (fileData.truncated) parts[0] += " (showing first 1500)"
  if (fileData.size != null) parts.push(formatSize(fileData.size))
  if (fileData.mtimeMs) parts.push("modified " + formatAge(fileData.mtimeMs))
  codeInfo.textContent = parts.join(" · ")

  var pre = document.createElement("pre")
  var code = document.createElement("code")
  code.className = "language-" + (fileData.language || "plaintext")
  code.textContent = fileData.content
  pre.appendChild(code)

  codeContent.innerHTML = ""
  codeContent.appendChild(pre)

  if (!pendingHighlight) clearDiff()

  // 구문 하이라이트 후 Edit diff 하이라이트 적용
  var savedHighlight = pendingHighlight
  pendingHighlight = null

  // Web Worker 하이라이트 — 1000줄 컷오프 제거 (UI block 안 함)
  highlightWithWorker(code, fileData.content, fileData.language || "plaintext", function () {
    if (savedHighlight) highlightChangedLines(code, savedHighlight)
  })

  // 클릭된 항목만 강조 (clickedElement가 있을 때만)
  document.querySelectorAll(".activity-item.active").forEach(function (el) {
    el.classList.remove("active")
  })
  if (displayCode._clickedEl) {
    displayCode._clickedEl.classList.add("active")
    displayCode._clickedEl = null
  }
}

function highlightChangedLines(codeEl, diffData) {
  var newStr = diffData.diff.newString
  if (!newStr) return

  var content = codeEl.textContent
  var lines = content.split("\n")
  var newLines = newStr.split("\n")

  // 파일에서 new_string이 시작되는 줄 찾기
  var firstNewLine = newLines[0].trim()
  if (!firstNewLine) return

  var startLine = -1
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].includes(firstNewLine)) {
      // 연속된 줄이 매칭되는지 검증
      var match = true
      for (var j = 1; j < Math.min(newLines.length, 3); j++) {
        if (
          i + j < lines.length &&
          newLines[j].trim() &&
          !lines[i + j].includes(newLines[j].trim())
        ) {
          match = false
          break
        }
      }
      if (match) {
        startLine = i
        break
      }
    }
  }

  if (startLine === -1) return

  var endLine = startLine + newLines.length

  // HTML을 줄 단위로 분할해서 하이라이트 적용
  var html = codeEl.innerHTML
  var htmlLines = html.split("\n")
  for (var i = startLine; i < Math.min(endLine, htmlLines.length); i++) {
    htmlLines[i] = '<span class="code-line-highlight">' + htmlLines[i] + "</span>"
  }
  codeEl.innerHTML = htmlLines.join("\n")

  // 하이라이트된 줄로 스크롤 (상단 1/3 지점)
  requestAnimationFrame(function () {
    var highlighted = codeContent.querySelector(".code-line-highlight")
    if (highlighted) {
      var containerRect = codeContent.getBoundingClientRect()
      var targetRect = highlighted.getBoundingClientRect()
      var offset = targetRect.top - containerRect.top + codeContent.scrollTop
      var scrollTo = offset - containerRect.height / 3
      codeContent.scrollTo({ top: Math.max(0, scrollTo), behavior: "smooth" })
    }
  })
}

// ─── 파일 캐시 + 요청 ─────────────────────────────
// LRU: 최근 사용 50개 유지. Map의 삽입 순서 보존을 활용.
var FILE_CACHE_MAX = (window.wilsonConfig && window.wilsonConfig.FILE_CACHE_MAX) || 50
var fileCache = (function () {
  var map = new Map()
  return {
    get: function (key) {
      if (!map.has(key)) return undefined
      var value = map.get(key)
      map.delete(key)
      map.set(key, value) // touch → move to end
      return value
    },
    set: function (key, value) {
      if (map.has(key)) map.delete(key)
      map.set(key, value)
      if (map.size > FILE_CACHE_MAX) {
        map.delete(map.keys().next().value) // evict oldest
      }
      return this
    },
    delete: function (key) {
      return map.delete(key)
    },
    has: function (key) {
      return map.has(key)
    },
  }
})()

function requestFileContent(filePath) {
  // 캐시에 있으면 즉시 표시
  var cached = fileCache.get(filePath)
  if (cached) {
    displayCode(cached)
    return
  }

  // 없으면 서버에 요청
  fetch("/api/file?path=" + encodeURIComponent(filePath))
    .then(function (r) {
      return r.ok ? r.json() : null
    })
    .then(function (data) {
      if (data && data.content) {
        fileCache.set(filePath, data)
        displayCode(data)
      }
    })
    .catch(function () {})
}

// ─── Diff Viewer ──────────────────────────────────
function makeDiffLine(kind, lang, line) {
  var div = document.createElement("div")
  div.className = "diff-line-" + kind
  var prefix = document.createElement("span")
  prefix.className = "diff-prefix"
  prefix.textContent = kind === "old" ? "- " : "+ "
  var code = document.createElement("code")
  code.className = "language-" + lang
  code.textContent = line
  div.appendChild(prefix)
  div.appendChild(code)
  return div
}

function displayDiff(data) {
  diffPanel.classList.add("visible")
  var oldLines = data.diff.oldString ? data.diff.oldString.split("\n").length : 0
  var newLines = data.diff.newString ? data.diff.newString.split("\n").length : 0

  // Filename + 배지 — textContent + createElement로 재작성 (XSS 방지 + reflow 1회)
  while (diffFilename.firstChild) diffFilename.removeChild(diffFilename.firstChild)
  diffFilename.appendChild(document.createTextNode("Edit: " + (data.fileName || "") + " "))
  var badge = document.createElement("span")
  badge.style.cssText = "color:var(--text-dim);font-weight:400"
  var plus = document.createElement("span")
  plus.style.color = "#6ee7b7"
  plus.textContent = "+" + newLines
  var minus = document.createElement("span")
  minus.style.color = "#fca5a5"
  minus.textContent = "-" + oldLines
  badge.appendChild(plus)
  badge.appendChild(document.createTextNode(" / "))
  badge.appendChild(minus)
  diffFilename.appendChild(badge)

  diffTime.textContent = data.time ? window.formatTime(data.time) : ""

  var lang = data.language || "plaintext"
  var frag = document.createDocumentFragment()

  if (data.diff.oldString) {
    data.diff.oldString.split("\n").forEach(function (line) {
      frag.appendChild(makeDiffLine("old", lang, line))
    })
  }
  var hr = document.createElement("hr")
  hr.className = "diff-separator"
  frag.appendChild(hr)
  if (data.diff.newString) {
    data.diff.newString.split("\n").forEach(function (line) {
      frag.appendChild(makeDiffLine("new", lang, line))
    })
  }

  diffContent.innerHTML = ""
  diffContent.appendChild(frag)

  var totalDiffLines = oldLines + newLines
  if (typeof Prism !== "undefined" && lang !== "plaintext" && totalDiffLines <= 1000) {
    requestAnimationFrame(function () {
      diffContent.querySelectorAll('code[class^="language-"]').forEach(function (el) {
        Prism.highlightElement(el)
      })
    })
  }
}

// ─── Browser Viewer ───────────────────────────────
function displayScreenshot(data) {
  browserViewer.classList.add("visible")
  screenshotTime.textContent = data.time ? window.formatTime(data.time) : ""
  browserContent.innerHTML =
    '<img src="/screenshots/' +
    encodeURIComponent(data.fileName) +
    "?t=" +
    Date.now() +
    '" alt="Browser screenshot">'
}

// ─── Tool Output Viewer ────────────────────────────
function displayOutput(data) {
  var title = data.name || "Output"
  if (data.target) title += ": " + data.target.split(/[/\\]/).pop()
  codeFilename.textContent = title
  var lines = (data.output || "").split("\n")
  codeInfo.textContent = lines.length + " lines"

  var pre = document.createElement("pre")
  pre.style.whiteSpace = "pre-wrap"
  pre.style.wordBreak = "break-word"
  var code = document.createElement("code")
  code.className = "language-plaintext"
  code.textContent = data.output || "(no output)"
  pre.appendChild(code)

  codeContent.innerHTML = ""
  codeContent.appendChild(pre)

  pendingHighlight = null
  clearDiff()
}

// ─── window 노출 ──────────────────────────────────
window.displayCode = displayCode
window.displayDiff = displayDiff
window.displayScreenshot = displayScreenshot
window.displayOutput = displayOutput
window.requestFileContent = requestFileContent
window.fileCache = fileCache

// pendingHighlight를 feed.js / wilson.js에서 설정할 수 있도록 노출
Object.defineProperty(window, "pendingHighlight", {
  get: function () {
    return pendingHighlight
  },
  set: function (v) {
    pendingHighlight = v
  },
})

// ─── ES Module exports (신규 consumer용, 내부는 window.* 유지) ─
export { displayCode, displayDiff, displayOutput, displayScreenshot, fileCache, requestFileContent }
export function setPendingHighlight(v) {
  pendingHighlight = v
}
export function getPendingHighlight() {
  return pendingHighlight
}
