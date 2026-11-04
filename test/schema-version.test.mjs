import assert from "node:assert/strict"
import test from "node:test"
import { isoDateOnly, migrateIndex, SCHEMA_VERSION } from "../lib/aggregator.mjs"

test("SCHEMA_VERSION: 현재 버전 상수 노출", () => {
  assert.equal(typeof SCHEMA_VERSION, "number")
  assert.ok(SCHEMA_VERSION >= 3)
  assert.equal(SCHEMA_VERSION, 4)
})

test("isoDateOnly: 하루 경계는 KST 자정 (UTC 15:00)", () => {
  assert.equal(isoDateOnly("2026-10-12T14:59:59Z"), "2026-10-12")
  assert.equal(isoDateOnly("2026-10-12T15:00:00Z"), "2026-10-13")
  assert.equal(isoDateOnly("2026-12-31T15:30:00Z"), "2027-01-01")
})

test("migrateIndex v3 → v4: UTC 날짜·시간 버킷을 KST로 옮김", () => {
  const v3 = {
    schemaVersion: 3,
    scanCursor: { "a.jsonl": "u1" },
    byDate: {
      "2026-10-12": {
        tokens: { input: 40, output: 4 },
        costUSD: 4,
        prompts: 4,
        userPrompts: 2,
        activeMs: 1000,
        byProject: { IT: { tokens: { input: 40, output: 4 }, costUSD: 4, prompts: 4 } },
        bySession: { s1: { project: "IT", costUSD: 4, prompts: 4 } },
        byHour: {
          3: { tokens: { input: 10, output: 1 }, costUSD: 1, prompts: 1 }, // KST 12시, 같은 날
          20: { tokens: { input: 30, output: 3 }, costUSD: 3, prompts: 3 }, // KST 5시, 다음 날
        },
      },
      "2026-10-13": {
        tokens: { input: 5, output: 0 },
        costUSD: 0.5,
        prompts: 1,
        byProject: { IT: { tokens: { input: 5, output: 0 }, costUSD: 0.5, prompts: 1 } },
        byHour: { 1: { tokens: { input: 5, output: 0 }, costUSD: 0.5, prompts: 1 } }, // KST 10시
      },
    },
  }
  const m = migrateIndex(v3)
  assert.equal(m.schemaVersion, 4)
  assert.equal(m.scanCursor["a.jsonl"], "u1")
  const d12 = m.byDate["2026-10-12"]
  const d13 = m.byDate["2026-10-13"]
  // byHour 는 정확히 이동: UTC 3시 → KST 12시, UTC 20시 → 다음날 KST 5시
  assert.deepEqual(Object.keys(d12.byHour), ["12"])
  assert.deepEqual(Object.keys(d13.byHour).sort(), ["10", "5"])
  // 하루 합계 tokens·cost 는 시간 버킷 기준으로 정확히 나뉨
  assert.deepEqual(d12.tokens, { input: 10, output: 1 })
  assert.equal(d12.costUSD, 1)
  assert.deepEqual(d13.tokens, { input: 35, output: 3 })
  assert.equal(d13.costUSD, 3.5)
  // 나머지(byProject·bySession·activeMs·userPrompts)는 비용 비율(1/4 : 3/4)로 추정 분할
  assert.equal(d12.byProject.IT.costUSD, 1)
  assert.equal(d13.byProject.IT.costUSD, 3.5)
  assert.equal(d12.activeMs, 250)
  assert.equal(d13.activeMs, 750)
  assert.equal(d13.bySession.s1.project, "IT")
  assert.equal(d12.prompts + d13.prompts, 5)
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
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION)
  // 누락된 byHour는 빈 객체로 채워짐
  assert.deepEqual(migrated.byDate["2026-04-16"].byHour, {})
  // 이미 존재하던 byHour는 보존 (v4 에서 UTC 10시 → KST 19시)
  assert.equal(migrated.byDate["2026-04-15"].byHour["19"].prompts, 1)
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
