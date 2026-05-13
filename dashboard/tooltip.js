/**
 * tooltip.js — 공용 hover 툴팁 (ES Module)
 *
 * 사용법:
 *   <element data-tooltip="전체 내용">...</element>
 *   import { hoverTooltip } from './tooltip.js';
 *   hoverTooltip.bind(rootEl, delayMs)
 */
import { wilsonConfig } from "./config.js"

const DEFAULT_DELAY_MS = wilsonConfig.TOOLTIP_DEFAULT_DELAY_MS || 1500
const HIDE_GRACE_MS = wilsonConfig.TOOLTIP_HIDE_GRACE_MS || 120

let tooltipEl = null
let tooltipTimer = null
let hideTimer = null
let tooltipCurrent = null

function ensureEl() {
  if (tooltipEl) return tooltipEl
  tooltipEl = document.getElementById("feed-tooltip")
  if (!tooltipEl) {
    tooltipEl = document.createElement("div")
    tooltipEl.id = "feed-tooltip"
    tooltipEl.className = "feed-tooltip"
    tooltipEl.setAttribute("aria-hidden", "true")
  }
  if (document.body && !tooltipEl.parentNode) document.body.appendChild(tooltipEl)
  tooltipEl.addEventListener("mouseenter", cancelHide)
  tooltipEl.addEventListener("mouseleave", hideTooltipNow)
  return tooltipEl
}

function positionTooltip(target) {
  const el = ensureEl()
  const rect = target.getBoundingClientRect()
  el.style.left = "0px"
  el.style.top = "0px"
  const tipRect = el.getBoundingClientRect()
  const margin = 8
  let x = rect.left
  let y = rect.bottom + margin
  if (y + tipRect.height > window.innerHeight - margin) {
    y = Math.max(margin, rect.top - tipRect.height - margin)
  }
  if (x + tipRect.width > window.innerWidth - margin) {
    x = Math.max(margin, window.innerWidth - tipRect.width - margin)
  }
  if (x < margin) x = margin
  el.style.left = x + "px"
  el.style.top = y + "px"
}

function showTooltipNow(target) {
  const text = target.getAttribute("data-tooltip")
  if (!text) return
  const el = ensureEl()
  el.textContent = text
  el.classList.add("visible")
  positionTooltip(target)
}

function hideTooltipNow() {
  if (tooltipTimer) {
    clearTimeout(tooltipTimer)
    tooltipTimer = null
  }
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  tooltipCurrent = null
  if (tooltipEl) tooltipEl.classList.remove("visible")
}

function cancelHide() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function scheduleHide() {
  cancelHide()
  hideTimer = setTimeout(hideTooltipNow, HIDE_GRACE_MS)
}

function scheduleShow(target, delay) {
  delay = delay != null ? delay : DEFAULT_DELAY_MS
  if (tooltipCurrent === target) {
    cancelHide()
    return
  }
  if (tooltipTimer) clearTimeout(tooltipTimer)
  cancelHide()
  tooltipCurrent = target
  tooltipTimer = setTimeout(function () {
    tooltipTimer = null
    if (tooltipCurrent === target) showTooltipNow(target)
  }, delay)
}

function bindTooltip(rootEl, delay) {
  if (!rootEl) return
  ensureEl()
  rootEl.addEventListener("mouseover", function (e) {
    const el = e.target.closest("[data-tooltip]")
    if (el && rootEl.contains(el)) scheduleShow(el, delay)
  })
  rootEl.addEventListener("mouseout", function (e) {
    const el = e.target.closest("[data-tooltip]")
    if (!el) return
    const to = e.relatedTarget
    if (to && (el.contains(to) || (tooltipEl && tooltipEl.contains(to)))) return
    scheduleHide()
  })
  rootEl.addEventListener("scroll", hideTooltipNow, { passive: true })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ensureEl)
} else {
  ensureEl()
}
window.addEventListener("scroll", hideTooltipNow, { passive: true })

export const hoverTooltip = {
  bind: bindTooltip,
  hide: hideTooltipNow,
}

// COMPAT — 마이그레이션 기간에만 유지
if (typeof window !== "undefined") window.hoverTooltip = hoverTooltip
