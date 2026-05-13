import test from "node:test"
import assert from "node:assert/strict"
import { computeActiveMs } from "../lib/time-metric.mjs"

test("computeActiveMs: 빈 배열은 0", () => {
  assert.equal(computeActiveMs([]), 0)
})

test("computeActiveMs: 이벤트 1개는 0", () => {
  assert.equal(computeActiveMs([{ timestamp: "2026-04-16T10:00:00Z" }]), 0)
})

test("computeActiveMs: 배열 아닌 입력은 0", () => {
  assert.equal(computeActiveMs(null), 0)
  assert.equal(computeActiveMs(undefined), 0)
})

test("computeActiveMs: 연속 이벤트 누적 (1분 간격 3개 → 2분)", () => {
  const events = [
    { timestamp: "2026-04-16T10:00:00Z" },
    { timestamp: "2026-04-16T10:01:00Z" },
    { timestamp: "2026-04-16T10:02:00Z" },
  ]
  assert.equal(computeActiveMs(events), 2 * 60 * 1000)
})

test("computeActiveMs: 5분 초과 갭은 무시 (기본값)", () => {
  const events = [
    { timestamp: "2026-04-16T10:00:00Z" },
    { timestamp: "2026-04-16T10:01:00Z" }, // 1분 gap (active)
    { timestamp: "2026-04-16T10:20:00Z" }, // 19분 gap (ignored, > 5분)
    { timestamp: "2026-04-16T10:21:00Z" }, // 1분 gap (active)
  ]
  assert.equal(computeActiveMs(events), 2 * 60 * 1000)
})

test("computeActiveMs: gapMaxMs 인자로 임계값 조정 가능", () => {
  const events = [
    { timestamp: "2026-04-16T10:00:00Z" },
    { timestamp: "2026-04-16T10:10:00Z" }, // 10분 gap
  ]
  // 기본값(5분)에서는 무시, 15분 임계값에서는 포함
  assert.equal(computeActiveMs(events), 0)
  assert.equal(computeActiveMs(events, 15 * 60 * 1000), 10 * 60 * 1000)
})

test("computeActiveMs: 타임스탬프 파싱 실패 시 해당 쌍 skip", () => {
  const events = [
    { timestamp: "2026-04-16T10:00:00Z" },
    { timestamp: "not-a-date" }, // parse 실패 → skip
    { timestamp: "2026-04-16T10:02:00Z" }, // 이전 파싱 실패로 skip
  ]
  // 첫 쌍(정상→invalid)은 parse 실패로 skip, 둘째 쌍(invalid→정상)도 skip
  assert.equal(computeActiveMs(events), 0)
})

test("computeActiveMs: number timestamp (ms epoch)도 지원", () => {
  const events = [
    { timestamp: 1713253200000 },
    { timestamp: 1713253260000 }, // +60초
  ]
  assert.equal(computeActiveMs(events), 60 * 1000)
})
