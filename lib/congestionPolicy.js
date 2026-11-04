// step663: 구글 혼잡(503/429 분당) 시 대체 경로 전환 단축 — 순수 함수(네트워크·DB 없음). 게이트: scripts/gate-congestion-policy.js
//
// 배경(11/3 08:20~59 실측): 메인 모델 503이 4회 연속이면 보조 모델로 넘어가지 않고 그대로 오류를 던졌다(채점 503 오류 111건).
//   보조 모델은 60초 매달림(TIMEOUT)으로만 선택돼 성공한 글도 100~159초가 걸렸다.
// 규칙(채점 2타입 grading·rewriteGrading에만 켠다 — 보조 모델 키당 하루 20회 보호):
//   ① 503 1회째 → 2초 뒤 1회만 재시도. 2회 연속이면 그 자리에서 다음 모델.
//   ② 429(분당) → 즉시 다음 모델(모델별 한도라 모델이 바뀌면 바로 풀린다). 마지막 모델이면 예산 안에서 1회만 대기.
//   ③ 합계 예산 30초(쓰로틀 대기 포함). 메인 모델 단건 타임아웃 15초, 보조는 남은 예산. 예산이 없으면 재시도·전환 없이 오류.
//   일일 한도(PerDay)·404·안전 필터·MAX_TOKENS 분기는 종전 그대로(lib/gemini.js).

export const CONGESTION_DEADLINE_MS = 30_000      // 제출 확인 통과 뒤 AI 호출 합계 상한(쓰로틀 대기 포함)
export const CONGESTION_MAIN_TIMEOUT_MS = 15_000  // 메인 모델 단건 매달림 상한(보조는 남은 예산, 기본 60초 상한)
export const CONGESTION_BUSY_WAIT_MS = 2_000      // 503 1회째 재시도 전 대기
export const CONGESTION_BUSY_MAX = 2              // 같은 모델에서 503 연속 N회면 전환
export const CONGESTION_MIN_LEFT_MS = 3_000       // 대기 뒤 호출에 최소로 남겨야 하는 예산

// 채점 2타입이 넘기는 기본 옵션
export const GRADING_CONGESTION_OPTS = Object.freeze({ deadlineMs: CONGESTION_DEADLINE_MS, mainTimeoutMs: CONGESTION_MAIN_TIMEOUT_MS })

export function isBusyMessage(msg) {
  const m = String(msg || '')
  return /503|high demand|overloaded|UNAVAILABLE/i.test(m)
}

/**
 * 혼잡 종류. quota = classifyQuotaError(err) 결과.
 * @returns {'rate429'|'busy503'|null}  일일 429는 null(종전 분기가 처리)
 */
export function congestionKind(msg, quota) {
  if (quota && quota.is429) return quota.daily ? null : 'rate429'
  if (isBusyMessage(msg)) return 'busy503'
  return null
}

/**
 * 이번 모델의 다음 행동.
 * @param {{ kind:'rate429'|'busy503', consecutive:number, remainingMs:number, isLastModel:boolean, retryDelaySec?:number|null }} p
 *   consecutive: 같은 모델에서 이번 실패까지 연속 혼잡 응답 수(1부터)
 * @returns {{ action:'retry'|'switch'|'fail', waitMs:number }}
 */
export function decideOnCongestion({ kind, consecutive, remainingMs, isLastModel, retryDelaySec } = {}) {
  const left = Number.isFinite(remainingMs) ? remainingMs : Infinity
  const n = Number(consecutive) || 1
  if (kind === 'rate429') {
    if (!isLastModel) return { action: 'switch', waitMs: 0 }
    // 마지막 모델: 기다릴수록 악화되므로 1회만, retryDelay(없으면 3초)가 예산 안에 들 때만
    const wait = Math.max(1, Math.ceil(Number.isFinite(retryDelaySec) && retryDelaySec > 0 ? retryDelaySec : 3)) * 1000
    if (n < 2 && left >= wait + CONGESTION_MIN_LEFT_MS) return { action: 'retry', waitMs: wait }
    return { action: 'fail', waitMs: 0 }
  }
  // busy503
  if (n < CONGESTION_BUSY_MAX && left >= CONGESTION_BUSY_WAIT_MS + CONGESTION_MIN_LEFT_MS) return { action: 'retry', waitMs: CONGESTION_BUSY_WAIT_MS }
  if (!isLastModel && left >= CONGESTION_MIN_LEFT_MS) return { action: 'switch', waitMs: 0 }
  return { action: 'fail', waitMs: 0 }
}

/**
 * 단건 타임아웃. 예산 밖·메인 상한 밖으로 매달리지 않게. 최소 1초.
 * @param {{ defaultMs:number, remainingMs:number, isMainModel:boolean, mainTimeoutMs?:number }} p
 */
export function attemptTimeoutMs({ defaultMs, remainingMs, isMainModel, mainTimeoutMs } = {}) {
  let t = Number(defaultMs) > 0 ? Number(defaultMs) : 60_000
  if (Number.isFinite(remainingMs)) t = Math.min(t, remainingMs)
  if (isMainModel && Number(mainTimeoutMs) > 0) t = Math.min(t, Number(mainTimeoutMs))
  return Math.max(1_000, Math.floor(t))
}

// 예산이 남았는지(호출 1회를 시작할 만큼)
export function hasBudget(remainingMs) {
  return !Number.isFinite(remainingMs) || remainingMs >= 1_000
}

// 429 quotaId 1줄(서버 로그용, PII 없음). quota = classifyQuotaError 결과. 429가 아니면 null.
//   배경: error_logs.message는 500자 절단이라 꼬리의 quotaId(분당/일일)가 소실됐다(체크리스트 ⑤ RPM 판정 재료).
export function quotaLineOf(quota) {
  if (!quota || !quota.is429) return null
  const ids = Array.isArray(quota.quotaIds) && quota.quotaIds.length ? quota.quotaIds.join(',') : 'unknown'
  const delay = Number.isFinite(quota.retryDelaySec) ? `${quota.retryDelaySec}s` : '-'
  return `[429 quota=${ids} retryDelay=${delay} ${quota.daily ? 'daily' : quota.perMinute ? 'perMinute' : 'unspecified'}]`.slice(0, 300)
}
