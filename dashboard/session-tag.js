/* ─── Session Tag 공유 모듈 (ES Module) ─────────────────
 * monitor-agent(Feeds)과 monitor-usage(Sessions·Top Projects)에서
 * 프로젝트 이름별로 동일한 색상 박스를 보장하기 위한 공유 레지스트리.
 *
 * 규칙:
 *   - 10색 팔레트 (아래 PALETTE)
 *   - 새 프로젝트가 나오면 다음 빈 슬롯(0~9)을 순서대로 배정
 *   - 11번째(이상) 프로젝트는 랜덤 슬롯 (충돌 허용)
 *   - 배정 결과는 localStorage에 영속화 → 양 페이지/세션 간 동일 색상
 *
 * 사용: import { sessionTag } from './session-tag.js'
 * 의존: 없음
 */

// 10색 팔레트
const PALETTE = [
  { bg: "#2a3a5c", fg: "#9cdcfe" },
  { bg: "#5c2a3a", fg: "#f48771" },
  { bg: "#3a5c2a", fg: "#b5cea8" },
  { bg: "#5c4a2a", fg: "#d7ba7d" },
  { bg: "#4a2a5c", fg: "#c586c0" },
  { bg: "#1a3c3c", fg: "#4fc1ff" },
  { bg: "#3c3a1a", fg: "#dcdcaa" },
  { bg: "#1a3c2d", fg: "#4ec9b0" },
  { bg: "#3c2a1a", fg: "#ce9178" },
  { bg: "#2a1a3c", fg: "#b48ead" },
]

const STORAGE_KEY = "wilson.projectColors.v1"
const LEGACY_STORAGE_KEY = "monitor-agent.projectColors.v1"

function loadMap() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (legacy) {
        localStorage.setItem(STORAGE_KEY, legacy)
        localStorage.removeItem(LEGACY_STORAGE_KEY)
        raw = legacy
      }
    }
    return raw ? JSON.parse(raw) || {} : {}
  } catch (_) {
    return {}
  }
}
function saveMap(m) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m))
  } catch (_) {
    /* skip */
  }
}

let map = loadMap()

function nextSlot() {
  const used = {}
  Object.keys(map).forEach(function (k) {
    const v = map[k]
    if (typeof v === "number" && v >= 0 && v < PALETTE.length) used[v] = true
  })
  for (let i = 0; i < PALETTE.length; i++) {
    if (!used[i]) return i
  }
  return Math.floor(Math.random() * PALETTE.length)
}

function assign(name) {
  const key = String(name || "default")
  if (typeof map[key] !== "number") {
    map[key] = nextSlot()
    saveMap(map)
  }
  return PALETTE[map[key] % PALETTE.length]
}

function escapeHtmlLocal(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function render(name) {
  const n = name || "IT"
  const c = assign(n)
  return (
    '<span class="session-tag" style="background:' +
    c.bg +
    ";color:" +
    c.fg +
    '">' +
    escapeHtmlLocal(n) +
    "</span>"
  )
}

function snapshot() {
  return Object.assign({}, map)
}
function reset() {
  map = {}
  saveMap(map)
}

export const sessionTag = {
  assign,
  render,
  snapshot,
  reset,
  palette: PALETTE,
}

// COMPAT — 마이그레이션 기간에만 유지
if (typeof window !== "undefined") window.sessionTag = sessionTag
