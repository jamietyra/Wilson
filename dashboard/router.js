// router.js — hash 기반 SPA 라우터 (#13)
// 역할:
//   - location.hash 읽어서 body[data-route] 토글 (agent/usage)
//   - hashchange 이벤트로 뒤/앞 버튼 처리
//   - usage route 첫 진입 시 usage.js의 init() 트리거 (lazy)
//   - 페이지 타이틀·body[data-page] 업데이트

const ROUTES = { agent: "agent", usage: "usage" }

function parseRoute() {
  const h = (location.hash || "").replace(/^#\/?/, "").trim()
  return h === "usage" ? "usage" : "agent"
}

let usageInitTriggered = false

function applyRoute(route) {
  document.body.dataset.route = route
  document.body.dataset.page = route
  const titleEl = document.getElementById("page-nav-title")
  if (titleEl) {
    titleEl.textContent = route === "usage" ? "monitor-usage" : "monitor-agent"
    titleEl.title =
      route === "usage"
        ? "monitor-agent 페이지로 전환 — 클릭"
        : "monitor-usage 페이지로 전환 — 클릭"
  }
  document.title = route === "usage" ? "monitor-usage" : "wilson"

  // usage route 첫 진입 시 init 트리거 (data fetch + chart 렌더)
  if (route === "usage" && !usageInitTriggered) {
    usageInitTriggered = true
    const page = window.usagePage
    if (page && typeof page.init === "function") {
      page.init()
    } else if (page && typeof page.loadUsageData === "function") {
      // init export 없으면 fallback
      page.loadUsageData()
    }
  }
}

function onHashChange() {
  applyRoute(parseRoute())
}

// 초기 적용 — 이미 DOM 준비됨 (module script는 defer 후 실행)
applyRoute(parseRoute())

window.addEventListener("hashchange", onHashChange)

export const router = {
  current: parseRoute,
  navigate: (route) => {
    if (!ROUTES[route]) return
    const target = route === "usage" ? "#/usage" : "#/agent"
    if (location.hash !== target) location.hash = target
  },
}

if (typeof window !== "undefined") window.router = router
