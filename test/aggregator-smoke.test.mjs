import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
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

test("aggregateAll: 한 응답이 여러 줄로 기록돼도 usage는 1번만 집계 (증분 경계 포함)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wilson-dedup-"))
  const projDir = path.join(root, "dedup-base-proj")
  fs.mkdirSync(projDir)
  const file = path.join(projDir, "sess-d.jsonl")
  const cachePath = makeTempCachePath()
  // CC는 응답 1개를 content block마다 한 줄씩 쓰고 줄마다 같은 usage를 복사한다
  const line = (uuid, id) =>
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-04-16T10:00:00Z",
      sessionId: "sess-d",
      uuid,
      message: {
        id,
        model: "claude-opus-4-6",
        role: "assistant",
        usage: { input_tokens: 100, output_tokens: 10 },
      },
    })
  const run = () => aggregateAll({ projectsDir: root, baseDirName: "dedup-base", cachePath })
  try {
    // 1차 스캔: msg_A의 첫 2줄까지만 기록된 시점
    fs.writeFileSync(file, `${line("u1", "msg_A")}\n${line("u2", "msg_A")}\n`)
    let day = (await run()).byDate["2026-04-16"]
    assert.equal(day.tokens.input, 100, "같은 응답 2줄 → 1번")

    // 2차 스캔: msg_A의 3번째 줄(커서 이후) + 새 응답 msg_B
    fs.appendFileSync(file, `${line("u3", "msg_A")}\n${line("u4", "msg_B")}\n`)
    day = (await run()).byDate["2026-04-16"]
    assert.equal(day.tokens.input, 200, "msg_A 1번 + msg_B 1번")
    assert.equal(day.tokens.output, 20)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
  }
})
