/* ─── Page Navigation (monitor-agent ↔ monitor-usage) ───
 * #13 — SPA hash router 기반으로 전환 (2026-04-17)
 *
 * 동작:
 *   1) 타이틀 클릭 → body.page-leaving 클래스 (CSS 슬라이드+페이드)
 *   2) LEAVE_MS 후 location.hash 변경 → router.js가 body[data-route] 토글
 *   3) playEntrance로 entrance 애니메이션 재생
 *   4) hashchange 시에도 동일 애니메이션 (뒤/앞 버튼 대응)
 *
 * ES Module — export { pageNav }
 */

const LEAVE_MS = 400

// 현재 route 읽기 (router.js의 parseRoute와 동등)
function currentRoute() {
  const h = (location.hash || "").replace(/^#\/?/, "").trim()
  return h === "usage" ? "usage" : "agent"
}

function targetRoute() {
  return currentRoute() === "usage" ? "agent" : "usage"
}

function targetHash(route) {
  return route === "usage" ? "#/usage" : "#/agent"
}

function navigateWithAnimation(toRoute) {
  if (document.body.classList.contains("page-leaving")) return
  document.body.classList.add("page-leaving")

  const title =
    document.getElementById("page-nav-title") || document.querySelector(".page-nav-title")
  if (title) title.classList.add("is-navigating")

  window.setTimeout(function () {
    const h = targetHash(toRoute)
    if (location.hash !== h) location.hash = h
    // hashchange → router applies → entrance 애니메이션 직후 재생
  }, LEAVE_MS)
}

function playEntrance() {
  document.body.classList.remove("page-leaving")

  const title =
    document.getElementById("page-nav-title") || document.querySelector(".page-nav-title")
  if (title) title.classList.remove("is-navigating")

  document.body.classList.add("page-entering")
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      document.body.classList.remove("page-entering")
    })
  })
}

function bindTitle() {
  const title =
    document.getElementById("page-nav-title") || document.querySelector(".page-nav-title")
  if (!title) return
  title.onclick = null
  title.removeAttribute("onclick")
  title.addEventListener("click", function (e) {
    e.preventDefault()
    navigateWithAnimation(targetRoute())
  })
}

// hashchange / pageshow 시 entrance 재생 (router가 이미 body[data-route] 세팅 후 발화)
window.addEventListener("hashchange", playEntrance)
window.addEventListener("pageshow", playEntrance)

function init() {
  bindTitle()
  playEntrance()
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init)
} else {
  init()
}

export const pageNav = {
  navigate: navigateWithAnimation,
  target: targetRoute,
}
if (typeof window !== "undefined") window.pageNav = pageNav
