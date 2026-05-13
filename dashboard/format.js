// format.js — 공용 포맷 헬퍼 (ES Module)
// 사용: import { formatTokens, formatCost, formatDuration, isoDate, escapeHtml } from './format.js'

/** 1234 → "1.2K", 1234567 → "1.2M", 1234567890 → "1.2B" */
export function formatTokens(n) {
  if (!n || n <= 0) return "0"
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K"
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B"
}

/** $X.XX 소수 둘째 자리. */
export function formatCost(usd) {
  if (!usd || usd <= 0) return "$0.00"
  return "$" + Number(usd).toFixed(2)
}

/** ms → "Xh Ym" 또는 "Ym", 0이면 "—" */
export function formatDuration(ms) {
  if (!ms || ms <= 0) return "—"
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return m + "m"
  return h + "h " + m + "m"
}

/** Date → 'YYYY-MM-DD' (로컬 기준) */
export function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return y + "-" + m + "-" + day
}

/** XSS 방지용 HTML 이스케이프 */
export function escapeHtml(s) {
  if (s == null) return ""
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  })
}

// COMPAT — 마이그레이션 기간에만 유지
if (typeof window !== "undefined") {
  window.wilsonFormat = { formatTokens, formatCost, formatDuration, isoDate, escapeHtml }
}
