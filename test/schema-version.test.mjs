import assert from "node:assert/strict"
import test from "node:test"
import { migrateIndex, SCHEMA_VERSION } from "../lib/aggregator.mjs"

test("SCHEMA_VERSION: 현재 버전 상수 노출", () => {
  assert.equal(typeof SCHEMA_VERSION, "number")
  assert.ok(SCHEMA_VERSION >= 3)
  assert.equal(SCHEMA_VERSION, 3)
})

test("migrateIndex: schemaVersion 누락(v1) → 현재 버전으로 마이그레이션", () => {
  const v1 = { scanCursor: {}, byDate: {} }
  const migrated = migrateIndex(v1)
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION)
  assert.deepEqual(migrated.scanCursor, {})
  assert.deepEqual(migrated.byDate, {})
})

test("migrateIndex v2 → v3: 기존 byDate 엔트리에 빈 byHour 채움", () => {
  const v2 = {
    schemaVersion: 2,
    scanCursor: {},
    byDate: {
      "2026-04-16": {
        tokens: { input: 10, output: 20 },
        costUSD: 0.1,
      },
      "2026-04-15": {
        tokens: { input: 5, output: 5 },
        costUSD: 0.05,
        byHour: { 10: { tokens: { input: 1 }, costUSD: 0.01, prompts: 1 } },
      },
    },
  }
  const migrated = migrateIndex(v2)
  assert.equal(migrated.schemaVersion, 3)
  // 누락된 byHour는 빈 객체로 채워짐
  assert.deepEqual(migrated.byDate["2026-04-16"].byHour, {})
  // 이미 존재하던 byHour는 보존
  assert.equal(migrated.byDate["2026-04-15"].byHour["10"].prompts, 1)
  // 기존 데이터 보존
  assert.equal(migrated.byDate["2026-04-16"].tokens.input, 10)
})

test("migrateIndex: 이미 현재 버전이면 변경 없음", () => {
  const current = { schemaVersion: SCHEMA_VERSION, scanCursor: {}, byDate: {} }
  const result = migrateIndex(current)
  assert.equal(result.schemaVersion, SCHEMA_VERSION)
})

test("migrateIndex: 기존 데이터 보존", () => {
  const v1 = {
    scanCursor: { "file.jsonl": "uuid-123" },
    byDate: {
      "2026-04-16": {
        tokens: { input: 100, output: 200 },
        costUSD: 0.5,
      },
    },
  }
  const migrated = migrateIndex(v1)
  assert.equal(migrated.scanCursor["file.jsonl"], "uuid-123")
  assert.equal(migrated.byDate["2026-04-16"].tokens.input, 100)
  assert.equal(migrated.byDate["2026-04-16"].costUSD, 0.5)
})

test("migrateIndex: 더 높은 버전 cache는 경고 후 그대로 (downgrade 없음)", () => {
  const future = { schemaVersion: SCHEMA_VERSION + 10, scanCursor: {}, byDate: {} }
  const originalWarn = console.warn
  let warned = false
  console.warn = () => {
    warned = true
  }
  try {
    const result = migrateIndex(future)
    assert.equal(result.schemaVersion, SCHEMA_VERSION + 10)
    assert.ok(warned, "더 높은 버전 감지 시 warn 호출")
  } finally {
    console.warn = originalWarn
  }
})
