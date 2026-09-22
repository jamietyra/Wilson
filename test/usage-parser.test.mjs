import assert from "node:assert/strict"
import test from "node:test"
import { getPricingSnapshot, normalizeModel, parseUsageEvent } from "../lib/usage-parser.mjs"

// ─── normalizeModel ───────────────────────────────────────

test("normalizeModel: 빈 문자열은 빈 문자열 반환", () => {
  assert.equal(normalizeModel(""), "")
})

test("normalizeModel: null/undefined은 빈 문자열 반환", () => {
  assert.equal(normalizeModel(null), "")
  assert.equal(normalizeModel(undefined), "")
})

test("normalizeModel: 날짜 suffix 제거", () => {
  assert.equal(normalizeModel("claude-haiku-4-5-20251001"), "claude-haiku-4-5")
  assert.equal(normalizeModel("claude-opus-4-6-20260101"), "claude-opus-4-6")
})

test("normalizeModel: 날짜 suffix 없으면 그대로", () => {
  assert.equal(normalizeModel("claude-sonnet-4-6"), "claude-sonnet-4-6")
  assert.equal(normalizeModel("claude-opus-4-6"), "claude-opus-4-6")
})

test("normalizeModel: [1m] 변형 suffix 제거 (1M 컨텍스트는 standard 단가)", () => {
  assert.equal(normalizeModel("claude-opus-4-8[1m]"), "claude-opus-4-8")
  assert.equal(normalizeModel("claude-sonnet-4-6[1m]"), "claude-sonnet-4-6")
})

test("normalizeModel: [1m] + 날짜 suffix 동시 제거", () => {
  assert.equal(normalizeModel("claude-opus-4-8-20260515[1m]"), "claude-opus-4-8")
})

// ─── parseUsageEvent ──────────────────────────────────────

test("parseUsageEvent: null/undefined은 null 반환", () => {
  assert.equal(parseUsageEvent(null), null)
  assert.equal(parseUsageEvent(undefined), null)
})

test("parseUsageEvent: message 없으면 null", () => {
  assert.equal(parseUsageEvent({ type: "user" }), null)
})

test("parseUsageEvent: usage 없으면 null", () => {
  assert.equal(
    parseUsageEvent({
      type: "assistant",
      message: { model: "claude-opus-4-6", role: "assistant" },
    }),
    null,
  )
})

test("parseUsageEvent: <synthetic> 모델은 null (합성 메시지 skip)", () => {
  assert.equal(
    parseUsageEvent({
      message: { model: "<synthetic>", usage: { input_tokens: 100, output_tokens: 200 } },
    }),
    null,
  )
})

test("parseUsageEvent: 정상 케이스 — tokens + costUSD 계산", () => {
  const result = parseUsageEvent({
    timestamp: "2026-04-16T10:00:00Z",
    sessionId: "sess-abc",
    isSidechain: false,
    uuid: "uuid-1",
    message: {
      model: "claude-opus-4-6-20260101",
      usage: {
        input_tokens: 1000,
        output_tokens: 2000,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 300,
      },
    },
  })
  assert.ok(result, "결과가 null이면 안 됨")
  assert.equal(result.model, "claude-opus-4-6-20260101")
  assert.equal(result.normalizedModel, "claude-opus-4-6")
  assert.equal(result.tokens.input, 1000)
  assert.equal(result.tokens.output, 2000)
  assert.equal(result.tokens.cacheRead, 500)
  assert.equal(result.sessionId, "sess-abc")
  assert.equal(result.uuid, "uuid-1")
  assert.equal(typeof result.costUSD, "number")
  assert.ok(result.costUSD >= 0, "costUSD는 음수가 아님")
})

test("parseUsageEvent: cache_creation 1h/5m 분리 케이스", () => {
  const result = parseUsageEvent({
    message: {
      model: "claude-opus-4-6",
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 500,
        cache_creation: {
          ephemeral_1h_input_tokens: 200,
          ephemeral_5m_input_tokens: 300,
        },
      },
    },
  })
  assert.ok(result)
  assert.equal(result.tokens.cacheWrite1h, 200)
  assert.equal(result.tokens.cacheWrite5m, 300)
})

test("parseUsageEvent: cache_creation 세부 없으면 total이 1h로 폴백", () => {
  const result = parseUsageEvent({
    message: {
      model: "claude-opus-4-6",
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 400,
      },
    },
  })
  assert.ok(result)
  assert.equal(result.tokens.cacheWrite1h, 400)
  assert.equal(result.tokens.cacheWrite5m, 0)
})

// ─── getPricingSnapshot ──────────────────────────────────

test("getPricingSnapshot: pricing 객체 반환 (unitTokens + models)", () => {
  const snap = getPricingSnapshot()
  assert.ok(snap, "pricing 스냅샷은 null이 아님")
  assert.equal(typeof snap.unitTokens, "number")
  assert.equal(typeof snap.models, "object")
})

test("pricing: 현행 모델 단가 등록 + 정확한 비용 계산 (Opus 5 / Fable 5.1 / Sonnet 5)", () => {
  const snap = getPricingSnapshot()
  for (const key of ["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"]) {
    assert.ok(snap.models[key], `${key} 단가 등록됨`)
  }
  // Fable 5.1 캐시 읽기는 0.025x 예외 단가 ($0.25/MTok)
  assert.equal(snap.models["claude-fable-5-1"].cacheRead, 0.25)
  // Sonnet 5 표준가 $2/$10
  assert.equal(snap.models["claude-sonnet-5"].input, 2)
  assert.equal(snap.models["claude-sonnet-5"].output, 10)

  // Opus 5: input 1M×$5 + output 1M×$25 = $30 (fallback 아님)
  const result = parseUsageEvent({
    message: {
      model: "claude-opus-5[1m]",
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    },
  })
  assert.ok(result)
  assert.equal(result.normalizedModel, "claude-opus-5")
  assert.equal(result.costUSD, 30)
})

test("pricing: Opus 5.5 단가 ($4/$20, 캐시 읽기 0.05x 예외)", () => {
  const rates = getPricingSnapshot().models["claude-opus-5-5"]
  assert.ok(rates, "claude-opus-5-5 단가 등록됨")
  assert.equal(rates.cacheRead, 0.2) // 0.1x 공식이면 0.4 — 2배 과대

  // input 1M×$4 + cache read 1M×$0.2 + output 1M×$20 = $24.2 (fallback 아님)
  const result = parseUsageEvent({
    message: {
      model: "claude-opus-5-5[1m]",
      usage: {
        input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      },
    },
  })
  assert.equal(result.normalizedModel, "claude-opus-5-5")
  assert.equal(result.costUSD, 24.2)
})
