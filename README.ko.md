# wilson

> **🏐 Claude라는 무인도에서, Wilson이 당신의 곁을 지킵니다.**

[English](README.md)

<p align="center">
  <img src="preview.svg?v=3" alt="wilson 대시보드 미리보기" width="100%">
</p>

---

## 🏝️ 스토리

**Claude라는 무인도에 표류한 당신 곁을 지키는 시각화 에이전트, Wilson.**

AI가 수십 개의 파일을 읽고 고치고 명령을 실행하는 동안, Wilson이 그 모든 움직임을 당신 대신 바라봅니다.
배구공 얼굴의 Wilson이 AI 상태를 표정으로 알려주고, 무엇을 읽고 썼는지, 어떤 오류가 났는지, 얼마나 일했는지 한눈에 보여줍니다.

---

## 🙋‍♂️ 왜 만들었나

**바이브코딩으로 코딩을 시작한 개발자**가, AI가 뭘 하고 있는지 자세하게 보고 싶어서 만들었습니다.

AI가 코드를 짜주는 건 기적 같지만, 정확히 뭘 하고 있는지 눈으로 확인하고 싶었습니다.

- 어떤 파일을 읽었지?
- 뭘 고쳤지? 왜 고쳤지?
- 지금 실행되는 Bash 명령어는 뭐지?
- 에러가 났나? 지금 어떻게 해결 중이지?

이 궁금증이 wilson의 출발점입니다.
**"믿지만, 눈으로 보고 싶다"** 그게 전부입니다.

---

## ✨ 기능

### 📺 monitor-agent — 실시간 활동 대시보드

메인 대시보드(`/`)가 프롬프트, tool 호출, 파일 편집, 에러 등 모든 Claude Code 활동을 Wilson의 표정과 타임라인 위젯으로 실시간 스트리밍합니다.

#### 🏐 Wilson — 시각화 에이전트 캐릭터

배구공 얼굴의 Wilson이 AI 상태를 **6가지 표정**으로 보여줍니다.

| 상태 | 표현 | 트리거 |
|------|------|--------|
| `waiting` | 천천히 숨쉬기 | 응답 완료 / 무활동 |
| `thinking` | 눈동자 굴림 + 약한 흔들림 | 프롬프트·Read |
| `searching` | 돋보기가 얼굴 위를 천천히 이동 (눈동자 집중 고정) | 탐색 도구 (Grep·Glob·Web 등) |
| `working` | 좌우 불규칙 jitter | 편집·실행 도구 (Write·Edit·Bash·Task 등) |
| `solving` | 황금 오로라 + crimson 펄스 | 에러 |
| `sleeping` | 눈 감고 숨쉬기 | 10분 무활동 |

#### ⏱️ Tool Timeline

Wilson 바로 아래, 최근 10분간의 모든 tool 호출을 컬러 아이콘으로 표시하는 6-레인 가로 타임라인. 어떤 도구가 언제 얼마나 몰렸는지 한눈에 파악됩니다.

#### 📂 Recent Files

최근 Read/Write/Edit 된 파일 목록을 시간순으로 보여줍니다.
클릭하면 코드 뷰어에 파일 내용이, Edit이면 변경된 줄이 하이라이트됩니다.

#### 📡 실시간 피드 (Feeds)

모든 프롬프트, 도구 호출, 응답이 접이식 그룹으로 쌓입니다.
검색, 세션 필터 지원.

#### 👀 코드 + Diff 뷰어

파일 내용(PrismJS 구문 하이라이트)과 변경 내역을 나란히 봅니다.
**Bash/Glob 출력도** 클릭하면 뷰어에 표시됩니다.

#### 🎨 3가지 테마

- **Beige** (기본) — 아날로그 느낌의 따뜻한 종이 색
- **White** — 깔끔한 라이트
- **Dark** — 개발자 클래식

헤더 우측 [Beige] 버튼 클릭으로 순환 (84px 고정 폭).

#### 🌍 멀티 세션 + 원격 접근

모든 하위 프로젝트의 Claude Code 세션을 동시 모니터링.

### 📊 monitor-usage — 비용·토큰 분석

`/usage` 페이지에서 Claude의 장기 토큰·비용 사용 내역을 한눈에 확인할 수 있습니다.

<p align="center">
  <img src="preview.usage.svg?v=2" alt="monitor-usage 대시보드 미리보기" width="100%">
</p>

헤더의 **`monitor-agent`** 제목을 클릭하면 `monitor-usage`로 전환되고, **`monitor-usage`** 제목을 클릭하면 다시 돌아옵니다.

#### 주요 내용

- **5개 지표 카드** — 비용 / 토큰 / 활성 시간 / 세션 / 프롬프트.
- **차트** — 일일 사용량 **모델별 스택 막대**(Opus 4.8 보라 / Opus 4.7 파랑 / Opus 4.6 와인 / Sonnet 4.6 녹색 / Haiku 4.5 노랑; 막대에 마우스를 올리면 모델별 토큰·비용 + 그날 합계), 모델 분포 도넛, Top Projects 리스트.
- **Month Grid 달력** — 각 날짜 토큰/비용, 셀 클릭 시 일간 상세 모달.
- **세션 트리** (왼쪽, Wilson 아래) — 프로젝트 태그별 2-level 트리, 레이블 `[MM/DD | 첫 프롬프트 요약]`, 서브에이전트 인라인.

#### 비용 정확도 참고

Anthropic 공개 API 단가(Opus 4.8 / 4.7 / 4.6 입력·출력 $5/$25 per M, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5)에 캐시 읽기/쓰기·모델별 단가를 정확히 적용해 이벤트 단위로 계산합니다. 1M 컨텍스트 변형(`[1m]`)은 standard 단가로 과금되므로 기본 모델에 합산됩니다. **Claude 구독제를 쓰면 이 숫자는 "API로 썼다면 얼마일까" 가상값**이라 실제 청구액이 아닙니다. 사용 강도 지표로 해석하세요.

---

## 🚀 빠른 시작

```bash
git clone https://github.com/jamietyra/Wilson.git
cd Wilson
node server.mjs
```

브라우저에서 **http://localhost:3141** 을 열면 됩니다. (포트는 π에서 따온 `3141`)

### IDE 팁

IDE 안에서 코드와 대시보드를 나란히 띄우는 방법:

- **VS Code / Cursor / Windsurf** (VS Code 계열):
  `Ctrl+Shift+P` → `Simple Browser: Show` → `http://localhost:3141`
- **JetBrains 계열** (IntelliJ IDEA, WebStorm, PyCharm 등):
  Tools → Web Browsers → 외부 브라우저 단축키 지정, 또는 우측 분할 패널에 브라우저 창 배치
- **Zed / Helix / opencode** 등 터미널 기반 에디터:
  브라우저를 창 나란히 배치 — Windows는 `Win + ←/→` 스냅, macOS는 Rectangle/Spectacle, Linux는 타일링 WM 활용
- **듀얼 모니터** 사용 시: 보조 모니터에 대시보드만 띄워두면 가장 편합니다

### 특정 디렉토리 모니터링

```bash
node server.mjs /path/to/your/project
```

기본값은 현재 작업 디렉토리입니다.

---

## ⚙️ 작동 원리

Claude Code는 모든 활동을 `~/.claude/projects/` 안의 transcript JSONL 파일에 기록합니다.
wilson은 이 파일들을 실시간 감시하고 두 갈래로 분기합니다 — 메인 대시보드용 SSE 스트림, 그리고 `/usage` 분석 페이지용 지속 집계기.

```
Claude Code → transcript.jsonl → wilson (server.mjs)
                                       │
                                       ├─► SSE /events ─► /agent 페이지
                                       │                  ├─► Wilson (5 states)
                                       │                  ├─► Feeds
                                       │                  ├─► Recent Files
                                       │                  └─► Code / Diff 뷰어
                                       │
                                       └─► Aggregator ─► cache/usage-index.json
                                                         (증분 스캔,
                                                          byDate / byProject /
                                                          bySession / byModel)
                                                         │
                                                         └─► GET /api/usage ─► /usage 페이지
                                                                              ├─► 지표 카드
                                                                              ├─► Daily / Model / Projects
                                                                              ├─► Month Grid 달력
                                                                              └─► 세션 트리
```

새 세션(+ 서브에이전트 transcript)은 디렉토리 워처로 즉시 감지되며 60초 폴백 스캔이 보조합니다.

### 💸 리소스 사용량 — Claude 토큰 소모 **0**

wilson은 **Anthropic API를 전혀 호출하지 않습니다**. Claude Code가 이미 디스크에 남겨둔 JSONL transcript를 읽어서 시각화만 할 뿐이므로:

| 리소스 | 사용량 |
|--------|--------|
| **Claude 토큰 / API 비용** | **0** (외부 호출 없음) |
| **네트워크** | localhost SSE만, 인터넷 트래픽 **0** |
| **CPU** | 아이들 시 실질 0%, 이벤트 발생 시 10~50ms 파싱 |
| **서버 메모리** | ~60~100MB RSS (상한 고정) |
| **브라우저 DOM** | 피드 500 그룹 상한, 장시간 가동에도 무한 성장 없음 |
| **초기 JS payload** | wilson.js **24KB** |
| **디스크** | `cache/usage-index.json` 수백KB~수MB + offsets.json 수KB |
| **의존성** | **Zero** — `npm install` 불필요, Node 내장 모듈만 |

대시보드를 하루 종일 켜둬도 Claude 사용량 통계엔 티끌도 반영되지 않고, 별도 클라우드 비용도 발생하지 않습니다.

---

## 🌐 원격 접근

다른 기기에서 대시보드에 접속하려면:

```bash
MONITOR_REMOTE=true MONITOR_TOKEN=your-secret-token node server.mjs
```

요청은 `Authorization: Bearer` 헤더로 인증하세요:

```bash
curl -H "Authorization: Bearer your-secret-token" http://서버IP:3141/api/usage
```

쿼리 토큰(`?token=…`)도 하위 호환으로 받지만 `X-Auth-Deprecation` 헤더로 경고합니다. Bearer 헤더를 권장합니다.

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `MONITOR_PORT` | `3141` | 서버 포트 |
| `MONITOR_REMOTE` | `false` | `true`면 `0.0.0.0`에서 수신, 아니면 `127.0.0.1` |
| `MONITOR_TOKEN` | (없음) | 인증 토큰 — 원격 접근 시 필수 |
| `MONITOR_ALLOWED_PATHS` | `$HOME` | `path.delimiter` 구분 파일 루트 목록. `/api/file`은 이 범위 밖 경로를 거부 |
| `MONITOR_ALLOWED_ORIGINS` | `localhost,127.0.0.1` | 콤마 구분 CORS 허용 hostname |

`MONITOR_REMOTE=true` 없이 실행하면 localhost 접속만 허용됩니다.

### 보안 모델

- **인증** — Bearer 헤더(권장) 또는 쿼리 스트링(deprecated).
- **Path traversal** — `/api/file`은 절대 경로를 `realpath`로 정규화하고 `MONITOR_ALLOWED_PATHS` 밖이면 거부.
- **CORS** — 화이트리스트 밖 origin에는 `Access-Control-Allow-Origin` 헤더를 내지 않음. 브라우저가 크로스 origin 읽기를 자연히 차단.
- **CSRF** — 해당 없음: 모든 HTTP 엔드포인트가 read-only. 향후 상태 변경 엔드포인트가 추가되면 각각 `X-CSRF-Token` 헤더(double-submit cookie 패턴)를 요구해야 함.

---

## 📦 요구 사항

- Node.js >= 18 (권장: 22+)
- 활성 Claude Code 세션
- 의존성 없음 (`npm install` 불필요)

---

## 📝 라이선스

MIT

---

## 💬 Credits

- 캐릭터 영감: 영화 **Cast Away (2000)** 의 배구공 Wilson
- 폰트: [Fraunces](https://fonts.google.com/specimen/Fraunces) (제목/섹션), [Caveat](https://fonts.google.com/specimen/Caveat) (Wilson 상태)
- 코드 하이라이트: [PrismJS](https://prismjs.com/)
- 테마 영감: VSCode, 그리고 아날로그 노트
