import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"
import { aggregateAll } from "../lib/aggregator.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PROJECTS_DIR = path.join(__dirname, "fixtures", "sample-projects")
const BASE_DIR_NAME = "fixture-base"

function makeTempCachePath() {
  return path.join(
    os.tmpdir(),
    `wilson-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  )
}

test("aggregateAll: fixture 프로젝트 스캔 → byDate에 이벤트 반영", async () => {
  const cachePath = makeTempCachePath()
  try {
    const index = await aggregateAll({
      projectsDir: FIXTURE_PROJECTS_DIR,
      baseDirName: BASE_DIR_NAME,
      cachePath,
    })

    assert.ok(index, "index는 null이 아님")
    assert.ok(index.byDate, "byDate 존재")
    assert.ok(index.byDate["2026-04-16"], "2026-04-16 버킷 생성됨")

    const day = index.byDate["2026-04-16"]
    assert.equal(day.tokens.input, 1500, "input 토큰 1000+500=1500")
    assert.equal(day.tokens.output, 800, "output 토큰 500+300=800")
    assert.equal(day.tokens.cacheRead, 100, "cacheRead 100")
    assert.ok(day.costUSD > 0, "costUSD는 양수")
  } finally {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
  }
})

test("aggregateAll: bySession에 세션 식별자 포함", async () => {
  const cachePath = makeTempCachePath()
  try {
    const index = await aggregateAll({
      projectsDir: FIXTURE_PROJECTS_DIR,
      baseDirName: BASE_DIR_NAME,
      cachePath,
    })

    const day = index.byDate["2026-04-16"]
    assert.ok(day.bySession, "bySession 존재")
    assert.ok(Object.keys(day.bySession).length > 0, "최소 1개 세션 포함")
  } finally {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
  }
})

test("aggregateAll: byModel에 모델별 집계", async () => {
  const cachePath = makeTempCachePath()
  try {
    const index = await aggregateAll({
      projectsDir: FIXTURE_PROJECTS_DIR,
      baseDirName: BASE_DIR_NAME,
      cachePath,
    })

    const day = index.byDate["2026-04-16"]
    assert.ok(day.byModel, "byModel 존재")
    // 정규화된 키(claude-opus-4-6)로 집계되어야 함
    assert.ok(day.byModel["claude-opus-4-6"], "claude-opus-4-6 정규화 키 존재")
    assert.equal(day.byModel["claude-opus-4-6"].tokens.input, 1500)
  } finally {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
  }
})

test("aggregateAll: byHour에 UTC 시간대별 집계 (fixture는 10시 bucket에 2건)", async () => {
  const cachePath = makeTempCachePath()
  try {
    const index = await aggregateAll({
      projectsDir: FIXTURE_PROJECTS_DIR,
      baseDirName: BASE_DIR_NAME,
      cachePath,
    })

    const day = index.byDate["2026-04-16"]
    assert.ok(day.byHour, "byHour 존재")
    // fixture: 10:00Z, 10:05Z → hour=10 bucket에 2건 누적
    assert.ok(day.byHour["10"], "hour=10 bucket 존재")
    assert.equal(day.byHour["10"].tokens.input, 1500, "10시 input 1000+500")
    assert.equal(day.byHour["10"].tokens.output, 800, "10시 output 500+300")
    assert.equal(day.byHour["10"].prompts, 2, "10시 prompts 2건")
    assert.ok(day.byHour["10"].costUSD > 0, "10시 costUSD 양수")
    // schemaVersion 확인
    assert.equal(index.schemaVersion, 3)
  } finally {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
  }
})

test("aggregateAll: 존재하지 않는 projectsDir은 빈 index 반환", async () => {
  const cachePath = makeTempCachePath()
  try {
    const index = await aggregateAll({
      projectsDir: "/nonexistent/path/does/not/exist",
      baseDirName: "whatever",
      cachePath,
    })
    assert.ok(index)
    assert.deepEqual(index.byDate, {})
  } finally {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
  }
})
