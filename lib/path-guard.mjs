/**
 * path-guard.mjs — /api/file 등 사용자 제공 파일 경로의 허용 여부 판단.
 *
 * 기본 정책:
 *   - 절대 경로만 허용 (상대 경로는 무조건 거부)
 *   - 허용 루트 목록(ALLOWED_ROOTS) 내부에 속해야 함
 *   - 파일이 실제로 존재하면 realpath로 심링크 해석 후 비교 (심링크 우회 차단)
 *   - Windows에서는 대소문자 무시 비교 (NTFS 기본이 case-insensitive)
 *
 * 환경변수:
 *   MONITOR_ALLOWED_PATHS — path.delimiter(';' on Win, ':' on *nix)로 구분된 루트 목록
 *   미설정 시 os.homedir()만 허용.
 */

import fs from "node:fs"
import path from "node:path"
import os from "node:os"

/**
 * 허용 루트 목록 계산 — env → 없으면 homedir
 * @param {string} [envValue] — MONITOR_ALLOWED_PATHS (path.delimiter 구분)
 * @param {() => string} [homedirFn] — homedir 반환 함수 (테스트 주입용)
 * @returns {string[]} path.resolve된 허용 루트 배열
 */
export function computeAllowedRoots(
  envValue = process.env.MONITOR_ALLOWED_PATHS,
  homedirFn = os.homedir,
) {
  if (envValue) {
    return envValue
      .split(path.delimiter)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => path.resolve(p))
  }
  return [path.resolve(homedirFn())]
}

/**
 * 주어진 경로가 허용된 루트 중 하나의 내부에 속하는지 판단.
 *
 * @param {string} filePath — 클라이언트가 제공한 파일 경로
 * @param {string[]} allowedRoots — path.resolve된 허용 루트 절대 경로 배열
 * @returns {boolean}
 */
export function isPathAllowed(filePath, allowedRoots) {
  if (!filePath || typeof filePath !== "string") return false
  if (!path.isAbsolute(filePath)) return false
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return false

  let resolved
  try {
    // 파일이 존재하면 심링크까지 해석 (realpath). 없으면 단순 정규화.
    resolved = fs.existsSync(filePath) ? fs.realpathSync(filePath) : path.resolve(filePath)
  } catch {
    return false
  }

  const isWin = process.platform === "win32"
  const resolvedCmp = isWin ? resolved.toLowerCase() : resolved

  for (const root of allowedRoots) {
    const rootCmp = isWin ? root.toLowerCase() : root
    // 정확히 같거나, path.sep으로 구분된 하위 경로면 허용
    if (resolvedCmp === rootCmp) return true
    if (resolvedCmp.startsWith(rootCmp + path.sep)) return true
  }
  return false
}
