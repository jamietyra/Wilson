import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import os from "node:os"
import { computeAllowedRoots, isPathAllowed } from "../lib/path-guard.mjs"

const isWin = process.platform === "win32"
const SEP = path.sep

// ─── computeAllowedRoots ─────────────────────────────

test("computeAllowedRoots: env 없으면 homedir만 반환", () => {
  const roots = computeAllowedRoots(undefined, () => "/home/tester")
  assert.deepEqual(roots, [path.resolve("/home/tester")])
})

test("computeAllowedRoots: env 있으면 delimiter로 분할 + 정규화", () => {
  const input = `/a${path.delimiter}/b/c${path.delimiter}  ${path.delimiter}/d`
  const roots = computeAllowedRoots(input, () => "/home/tester")
  assert.equal(roots.length, 3)
  assert.ok(roots[0].endsWith("a") || roots[0].endsWith("a" + SEP))
  assert.ok(roots[1].endsWith("c") || roots[1].endsWith("c" + SEP))
})

// ─── isPathAllowed ───────────────────────────────────

test("isPathAllowed: 빈/null/undefined 경로는 거부", () => {
  const roots = [path.resolve("/safe")]
  assert.equal(isPathAllowed("", roots), false)
  assert.equal(isPathAllowed(null, roots), false)
  assert.equal(isPathAllowed(undefined, roots), false)
})

test("isPathAllowed: 문자열 아닌 입력은 거부", () => {
  const roots = [path.resolve("/safe")]
  assert.equal(isPathAllowed(123, roots), false)
  assert.equal(isPathAllowed({}, roots), false)
})

test("isPathAllowed: 상대 경로는 거부", () => {
  const roots = [path.resolve("/safe")]
  assert.equal(isPathAllowed("./foo", roots), false)
  assert.equal(isPathAllowed("../etc/passwd", roots), false)
  assert.equal(isPathAllowed("foo/bar.txt", roots), false)
})

test("isPathAllowed: allowedRoots가 빈 배열/누락 시 거부", () => {
  assert.equal(isPathAllowed(path.resolve("/safe/a.txt"), []), false)
  assert.equal(isPathAllowed(path.resolve("/safe/a.txt"), null), false)
  assert.equal(isPathAllowed(path.resolve("/safe/a.txt"), undefined), false)
})

test("isPathAllowed: 허용 루트 내부 절대경로는 허용 (존재하지 않는 파일)", () => {
  const root = path.resolve("/some/safe-area")
  const inside = path.join(root, "deep", "file.txt")
  assert.equal(isPathAllowed(inside, [root]), true)
})

test("isPathAllowed: 허용 루트 밖은 거부", () => {
  const root = path.resolve("/some/safe-area")
  const outside = path.resolve("/other/unsafe/file.txt")
  assert.equal(isPathAllowed(outside, [root]), false)
})

test("isPathAllowed: 정규화로 .. 탈출 차단", () => {
  const root = path.resolve("/base/inside")
  // 이미 절대 경로지만 문자열상 루트로 시작해도 realpath/resolve 이후 밖이어야 함
  const sneaky = path.resolve("/base/inside/../../etc/passwd")
  assert.equal(isPathAllowed(sneaky, [root]), false)
})

test("isPathAllowed: homedir 내부의 실제 존재 파일 허용", () => {
  const homedir = os.homedir()
  const roots = [path.resolve(homedir)]
  // homedir 자체는 항상 존재하는 디렉토리 — realpath 테스트
  assert.equal(isPathAllowed(homedir, roots), true)
})

if (isWin) {
  test("isPathAllowed: Windows 대소문자 무시", () => {
    const root = path.resolve("C:\\Users\\Tester")
    const mixed = "c:\\users\\tester\\file.txt"
    assert.equal(isPathAllowed(mixed, [root]), true)
  })
}

test("isPathAllowed: 여러 허용 루트 중 하나라도 매칭되면 허용", () => {
  const r1 = path.resolve("/root-a")
  const r2 = path.resolve("/root-b")
  const target = path.join(r2, "file.txt")
  assert.equal(isPathAllowed(target, [r1, r2]), true)
})

test("isPathAllowed: 루트와 정확히 같은 경로도 허용", () => {
  const root = path.resolve("/exact-match")
  assert.equal(isPathAllowed(root, [root]), true)
})

test("isPathAllowed: 루트 prefix가 파일명과 우연히 겹쳐도 거부 (sep 체크)", () => {
  // /root-a는 허용, /root-abc는 루트의 하위가 아님
  const root = path.resolve("/root-a")
  const sneaky = path.resolve("/root-abc/file.txt")
  assert.equal(isPathAllowed(sneaky, [root]), false)
})
