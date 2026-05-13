// Prism syntax highlighting Web Worker.
// Main thread에서 큰 파일 하이라이팅 시 UI blocking 방지.

// Prism 코어가 워커 컨텍스트에서 자동 등록하는 message 리스너를 차단.
// Prism 기본 리스너는 JSON.parse(t.data)를 기대하는데 우리는 객체로 postMessage하므로
// "[object Object]" is not valid JSON SyntaxError가 반복 발생함.
// importScripts 중 addEventListener('message', ...) 1회 호출을 no-op으로 만들어 예방.
;(function () {
  var orig = self.addEventListener
  var blocked = false
  self.addEventListener = function (type, listener, options) {
    if (!blocked && type === "message") {
      blocked = true
      return
    }
    return orig.call(self, type, listener, options)
  }
  try {
    importScripts("/vendor/prism/prism.min.js")
  } finally {
    self.addEventListener = orig
  }
})()

importScripts(
  "/vendor/prism/prism-javascript.min.js",
  "/vendor/prism/prism-typescript.min.js",
  "/vendor/prism/prism-jsx.min.js",
  "/vendor/prism/prism-tsx.min.js",
  "/vendor/prism/prism-python.min.js",
  "/vendor/prism/prism-csharp.min.js",
  "/vendor/prism/prism-json.min.js",
  "/vendor/prism/prism-css.min.js",
  "/vendor/prism/prism-bash.min.js",
  "/vendor/prism/prism-yaml.min.js",
  "/vendor/prism/prism-markdown.min.js",
  "/vendor/prism/prism-sql.min.js",
  "/vendor/prism/prism-go.min.js",
  "/vendor/prism/prism-rust.min.js",
  "/vendor/prism/prism-powershell.min.js",
)

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  })
}

self.onmessage = function (e) {
  var id = e.data.id
  var code = e.data.code
  var language = e.data.language

  if (!self.Prism || !self.Prism.languages[language]) {
    self.postMessage({ id: id, html: escapeHtml(code), fallback: true })
    return
  }

  try {
    var html = self.Prism.highlight(code, self.Prism.languages[language], language)
    self.postMessage({ id: id, html: html })
  } catch (err) {
    self.postMessage({ id: id, html: escapeHtml(code), err: err.message })
  }
}
