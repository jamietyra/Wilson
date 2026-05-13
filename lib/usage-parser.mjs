/**
 * usage-parser.mjs — transcript 이벤트 1건에서 usage/cost 추출
 *
 * 스펙: docs/specs/2026-04-13-monitor-usage-design.md (섹션 6)
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── pricing.json 로드 (모듈 초기화 시 1회) ─────────────
const PRICING_PATH = path.join(__dirname, "pricing.json")
let pricing = null
try {
  pricing = JSON.parse(fs.readFileSync(PRICING_PATH, "utf8"))
} catch (err) {
  console.warn(`[usage-parser] pricing.json 로드 실패: ${err.message}`)
  // 최소 fallback — 모든 단가 0 처리
  pricing = { unitTokens: 1_000_000, fallback: "claude-sonnet-4-6", models: {} }
}

// 같은 미지 모델명 중복 경고 방지용 Set
const warnedUnknownModels = new Set()

/**
 * 실제 모델 이름(예: claude-haiku-4-5-20251001)을 pricing 키 형태로 정규화.
 * - 뒤쪽 날짜 suffix (YYYYMMDD 8자리) 제거
 * - 그 외에는 원본 유지
 */
export function normalizeModel(rawModel) {
  if (!rawModel || typeof rawModel !== "string") return ""
  // -20251001 같은 뒤쪽 날짜 suffix 제거
  return rawModel.replace(/-\d{8}$/, "")
}

/**
 * pricing.models에서 모델 단가를 얻고, 없으면 fallback 경로.
 * 반환: { unit, rates, usedFallback, resolvedModel }
 */
function resolveRates(normalizedModel) {
  const models = pricing.models || {}
  if (models[normalizedModel]) {
    return {
      unit: pricing.unitTokens || 1_000_000,
      rates: models[normalizedModel],
      usedFallback: false,
      resolvedModel: normalizedModel,
    }
  }
  const fallbackKey = pricing.fallback
  const fallbackRates = fallbackKey ? models[fallbackKey] : null
  if (!warnedUnknownModels.has(normalizedModel)) {
    warnedUnknownModels.add(normalizedModel)
    console.warn(
      `[usage-parser] unknown model: ${normalizedModel} — fallback(${fallbackKey}) 단가 적용`,
    )
  }
  return {
    unit: pricing.unitTokens || 1_000_000,
    rates: fallbackRates || { input: 0, output: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0 },
    usedFallback: true,
    resolvedModel: fallbackKey || null,
  }
}

/**
 * transcript 한 줄(JSON 파싱 결과)에서 usage 이벤트 추출.
 * usage가 없거나 assistant 메시지가 아니면 null.
 *
 * @param {object} entry — .jsonl 한 줄을 JSON.parse한 결과
 * @returns {null | {
 *   model: string, normalizedModel: string,
 *   tokens: {input, cacheWrite1h, cacheWrite5m, cacheRead, output},
 *   costUSD: number,
 *   timestamp: string, sessionId: string,
 *   isSidechain: boolean, agentId: string | null,
 *   uuid: string | null
 * }}
 */
export function parseUsageEvent(entry) {
  if (!entry || typeof entry !== "object") return null

  // assistant 타입만 usage를 가진다. snapshot 등은 skip.
  const msg = entry.message
  if (!msg || typeof msg !== "object") return null
  const usage = msg.usage
  if (!usage || typeof usage !== "object") return null

  const rawModel = msg.model || ""
  // <synthetic> 등 합성 모델은 skip (토큰 0이지만 의미 없음)
  if (!rawModel || rawModel === "<synthetic>") return null

  const normalizedModel = normalizeModel(rawModel)

  // 캐시 creation 토큰 — 1h/5m 세부 값이 있으면 사용, 없으면 total을 1h로 fallback
  const creation = usage.cache_creation || {}
  const has1h = typeof creation.ephemeral_1h_input_tokens === "number"
  const has5m = typeof creation.ephemeral_5m_input_tokens === "number"
  const totalCreation =
    typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : 0

  const cacheWrite1h = has1h ? creation.ephemeral_1h_input_tokens : has5m ? 0 : totalCreation
  const cacheWrite5m = has5m ? creation.ephemeral_5m_input_tokens : 0

  const tokens = {
    input: usage.input_tokens || 0,
    cacheWrite1h: cacheWrite1h || 0,
    cacheWrite5m: cacheWrite5m || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    output: usage.output_tokens || 0,
  }

  // 단가 적용
  const { unit, rates } = resolveRates(normalizedModel)
  const costUSD =
    (tokens.input * (rates.input || 0) +
      tokens.cacheWrite1h * (rates.cacheWrite1h || 0) +
      tokens.cacheWrite5m * (rates.cacheWrite5m || 0) +
      tokens.cacheRead * (rates.cacheRead || 0) +
      tokens.output * (rates.output || 0)) /
    unit

  return {
    model: rawModel,
    normalizedModel,
    tokens,
    costUSD,
    timestamp: entry.timestamp || null,
    sessionId: entry.sessionId || null,
    isSidechain: entry.isSidechain === true,
    // 서브에이전트 파일 경로 기반 식별자는 aggregator가 주입
    agentId: entry.__agentId || null,
    uuid: entry.uuid || null,
  }
}

/**
 * 테스트/디버깅용 — 현재 로드된 pricing 스냅샷 노출
 */
export function getPricingSnapshot() {
  return pricing
}
