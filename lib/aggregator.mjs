/**
 * aggregator.mjs — transcript → usage-index.json 집계 엔진
 *
 * 스펙: docs/specs/2026-04-13-monitor-usage-design.md (섹션 5, 5a, 9)
 *
 * 흐름:
 *   1) cachePath에서 기존 usage-index.json 로드 (없으면 빈 구조)
 *   2) projectsDir 아래 base prefix와 일치하는 폴더의 .jsonl + subagents/*.jsonl 발견
 *   3) 파일 단위로 lastProcessedUuid 이후 라인만 증분 파싱
 *   4) parseUsageEvent 결과를 byDate / byProject / bySession / bySubagent에 누적
 *   5) 각 (날짜, 세션) events로 computeActiveMs 호출 → activeMs 갱신
 *   6) scanCursor 업데이트 후 cachePath에 저장 → 결과 반환
 */

import fsSync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import readline from "node:readline"
import { computeActiveMs } from "./time-metric.mjs"
import { parseUsageEvent } from "./usage-parser.mjs"

// ─── 유틸 ──────────────────────────────────────────────

function cwdToProjectDir(cwd) {
  const dashed = cwd.replace(/\\/g, "-").replace(":", "-")
  return dashed.charAt(0).toLowerCase() + dashed.slice(1)
}

function extractProjectName(dirName, baseName) {
  if (!baseName) {
    const parts = dirName.split("-").filter(Boolean)
    return parts[parts.length - 1] || dirName.slice(0, 10)
  }
  const lower = dirName.toLowerCase()
  const baseL = baseName.toLowerCase()
  if (lower === baseL) return dirName.split("-").filter(Boolean).pop() || "root"
  if (lower.startsWith(baseL + "-")) {
    const after = dirName.slice(baseName.length + 1)
    return after || "root"
  }
  return dirName.split("-").filter(Boolean).pop() || dirName.slice(0, 10)
}

function isoDateOnly(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  // UTC 기준 YYYY-MM-DD — 서버 시계 영향 배제
  return d.toISOString().slice(0, 10)
}

function emptyTokens() {
  return { input: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0 }
}

function addTokens(dst, src) {
  dst.input += src.input || 0
  dst.cacheWrite1h += src.cacheWrite1h || 0
  dst.cacheWrite5m += src.cacheWrite5m || 0
  dst.cacheRead += src.cacheRead || 0
  dst.output += src.output || 0
}

// ─── 스키마 버전 ────────────────────────────────────────
// v1 → v2: schemaVersion 필드 도입 (데이터 변경 없음).
// v2 → v3: byDate[date].byHour 버킷 도입 — UTC 시간(0..23)별 tokens/costUSD/prompts.
// 향후 aggregator 구조 변경 시 MIGRATIONS에 함수 추가.
const SCHEMA_VERSION = 3

const MIGRATIONS = {
  2: (index) => {
    index.schemaVersion = 2
    return index
  },
  3: (index) => {
    // 기존 byDate 엔트리에 빈 byHour 추가. 실제 누적은 backfillByHour가 수행.
    for (const dk of Object.keys(index.byDate || {})) {
      const d = index.byDate[dk]
      if (d && !d.byHour) d.byHour = {}
    }
    index.schemaVersion = 3
    return index
  },
}

/**
 * 디스크 캐시(index) 스키마를 현재 SCHEMA_VERSION까지 순차 승격.
 * 현재 버전이 코드 버전보다 높으면 경고만 내고 그대로 통과 (downgrade 금지).
 *
 * @param {object} index — loadCache가 반환한 raw index 객체
 * @returns {object} 현재 SCHEMA_VERSION으로 승격된 index
 */
function migrateIndex(index) {
  const currentVersion = index.schemaVersion || 1
  if (currentVersion > SCHEMA_VERSION) {
    console.warn(
      `[aggregator] cache schema v${currentVersion} is newer than code v${SCHEMA_VERSION} — running as-is`,
    )
    return index
  }
  let migrated = index
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    if (MIGRATIONS[v]) migrated = MIGRATIONS[v](migrated)
  }
  return migrated
}

function emptyIndex() {
  return { schemaVersion: SCHEMA_VERSION, scanCursor: {}, byDate: {} }
}

/**
 * 사용자 프롬프트 텍스트를 세션 레이블용 짧은 요약으로 변환.
 * 규칙:
 *   - 개행/탭/연속 공백 → 단일 공백
 *   - trim 후 최대 40자 (초과 시 앞 40자 + '...')
 *   - 빈 문자열은 null 반환
 */
export function summarizePrompt(text) {
  if (!text || typeof text !== "string") return null
  const normalized = text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!normalized) return null
  const MAX = 40
  if (normalized.length <= MAX) return normalized
  return normalized.slice(0, MAX) + "..."
}

/**
 * transcript 라인 1건에서 사용자 프롬프트 텍스트를 추출.
 * 시스템성 메시지(<system-reminder>, <command-name>, <local-command-stdout> 등
 * '<'로 시작하는 블록)는 제외한다.
 * 반환: 요약 문자열 또는 null
 */
function extractUserPromptSummary(obj) {
  if (!obj || obj.type !== "user") return null
  const msg = obj.message
  if (!msg || msg.role !== "user") return null
  const content = msg.content
  let text = ""
  if (typeof content === "string") {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join(" ")
  }
  if (!text) return null
  const trimmed = text.trim()
  // '<'로 시작하는 시스템 메시지 제외 (e.g. <system-reminder>, <command-name>)
  if (!trimmed || trimmed.startsWith("<")) return null
  return summarizePrompt(trimmed)
}

// ─── 캐시 I/O ──────────────────────────────────────────

async function loadCache(cachePath) {
  try {
    const raw = await fs.readFile(cachePath, "utf8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && parsed.byDate && parsed.scanCursor) {
      return migrateIndex(parsed)
    }
    return emptyIndex()
  } catch {
    // 파일 없음 또는 파싱 실패 → 풀스캔 재구축
    return emptyIndex()
  }
}

async function saveCache(cachePath, index) {
  const dir = path.dirname(cachePath)
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {
    /* ok */
  }
  // atomic write: tmp → rename
  const tmp = cachePath + ".tmp"
  await fs.writeFile(tmp, JSON.stringify(index), "utf8")
  await fs.rename(tmp, cachePath)
}

// ─── 파일 발견 ─────────────────────────────────────────

/**
 * projectsDir 아래에서 baseDirName prefix로 시작하는 모든 폴더의
 * 메인 transcript(.jsonl) + subagents/*.jsonl 목록 반환.
 */
function discoverTranscripts(projectsDir, baseDirName) {
  const results = []
  if (!fsSync.existsSync(projectsDir)) return results

  let dirs
  try {
    dirs = fsSync.readdirSync(projectsDir)
  } catch {
    return results
  }

  const baseL = baseDirName.toLowerCase()
  for (const dir of dirs) {
    if (!dir.toLowerCase().startsWith(baseL)) continue
    const projectDir = path.join(projectsDir, dir)
    let stat
    try {
      stat = fsSync.statSync(projectDir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue

    const projectName = extractProjectName(dir, baseDirName)

    // 메인 .jsonl 파일들
    let files
    try {
      files = fsSync.readdirSync(projectDir)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue
      results.push({
        project: projectName,
        filePath: path.join(projectDir, f),
        isSubagent: false,
      })
    }

    // 서브에이전트: <project>/<session-id>/subagents/*.jsonl
    let subDirs
    try {
      subDirs = fsSync
        .readdirSync(projectDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
    } catch {
      subDirs = []
    }

    for (const sd of subDirs) {
      const subagentsDir = path.join(projectDir, sd.name, "subagents")
      if (!fsSync.existsSync(subagentsDir)) continue
      let subFiles
      try {
        subFiles = fsSync.readdirSync(subagentsDir)
      } catch {
        continue
      }
      for (const sf of subFiles) {
        if (!sf.endsWith(".jsonl")) continue
        const fullPath = path.join(subagentsDir, sf)
        const agentId = sf.replace(/\.jsonl$/, "")

        // meta.json에서 agentType 획득
        const metaPath = fullPath.replace(/\.jsonl$/, ".meta.json")
        let agentType = "Agent"
        if (fsSync.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fsSync.readFileSync(metaPath, "utf8"))
            agentType = meta.agentType || agentType
          } catch {
            /* skip */
          }
        }

        results.push({
          project: projectName,
          filePath: fullPath,
          isSubagent: true,
          agentId,
          agentType,
          parentSessionId: sd.name,
        })
      }
    }
  }
  return results
}

// ─── 라인 파싱 (증분 + 스트리밍) ───────────────────────

/**
 * 한 파일을 스트리밍으로 읽으면서 lastUuid 이후 라인을 파싱한다.
 * 반환:
 *   { events: [...parsedUsageEvents], newLastUuid: string|null,
 *     firstPromptSummary: string|null, firstPromptTs: string|null,
 *     firstPromptSessionId: string|null }
 *
 * firstPromptSummary는 커서 통과 여부와 무관하게 파일 전체에서
 * 가장 이른 타임스탬프의 사용자 프롬프트 요약을 한 번만 수집한다.
 * (증분 재스캔 시 기존 세션 레코드에 firstPromptSummary가 이미 있으면
 *  호출자가 덮어쓰지 않도록 가드해야 함)
 */
async function scanFileIncremental(fileInfo, lastUuid) {
  const { filePath } = fileInfo
  const stream = fsSync.createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  const events = []
  let newLastUuid = lastUuid || null
  let passedCursor = !lastUuid // 커서 없으면 처음부터 전부 수집

  // 파일 전체에서 가장 이른 타임스탬프의 사용자 프롬프트 추적
  let firstPromptSummary = null
  let firstPromptTs = null
  let firstPromptSessionId = null

  // 사용자 프롬프트 카운트 — 커서 이후(=새 라인)만 누적.
  // key: 'YYYY-MM-DD::sid'. 서브에이전트 파일은 건너뛴다.
  const userPromptsByDateSid = new Map()

  for await (const line of rl) {
    if (!line || line.trim() === "") continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }

    // 서브에이전트 파일이면 agentId 주입 (parser가 바로 사용)
    if (fileInfo.isSubagent) {
      obj.__agentId = fileInfo.agentId
    }

    // 사용자 프롬프트 추적 — 커서와 독립적으로 "파일 전체"에서 가장 이른 값을 잡는다.
    // (서브에이전트 파일은 세션 레이블과 무관하므로 스킵)
    if (!fileInfo.isSubagent) {
      const summary = extractUserPromptSummary(obj)
      if (summary) {
        const ts = obj.timestamp || null
        const isEarlier = !firstPromptTs || (ts && ts < firstPromptTs)
        if (!firstPromptSummary || isEarlier) {
          firstPromptSummary = summary
          firstPromptTs = ts
          firstPromptSessionId = obj.sessionId || null
        }
      }
    }

    const uuid = obj.uuid || null

    if (!passedCursor) {
      // lastUuid를 만나는 순간부터 다음 라인을 수집
      if (uuid && uuid === lastUuid) {
        passedCursor = true
      }
      continue
    }

    // 사용자 프롬프트 카운트 — 커서 이후의 user 이벤트만 집계 (중복 방지)
    // 서브에이전트 파일은 세션 집계 대상에서 제외하는 정책을 따른다.
    if (!fileInfo.isSubagent && obj.type === "user" && obj.message && obj.message.role === "user") {
      const content = obj.message.content
      let text = ""
      if (typeof content === "string") text = content
      else if (Array.isArray(content)) {
        text = content
          .filter((b) => b && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join(" ")
      }
      const trimmed = (text || "").trim()
      // 시스템 메시지/명령 출력(<system-reminder>, <command-name>, <local-command-stdout> 등) 제외
      if (trimmed && !trimmed.startsWith("<")) {
        const date = isoDateOnly(obj.timestamp)
        const sid = obj.sessionId || path.basename(filePath, ".jsonl")
        if (date && sid) {
          const key = date + "::" + sid
          userPromptsByDateSid.set(key, (userPromptsByDateSid.get(key) || 0) + 1)
        }
      }
    }

    const parsed = parseUsageEvent(obj)
    if (parsed) {
      // 메타 데이터 주입
      parsed.__project = fileInfo.project
      parsed.__isSubagent = fileInfo.isSubagent === true
      // slug: transcript 라인의 최상위 필드 (Claude Code 자동 부여 — 예: "iridescent-splashing-dream")
      // 세션 레이블에 사용. 같은 세션 내 모든 라인에 동일한 값이지만 일부 라인엔 없을 수 있음.
      if (typeof obj.slug === "string" && obj.slug) {
        parsed.__slug = obj.slug
      }
      if (fileInfo.isSubagent) {
        parsed.__agentType = fileInfo.agentType
        parsed.__parentSessionId = fileInfo.parentSessionId
        parsed.__agentId = fileInfo.agentId
      }
      events.push(parsed)
    }
    if (uuid) newLastUuid = uuid
  }

  return {
    events,
    newLastUuid,
    firstPromptSummary,
    firstPromptTs,
    firstPromptSessionId,
    userPromptsByDateSid,
  }
}

// ─── 집계 병합 ─────────────────────────────────────────

/**
 * 이벤트 1건을 인덱스에 병합. byDate/byProject/bySession/bySubagent 모두 갱신.
 * activeMs는 일단 건너뛰고 호출자가 나중에 session events 기준으로 재계산한다.
 */
function mergeEvent(index, ev, sessionEventsMap) {
  const date = isoDateOnly(ev.timestamp)
  if (!date) return

  // day bucket 초기화
  if (!index.byDate[date]) {
    index.byDate[date] = {
      tokens: emptyTokens(),
      costUSD: 0,
      activeMs: 0,
      prompts: 0,
      userPrompts: 0, // 실제 사용자가 보낸 프롬프트 수 (assistant 응답 수와 구분)
      byProject: {},
      bySession: {},
      bySubagent: {},
      byModel: {}, // key: normalizedModel (예: "claude-opus-4-6") — 모델 도넛 차트용
      byHour: {}, // key: UTC hour 0..23 — 시간대별 활동 분포용
    }
  }
  const day = index.byDate[date]
  // 기존 캐시 호환: byModel / userPrompts / byHour 필드 누락 시 초기화
  if (!day.byModel) day.byModel = {}
  if (typeof day.userPrompts !== "number") day.userPrompts = 0
  if (!day.byHour) day.byHour = {}

  // 전체 누적 (day level)
  addTokens(day.tokens, ev.tokens)
  day.costUSD += ev.costUSD

  // byHour 누적 — UTC 시간 기준 (byDate와 동일 기준). 범위 이탈 시 스킵.
  const hourDate = new Date(ev.timestamp)
  if (!Number.isNaN(hourDate.getTime())) {
    const hour = hourDate.getUTCHours()
    if (hour >= 0 && hour <= 23) {
      const hourKey = String(hour)
      if (!day.byHour[hourKey]) {
        day.byHour[hourKey] = {
          tokens: emptyTokens(),
          costUSD: 0,
          prompts: 0,
        }
      }
      const hr = day.byHour[hourKey]
      addTokens(hr.tokens, ev.tokens)
      hr.costUSD += ev.costUSD
      // byModel 규칙 재사용: subagent 이벤트는 prompts 제외
      if (!ev.__isSubagent) hr.prompts += 1
    }
  }

  // byModel 누적 (모델 도넛 차트용) — normalizedModel 기준
  const modelKey = ev.normalizedModel || ev.model || "unknown"
  if (!day.byModel[modelKey]) {
    day.byModel[modelKey] = {
      tokens: emptyTokens(),
      costUSD: 0,
      prompts: 0,
    }
  }
  const mdl = day.byModel[modelKey]
  addTokens(mdl.tokens, ev.tokens)
  mdl.costUSD += ev.costUSD
  // 메인 세션 흐름과 동일 정책: subagent(sidechain) 이벤트는 prompts 카운트에서 제외
  if (!ev.__isSubagent) mdl.prompts += 1

  // byProject
  const project = ev.__project || "unknown"
  if (!day.byProject[project]) {
    day.byProject[project] = { tokens: emptyTokens(), costUSD: 0, prompts: 0 }
  }
  const proj = day.byProject[project]
  addTokens(proj.tokens, ev.tokens)
  proj.costUSD += ev.costUSD

  // 서브에이전트 vs 메인 세션 분기
  if (ev.__isSubagent) {
    // bySubagent — 메인 세션은 부모 id
    const agentId = ev.__agentId || "unknown-agent"
    if (!day.bySubagent[agentId]) {
      day.bySubagent[agentId] = {
        parentSessionId: ev.__parentSessionId || null,
        agentType: ev.__agentType || "Agent",
        tokens: emptyTokens(),
        costUSD: 0,
        prompts: 0,
      }
    }
    const sa = day.bySubagent[agentId]
    addTokens(sa.tokens, ev.tokens)
    sa.costUSD += ev.costUSD
    // 서브에이전트 프롬프트 카운트는 sidechain=true인 user 이벤트로 따져야 정확하지만,
    // usage event 기반으로는 assistant 응답 수만 보임. 대략 지표로 응답 수를 쓴다.
    sa.prompts += 1
  } else {
    // bySession — 메인 transcript
    const sid = ev.sessionId || "unknown"
    if (!day.bySession[sid]) {
      day.bySession[sid] = {
        project,
        startTime: ev.timestamp,
        endTime: ev.timestamp,
        activeMs: 0,
        prompts: 0,
        userPrompts: 0, // 실제 사용자가 보낸 프롬프트 수
        tokens: emptyTokens(),
        costUSD: 0,
        slug: null, // Claude Code slug (예: "iridescent-splashing-dream") — 툴팁/fallback 용도
        firstPromptSummary: null, // 세션 첫 사용자 프롬프트 요약 — 레이블 "[MM/DD | ...]"용
      }
    }
    const s = day.bySession[sid]
    // 기존 캐시 호환: userPrompts 필드 누락 시 초기화
    if (typeof s.userPrompts !== "number") s.userPrompts = 0
    addTokens(s.tokens, ev.tokens)
    s.costUSD += ev.costUSD
    s.prompts += 1
    // startTime/endTime 갱신
    if (ev.timestamp < s.startTime) s.startTime = ev.timestamp
    if (ev.timestamp > s.endTime) s.endTime = ev.timestamp
    // slug: 첫 번째 non-null 값만 저장 (같은 세션의 모든 라인에 동일값이지만 일부 라인은 미포함)
    if (!s.slug && ev.__slug) s.slug = ev.__slug

    // 프로젝트 prompts는 메인 세션의 assistant 응답 수로 근사
    proj.prompts += 1
    day.prompts += 1

    // activeMs 재계산을 위한 이벤트 기록
    const key = date + "::" + sid
    if (!sessionEventsMap.has(key)) sessionEventsMap.set(key, [])
    sessionEventsMap.get(key).push({ timestamp: ev.timestamp })
  }
}

/**
 * 누적된 session 이벤트 timestamp 배열을 정렬하여 activeMs 재계산 후
 * bySession[].activeMs, byDate[].activeMs에 반영.
 * 같은 세션이 여러 날짜에 걸치면 각 날짜별 events로 개별 계산된다.
 */
function recomputeActiveMs(index, sessionEventsMap) {
  // 버그 수정 (2026-04-14): 전역 초기화하면 증분 갱신 시 영향 받지 않는
  // 과거 날짜/세션의 activeMs가 0으로 증발함.
  // → 영향 받은 (date, sid)만 기존 값 차감 후 재계산값을 다시 더한다.

  // 1) 영향 받은 (date, sid)의 기존 activeMs를 day/session에서 차감한 뒤 0으로 리셋
  for (const key of sessionEventsMap.keys()) {
    const idx = key.indexOf("::")
    if (idx < 0) continue
    const date = key.slice(0, idx)
    const sid = key.slice(idx + 2)
    const day = index.byDate[date]
    if (!day) continue
    const s = day.bySession && day.bySession[sid]
    if (!s) continue
    const prev = s.activeMs || 0
    day.activeMs = Math.max(0, (day.activeMs || 0) - prev)
    s.activeMs = 0
  }

  // 2) 영향 받은 (date, sid)에 한해 events 정렬 → computeActiveMs → day/session 가산
  for (const [key, events] of sessionEventsMap.entries()) {
    const idx = key.indexOf("::")
    if (idx < 0) continue
    const date = key.slice(0, idx)
    const sid = key.slice(idx + 2)
    events.sort((a, b) => {
      const ta = Date.parse(a.timestamp)
      const tb = Date.parse(b.timestamp)
      return ta - tb
    })
    const ms = computeActiveMs(events)
    const day = index.byDate[date]
    if (!day) continue
    const s = day.bySession && day.bySession[sid]
    if (!s) continue
    s.activeMs = ms
    day.activeMs = (day.activeMs || 0) + ms
  }
}

// ─── 증분 갱신에서 기존 세션 events 복원 ──────────────

/**
 * 증분 갱신 시, 기존 bySession 활성 시간을 단순히 보존하면 자정 같은 경계에서
 * 오차가 난다. V1에서는 단순화를 위해 증분 이벤트가 발생한 (날짜, 세션)만 풀스캔하여
 * timestamp 목록을 복원해 computeActiveMs를 다시 돌린다.
 *
 * 그러나 이번 이터레이션에서는 더 간단한 전략을 쓴다:
 *   - 집계 대상 파일 전체를 다시 읽지 않기 위해, 새 이벤트들이 속한
 *     (날짜, 세션)에 대해서만 "그 세션 전체 파일"을 재스캔하여 timestamp만 수집한다.
 *   - 서브에이전트는 active 미산정.
 */
async function collectSessionTimestamps(targetFiles, affectedDateSessionKeys) {
  // affectedDateSessionKeys: Set<date::sid>
  // 결과: Map<date::sid, [{timestamp}]>
  const result = new Map()
  if (affectedDateSessionKeys.size === 0) return result

  // session → 메인 파일 매핑 — 파일명이 <sessionId>.jsonl 규칙이라고 가정
  const sessionToFiles = new Map()
  for (const f of targetFiles) {
    if (f.isSubagent) continue
    const base = path.basename(f.filePath, ".jsonl")
    if (!sessionToFiles.has(base)) sessionToFiles.set(base, [])
    sessionToFiles.get(base).push(f)
  }

  const affectedSessions = new Set()
  for (const key of affectedDateSessionKeys) {
    const idx = key.indexOf("::")
    affectedSessions.add(key.slice(idx + 2))
  }

  for (const sid of affectedSessions) {
    const files = sessionToFiles.get(sid) || []
    for (const f of files) {
      const stream = fsSync.createReadStream(f.filePath, { encoding: "utf8" })
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
      for await (const line of rl) {
        if (!line || line.trim() === "") continue
        let obj
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }
        // assistant usage 이벤트만 시간 축으로 사용 (스펙 섹션 7)
        if (!obj.message || !obj.message.usage) continue
        if (obj.message.model === "<synthetic>") continue
        const ts = obj.timestamp
        if (!ts) continue
        const date = isoDateOnly(ts)
        if (!date) continue
        const key = date + "::" + sid
        if (!affectedDateSessionKeys.has(key)) continue
        if (!result.has(key)) result.set(key, [])
        result.get(key).push({ timestamp: ts })
      }
    }
  }
  return result
}

// ─── slug 백필 ────────────────────────────────────────

// ─── Backfill 공유 파일 캐시 ──────────────────────────
// 같은 aggregate 호출 내에서 5개 backfill이 동일 파일을 여러 번 읽는 비용을 제거.
// aggregateAll() 끝에 cache.clear()로 메모리 반납.
async function readLinesCached(cache, filePath) {
  if (cache && cache.has(filePath)) return cache.get(filePath)
  const lines = []
  try {
    const stream = fsSync.createReadStream(filePath, { encoding: "utf8" })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      if (line && line.trim()) lines.push(line)
    }
  } catch {
    /* skip */
  }
  if (cache) cache.set(filePath, lines)
  return lines
}

/**
 * bySession에 slug 필드가 비어있는 세션들에 대해, 해당 세션 파일을 한 번 훑어 slug를 채운다.
 * 기존 usage-index.json에 slug가 없던 (구버전 집계로 만들어진) 케이스를 복구하기 위함.
 *
 * 최적화:
 *   - 파일 경로(basename=sessionId) 매핑으로 필요한 파일만 열어 최소 라인까지 읽고 조기 종료
 *   - 해당 파일 안의 여러 날짜 bucket에 동일 slug 전파 (같은 세션은 동일 slug)
 *
 * @returns {Promise<boolean>} 무언가 변경되었는지 여부
 */
async function backfillSlugs(index, files, linesCache) {
  // sessionId → [dateKeys] (slug 없음인 날짜들)
  const missingBySession = new Map()
  for (const dateKey of Object.keys(index.byDate)) {
    const day = index.byDate[dateKey]
    const bySession = day.bySession || {}
    for (const sid of Object.keys(bySession)) {
      const rec = bySession[sid]
      if (!rec || rec.slug) continue
      if (!missingBySession.has(sid)) missingBySession.set(sid, [])
      missingBySession.get(sid).push(dateKey)
    }
  }
  if (missingBySession.size === 0) return false

  // sessionId → 메인 파일(들)
  const sessionToFiles = new Map()
  for (const f of files) {
    if (f.isSubagent) continue
    const base = path.basename(f.filePath, ".jsonl")
    if (!sessionToFiles.has(base)) sessionToFiles.set(base, [])
    sessionToFiles.get(base).push(f)
  }

  let changed = false
  for (const [sid, dateKeys] of missingBySession.entries()) {
    const targets = sessionToFiles.get(sid) || []
    if (targets.length === 0) continue

    let foundSlug = null
    for (const f of targets) {
      if (foundSlug) break
      const lines = await readLinesCached(linesCache, f.filePath)
      for (const line of lines) {
        // 텍스트 빠른 필터 — slug 문자열이 아예 없으면 JSON.parse 스킵
        if (line.indexOf('"slug"') === -1) continue
        let obj
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof obj.slug === "string" && obj.slug) {
          foundSlug = obj.slug
          break
        }
      }
    }

    if (foundSlug) {
      for (const dk of dateKeys) {
        const rec =
          index.byDate[dk] && index.byDate[dk].bySession && index.byDate[dk].bySession[sid]
        if (rec && !rec.slug) {
          rec.slug = foundSlug
          changed = true
        }
      }
    }
  }
  return changed
}

// ─── byModel 백필 ───────────────────────────────────

/**
 * 기존 cache에 byModel 필드가 없거나 비어있는 날짜를 파일 재스캔으로 복원.
 *
 * 전략:
 *   1) byModel이 비어있는 날짜의 bySession 참여 세션 → 메인 파일 매핑
 *   2) 각 파일을 라인 단위로 스트리밍 읽으며, timestamp가 해당 날짜와 일치하는
 *      assistant usage 이벤트만 parseUsageEvent로 파싱하여 byModel에 누적
 *   3) bySubagent 참여 에이전트 파일도 동일 방식으로 처리 (서브에이전트도 모델 기여)
 *
 * 주의: backfillSlugs/backfillFirstPrompts와 달리, 모델은 라인마다 다를 수 있으므로
 *        조기 종료 불가 — 파일 전체를 읽되, 필요 최소 집합에 대해서만 수행.
 *
 * @returns {Promise<boolean>} 변경 여부
 */
async function backfillByModel(index, files, linesCache) {
  // 1) 복원 대상 날짜 수집 (byModel 누락 또는 비어있음)
  const targetDates = []
  for (const dateKey of Object.keys(index.byDate)) {
    const day = index.byDate[dateKey]
    if (!day.byModel) day.byModel = {}
    if (Object.keys(day.byModel).length === 0) {
      targetDates.push(dateKey)
    }
  }
  if (targetDates.length === 0) return false

  // 2) sessionId → 메인 파일, agentId → 서브에이전트 파일 매핑
  const sessionToFile = new Map() // sid → filePath
  const agentIdToFile = new Map() // agentId → filePath
  for (const f of files || []) {
    const base = path.basename(f.filePath, ".jsonl")
    if (f.isSubagent) {
      agentIdToFile.set(base, f.filePath)
    } else {
      sessionToFile.set(base, f.filePath)
    }
  }

  // 3) 날짜별로 필요한 파일 집합 구성
  const targetSet = new Set(targetDates)
  // 파일 → 대상 날짜들 (파일당 1회만 읽도록)
  const fileToDates = new Map()
  for (const dateKey of targetDates) {
    const day = index.byDate[dateKey]
    for (const sid of Object.keys(day.bySession || {})) {
      const fp = sessionToFile.get(sid)
      if (!fp) continue
      if (!fileToDates.has(fp)) fileToDates.set(fp, new Set())
      fileToDates.get(fp).add(dateKey)
    }
    for (const aid of Object.keys(day.bySubagent || {})) {
      const fp = agentIdToFile.get(aid)
      if (!fp) continue
      if (!fileToDates.has(fp)) fileToDates.set(fp, new Set())
      fileToDates.get(fp).add(dateKey)
    }
  }
  if (fileToDates.size === 0) return false

  let changed = false

  // 4) 파일별로 스트리밍 파싱 → 해당 날짜의 이벤트만 byModel에 반영
  for (const [filePath, dateSet] of fileToDates.entries()) {
    const isSubagent = agentIdToFile.has(path.basename(filePath, ".jsonl"))
    const agentId = isSubagent ? path.basename(filePath, ".jsonl") : null

    const lines = await readLinesCached(linesCache, filePath)
    for (const line of lines) {
      // 빠른 필터 — usage가 없는 라인은 skip
      if (line.indexOf('"usage"') === -1) continue
      let obj
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      const date = isoDateOnly(obj.timestamp)
      if (!date || !dateSet.has(date)) continue
      if (isSubagent) obj.__agentId = agentId
      const parsed = parseUsageEvent(obj)
      if (!parsed) continue

      const day = index.byDate[date]
      if (!day) continue
      if (!day.byModel) day.byModel = {}

      const modelKey = parsed.normalizedModel || parsed.model || "unknown"
      if (!day.byModel[modelKey]) {
        day.byModel[modelKey] = {
          tokens: emptyTokens(),
          costUSD: 0,
          prompts: 0,
        }
      }
      const mdl = day.byModel[modelKey]
      addTokens(mdl.tokens, parsed.tokens)
      mdl.costUSD += parsed.costUSD || 0
      // 메인 흐름과 동일 정책: subagent(sidechain) 제외
      if (!isSubagent && !parsed.isSidechain) mdl.prompts += 1
      changed = true
    }
  }

  return changed
}

// ─── byHour 백필 ───────────────────────────────────

/**
 * 기존 cache에 byHour 필드가 없거나 비어있는 날짜를 파일 재스캔으로 복원.
 *
 * 전략(backfillByModel 패턴 재사용):
 *   1) byHour 비어있는 날짜 수집
 *   2) bySession/bySubagent 참여 세션·에이전트 → 메인/서브에이전트 파일 매핑
 *   3) 파일을 라인 단위로 스트리밍하며 해당 날짜의 assistant usage 이벤트만
 *      UTC hour로 bucketize → byHour[hour]에 누적
 *
 * @returns {Promise<boolean>} 변경 여부
 */
async function backfillByHour(index, files, linesCache) {
  // 1) 복원 대상 날짜 수집 (byHour 누락 또는 비어있음)
  const targetDates = []
  for (const dateKey of Object.keys(index.byDate)) {
    const day = index.byDate[dateKey]
    if (!day.byHour) day.byHour = {}
    if (Object.keys(day.byHour).length === 0) {
      targetDates.push(dateKey)
    }
  }
  if (targetDates.length === 0) return false

  // 2) sessionId → 메인 파일, agentId → 서브에이전트 파일 매핑
  const sessionToFile = new Map()
  const agentIdToFile = new Map()
  for (const f of files || []) {
    const base = path.basename(f.filePath, ".jsonl")
    if (f.isSubagent) {
      agentIdToFile.set(base, f.filePath)
    } else {
      sessionToFile.set(base, f.filePath)
    }
  }

  // 3) 파일 → 대상 날짜 집합 (파일당 1회만 읽도록)
  const fileToDates = new Map()
  for (const dateKey of targetDates) {
    const day = index.byDate[dateKey]
    for (const sid of Object.keys(day.bySession || {})) {
      const fp = sessionToFile.get(sid)
      if (!fp) continue
      if (!fileToDates.has(fp)) fileToDates.set(fp, new Set())
      fileToDates.get(fp).add(dateKey)
    }
    for (const aid of Object.keys(day.bySubagent || {})) {
      const fp = agentIdToFile.get(aid)
      if (!fp) continue
      if (!fileToDates.has(fp)) fileToDates.set(fp, new Set())
      fileToDates.get(fp).add(dateKey)
    }
  }
  if (fileToDates.size === 0) return false

  let changed = false

  // 4) 파일별 스트리밍 파싱 → byHour 누적
  for (const [filePath, dateSet] of fileToDates.entries()) {
    const isSubagent = agentIdToFile.has(path.basename(filePath, ".jsonl"))
    const agentId = isSubagent ? path.basename(filePath, ".jsonl") : null

    const lines = await readLinesCached(linesCache, filePath)
    for (const line of lines) {
      if (line.indexOf('"usage"') === -1) continue
      let obj
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      const date = isoDateOnly(obj.timestamp)
      if (!date || !dateSet.has(date)) continue
      if (isSubagent) obj.__agentId = agentId
      const parsed = parseUsageEvent(obj)
      if (!parsed) continue

      const day = index.byDate[date]
      if (!day) continue
      if (!day.byHour) day.byHour = {}

      const hourDate = new Date(parsed.timestamp)
      if (Number.isNaN(hourDate.getTime())) continue
      const hour = hourDate.getUTCHours()
      if (hour < 0 || hour > 23) continue
      const hourKey = String(hour)

      if (!day.byHour[hourKey]) {
        day.byHour[hourKey] = {
          tokens: emptyTokens(),
          costUSD: 0,
          prompts: 0,
        }
      }
      const hr = day.byHour[hourKey]
      addTokens(hr.tokens, parsed.tokens)
      hr.costUSD += parsed.costUSD || 0
      // 메인 흐름과 동일 정책: subagent(sidechain) 제외
      if (!isSubagent && !parsed.isSidechain) hr.prompts += 1
      changed = true
    }
  }

  return changed
}

// ─── userPrompts 증분 반영 ─────────────────────────

/**
 * scanFileIncremental에서 집계한 (date::sid → count) 맵을
 * index.byDate[date].userPrompts, index.byDate[date].bySession[sid].userPrompts에 가산.
 *
 * 주의: 새 이벤트가 없는 날짜/세션도 day bucket은 이미 존재해야 의미가 있다.
 * user-only 라인뿐이라 mergeEvent로 day bucket이 생성되지 않은 경우엔
 * 다음 assistant 응답이 기록될 때 bucket이 생기고 backfill 과정에서 복원된다.
 * (따라서 여기선 bucket 없는 경우는 skip)
 */
function applyUserPromptsDelta(index, userPromptsByDateSid) {
  if (!userPromptsByDateSid || userPromptsByDateSid.size === 0) return
  for (const [key, cnt] of userPromptsByDateSid.entries()) {
    if (!cnt) continue
    const idx = key.indexOf("::")
    if (idx < 0) continue
    const date = key.slice(0, idx)
    const sid = key.slice(idx + 2)
    const day = index.byDate[date]
    if (!day) continue
    if (typeof day.userPrompts !== "number") day.userPrompts = 0
    day.userPrompts += cnt
    const s = day.bySession && day.bySession[sid]
    if (s) {
      if (typeof s.userPrompts !== "number") s.userPrompts = 0
      s.userPrompts += cnt
    }
  }
}

// ─── activeMs 백필 ─────────────────────────────────

/**
 * 과거 recomputeActiveMs 버그로 activeMs=0이 박힌 날짜/세션 복구.
 *
 * 복구 대상: day.activeMs === 0 이고 해당 day의 bySession에 s.activeMs === 0인
 *           세션이 존재하는 (date, sid) 쌍.
 * 방식: 해당 sid의 메인 파일을 재스캔하여 date에 속한 assistant usage 이벤트만
 *       timestamp를 모아 computeActiveMs 호출 → s.activeMs/day.activeMs에 가산.
 * 서브에이전트는 정책상 activeMs 미산정 → skip.
 *
 * 성능: 1회 실행이면 충분. 복구 후에는 activeMs > 0이라 다음 호출에선 skip.
 *
 * @returns {Promise<boolean>} 변경 여부
 */
async function backfillActiveMs(index, files, linesCache) {
  // 1) 복구 대상 수집: (date, sid)
  const missingBySession = new Map() // sid → Set<dateKey>
  for (const dateKey of Object.keys(index.byDate)) {
    const day = index.byDate[dateKey]
    if (!day || !day.bySession) continue
    // day.activeMs > 0이면 해당 날짜는 이미 정상 — skip (세션 단위 분해 부담 회피)
    if ((day.activeMs || 0) > 0) continue
    for (const sid of Object.keys(day.bySession)) {
      const s = day.bySession[sid]
      if (!s) continue
      if ((s.activeMs || 0) > 0) continue
      if (!missingBySession.has(sid)) missingBySession.set(sid, new Set())
      missingBySession.get(sid).add(dateKey)
    }
  }
  if (missingBySession.size === 0) return false

  // 2) sessionId → 메인 파일 매핑 (서브에이전트 제외)
  const sessionToFiles = new Map()
  for (const f of files || []) {
    if (f.isSubagent) continue
    const base = path.basename(f.filePath, ".jsonl")
    if (!sessionToFiles.has(base)) sessionToFiles.set(base, [])
    sessionToFiles.get(base).push(f)
  }

  let changed = false

  // 3) 세션별로 파일 재스캔 → 날짜별 timestamp 수집
  for (const [sid, dateSet] of missingBySession.entries()) {
    const targets = sessionToFiles.get(sid) || []
    if (targets.length === 0) continue

    // date → [timestamps]
    const tsByDate = new Map()
    for (const f of targets) {
      const lines = await readLinesCached(linesCache, f.filePath)
      for (const line of lines) {
        // 빠른 필터: usage 없는 라인 skip
        if (line.indexOf('"usage"') === -1) continue
        let obj
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }
        if (!obj.message || !obj.message.usage) continue
        if (obj.message.model === "<synthetic>") continue
        const ts = obj.timestamp
        if (!ts) continue
        const date = isoDateOnly(ts)
        if (!date || !dateSet.has(date)) continue
        if (!tsByDate.has(date)) tsByDate.set(date, [])
        tsByDate.get(date).push({ timestamp: ts })
      }
    }

    // 4) 날짜별로 computeActiveMs 실행 → 반영
    for (const [date, events] of tsByDate.entries()) {
      if (events.length === 0) continue
      events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      const ms = computeActiveMs(events)
      if (!ms) continue
      const day = index.byDate[date]
      if (!day) continue
      const s = day.bySession && day.bySession[sid]
      if (!s) continue
      // 중복 복구 방지: 이미 값이 있으면 skip
      if ((s.activeMs || 0) > 0) continue
      s.activeMs = ms
      day.activeMs = (day.activeMs || 0) + ms
      changed = true
    }
  }

  return changed
}

// ─── userPrompts 백필 ──────────────────────────────

/**
 * 기존 캐시 호환. day.userPrompts가 없거나 0이고 bySession에 세션이 있으면
 * 해당 세션의 파일을 재스캔하여 그 날짜에 속한 사용자 프롬프트 수를 복원.
 *
 * 서브에이전트 파일은 제외 (세션 집계 대상 아님).
 *
 * @returns {Promise<boolean>} 변경 여부
 */
async function backfillUserPrompts(index, files, linesCache) {
  // 1) 복구 대상 수집
  const missingBySession = new Map() // sid → Set<dateKey>
  for (const dateKey of Object.keys(index.byDate)) {
    const day = index.byDate[dateKey]
    if (!day || !day.bySession) continue
    // day.userPrompts > 0이면 이미 집계됨 — skip (세션 단위 부분복구 부담 회피)
    if ((day.userPrompts || 0) > 0) continue
    for (const sid of Object.keys(day.bySession)) {
      const s = day.bySession[sid]
      if (!s) continue
      if ((s.userPrompts || 0) > 0) continue
      if (!missingBySession.has(sid)) missingBySession.set(sid, new Set())
      missingBySession.get(sid).add(dateKey)
    }
  }
  if (missingBySession.size === 0) return false

  // 2) sessionId → 메인 파일 매핑
  const sessionToFiles = new Map()
  for (const f of files || []) {
    if (f.isSubagent) continue
    const base = path.basename(f.filePath, ".jsonl")
    if (!sessionToFiles.has(base)) sessionToFiles.set(base, [])
    sessionToFiles.get(base).push(f)
  }

  let changed = false

  // 3) 세션별로 파일 재스캔 → (date → count)
  for (const [sid, dateSet] of missingBySession.entries()) {
    const targets = sessionToFiles.get(sid) || []
    if (targets.length === 0) continue

    const countByDate = new Map()
    for (const f of targets) {
      const lines = await readLinesCached(linesCache, f.filePath)
      for (const line of lines) {
        // 빠른 필터: user 타입 라인이 아니면 skip
        if (line.indexOf('"type":"user"') === -1) continue
        let obj
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }
        if (!obj || obj.type !== "user") continue
        const msg = obj.message
        if (!msg || msg.role !== "user") continue
        const date = isoDateOnly(obj.timestamp)
        if (!date || !dateSet.has(date)) continue
        // 텍스트 추출 후 시스템 메시지 제외
        const content = msg.content
        let text = ""
        if (typeof content === "string") text = content
        else if (Array.isArray(content)) {
          text = content
            .filter((b) => b && b.type === "text" && typeof b.text === "string")
            .map((b) => b.text)
            .join(" ")
        }
        const trimmed = (text || "").trim()
        if (!trimmed || trimmed.startsWith("<")) continue
        countByDate.set(date, (countByDate.get(date) || 0) + 1)
      }
    }

    // 4) 반영
    for (const [date, cnt] of countByDate.entries()) {
      if (!cnt) continue
      const day = index.byDate[date]
      if (!day) continue
      const s = day.bySession && day.bySession[sid]
      if (!s) continue
      // 중복 복구 방지
      if ((s.userPrompts || 0) > 0) continue
      s.userPrompts = cnt
      if (typeof day.userPrompts !== "number") day.userPrompts = 0
      day.userPrompts += cnt
      changed = true
    }
  }

  return changed
}

// ─── firstPromptSummary 백필 ────────────────────────

/**
 * bySession[sid].firstPromptSummary가 비어있는 세션들에 대해
 * 해당 세션의 transcript 파일을 훑어 가장 이른 사용자 프롬프트 요약을 채운다.
 *
 * 최적화:
 *   - 파일 basename=sessionId 매핑 활용
 *   - 파일을 전부 읽어 가장 이른 timestamp 프롬프트를 선별 (라인 순서가 시간순이 아닐 수 있음)
 *
 * @returns {Promise<boolean>} 변경 여부
 */
async function backfillFirstPrompts(index, files, linesCache) {
  // 누락 세션 수집
  const missingBySession = new Map() // sid → [dateKeys]
  for (const dateKey of Object.keys(index.byDate)) {
    const day = index.byDate[dateKey]
    const bySession = day.bySession || {}
    for (const sid of Object.keys(bySession)) {
      const rec = bySession[sid]
      if (!rec || rec.firstPromptSummary) continue
      if (!missingBySession.has(sid)) missingBySession.set(sid, [])
      missingBySession.get(sid).push(dateKey)
    }
  }
  if (missingBySession.size === 0) return false

  // sessionId → 메인 파일(들)
  const sessionToFiles = new Map()
  for (const f of files) {
    if (f.isSubagent) continue
    const base = path.basename(f.filePath, ".jsonl")
    if (!sessionToFiles.has(base)) sessionToFiles.set(base, [])
    sessionToFiles.get(base).push(f)
  }

  let changed = false
  for (const [sid, dateKeys] of missingBySession.entries()) {
    const targets = sessionToFiles.get(sid) || []
    if (targets.length === 0) continue

    let earliestSummary = null
    let earliestTs = null
    for (const f of targets) {
      const lines = await readLinesCached(linesCache, f.filePath)
      for (const line of lines) {
        // 빠른 필터 — 'user' 타입 라인이 아니면 skip
        if (line.indexOf('"type":"user"') === -1) continue
        let obj
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }
        const summary = extractUserPromptSummary(obj)
        if (!summary) continue
        const ts = obj.timestamp || null
        if (!earliestSummary || (ts && (!earliestTs || ts < earliestTs))) {
          earliestSummary = summary
          earliestTs = ts
        }
      }
    }

    if (earliestSummary) {
      for (const dk of dateKeys) {
        const rec =
          index.byDate[dk] && index.byDate[dk].bySession && index.byDate[dk].bySession[sid]
        if (rec && !rec.firstPromptSummary) {
          rec.firstPromptSummary = earliestSummary
          changed = true
        }
      }
    }
  }
  return changed
}

// ─── 메인 진입점 ──────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.projectsDir   — ~/.claude/projects 절대 경로
 * @param {string} opts.baseDirName   — cwdToProjectDir(workDir) 결과 (IT 기준 prefix)
 * @param {string} opts.cachePath     — usage-index.json 경로
 * @returns {Promise<object>} usage-index 구조
 */
export async function aggregateAll({ projectsDir, baseDirName, cachePath }) {
  const index = await loadCache(cachePath)
  const files = discoverTranscripts(projectsDir, baseDirName)

  // 증분 scan — 파일별 lastUuid 이후만
  const newEvents = []
  const newCursor = { ...index.scanCursor }
  // 파일 단위로 포착된 첫 프롬프트 (sessionId → summary)
  // 이후 mergeEvent로 만들어진 bySession 레코드에 채워 넣는다.
  const firstPromptBySession = new Map()
  // 이번 스캔에서 새로 발견한 사용자 프롬프트 카운트 ('date::sid' → count)
  const newUserPromptsByDateSid = new Map()

  for (const f of files) {
    // 커서 키: 파일 경로로 식별 (같은 sessionId가 여러 파일에 존재할 수 있는 엣지 대비)
    const cursorKey = f.filePath
    const lastUuid = index.scanCursor[cursorKey] || null

    try {
      const {
        events,
        newLastUuid,
        firstPromptSummary,
        firstPromptSessionId,
        userPromptsByDateSid,
      } = await scanFileIncremental(f, lastUuid)
      if (events.length > 0) newEvents.push(...events)
      if (newLastUuid) newCursor[cursorKey] = newLastUuid
      // 파일 basename을 sessionId로도 사용 가능(파일명이 <sessionId>.jsonl 규칙)
      const fallbackSid = path.basename(f.filePath, ".jsonl")
      const sidKey = firstPromptSessionId || fallbackSid
      if (firstPromptSummary && sidKey && !firstPromptBySession.has(sidKey)) {
        firstPromptBySession.set(sidKey, firstPromptSummary)
      }
      // userPrompts 누적 — 커서 이후 새로 발견한 user 이벤트 수만 반영.
      if (userPromptsByDateSid && userPromptsByDateSid.size > 0) {
        for (const [key, cnt] of userPromptsByDateSid.entries()) {
          newUserPromptsByDateSid.set(key, (newUserPromptsByDateSid.get(key) || 0) + cnt)
        }
      }
    } catch (err) {
      console.warn(`[aggregator] 파일 스캔 실패 ${f.filePath}: ${err.message}`)
    }
  }

  // 새 이벤트가 없더라도 slug / firstPromptSummary / byModel / activeMs / userPrompts
  // 누락 세션이 있으면 백필만 수행 후 반환
  if (newEvents.length === 0) {
    // 이번 스캔에서 발견한 새 userPrompts가 있으면 먼저 반영 (이벤트가 없어도 user만 있었을 수 있음)
    applyUserPromptsDelta(index, newUserPromptsByDateSid)
    // 5개 backfill이 같은 파일을 재사용 — 공유 라인 캐시
    const linesCache = new Map()
    const didSlug = await backfillSlugs(index, files, linesCache)
    const didPrompt = await backfillFirstPrompts(index, files, linesCache)
    const didByModel = await backfillByModel(index, files, linesCache)
    const didByHour = await backfillByHour(index, files, linesCache)
    const didActive = await backfillActiveMs(index, files, linesCache)
    const didUserPrompts = await backfillUserPrompts(index, files, linesCache)
    linesCache.clear()
    const hasDelta = newUserPromptsByDateSid.size > 0
    if (
      didSlug ||
      didPrompt ||
      didByModel ||
      didByHour ||
      didActive ||
      didUserPrompts ||
      hasDelta
    ) {
      try {
        await saveCache(cachePath, index)
      } catch {
        /* skip */
      }
    }
    return index
  }

  // 병합
  const sessionEventsMap = new Map()
  const affectedKeys = new Set() // date::sid — active 재계산 대상
  for (const ev of newEvents) {
    mergeEvent(index, ev, sessionEventsMap)
    if (!ev.__isSubagent) {
      const date = isoDateOnly(ev.timestamp)
      if (date && ev.sessionId) affectedKeys.add(date + "::" + ev.sessionId)
    }
  }

  // active time: 증분일 경우 기존 세션 timestamp를 포함해 재계산해야 정확.
  // V1 단순화: 영향 받은 (날짜, 세션)만 파일에서 timestamp를 재수집해 덮어쓰기.
  const fullTimestampMap = await collectSessionTimestamps(files, affectedKeys)

  // sessionEventsMap과 fullTimestampMap 병합 — fullTimestampMap이 있으면 그걸로 교체
  for (const [key, events] of fullTimestampMap.entries()) {
    sessionEventsMap.set(key, events)
  }

  recomputeActiveMs(index, sessionEventsMap)

  // userPrompts 증분 반영 — scanFileIncremental이 커서 이후만 카운트했으므로 그대로 더하면 된다.
  applyUserPromptsDelta(index, newUserPromptsByDateSid)

  // scanCursor 갱신
  index.scanCursor = newCursor

  // 이번 스캔에서 포착한 firstPromptSummary를 bySession 레코드에 주입
  // (기존 값이 이미 있으면 덮어쓰지 않음 — 증분 재스캔 시 최초가 아닐 수 있음)
  if (firstPromptBySession.size > 0) {
    for (const dateKey of Object.keys(index.byDate)) {
      const day = index.byDate[dateKey]
      if (!day || !day.bySession) continue
      for (const sid of Object.keys(day.bySession)) {
        const rec = day.bySession[sid]
        if (!rec || rec.firstPromptSummary) continue
        const summary = firstPromptBySession.get(sid)
        if (summary) rec.firstPromptSummary = summary
      }
    }
  }

  // 5개 backfill이 같은 파일을 재사용 — 공유 라인 캐시 (파일 I/O 5x → 1x)
  const backfillLinesCache = new Map()

  // slug 백필: 기존 캐시로 집계된 세션은 slug 필드가 없을 수 있음.
  // 또한 새 이벤트에 slug가 포함되지 않았던 세션도 여기서 복구.
  await backfillSlugs(index, files, backfillLinesCache)

  // firstPromptSummary 백필 — 구버전 캐시로 집계된 세션 복구
  await backfillFirstPrompts(index, files, backfillLinesCache)

  // byModel 백필 — 구버전 캐시에 byModel 필드 누락/비어있는 날짜는 파일 재스캔으로 복원
  // (이번 스캔에서 발생한 새 이벤트는 이미 mergeEvent에서 day.byModel에 반영됨)
  await backfillByModel(index, files, backfillLinesCache)

  // byHour 백필 — v3 마이그레이션 시 빈 byHour 채움. 새 이벤트는 mergeEvent에서 이미 반영됨.
  await backfillByHour(index, files, backfillLinesCache)

  // activeMs 백필 — recomputeActiveMs의 과거 버그로 activeMs=0 박힌 날짜들 재계산
  await backfillActiveMs(index, files, backfillLinesCache)

  // userPrompts 백필 — 기존 캐시엔 userPrompts 필드가 없어 0. 파일 재스캔으로 복원
  await backfillUserPrompts(index, files, backfillLinesCache)

  backfillLinesCache.clear()

  // 캐시 저장 (best-effort)
  try {
    await saveCache(cachePath, index)
  } catch (err) {
    console.warn(`[aggregator] 캐시 저장 실패: ${err.message}`)
  }

  return index
}

// 테스트/외부용 헬퍼 export
export { cwdToProjectDir, extractProjectName, isoDateOnly, migrateIndex, SCHEMA_VERSION }
