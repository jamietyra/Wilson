/**
 * time-metric.mjs — active time 계산 (5분 갭 컷오프)
 *
 * 스펙: docs/specs/2026-04-13-monitor-usage-design.md (섹션 7)
 */

/**
 * 연속 이벤트 간격의 합. 단, gapMaxMs를 초과하는 갭은 무시한다.
 * 자리 비운 시간을 자연스럽게 제거하는 단순·안정 알고리즘.
 *
 * @param {Array<{timestamp: string|number}>} events — 오름차순 정렬 가정
 * @param {number} gapMaxMs — 이 값 이상의 갭은 무시 (기본 5분)
 * @returns {number} active milliseconds
 */
export function computeActiveMs(events, gapMaxMs = 5 * 60 * 1000) {
  if (!Array.isArray(events) || events.length < 2) return 0

  let active = 0
  for (let i = 1; i < events.length; i++) {
    const prevTs = toMs(events[i - 1].timestamp)
    const currTs = toMs(events[i].timestamp)
    if (prevTs == null || currTs == null) continue
    const gap = currTs - prevTs
    if (gap > 0 && gap < gapMaxMs) {
      active += gap
    }
  }
  return active
}

function toMs(ts) {
  if (ts == null) return null
  if (typeof ts === "number") return ts
  const parsed = Date.parse(ts)
  return Number.isNaN(parsed) ? null : parsed
}
