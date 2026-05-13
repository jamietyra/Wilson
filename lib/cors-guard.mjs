/**
 * cors-guard.mjs — Origin 화이트리스트 기반 CORS 매칭.
 *
 * 기본 정책:
 *   - 환경변수 MONITOR_ALLOWED_ORIGINS 콤마 구분 hostname 목록
 *   - 미설정 시 localhost / 127.0.0.1만 허용
 *   - 매칭 시 Origin 헤더 값을 그대로 echo (와일드카드 '*' 사용 안 함)
 *   - 매칭 실패 시 null 반환 → 호출측이 CORS 헤더를 세팅하지 않음 (브라우저가 자연스럽게 차단)
 */

/**
 * 허용 origin(hostname) 목록 계산
 * @param {string} [envValue] — MONITOR_ALLOWED_ORIGINS (콤마 구분 hostname)
 * @returns {string[]} 허용 hostname 배열
 */
export function computeAllowedOrigins(envValue = process.env.MONITOR_ALLOWED_ORIGINS) {
  if (envValue) {
    return envValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return ["localhost", "127.0.0.1"]
}

/**
 * 주어진 Origin 헤더가 허용 목록에 속하는지 판단.
 *
 * @param {string|undefined} origin — 요청의 Origin 헤더 값 (예: "http://localhost:3141")
 * @param {string[]} allowedOrigins — hostname 배열
 * @returns {string|null} 허용 시 원본 origin 문자열, 아니면 null
 */
export function matchOrigin(origin, allowedOrigins) {
  if (!origin || typeof origin !== "string") return null
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) return null
  try {
    const url = new URL(origin)
    if (allowedOrigins.includes(url.hostname)) return origin
  } catch {
    return null
  }
  return null
}
