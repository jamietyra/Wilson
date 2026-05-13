import test from "node:test"
import assert from "node:assert/strict"
import { computeAllowedOrigins, matchOrigin } from "../lib/cors-guard.mjs"

// ─── computeAllowedOrigins ───────────────────────────

test("computeAllowedOrigins: env 없으면 localhost/127.0.0.1 기본", () => {
  const origins = computeAllowedOrigins(undefined)
  assert.deepEqual(origins, ["localhost", "127.0.0.1"])
})

test("computeAllowedOrigins: env 콤마 분할 + trim", () => {
  const origins = computeAllowedOrigins("a.com, b.com ,  c.com")
  assert.deepEqual(origins, ["a.com", "b.com", "c.com"])
})

test("computeAllowedOrigins: 빈 항목 필터링", () => {
  const origins = computeAllowedOrigins("a.com,,b.com, ")
  assert.deepEqual(origins, ["a.com", "b.com"])
})

// ─── matchOrigin ─────────────────────────────────────

test("matchOrigin: 허용된 origin은 원본 문자열 echo", () => {
  const result = matchOrigin("http://localhost:3141", ["localhost"])
  assert.equal(result, "http://localhost:3141")
})

test("matchOrigin: 포트 달라도 hostname 매칭되면 허용", () => {
  const result = matchOrigin("http://localhost:9999", ["localhost"])
  assert.equal(result, "http://localhost:9999")
})

test("matchOrigin: 허용되지 않은 origin은 null", () => {
  const result = matchOrigin("http://evil.com", ["localhost", "127.0.0.1"])
  assert.equal(result, null)
})

test("matchOrigin: undefined/null origin은 null", () => {
  assert.equal(matchOrigin(undefined, ["localhost"]), null)
  assert.equal(matchOrigin(null, ["localhost"]), null)
  assert.equal(matchOrigin("", ["localhost"]), null)
})

test("matchOrigin: allowedOrigins 빈/null은 null", () => {
  assert.equal(matchOrigin("http://localhost:80", []), null)
  assert.equal(matchOrigin("http://localhost:80", null), null)
})

test("matchOrigin: 잘못된 URL은 null", () => {
  assert.equal(matchOrigin("not-a-url", ["localhost"]), null)
  assert.equal(matchOrigin("://missing-scheme", ["localhost"]), null)
})

test("matchOrigin: https 스킴도 hostname만 보고 판단", () => {
  const result = matchOrigin("https://localhost", ["localhost"])
  assert.equal(result, "https://localhost")
})

test("matchOrigin: 부분 문자열 매칭 차단 (정확한 hostname)", () => {
  // "localhost"만 허용 목록에 있을 때 "localhost.evil.com"은 차단
  assert.equal(matchOrigin("http://localhost.evil.com", ["localhost"]), null)
  // 반대로 "evil-localhost.com"도 차단
  assert.equal(matchOrigin("http://evil-localhost.com", ["localhost"]), null)
})
