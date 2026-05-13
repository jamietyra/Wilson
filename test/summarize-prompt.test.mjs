import test from "node:test"
import assert from "node:assert/strict"
import { summarizePrompt } from "../lib/aggregator.mjs"

test("summarizePrompt: null/undefined은 null", () => {
  assert.equal(summarizePrompt(null), null)
  assert.equal(summarizePrompt(undefined), null)
})

test("summarizePrompt: 빈 문자열은 null", () => {
  assert.equal(summarizePrompt(""), null)
  assert.equal(summarizePrompt("   "), null)
  assert.equal(summarizePrompt("\n\n\t"), null)
})

test("summarizePrompt: 문자열 아닌 입력은 null", () => {
  assert.equal(summarizePrompt(123), null)
  assert.equal(summarizePrompt({}), null)
  assert.equal(summarizePrompt([]), null)
})

test("summarizePrompt: 짧은 텍스트는 그대로", () => {
  assert.equal(summarizePrompt("hello"), "hello")
  assert.equal(summarizePrompt("테스트 프롬프트"), "테스트 프롬프트")
})

test("summarizePrompt: 개행/탭/연속공백 → 단일 공백", () => {
  assert.equal(summarizePrompt("line1\nline2"), "line1 line2")
  assert.equal(summarizePrompt("word1\t\tword2"), "word1 word2")
  assert.equal(summarizePrompt("a    b     c"), "a b c")
  assert.equal(summarizePrompt("  trim  me  "), "trim me")
})

test('summarizePrompt: 40자 초과는 40자 + "..."', () => {
  const long = "a".repeat(50)
  const result = summarizePrompt(long)
  assert.equal(result.length, 43) // 40 + '...'
  assert.ok(result.endsWith("..."))
  assert.equal(result.slice(0, 40), "a".repeat(40))
})

test("summarizePrompt: 정확히 40자는 잘리지 않음", () => {
  const exact = "a".repeat(40)
  assert.equal(summarizePrompt(exact), exact)
})
