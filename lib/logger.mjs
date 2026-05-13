/**
 * logger.mjs — 구조화 로그 유틸.
 *
 * 기본 모드: stdout이 TTY면 사람이 읽기 좋은 포맷, 아니면 JSON lines.
 *   MONITOR_LOG_JSON=true 로 강제 JSON 출력 가능.
 *
 * 용법:
 *   import { createLogger } from './lib/logger.mjs';
 *   const log = createLogger('watcher');
 *   log.info('tail started', { file: 'abc.jsonl', bytes: 123 });
 *   log.warn('retrying', { reason: 'EACCES' });
 *   log.error('fatal', { err: err.message });
 *
 * 설계 원칙:
 *   - info는 stdout, warn/error는 stderr. 파이프라인에서 분리 가능.
 *   - 필드는 평면화. 중첩 객체는 caller가 flatten하거나 JSON.stringify.
 *   - 구조적 로그가 목적이지 "모든 console.log를 치환"하는 게 아님.
 *     startup banner 같은 사람 친화 메시지는 기존 console.log 유지.
 */

const FORCE_JSON = process.env.MONITOR_LOG_JSON === "true"
const PRETTY = !FORCE_JSON && process.stdout.isTTY

/**
 * @param {string} component — 구성요소 태그 (예: 'watcher', 'auth', 'usage')
 */
export function createLogger(component) {
  return {
    info: (msg, ctx) => emit("info", component, msg, ctx),
    warn: (msg, ctx) => emit("warn", component, msg, ctx),
    error: (msg, ctx) => emit("error", component, msg, ctx),
  }
}

function emit(level, component, msg, ctx) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...(ctx && typeof ctx === "object" ? ctx : {}),
  }
  const line = PRETTY ? formatPretty(entry) : JSON.stringify(entry)
  const stream = level === "info" ? process.stdout : process.stderr
  stream.write(line + "\n")
}

function formatPretty(entry) {
  const icon = entry.level === "error" ? "✗" : entry.level === "warn" ? "⚠" : "·"
  const base = `${icon} [${entry.component}] ${entry.msg}`
  const ctxKeys = Object.keys(entry).filter((k) => !["ts", "level", "component", "msg"].includes(k))
  if (ctxKeys.length === 0) return base
  const ctxStr = ctxKeys.map((k) => `${k}=${formatValue(entry[k])}`).join(" ")
  return `${base}  ${ctxStr}`
}

function formatValue(v) {
  if (v == null) return "null"
  if (typeof v === "string") return v.length > 80 ? JSON.stringify(v.slice(0, 80) + "…") : v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
