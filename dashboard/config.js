// config.js — 대시보드 전역 설정 (매직넘버 집약)
// ES Module — import { wilsonConfig } from './config.js'

export const wilsonConfig = {
  // feed.js — 최종 메시지 후 N ms 무활동 시 그룹 자동 접힘
  IDLE_CLOSE_MS: 3000,

  // tooltip.js — hover 후 툴팁 표시까지 기본 지연
  TOOLTIP_DEFAULT_DELAY_MS: 1500,
  // tooltip.js — 이탈 후 숨김까지 grace 기간 (툴팁 내부 재진입 허용)
  TOOLTIP_HIDE_GRACE_MS: 120,

  // viewer.js — 파일 LRU 캐시 최대 항목 수
  FILE_CACHE_MAX: 50,

  // wilson.js — 툴팁/팁 메시지 표시 시간
  TIP_DISPLAY_MS: 15000,
  // wilson.js — 액션 애니메이션 잔상 유지 시간
  ACTION_LINGER_MS: 15000,
  // wilson.js — 최근 파일 목록 최대 보관 수
  MAX_RECENT_FILES: 100,

  // feed.js — DOM 내 prompt-group 최대 개수 (#5 virtualization)
  // 초과 시 가장 오래된 그룹부터 FIFO 제거 → DOM 성장 상한. Load More로 복구 가능.
  MAX_FEED_GROUPS: 500,
}

// COMPAT — 마이그레이션 기간에만 유지 (Tier 6에서 제거)
if (typeof window !== "undefined") window.wilsonConfig = wilsonConfig
