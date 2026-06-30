# SNAPSHOT — lib/  (24 files)

> 다온클래스 소스 스냅샷. 생성 기준 디렉터리: `lib/`

## lib/aiClient.js

```js
// ============================================
// AI 서버 프록시 호출 헬퍼 (클라이언트용)
// ============================================
// 프롬프트는 서버(/api/ai)에서 구성하므로, 여기선 작업 종류와 데이터만 보냄.
// 프롬프트 본문이 브라우저 번들에 없어 F12로 노출되지 않음.
//
// 키 서버격리(step153~): 클라이언트는 API 키를 다루지 않는다.
//   로그인 세션 토큰만 보내면 서버가 학급 키를 조회해 호출한다.
//   (admin이 특정 학급으로 호출하려면 opts.classId 전달)
// ============================================
import { supabase } from './supabase'
import { logError } from './errorLog'

export async function callAI(type, payload, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const accessToken = session?.access_token
  if (!accessToken) {
    throw new Error('로그인이 필요해요. 페이지를 새로고침 해주세요.')
  }

  // AI 호출 실패는 여기 한 군데서만 기록 (호출처마다 중복 기록 방지). 원본 메시지 사용.
  const fail = (rawMessage) => {
    logError({ page: 'api/ai', errorType: 'ai_call', message: rawMessage, context: { aiType: type } })
  }

  let res
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, accessToken, classId: opts.classId, payload }),
    })
  } catch (e) {
    fail('fetch 실패: ' + (e?.message || e))
    throw new Error('인터넷 연결을 확인해주세요. 잠시 후 다시 시도해주세요.')
  }

  let data
  try {
    data = await res.json()
  } catch (e) {
    fail('응답 파싱 실패 (status ' + res.status + ')')
    throw new Error('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해주세요.')
  }

  if (!res.ok) {
    fail(data?.error || ('AI 오류 status ' + res.status))
    throw new Error(data?.error || 'AI 처리 중 오류가 발생했어요')
  }
  // 채점·주제 등은 result, 챗봇은 answer 반환
  return data.result !== undefined ? data.result : data.answer
}

```

## lib/apiThrottle.js

```js
// API 호출 큐 (분당 호출 제한 보호)
//
// 같은 학급 학생들이 동시에 제출 누를 때 분당 한도(15회)를 넘지 않도록
// 클라이언트에서 호출 간격을 조절합니다.
//
// 기본 정책: 최근 1분 동안의 호출이 12회 이상이면 1초씩 지연 (15보다 약간 여유)
//
// 주의: 이건 클라이언트 사이드라 같은 학급 다른 학생끼리는 협조 안 됨.
// 하지만 한 학생이 빠르게 여러 번 누르거나, 같은 학생의 첫 글+수정본 연속
// 호출은 막아줌. 분당 한도 도달 자체를 막진 못해도 완화 효과는 있음.

const RATE_LIMIT_RPM = 12 // 분당 12회 이하로 유지 (15가 한도지만 여유)
const callTimestamps = [] // 최근 호출 시각들

/**
 * 분당 호출 한도 검사 후 필요시 지연
 * @returns {Promise<void>} 호출 가능 시 즉시, 한도 가까우면 지연 후 resolve
 */
export async function throttleApiCall() {
  const now = Date.now()
  const oneMinuteAgo = now - 60_000

  // 1분 지난 기록 제거
  while (callTimestamps.length > 0 && callTimestamps[0] < oneMinuteAgo) {
    callTimestamps.shift()
  }

  // 한도 가까우면 대기
  if (callTimestamps.length >= RATE_LIMIT_RPM) {
    // 가장 오래된 호출이 1분 지나갈 때까지 + 약간의 여유
    const waitMs = (callTimestamps[0] + 60_000) - now + 100
    if (waitMs > 0) {
      console.log(`⏳ 분당 호출 한도 보호: ${Math.ceil(waitMs/1000)}초 대기`)
      await new Promise(r => setTimeout(r, waitMs))
      // 재귀로 다시 검사
      return throttleApiCall()
    }
  }

  // 호출 기록 추가
  callTimestamps.push(Date.now())
}

/**
 * 현재 분당 호출 사용량 (정보 표시용)
 */
export function getCurrentUsage() {
  const oneMinuteAgo = Date.now() - 60_000
  const recent = callTimestamps.filter(t => t > oneMinuteAgo)
  return {
    used: recent.length,
    limit: RATE_LIMIT_RPM
  }
}

```

## lib/authErrors.js

```js
// Supabase Auth + 일반 에러를 사용자 친화적 한글 메시지로 변환
// 베타 운영하면서 자주 보이는 에러들 대응

/**
 * 에러 객체나 메시지를 받아 사용자에게 보여줄 친절한 한글 메시지로 변환
 * @param {Error|object|string} err - 에러
 * @param {string} context - 'login' | 'signup' | 'reset' | 'general'
 * @returns {string} 사용자에게 보여줄 메시지
 */
export function getAuthErrorMessage(err, context = 'general') {
  if (!err) return '알 수 없는 오류가 발생했어요'

  const raw = (typeof err === 'string') ? err : (err.message || err.error_description || err.error || '')
  const status = err?.status || err?.statusCode
  const code = err?.code

  // 로그인 자격 증명 실패
  if (raw.includes('Invalid login credentials') || raw.includes('invalid_credentials')) {
    if (context === 'teacherLogin') {
      return '아이디 또는 비밀번호가 잘못됐어요.\n다시 확인해주세요.\n\n' +
        '🔑 비밀번호를 잊으셨나요?\n' +
        '새로 가입하지 마시고 관리자(개발자)에게 초기화를 요청하세요.\n' +
        '재가입하면 기존 학급·학생·글과 연결이 끊겨요!\n\n' +
        '💡 처음이라면 회원가입을 먼저 해주세요.'
    }
    // step206: '회원가입 먼저'를 1순위에서 내림 — 명렬표 학급 학생이 오타 후 새 계정(유령) 만드는 것 방지.
    return '아이디 또는 비밀번호가 잘못됐어요.\n다시 확인해주세요.\n\n💡 아이디 오타가 아닌지 확인하고, 모르겠으면 선생님께 물어보세요.\n(처음 가입하는 학급이면 "회원가입" 탭을 눌러요.)'
  }

  // 이미 가입된 사용자 (422)
  if (raw.includes('already registered') || raw.includes('already been registered') ||
      raw.includes('User already') || raw.includes('already exists') || raw.toLowerCase().includes('duplicate')) {
    if (context === 'signup') {
      return '이미 가입된 아이디예요!\n\n👉 "로그인" 탭으로 가서 로그인해주세요.\n비밀번호를 잊으셨다면 선생님께 초기화 요청하세요.'
    }
    return '이미 가입된 계정이에요.'
  }

  // 비밀번호 너무 짧음
  if (raw.includes('Password should be at least') || raw.includes('password_too_short') || raw.includes('weak_password')) {
    const match = raw.match(/at least (\d+)/)
    const minLen = match ? match[1] : '6'
    return `비밀번호는 ${minLen}자 이상이어야 해요.`
  }

  // 이메일 형식 오류
  if (raw.includes('Unable to validate email') || raw.includes('Invalid email')) {
    return '아이디 형식이 잘못됐어요.\n영문/숫자만 사용해주세요.'
  }

  // 이메일 인증 안 됨
  if (raw.includes('Email not confirmed') || raw.includes('email_not_confirmed')) {
    return '이메일 인증이 필요해요. 선생님 또는 관리자에게 문의해주세요.'
  }

  // 사용자 없음
  if (raw.includes('User not found') || raw.includes('user does not exist') || raw.includes('user_not_found')) {
    // step206: 오타 확인·선생님 문의를 앞세움(명렬표 학급 유령 방지). 가입은 보조 안내로.
    return '입력한 아이디로 만든 계정이 없어요.\n\n💡 아이디 오타가 아닌지 확인하거나 선생님께 문의해주세요.\n(처음 가입하는 학급이면 "회원가입" 탭으로 가입하세요.)'
  }

  // 비밀번호 변경 시 이전과 같음
  if (raw.includes('same as the existing') || raw.includes('same_password')) {
    return '현재 비밀번호와 같은 비밀번호로 변경할 수 없어요.'
  }

  // Rate limit (너무 많은 시도)
  if (raw.includes('rate limit') || raw.includes('too many') || raw.includes('Email rate limit') || status === 429) {
    return '잠시 후 다시 시도해주세요.\n(짧은 시간에 너무 많이 시도했어요)'
  }

  // 네트워크
  if (raw.includes('Network') || raw.includes('Failed to fetch') || raw.includes('NetworkError')) {
    return '네트워크 연결을 확인해주세요.\nWiFi나 데이터가 켜져 있는지 살펴주세요.'
  }

  // 세션 만료
  if (raw.includes('JWT expired') || raw.includes('token expired') || raw.includes('session expired')) {
    return '로그인이 만료됐어요.\n다시 로그인해주세요.'
  }

  // Supabase 422 (일반적 회원가입 거부)
  if (status === 422 || raw.includes('422')) {
    if (context === 'signup') {
      return '회원가입에 실패했어요.\n\n자주 보이는 원인:\n· 이미 가입된 아이디\n· 비밀번호가 너무 짧음 (6자 이상)\n· 아이디 형식 오류'
    }
    return '요청이 거부됐어요. 다시 시도해주세요.'
  }

  // 학급 코드 관련
  if (raw.includes('학급 코드') || raw.includes('class code')) {
    return raw // 우리 시스템 메시지는 그대로
  }

  // 권한 없음
  if (status === 403 || raw.includes('not authorized') || raw.includes('Forbidden')) {
    return '권한이 없어요.\n다시 로그인해보세요.'
  }

  // 그 외: 원본 메시지 표시 (개발자가 디버깅할 수 있게)
  return raw || '알 수 없는 오류가 발생했어요. 다시 시도해주세요.'
}

```

## lib/consentPassword.js

```js
// 동의 비밀번호 폴백 규칙 (단일 출처)
// 교사가 동의 비번을 설정했으면 그 값, 비웠으면(빈값/null) 학급코드가 정답이다.
//  ※ ClassSettings(표시·안내문)·parent-consent(제출 검증)·consent-verify-child(확인)가
//    반드시 같은 규칙을 써야 한다 — 안 그러면 "안내문엔 적혀있는데 거부" 사고.
//
// parent-consent.js 의 기존 인라인 규칙과 글자 그대로 동일:
//   (cls.consent_password && trim !== '') ? trim(consent_password)
//                                          : trim(cls.code || normalizedCode || '')
//
// normalizedCode: 호출처에서 이미 정규화한 학급코드(대문자/trim). cls.code 가 비어 있을 때의 폴백.

export function effectiveConsentPassword(cls, normalizedCode) {
  if (!cls) return String(normalizedCode || '').trim()
  return (cls.consent_password && String(cls.consent_password).trim() !== '')
    ? String(cls.consent_password).trim()
    : String(cls.code || normalizedCode || '').trim()
}

```

## lib/consentTrace.js

```js
// 동의 흔적 판정 (서버 전용 · 읽기 전용)
//
// "잠긴 적 없는(pending_names 행이 없는) 학생"이 진짜 '이미 동의'인지 가르는 단일 규칙.
// 닉네임-잠금 도입 이전 등록된 기존 학생은 실명이 평문으로 들어갔고 pending_names가 없어,
// pending_names 유무만으로 판정하면 전부 "이미 동의"로 오판된다(실명 무단 노출).
//
// 규칙: consents 기록이 있거나 profiles.consent_received=true 이면 '동의 흔적 있음'.
//   → 흔적이 있을 때만 alreadyConsented 로 본다.
// parent-consent.js · consent-verify-child.js 가 동일하게 사용(복제 금지).
// ⚠️ 이 함수는 조회만 한다 — 어떤 쓰기도 하지 않는다.

export async function hasConsentTrace(supabaseAdmin, studentId) {
  // 1) consents 이력 존재?
  try {
    const { count } = await supabaseAdmin.from('consents')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId)
    if ((count || 0) > 0) return true
  } catch (e) { /* 무시 — 아래 플래그로 폴백 */ }
  // 2) profiles.consent_received 플래그
  try {
    const { data: prof } = await supabaseAdmin.from('profiles')
      .select('consent_received').eq('id', studentId).maybeSingle()
    return prof?.consent_received === true
  } catch (e) {
    return false
  }
}

```

## lib/displayName.js

```js
// 학생 표시 이름 헬퍼
// realname 있으면 실명 → 없으면 닉네임 → 둘 다 없으면 seed로 만든 고정 닉네임
// (저장 로직과 무관 — 표시 전용)
import { nicknameFromSeed } from './nickname'

export function displayStudentName(s) {
  if (!s) return '학생'
  const real = s.realname && s.realname.trim()
  if (real) return real
  if (s.nickname && s.nickname.trim()) return s.nickname
  return nicknameFromSeed(s.username || s.id)
}

// 번호 접두 합성 (표시 전용) — number 있으면 "12. 곽서곰", 없으면 이름만.
// 이름 우선순위는 displayStudentName 그대로(realname→nickname→시드). 중복 합성 방지용 단일 정의.
export function displayStudentNameWithNumber(s) {
  const name = displayStudentName(s)
  const num = (s && s.number != null && String(s.number).trim() !== '') ? String(s.number).trim() : ''
  return num ? `${num}. ${name}` : name
}

```

## lib/encryptName.js

```js
// 학생 실명 암호화 유틸 (서버 전용 — Node crypto, AES-256-GCM)
// ⚠️ 절대 클라이언트(컴포넌트/페이지)에서 import 금지. API 라우트(서버)에서만 사용.
//    NAME_ENCRYPTION_KEY는 서버 환경변수에만 존재 (NEXT_PUBLIC_ 접두사 절대 금지).
//
// 저장 형식: "ivB64:tagB64:ciphertextB64" (iv 12B, authTag 16B, base64, ':' 구분자)
import crypto from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12   // GCM 권장 nonce 길이
const TAG_LEN = 16  // GCM auth tag 길이

// NAME_ENCRYPTION_KEY: hex 64자 = 32바이트(AES-256). 없거나 형식 오류면 명확한 에러.
function getKey() {
  const hex = process.env.NAME_ENCRYPTION_KEY
  if (!hex) throw new Error('NAME_ENCRYPTION_KEY 환경변수가 없습니다 (서버 전용).')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('NAME_ENCRYPTION_KEY 형식 오류: hex 64자(32바이트)여야 합니다.')
  }
  return Buffer.from(hex, 'hex')
}

// 평문 → "ivB64:tagB64:ctB64"  (키 없음/형식오류 시 throw — 호출처에서 폴백 처리)
export function encryptName(plain) {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(String(plain ?? ''), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

// "ivB64:tagB64:ctB64" → 평문. 실패(키 오류·변조·형식 불일치 등) 시 null 반환 (throw 금지).
export function decryptName(enc) {
  try {
    if (!enc || typeof enc !== 'string') return null
    const [ivB64, tagB64, ctB64] = enc.split(':')
    if (!ivB64 || !tagB64 || !ctB64) return null
    const key = getKey()
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const ct = Buffer.from(ctB64, 'base64')
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return null
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch (e) {
    return null
  }
}

```

## lib/errorLog.js

```js
// ============================================
// 에러 로깅 헬퍼 (클라이언트용) — step155
// ============================================
// logError({ page, errorType, message, context }) 하나로 통일.
//
// 설계 원칙 (반드시 지킬 것):
//  1) 로거 자신은 절대 throw하지 않는다. 실패해도 console.warn까지만.
//  2) 무한 루프 방지: 로거 내부 에러는 로깅하지 않음. 같은 message는 60초 내 1회만 전송.
//  3) 개인정보 금지: 학생 글 본문/토큰/API키/비밀번호를 넣지 말 것. message는 500자로 자름.
//  4) 자동 수집: 세션에서 role/user_id/class_id를 가져와 자동 첨부 (비로그인이면 unknown/null).
// ============================================
import { supabase } from './supabase'

const DEDUPE_WINDOW_MS = 60 * 1000
const recentMessages = new Map() // message → 마지막 전송 시각(ms)

// 프로필(role/class_id) 캐시 — 매 에러마다 DB 조회하지 않도록 user_id별 1회 캐시
let cachedProfile = null // { userId, role, classId }

function isDuplicate(message) {
  const now = Date.now()
  const last = recentMessages.get(message)
  if (last && now - last < DEDUPE_WINDOW_MS) return true
  recentMessages.set(message, now)
  // 맵이 과도하게 커지지 않게 오래된 항목 정리
  if (recentMessages.size > 200) {
    for (const [k, t] of recentMessages) {
      if (now - t > DEDUPE_WINDOW_MS) recentMessages.delete(k)
    }
  }
  return false
}

async function resolveIdentity() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id || null
    if (!userId) return { role: 'unknown', userId: null, classId: null }
    if (cachedProfile && cachedProfile.userId === userId) {
      return { role: cachedProfile.role, userId, classId: cachedProfile.classId }
    }
    const { data: profile } = await supabase.from('profiles')
      .select('role, class_id').eq('id', userId).maybeSingle()
    const role = profile?.role || 'unknown'
    const classId = profile?.class_id || null
    cachedProfile = { userId, role, classId }
    return { role, userId, classId }
  } catch (e) {
    return { role: 'unknown', userId: null, classId: null }
  }
}

export async function logError({ page, errorType, message, context } = {}) {
  try {
    let msg = (message == null ? '' : String(message)).slice(0, 500)
    if (!msg) return
    if (isDuplicate(msg)) return

    const { role, userId, classId } = await resolveIdentity()

    const row = {
      role,
      user_id: userId,
      class_id: classId,
      page: page ? String(page).slice(0, 200) : null,
      error_type: errorType || 'js_error',
      message: msg,
      context: context && typeof context === 'object' ? context : null,
      user_agent: (typeof navigator !== 'undefined' && navigator.userAgent)
        ? navigator.userAgent.slice(0, 300) : null,
    }

    // 비로그인(anon)은 RLS로 INSERT가 막히지만, 실패해도 조용히 무시되므로 안전
    await supabase.from('error_logs').insert(row)
  } catch (e) {
    // 로깅 실패가 앱을 깨뜨리면 본말전도 — 절대 throw하지 않음
    try { console.warn('logError 실패(무시):', e?.message || e) } catch (_) {}
  }
}

```

## lib/feedbackFormat.js

```js
// 📝 AI 피드백 텍스트를 보기 좋게 항목으로 분리
// - "- " 시작 항목 우선
// - 못 찾으면 "키워드: 내용" 패턴
// - 못 찾으면 문장 단위로 분리 (2개 이상이면)

/**
 * 피드백 텍스트를 항목 배열로 분리
 * @param {string} text - AI가 준 피드백 텍스트
 * @returns {string[]} 항목 배열 (1개 이상)
 */
export function splitFeedbackItems(text) {
  if (!text || typeof text !== 'string') return []
  const cleaned = text.trim()
  if (!cleaned) return []

  // 패턴 1: "- " 또는 "* " 시작 항목 (가장 명확)
  const dashMatches = cleaned.match(/(?:^|\n)\s*[-*•]\s+([^\n]+)/g)
  if (dashMatches && dashMatches.length >= 2) {
    return dashMatches
      .map(m => m.replace(/^[\n\s]*[-*•]\s+/, '').trim())
      .filter(s => s.length > 0)
  }

  // 패턴 2: "1. ", "2. " 같은 번호 시작
  const numberMatches = cleaned.match(/(?:^|\n)\s*\d+\.\s+([^\n]+)/g)
  if (numberMatches && numberMatches.length >= 2) {
    return numberMatches
      .map(m => m.replace(/^[\n\s]*\d+\.\s+/, '').trim())
      .filter(s => s.length > 0)
  }

  // 패턴 3: "키워드: 내용" 형태가 두 개 이상 (예: "솔직한 표현: ... 참신한 관점: ...")
  // 한글 단어 + 콜론(:) + 내용 패턴
  const colonMatches = cleaned.match(/([가-힣A-Za-z0-9 ]{2,15}):\s*([^:]+?)(?=\s+[가-힣A-Za-z0-9 ]{2,15}:|$)/g)
  if (colonMatches && colonMatches.length >= 2) {
    return colonMatches
      .map(s => s.trim().replace(/[,.]$/, '').trim())
      .filter(s => s.length > 0)
  }

  // 패턴 4: 줄바꿈으로 분리
  if (cleaned.includes('\n')) {
    const lines = cleaned.split('\n').map(s => s.trim()).filter(s => s.length > 0)
    if (lines.length >= 2) return lines
  }

  // 분리 못 함 → 전체를 한 항목으로
  return [cleaned]
}

```

## lib/gemini.js

````js
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { throttleApiCall } from './apiThrottle'

// 자유 텍스트 호출 (백업용, 거의 안 씀)
export async function callGemini(apiKey, prompt, opts = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 필요해요. 선생님 화면에서 등록해주세요.')

  // 분당 호출 한도 보호
  await throttleApiCall()

  const fallbackModels = opts.model
    ? [opts.model]
    : (opts.chainName && MODEL_CHAINS[opts.chainName])
      ? MODEL_CHAINS[opts.chainName]
      : ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite']

  const genAI = new GoogleGenerativeAI(apiKey)

  let lastError = null
  for (const modelName of fallbackModels) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxTokens ?? 2000,
      }
    })

    const maxRetries = opts.maxRetries ?? 3
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await model.generateContent(prompt)
        return result.response.text()
      } catch(e) {
        lastError = e
        const msg = e.message || ''

        const isDailyQuota = (msg.includes('429') || msg.includes('quota')) &&
          (msg.includes('per day') || msg.includes('PerDay') || msg.includes('PerProjectPerModel'))
        if (isDailyQuota && modelName !== fallbackModels[fallbackModels.length - 1]) {
          console.warn(`📊 ${modelName} 일일 한도 도달 → 다음 모델 시도`)
          break
        }

        const isRetryable = msg.includes('503') || msg.includes('overloaded') ||
          msg.includes('high demand') || msg.includes('rate') ||
          (msg.includes('429') && !isDailyQuota)
        if (isRetryable && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, attempt * 2000))
          continue
        }
        throw e
      }
    }
  }
  throw lastError
}

// 오늘 일일 한도 도달한 모델 기억 (localStorage)
// 다음 호출 시 자동으로 건너뛰어서 폴백 지연 줄임
const QUOTA_HIT_KEY = 'gemini_quota_hit_today'

function getQuotaHitModels() {
  if (typeof window === 'undefined') return new Set()
  try {
    const stored = localStorage.getItem(QUOTA_HIT_KEY)
    if (!stored) return new Set()
    const data = JSON.parse(stored)
    // 오늘 (KST 기준 한국 자정~) 데이터만 유효
    const today = new Date().toISOString().slice(0, 10)
    if (data.date !== today) {
      localStorage.removeItem(QUOTA_HIT_KEY)
      return new Set()
    }
    return new Set(data.models || [])
  } catch(e) { return new Set() }
}

function markQuotaHit(modelName) {
  if (typeof window === 'undefined') return
  try {
    const today = new Date().toISOString().slice(0, 10)
    const current = getQuotaHitModels()
    current.add(modelName)
    localStorage.setItem(QUOTA_HIT_KEY, JSON.stringify({
      date: today,
      models: [...current]
    }))
  } catch(e) {}
}

// 📊 작업 타입별 모델 폴백 체인 (철학: 적재적소 + 일관성 + 가용성)
// - 'grading': 학생 글 채점 - 일관성·한도 안정성 최우선 (~99% 메인 사용)
// - 'creative': 주제 추천 등 창의성·다양성 필요 - 좋은 모델부터 시도
// - 'simple': 평가기준 생성 등 단순/형식적 작업 - 한도 작은 모델로 충분
// - 'quality': 예시 생성 등 일반 품질 작업 - grading과 같은 풀
// ⚠️ Gemma 4는 한국어 응답 시 반복 루프 + 메타 텍스트 출력 문제로 제외
//
// 📌 실측 무료 한도 (와이프 계정 기준):
//    gemini-3.1-flash-lite : 15 RPM / 500 RPD ⭐ (메인 풀)
//    gemini-3-flash-preview    :  5 RPM /  20 RPD  (품질 高)
//    gemini-2.5-flash      :  5 RPM /  20 RPD
//    gemini-2.5-flash-lite : 10 RPM /  20 RPD
export const MODEL_CHAINS = {
  // 🎯 채점: 메인 모델 우선 사용으로 일관성 확보
  // 한도 도달 시에만 폴백하여 채점 자체는 멈추지 않게 (가용성 보장)
  // 폴백된 글은 is_fallback_graded=true로 표시되어 나중에 재평가 가능
  grading: [
    'gemini-3.1-flash-lite',     // 500 RPD ⭐ (메인 - 평소엔 이것만 사용)
    'gemini-3-flash-preview',            // 20 RPD (비상 백업 1, 품질 高)
    'gemini-2.5-flash',          // 20 RPD (비상 백업 2)
    'gemini-2.5-flash-lite'      // 20 RPD (마지막 보루)
  ],
  // 🎨 창의 작업 (주제 추천 등): 좋은 모델부터 시도
  // → 주제는 빈도 적어서 (학급당 며칠에 한 번) 20 RPD로도 충분
  // → 한도 차면 채점용 풀(3.1-flash-lite)로 폴백
  creative: [
    'gemini-3-flash-preview',            // 20 RPD (품질 高, 1순위)
    'gemini-2.5-flash',          // 20 RPD (품질 高, 2순위)
    'gemini-3.1-flash-lite',     // 500 RPD (안전망 - 채점 풀이지만 폴백 보장)
    'gemini-2.5-flash-lite'      // 20 RPD (마지막 보루)
  ],
  // 예시 생성 등 일반 품질: grading과 같은 풀 공유 (단 폴백은 더 자유)
  quality: [
    'gemini-3.1-flash-lite',     // 500 RPD ⭐ (메인)
    'gemini-3-flash-preview',            // 20 RPD
    'gemini-2.5-flash',          // 20 RPD
    'gemini-2.5-flash-lite'      // 20 RPD
  ],
  // 단순 작업 (예: 평가기준 형식 보정): 가벼운 모델로 충분
  // → 한도 작은 flash-lite 먼저 소진 (어차피 적게 씀)
  // → 한도 큰 3.1-flash-lite는 채점용으로 보존
  simple: [
    'gemini-2.5-flash-lite',     // 20 RPD (단순 작업 충분)
    'gemini-2.5-flash',          // 20 RPD
    'gemini-3-flash-preview',            // 20 RPD
    'gemini-3.1-flash-lite'      // 500 RPD (채점용 보존, 마지막)
  ],
  // 🔤 맞춤법 전용: 채점 메인(3.1-flash-lite)과 다른 모델을 1순위로 두어
  //    제출당 채점+맞춤법 2회 호출이 채점 500 RPD 풀을 같이 까먹지 않게 함.
  //    별도 quota(20 RPD) 모델 우선 소진 후, 그래도 막히면 채점 풀로 안전망 폴백.
  grammar: [
    'gemini-2.5-flash',          // 20 RPD (채점 메인과 다른 모델, 품질 양호)
    'gemini-3-flash-preview',            // 20 RPD
    'gemini-3.1-flash-lite',     // 500 RPD (안전망 - 위가 다 막힐 때만)
    'gemini-2.5-flash-lite'      // 20 RPD (마지막 보루)
  ],
  // 기본 (옛 동작 호환)
  default: [
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-3-flash-preview'
  ]
}

// ★ Structured Output - 정해진 양식 강제 (JSON 깨질 일 없음)
export async function callGeminiStructured(apiKey, prompt, schema, opts = {}) {
  if (!apiKey) throw new Error('Gemini API 키가 필요해요. 선생님 화면에서 등록해주세요.')

  // 분당 호출 한도 보호
  await throttleApiCall()

  // 작업 타입별 폴백 체인 (opts.taskType: 'grading' | 'creative' | 'quality' | 'simple' | 'default')
  const chainName = opts.taskType || 'default'
  const allModels = opts.model
    ? [opts.model]
    : (MODEL_CHAINS[chainName] || MODEL_CHAINS.default)

  // 오늘 이미 한도 도달한 모델은 건너뛰기 (시간 절약)
  const hitModels = getQuotaHitModels()
  const fallbackModels = allModels.filter(m => !hitModels.has(m))
  // 모두 한도 도달했다면 마지막 모델로 한 번 더 시도 (혹시 리셋됐을 수도)
  if (fallbackModels.length === 0) fallbackModels.push(allModels[allModels.length - 1])

  const genAI = new GoogleGenerativeAI(apiKey)

  // 진행 상황 콜백 (학생 화면에 "잠시 기다리는 중..." 표시용)
  const onProgress = opts.onProgress || (() => {})

  let lastError = null
  for (const modelName of fallbackModels) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxTokens ?? 8000,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    })

    const maxRetries = opts.maxRetries ?? 4 // 3 → 4로 늘림
    const timeoutMs = opts.timeoutMs ?? 60000 // 60초 타임아웃
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 모델명은 외부에 노출하지 않음 (IP 보호) — 로그/화면 모두 'AI'로 표기
        if (process.env.NODE_ENV !== 'production') console.log(`🤖 AI 호출 시작 (시도 ${attempt}/${maxRetries})`)
        onProgress({ type: 'calling', attempt, message: `AI가 채점 중...` })

        // 🆕 타임아웃 적용 (응답 없이 영원히 매달리는 것 방지)
        const callPromise = model.generateContent(prompt)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`TIMEOUT: AI 응답 ${timeoutMs/1000}초 초과`)), timeoutMs)
        )
        const result = await Promise.race([callPromise, timeoutPromise])
        const finishReason = result?.response?.candidates?.[0]?.finishReason
        const text = result.response.text()
        if (process.env.NODE_ENV !== 'production') console.log(`✅ AI 응답 성공`)
        // 🆕 step260: 응답 잘림(MAX_TOKENS) 감지 — 마지막 모델이 아니면 다음 모델로 폴백
        // (잘린 결과를 성공으로 반환하면 주제 설명 등이 "...(끊김)"으로 노출됨)
        if (finishReason === 'MAX_TOKENS' && modelName !== fallbackModels[fallbackModels.length - 1]) {
          if (process.env.NODE_ENV !== 'production') console.warn('✂️ AI 응답 잘림(MAX_TOKENS) → 다음 모델로 전환')
          onProgress({ type: 'fallback', message: '응답이 잘려서 다른 AI 모델로 다시 시도 중...' })
          lastError = new Error('MAX_TOKENS: 응답 잘림')
          break // 다음 모델로 (inner attempt 루프 탈출 → 다음 modelName)
        }
        try {
          const parsed = JSON.parse(text)
          // 🆕 어떤 모델로 응답했는지 정보 추가 (호출자가 폴백 여부 판단 가능)
          if (parsed && typeof parsed === 'object') parsed.__usedModel = modelName
          return parsed
        } catch(parseErr) {
          if (process.env.NODE_ENV !== 'production') console.error('Structured Output 응답 파싱 실패, 백업 시도:', parseErr.message)
          const parsed = parseAIJson(text)
          if (parsed && typeof parsed === 'object') parsed.__usedModel = modelName
          return parsed
        }
      } catch(e) {
        lastError = e
        const msg = e.message || ''

        // 🆕 타임아웃 시 즉시 다음 모델로 (재시도 무의미)
        if (msg.includes('TIMEOUT:')) {
          if (process.env.NODE_ENV !== 'production') console.warn(`⏱️ AI 타임아웃 → 다음 모델로 전환`)
          onProgress({ type: 'timeout', message: `AI 응답이 너무 느려서 다시 시도합니다...` })
          if (modelName !== fallbackModels[fallbackModels.length - 1]) {
            break // 다음 모델로
          } else {
            throw new Error('AI가 응답하지 않습니다. 잠시 후 다시 시도해주세요.')
          }
        }

        // 🆕 모델이 존재하지 않음 (404) → 즉시 폴백 + 영구 기억
        const isModelNotFound = msg.includes('404') &&
          (msg.includes('not found') || msg.includes('is not supported'))
        if (isModelNotFound) {
          if (process.env.NODE_ENV !== 'production') console.warn(`❌ AI 모델 사용 불가 → 다음 모델 시도`)
          markQuotaHit(modelName) // 오늘은 다시 시도 안 함 (사실상 영구 제외)
          if (modelName !== fallbackModels[fallbackModels.length - 1]) {
            break // 다음 모델로
          } else {
            throw e
          }
        }

        // 일일 한도 도달 → 다른 모델로 즉시 폴백 + 기억
        const isDailyQuota = (msg.includes('429') || msg.includes('quota')) &&
          (msg.includes('per day') || msg.includes('PerDay') || msg.includes('PerProjectPerModel'))
        if (isDailyQuota) {
          markQuotaHit(modelName) // 오늘 다시 시도 안 함
          if (modelName !== fallbackModels[fallbackModels.length - 1]) {
            console.warn(`📊 ${modelName} 일일 한도 도달 → 다음 모델 시도`)
            onProgress({ type: 'fallback', message: '다른 AI 모델로 전환 중...' })
            break // 다음 모델로
          } else {
            // 마지막 모델도 일일 한도 도달 → 재시도 무의미, 바로 에러
            console.warn(`📊 ${modelName} (마지막 모델) 일일 한도 도달 - 재시도 중단`)
            throw e
          }
        }

        // 분당 한도 또는 일시적 오류 → 백오프 재시도
        const isRetryable = msg.includes('503') || msg.includes('overloaded') ||
          msg.includes('high demand') || msg.includes('rate') ||
          (msg.includes('429') && !isDailyQuota)
        if (isRetryable && attempt < maxRetries) {
          // Gemini의 retryDelay 정보 추출 시도 (예: "retryDelay":"28s")
          let waitSec = attempt * 3 // 기본: 3, 6, 9, 12초 (점진적)
          const retryMatch = msg.match(/retryDelay["\s:]+(\d+)s/i)
          if (retryMatch) {
            waitSec = Math.min(parseInt(retryMatch[1]) + 1, 30) // 최대 30초
          }
          console.log(`⏳ Gemini 호출 실패 (${attempt}/${maxRetries}), ${waitSec}초 후 재시도...`)
          onProgress({
            type: 'retry',
            attempt,
            waitSec,
            message: `잠시만요... AI가 다른 친구들 글을 처리 중이에요. ${waitSec}초 후 자동 재시도할게요.`
          })
          await new Promise(r => setTimeout(r, waitSec * 1000))
          continue
        }
        throw e
      }
    }
  }
  throw lastError
}

// 미리 정의된 스키마들
export const SCHEMAS = {
  // 담임 코멘트 추천
  commentSuggest: {
    type: SchemaType.OBJECT,
    properties: {
      comments: {
        type: SchemaType.ARRAY,
        description: '교사 말투를 따른 코멘트 초안 2개, 각 1-3문장',
        items: { type: SchemaType.STRING }
      }
    },
    required: ['comments']
  },

  // 생기부/평어 자동 생성
  schoolRecord: {
    type: SchemaType.OBJECT,
    properties: {
      sentences: {
        type: SchemaType.ARRAY,
        description: '독립적으로 쓸 수 있는 한 문장 평어 후보, 각 60-80자, 구체적 근거 포함, 명사형 종결',
        items: { type: SchemaType.STRING }
      },
      strengths: { type: SchemaType.STRING, description: '글쓰기에서 드러난 강점 요약, 1-2문장' },
      growth: { type: SchemaType.STRING, description: '한 학기 동안의 성장/변화, 1-2문장' }
    },
    required: ['sentences']
  },

  topicSuggestion: {
    type: SchemaType.OBJECT,
    properties: {
      title: { type: SchemaType.STRING, description: '주제 제목 10-15자' },
      description: { type: SchemaType.STRING, description: '학생용 설명, 70-100자' }
    },
    required: ['title', 'description']
  },

  // 여러 주제 한 번에 생성 (기간 일괄 등록용)
  topicBatch: {
    type: SchemaType.OBJECT,
    properties: {
      topics: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING, description: '주제 제목 10-15자' },
            description: { type: SchemaType.STRING, description: '학생용 설명, 70-100자' },
            category: { type: SchemaType.STRING, description: '카테고리명' }
          },
          required: ['title', 'description']
        }
      }
    },
    required: ['topics']
  },

  rubricSet: {
    type: SchemaType.OBJECT,
    properties: {
      rubrics: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: '기준 이름 4-10자' },
            hint: { type: SchemaType.STRING, description: '주제에 맞는 구체적 안내 (예: 주인공의 삶, 주인공의 모습 등)' },
            score: { type: SchemaType.INTEGER, description: '배점 (10~40 사이, 합계 100)' }
          },
          required: ['name', 'hint', 'score']
        }
      }
    },
    required: ['rubrics']
  },

  essayFeedback: {
    type: SchemaType.OBJECT,
    properties: {
      scores: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.INTEGER }
      },
      // 평가기준별 점수 근거 (학생이 납득하려면 80-150자 충실하게)
      rubric_reasons: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING, description: '이 점수를 준 구체적 이유. 만점이 아니라면 어디가 부족했는지, 학생 글의 어느 부분 때문인지 짚어주기. 80-150자.' }
      },
      total: { type: SchemaType.INTEGER },
      overall: { type: SchemaType.STRING, description: '종합 의견 4-6문장. 학생 글의 구체적 부분을 인용해서 칭찬·격려. 5학년이 알아듣는 쉬운 말로.' },
      good: { type: SchemaType.STRING, description: '잘한 점 2가지. 각 80-120자. 학생 글의 어느 부분이 좋았는지 직접 인용해서 짚어주기.' },
      improve: { type: SchemaType.STRING, description: '발전시킬 점 2가지. 각 100-150자. 학생 글의 어느 부분이 아쉬운지 + 어떻게 고치면 좋을지 구체적으로.' },
      // 🆕 발전점 구체 예시 (학생 글의 일부를 어떻게 바꾸면 좋을지)
      improve_examples: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            original: { type: SchemaType.STRING, description: '학생 글의 일부분 (있는 그대로)' },
            suggested: { type: SchemaType.STRING, description: '이렇게 바꿔보면 어떨까 하는 예시' },
            reason: { type: SchemaType.STRING, description: '왜 이렇게 바꾸면 좋은지 30-60자' }
          },
          required: ['original', 'suggested', 'reason']
        }
      },
      corrections: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            original: { type: SchemaType.STRING, description: '학생 글에 정확히 등장하는 틀린 부분 (한 글자도 다르면 안 됨)' },
            correction: { type: SchemaType.STRING, description: '올바른 표기' },
            reason: { type: SchemaType.STRING, description: '왜 틀렸는지 5학년이 알아듣게' }
          },
          required: ['original', 'correction', 'reason']
        }
      }
    },
    required: ['scores', 'rubric_reasons', 'total', 'overall', 'good', 'improve', 'improve_examples', 'corrections']
  },

  exampleEssay: {
    type: SchemaType.OBJECT,
    properties: {
      example: { type: SchemaType.STRING, description: '5학년 수준 예시 작품 350-500자' }
    },
    required: ['example']
  },

  // 맞춤법 검사 전용 (점수/의견 없이 corrections만)
  grammarOnly: {
    type: SchemaType.OBJECT,
    properties: {
      corrections: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            original: { type: SchemaType.STRING, description: '학생 글에서 정확히 등장하는 틀린 부분' },
            correction: { type: SchemaType.STRING, description: '올바른 표기' },
            reason: { type: SchemaType.STRING, description: '맞춤법, 띄어쓰기 등' }
          },
          required: ['original', 'correction', 'reason']
        }
      }
    },
    required: ['corrections']
  },

  // admin 의견 분석 요약
  feedbackSummary: {
    type: SchemaType.OBJECT,
    properties: {
      categories: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING },
            items: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
          },
          required: ['name', 'items']
        }
      },
      priorityList: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      summary: { type: SchemaType.STRING }
    },
    required: ['categories', 'priorityList', 'summary']
  }
}

// API 오류 메시지를 사용자 친화적으로 변환
export function getFriendlyErrorMessage(error) {
  const msg = error?.message || String(error) || ''

  // 유료(선불) 잔액 소진 — 429를 포함하므로 일일/분당 한도 분기보다 먼저 처리
  if (msg.includes('prepayment') || msg.includes('credits are depleted') || msg.includes('billing#prepay')) {
    return (
      '💳 이 키는 \'유료(선불)\' 설정이고 잔액이 모두 소진됐어요.\n\n' +
      '이 앱은 무료 키만으로 충분히 운영돼요!\n' +
      '✅ AI Studio에서 결제 안 걸린 \'무료\' 개인 Gmail 키를 새로 발급해 등록해 주세요.\n\n' +
      '📝 지금까지 쓴 글은 자동 저장돼 있어요!'
    )
  }

  // 한도 초과 (429) - 일일 한도 vs 분당 한도 구분
  if (msg.includes('429') || msg.includes('quota') || msg.includes('exceeded')) {
    // 일일 한도 도달 (가장 흔하고 심각한 케이스)
    if (msg.includes('per day') || msg.includes('PerDay') || msg.includes('daily') ||
        msg.includes('GenerateRequestsPerDayPerProjectPerModel')) {
      return (
        '⏰ 오늘 AI 사용 한도가 모두 사용되었어요\n\n' +
        '📌 한국 시간 오후 4-5시 이후에 자동으로 다시 사용 가능해요.\n' +
        '   (Google의 한도는 미국 태평양 시간 자정에 리셋돼요)\n\n' +
        '💡 빠른 해결 방법:\n' +
        '   1. 선생님께 다른 API 키로 교체 요청\n' +
        '   2. 또는 자정 이후 다시 시도\n\n' +
        '📝 걱정 마세요! 지금까지 쓴 글은 자동 저장되어 있어요.\n' +
        '   다시 들어오면 그대로 이어쓸 수 있어요.'
      )
    }
    // 분당 한도 (일시적, 1분 기다리면 풀림)
    return (
      '⏳ 잠깐 사용량이 너무 많아요!\n\n' +
      '동시에 너무 많은 친구들이 글을 제출하고 있어요.\n' +
      '약 1분 후에 다시 시도해주세요.\n\n' +
      '📝 지금까지 쓴 글은 자동 저장되니 걱정 마세요!'
    )
  }

  // 권한/차단 (403)
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('denied access')) {
    return '🚫 API 키 사용이 거부되었습니다.\n\n원인:\n• 학교/회사 Google 계정으로 발급한 경우 차단될 수 있어요\n• Google이 의심스러운 사용 패턴을 감지한 경우\n\n해결: 개인 Gmail 계정으로 새 API 키를 발급해주세요.'
  }

  // 잘못된 키 (400)
  if (msg.includes('400') || msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
    return '🔑 API 키가 올바르지 않습니다.\n\nAI Studio (aistudio.google.com/apikey)에서 새 키를 발급받아 등록해주세요.'
  }

  // 서버 과부하 (503)
  if (msg.includes('503') || msg.includes('overloaded') || msg.includes('high demand') || msg.includes('UNAVAILABLE')) {
    return '⏳ Gemini 서버가 지금 매우 바빠요!\n잠시 후 (30초~1분) 다시 시도해주세요.\n\n📝 지금까지 쓴 글은 자동 저장되어 있어요!'
  }

  // 로그인 세션 만료 (학생 채점 등 — 서버가 토큰을 거부한 경우)
  // ※ 'API 키' 인증 실패(아래 401)와 구분: 학생용 친절 안내 + 새로고침 유도
  if (msg.includes('인증 정보가 유효하지 않아요') || msg.includes('다시 로그인')) {
    return '로그인 시간이 만료됐어요. 아래 새로고침 버튼을 누르면 다시 쓸 수 있어요. 쓰던 글은 저장돼 있으니 걱정 마세요!'
  }

  // 인증 (401)
  if (msg.includes('401') || msg.includes('UNAUTHENTICATED')) {
    return '🔐 API 키 인증에 실패했습니다.\n선생님께 API 키 재등록을 요청해주세요.'
  }

  // 네트워크 오류
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network')) {
    return '🌐 네트워크 연결을 확인해주세요.\n\n📝 지금까지 쓴 글은 자동 저장되어 있어요!'
  }

  // JSON 파싱
  if (msg.includes('JSON') || msg.includes('파싱')) {
    return '🔄 AI 응답이 깨졌어요. 다시 한 번 시도해주세요.'
  }

  // 기타
  return 'AI 호출 중 오류가 발생했습니다: ' + msg
}

// 백업 파싱 (극단적 경우용)
export function parseAIJson(text) {
  console.log('===== AI 응답 원문 (백업 파싱) =====')
  console.log(text)
  console.log('========================')

  let cleaned = text.replace(/```json|```/g, '').trim()
  const firstBrace = cleaned.indexOf('{')
  let lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  } else if (firstBrace !== -1) {
    cleaned = cleaned.slice(firstBrace) + '}'
  }

  try { return JSON.parse(cleaned) } catch(e) {}

  let v2 = cleaned.replace(/"corrections"\s*:\s*\[[\s\S]*?\]\s*([,}])/, '"corrections":[]$1')
  try { return JSON.parse(v2) } catch(e) {}

  let v3 = cleaned.replace(/("(?:[^"\\]|\\.)*")/g, function(match) {
    return match.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t')
  })
  try { return JSON.parse(v3) } catch(e) {}

  // 🆕 잘린 문자열 복구 시도: 문자열이 닫히지 않은 채 끝났을 때
  // "example":"내용...중간에 끊김  → "example":"내용...중간에 끊김"}
  try {
    let v4 = cleaned
    // 따옴표 짝수 카운트로 마지막이 열린 상태인지 검사
    let inString = false
    let escape = false
    for (let i = 0; i < v4.length; i++) {
      const c = v4[i]
      if (escape) { escape = false; continue }
      if (c === '\\') { escape = true; continue }
      if (c === '"') inString = !inString
    }
    if (inString) {
      // 문자열이 열린 채 끝났음 → 닫고 마무리
      v4 = v4 + '"'
    }
    // 마지막 콤마/콜론 등 trailing 정리
    v4 = v4.replace(/,\s*$/, '').replace(/:\s*$/, ':""')
    // 닫는 중괄호 부족하면 추가
    const openCount = (v4.match(/\{/g) || []).length
    const closeCount = (v4.match(/\}/g) || []).length
    if (openCount > closeCount) {
      v4 = v4 + '}'.repeat(openCount - closeCount)
    }
    const openBracket = (v4.match(/\[/g) || []).length
    const closeBracket = (v4.match(/\]/g) || []).length
    if (openBracket > closeBracket) {
      // 배열이 열린 채 끝남 - 닫기 위치를 찾기 어려우니 일단 마지막 } 전에 ]
      v4 = v4.replace(/\}*$/, ']'.repeat(openBracket - closeBracket) + '$&')
    }
    return JSON.parse(v4)
  } catch(e) {}

  const result = { corrections: [] }
  const fields = ['title', 'description', 'overall', 'good', 'improve', 'example']
  for (const f of fields) {
    // 정상 종료된 필드
    const re = new RegExp('"' + f + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 's')
    const m = cleaned.match(re)
    if (m) {
      result[f] = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
    } else {
      // 잘린 필드 (마지막에 닫는 따옴표 없음)
      const reTruncated = new RegExp('"' + f + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)$', 's')
      const mT = cleaned.match(reTruncated)
      if (mT && mT[1].length > 20) { // 최소 20자 이상이어야 의미 있음
        result[f] = mT[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') + '...(끊김)'
      }
    }
  }
  const totalM = cleaned.match(/"total"\s*:\s*(\d+)/)
  if (totalM) result.total = parseInt(totalM[1])
  const scoresM = cleaned.match(/"scores"\s*:\s*\[([^\]]+)\]/)
  if (scoresM) result.scores = scoresM[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
  if (Object.keys(result).length > 1) return result
  throw new Error('JSON 파싱 실패')
}

// 키 서버격리(step153~): API 키는 더 이상 클라이언트 localStorage에 저장하지 않는다.
// 과거 버전이 남긴 'gemini_api_key'를 1회성으로 제거 (앱 로드 시 _app.js에서 호출).
export function purgeLegacyApiKey() {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem('gemini_api_key') } catch (e) {}
}

````

## lib/impersonation.js

```js
// ============================================
// 관리자 임퍼소네이션 헬퍼
// ============================================
// 와이프 피드백 5번: 관리자가 담임 선생님 화면을 그대로 볼 수 있어야 함
// 핵심 제약: "담임 모르게" — 어떤 DB 흔적도 남기지 않는 읽기 전용
//
// URL 사용법: /teacher?as=<teacher_uuid>
// - admin 권한 있는 사용자만 ?as= 통과
// - 임퍼소네이션 중에는 모든 쓰기 작업 차단 (assertWritable)
// ============================================
import { supabase } from './supabase'

/**
 * 현재 어떤 profile로 동작 중인지 판단해서 반환.
 * - URL에 ?as=<id>가 있고, 로그인 사용자가 admin이면 → 그 teacher profile 반환
 * - 그 외에는 본인 profile 반환
 *
 * @param {string} profileSelect - profiles에서 select할 컬럼 (필요시 classes join 등)
 * @returns {{ profile, isImpersonating, realAdminId }}
 */
export async function getEffectiveProfile(profileSelect = '*, classes:class_id(*)') {
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return { profile: null, isImpersonating: false, realAdminId: null }

  // 본인 profile 먼저
  const { data: ownProfile } = await supabase.from('profiles')
    .select(profileSelect).eq('id', authUser.id).maybeSingle()
  if (!ownProfile) return { profile: null, isImpersonating: false, realAdminId: null }

  // 🆕 삭제된 계정은 로그인 차단 (B4)
  if (ownProfile.deleted_at) {
    if (typeof window !== 'undefined') {
      // signOut 완료를 기다리고 강제로 홈 페이지로 (router 사용 안 함 - 깨끗하게 시작)
      try { await supabase.auth.signOut() } catch(e) {}
      alert('이 계정은 관리자에 의해 삭제되었어요.\n관리자에게 문의해주세요.')
      window.location.href = '/'
    }
    return { profile: null, isImpersonating: false, realAdminId: null, deleted: true }
  }

  // URL 파라미터 확인 (브라우저에서만 동작; SSR이면 window 없음)
  if (typeof window === 'undefined') {
    return { profile: ownProfile, isImpersonating: false, realAdminId: null }
  }
  const params = new URLSearchParams(window.location.search)
  const asTeacherId = params.get('as')
  if (!asTeacherId) {
    return { profile: ownProfile, isImpersonating: false, realAdminId: null }
  }

  // ?as=가 있으면 admin 권한 확인
  if (ownProfile.role !== 'admin') {
    // 권한 없는 사람은 ?as= 무시 (보안)
    console.warn('[impersonation] non-admin tried to use ?as=, ignored')
    return { profile: ownProfile, isImpersonating: false, realAdminId: null }
  }

  // 자기 자신을 ?as=한 경우는 그냥 평소 동작
  if (asTeacherId === ownProfile.id) {
    return { profile: ownProfile, isImpersonating: false, realAdminId: ownProfile.id }
  }

  // 대상 선생님 profile 로드
  const { data: targetProfile } = await supabase.from('profiles')
    .select(profileSelect).eq('id', asTeacherId).maybeSingle()
  if (!targetProfile) {
    alert('해당 선생님 정보를 찾을 수 없어요')
    return { profile: ownProfile, isImpersonating: false, realAdminId: ownProfile.id }
  }
  if (targetProfile.role !== 'teacher' && targetProfile.role !== 'admin') {
    alert('선생님만 엿볼 수 있어요')
    return { profile: ownProfile, isImpersonating: false, realAdminId: ownProfile.id }
  }

  return {
    profile: targetProfile,
    isImpersonating: true,
    realAdminId: ownProfile.id
  }
}

/**
 * 임퍼소네이션 중이면 쓰기 작업 차단.
 * 모든 update/insert/delete 호출 직전에 호출하세요.
 * @returns {boolean} true면 안전 (계속 진행), false면 차단됨
 */
export function assertWritable() {
  if (typeof window === 'undefined') return true
  const params = new URLSearchParams(window.location.search)
  if (params.has('as')) {
    alert('🔴 엿보기 모드에서는 어떤 변경도 할 수 없어요.\n관리자 페이지로 돌아가서 작업하세요.')
    return false
  }
  return true
}

/**
 * 현재 URL에 ?as= 있는지 확인 (페이지 렌더링용)
 */
export function isImpersonatingNow() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('as')
}

/**
 * 임퍼소네이션 중이면 URL에 ?as= 파라미터를 붙여줌.
 * 교사 페이지 간 내부 링크에서 사용하세요.
 *
 * @example
 *   <Link href={withImpersonation('/teacher/students')}>학생 관리</Link>
 */
export function withImpersonation(href) {
  if (typeof window === 'undefined') return href
  const params = new URLSearchParams(window.location.search)
  const asParam = params.get('as')
  if (!asParam) return href
  // href에 이미 쿼리가 있는지에 따라 ? or & 결정
  const sep = href.includes('?') ? '&' : '?'
  return `${href}${sep}as=${asParam}`
}

```

## lib/koreanRules.js

```js
// 규칙 기반 한국어 맞춤법/띄어쓰기 보강
// AI(Gemini)가 자주 놓치는 패턴들을 정규식으로 직접 잡아냄
// 학생 글 채점 후 AI 결과에 누락된 항목을 추가하는 후처리용

/**
 * 텍스트에서 규칙 기반으로 잡을 수 있는 오류 찾기
 * @param {string} text - 학생이 쓴 글
 * @returns {Array} - [{ original, correction, reason }] 형식의 추가 corrections
 */
export function findRuleBasedErrors(text) {
  if (!text || typeof text !== 'string') return []
  const errors = []

  // ─────────────────────────────────────────────
  // 1. 온점 뒤 띄어쓰기 누락: "왔다.그래서" → "왔다. 그래서"
  // ─────────────────────────────────────────────
  // 마침표/물음표/느낌표 뒤에 한글이 바로 붙는 경우
  // 단, 숫자 뒤의 점(예: 3.14, 1.2.3)은 제외
  {
    const pattern = /([^\d\s])([.!?])([가-힣])/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      // 맥락 추출 (앞뒤 2글자 정도)
      const start = Math.max(0, match.index - 1)
      const end = Math.min(text.length, match.index + match[0].length + 1)
      const segment = text.slice(match.index, match.index + match[0].length)
      // original: "왔다.그래서" 같은 한 덩어리
      const punct = match[2]
      const fixed = `${match[1]}${punct} ${match[3]}`
      errors.push({
        original: segment,
        correction: fixed,
        reason: `문장 부호(${punct}) 뒤에는 한 칸 띄어쓰기가 필요해요`
      })
    }
  }

  // ─────────────────────────────────────────────
  // 2. 쉼표 뒤 띄어쓰기 누락: "예를들면,그것은" → ", 그것은"
  // ─────────────────────────────────────────────
  {
    const pattern = /([가-힣]),([가-힣])/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      const segment = text.slice(match.index, match.index + match[0].length)
      const fixed = `${match[1]}, ${match[2]}`
      errors.push({
        original: segment,
        correction: fixed,
        reason: '쉼표(,) 뒤에는 한 칸 띄어쓰기가 필요해요'
      })
    }
  }

  // ─────────────────────────────────────────────
  // 3. 자주 틀리는 띄어쓰기 (제한적으로)
  // ─────────────────────────────────────────────
  // "할수있다" → "할 수 있다" 같은 패턴
  // ※ 과교정 위험이 있어 가장 확실한 것만
  const fixedPatterns = [
    // "할수있다" → "할 수 있다"
    {
      regex: /([가-힣])수있/g,
      check: (m) => ((m.charCodeAt(0) - 0xAC00) % 28) === 8,
      build: (m) => m.replace('수있', ' 수 있'),
      reason: '"할 수 있다"는 띄어 써요'
    },
    // "할수없다" → "할 수 없다"
    {
      regex: /([가-힣])수없/g,
      check: (m) => ((m.charCodeAt(0) - 0xAC00) % 28) === 8,
      build: (m) => m.replace('수없', ' 수 없'),
      reason: '"할 수 없다"는 띄어 써요'
    },
    // "첫번째" → "첫 번째" (의존명사 '번째'는 앞 수관형사와 띄어 씀)
    // 한정 접두사 + "번째"가 공백 없이 붙은 경우만 (긴 접두사 먼저 — 부분매칭 방지)
    {
      regex: /(다섯|여섯|일곱|여덟|아홉|여러|첫|두|세|네|열|몇|한)번째/g,
      build: (m) => m.replace('번째', ' 번째'),
      reason: '순서를 나타내는 "번째"는 앞말과 띄어 써요'
    },
    // "20일 입니다" → "20일입니다" ('입니다/습니다'는 앞말에 붙여 씀)
    {
      regex: /([가-힣0-9])\s+(입니다|입니까|습니다|습니까)/g,
      build: (m) => m.replace(/\s+/, ''),
      reason: '"입니다/습니다"는 앞말에 붙여 써요'
    },
  ]

  for (const fp of fixedPatterns) {
    let match
    const re = new RegExp(fp.regex.source, fp.regex.flags)
    while ((match = re.exec(text)) !== null) {
      const before = text.slice(Math.max(0, match.index - 1), match.index)
      if (fp.check && !fp.check(match[0], before)) continue
      const fixed = fp.build(match[0])
      if (fixed === match[0]) continue
      errors.push({
        original: match[0],
        correction: fixed,
        reason: fp.reason
      })
    }
  }

  // ─────────────────────────────────────────────
  // 4. 5학년 단골 실수: 안 / 않 구분
  // ─────────────────────────────────────────────
  // "않" + 받침/한글 그대로 (즉 "않좋다", "않된다", "않갔다" 등) → "안 좋다"
  // ※ "않다", "않은", "않을", "않고", "않으니" 등 "않" 자체가 동사 활용인 경우는 정상이므로 제외
  {
    // "않" 다음에 자음+모음+받침으로 시작하는 한글이 오면서, "않" 뒤가 '다/은/을/고/으/지/네/았/었/도/만'가 아닌 경우만
    const pattern = /않([가-힣])/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      const next = match[1]
      // "않다", "않았", "않은", "않을", "않으", "않고", "않지", "않네", "않도록", "않만" 등은 정상 활용
      if (/[다았었은을으고지네도만는][가-힣]?/.test(next + (text[match.index + 2] || ''))) continue
      if (['다','은','을','으','고','지','네','도','만','았','었','니','며','자','거','구','는'].includes(next)) continue
      // 외에 "않좋다", "않된다", "않갔다" 등은 "안 + ..." 의미일 가능성 매우 높음
      const segment = match[0] // "않좋", "않된" 등
      errors.push({
        original: segment,
        correction: '안 ' + next,
        reason: '부정의 "안"은 띄어 써요 ("않"은 "그렇지 않다" 같은 동사 활용에만)'
      })
    }
  }

  // ─────────────────────────────────────────────
  // 5. 5학년 단골 실수: 되/돼 구분 (확실한 것만)
  // ─────────────────────────────────────────────
  // "안되" + 받침없는 종결어미 → "안 돼" (예: "안되요" → "안 돼요")
  // "되요" → "돼요"
  {
    // "되요" → "돼요" (확실한 오류)
    const pattern = /되요/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      errors.push({
        original: '되요',
        correction: '돼요',
        reason: '"돼요"가 맞아요 ("되어요"의 줄임말)'
      })
      break // 첫 번째만 (중복 방지, 같은 글에서 더 있으면 모두 표시되므로 break)
    }
  }
  {
    // "되" 바로 뒤에 문장 끝 (마침표/물음표/느낌표/줄바꿈/문장 끝) → "돼"
    const pattern = /([가-힣])되([.!?\n]|$)/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      // 앞 글자가 '하/되/이' 같이 "되다" 동사 어간을 만드는 경우는 제외
      // 단순히 "안되." 같은 경우만 잡기 위해 앞이 "안", "잘", "못" 등 부사일 때만
      const prev = match[1]
      if (!['안','잘','못','다'].includes(prev)) continue
      errors.push({
        original: prev + '되' + match[2],
        correction: prev + ' 돼' + match[2],
        reason: '문장 끝에서는 "돼"가 맞아요 ("되어"의 줄임말)'
      })
    }
  }

  // ─────────────────────────────────────────────
  // 6. 5학년 단골 실수: 종결어미 "~게요" / "~께요"
  // ─────────────────────────────────────────────
  // "할께요" → "할게요" (의지 표현은 'ㄹ게')
  {
    const pattern = /([가-힣])ㄹ?께요/g
    let match
    const targets = [
      { wrong: '할께요', right: '할게요' },
      { wrong: '갈께요', right: '갈게요' },
      { wrong: '볼께요', right: '볼게요' },
      { wrong: '올께요', right: '올게요' },
      { wrong: '쓸께요', right: '쓸게요' },
      { wrong: '먹을께요', right: '먹을게요' },
      { wrong: '읽을께요', right: '읽을게요' }
    ]
    for (const t of targets) {
      if (text.includes(t.wrong)) {
        errors.push({
          original: t.wrong,
          correction: t.right,
          reason: '의지를 나타낼 때는 "~게요"가 맞아요 ("ㄹ께요"는 틀린 표현)'
        })
      }
    }
  }

  // ─────────────────────────────────────────────
  // 7. 5학년 단골 실수: "왠지" vs "웬지"
  // ─────────────────────────────────────────────
  {
    if (text.includes('웬지')) {
      errors.push({
        original: '웬지',
        correction: '왠지',
        reason: '"왠지"가 맞아요 ("왜인지"의 줄임말)'
      })
    }
  }

  // 중복 제거 (같은 original이 여러 번 잡힌 경우, 한 번만)
  // 다만 같은 텍스트에 같은 오류가 여러 번 있으면 의미 있는 정보라 모두 유지
  // 여기서는 그대로 두기 (essayText에서 여러 번 등장 가능)

  // 항상 틀린 표기 (문맥 없이도 100% 오류인 것만 — 결정적 보강)
  // ※ '밥/밤', '빛/빚'처럼 둘 다 실제 단어인 건 절대 넣지 말 것(문맥 필요 → AI 담당)
  const COMMON_TYPOS = [
    { wrong: '됬',   right: '됐',   reason: '"됐"이 올바른 표기예요' },
    { wrong: '몇일',  right: '며칠',  reason: '"며칠"이 올바른 표기예요' },
    { wrong: '오랫만', right: '오랜만', reason: '"오랜만"이 올바른 표기예요' },
    { wrong: '왠만',  right: '웬만',  reason: '"웬만"이 올바른 표기예요' },
    { wrong: '왠일',  right: '웬일',  reason: '"웬일"이 올바른 표기예요' },
    { wrong: '역활',  right: '역할',  reason: '"역할"이 올바른 표기예요' },
    { wrong: '재대로', right: '제대로', reason: '"제대로"가 올바른 표기예요' },
    { wrong: '훑터',  right: '훑어',  reason: '"훑어"가 올바른 표기예요' },
    { wrong: '설겆이', right: '설거지', reason: '"설거지"가 올바른 표기예요' },
    { wrong: '어떻해', right: '어떡해', reason: '"어떡해"가 올바른 표기예요' },
    { wrong: '깨끗히', right: '깨끗이', reason: '"깨끗이"가 올바른 표기예요' },
  ]
  for (const t of COMMON_TYPOS) {
    let idx = 0
    while ((idx = text.indexOf(t.wrong, idx)) !== -1) {
      errors.push({ original: t.wrong, correction: t.right, reason: t.reason })
      idx += t.wrong.length
    }
  }

  return errors
}

/**
 * AI corrections와 규칙 기반 검사 결과를 병합
 * - AI가 이미 잡은 건 중복 제거
 * - AI가 놓친 건 추가
 *
 * @param {Array} aiCorrections - AI가 반환한 corrections
 * @param {string} essayText - 원본 글
 * @returns {Array} - 병합된 corrections
 */
// 안/않 오교정 차단(false positive 가드):
// 보조용언 '-지 않-'(않는/않은/않을/않고/않다…)은 항상 '않'. 맞는 '않'을 '안'으로 바꾸는 교정은 무조건 틀림.
// original의 '않'을 전부 '안'으로 치환한 게 correction과 같고, 그 '안'이 활용어미 앞이면 오교정으로 판정.
// (안/않 능동 탐지는 추가하지 않음 — 과교정 유발. 여기선 "맞는 걸 틀리게 바꾸는 교정"만 폐기.)
function isInvalidAnhToAn(original, correction) {
  if (!original || !correction) return false
  const o = String(original).replace(/\s+/g, '')
  const c = String(correction).replace(/\s+/g, '')
  if (!/않/.test(o)) return false
  // original의 '않'을 전부 '안'으로 치환한 결과가 correction과 같다 = 순수 않→안 변환
  if (o.replace(/않/g, '안') !== c) return false
  // 그 '안'이 활용어미 앞이면(=원래 보조용언 '않') 무조건 오교정
  return /안[는은을던고다아았지게며나도세]/.test(c)
}

// mergeCorrections를 거치지 않는 경로(regrade 등)에서 안/않 오교정만 걸러낼 때 재사용.
// 규칙기반 추가 없이 "맞는 걸 틀리게 바꾸는 교정"만 폐기(최소).
export function dropAnhFalsePositives(corrections) {
  return (corrections || []).filter(c => !isInvalidAnhToAn(c.original, c.correction))
}

// 🆕 공백 허용 매칭: original을 본문에서 찾되, 못 찾으면 공백(\s — 전각공백 　·BOM 포함)을
// 무시하고 매칭한 뒤, 원본 essayText의 실제 구간 인덱스로 환산해 반환한다.
// 하이라이트 4곳과 저장 보정(snap)에서 공용으로 쓴다.
// 반환: { start, end, exact, ambiguous } 또는 null.
//  - exact=true  : 공백까지 정확히 일치(지금 잘 되던 경우 — 동작 불변)
//  - exact=false : 공백 무시로 찾음. ambiguous=true면 공백무시 매칭이 2곳 이상(모호)
// ★위치가 불확실(null)하면 호출부에서 "그 correction은 조용히 건너뛴다"(억지로 긋지 않음).
export function findOriginalRange(essayText, original) {
  if (!essayText || !original) return null

  // 1) 정확 일치 — 지금 잘 되는 건 그대로
  const i = essayText.indexOf(original)
  if (i !== -1) return { start: i, end: i + original.length, exact: true, ambiguous: false }

  // 2) 공백 무시 매칭: 본문에서 공백 제거 + 각 글자의 원본 인덱스 매핑
  let essayNoWs = ''
  const map = [] // map[k] = essayNoWs의 k번째 글자가 원본 essayText에서 갖는 인덱스
  for (let idx = 0; idx < essayText.length; idx++) {
    const ch = essayText[idx]
    if (!/\s/.test(ch)) { // \s는 　(전각공백)·﻿(BOM) 포함
      essayNoWs += ch
      map.push(idx)
    }
  }
  const origNoWs = original.replace(/\s/g, '')
  if (!origNoWs) return null

  const j = essayNoWs.indexOf(origNoWs)
  if (j === -1) return null
  const j2 = essayNoWs.indexOf(origNoWs, j + 1)

  // 공백 포함 실제 구간으로 환산: 시작 = 첫 글자의 원본 인덱스, 끝 = 마지막 글자의 원본 인덱스 + 1
  const start = map[j]
  const end = map[j + origNoWs.length - 1] + 1
  return { start, end, exact: false, ambiguous: j2 !== -1 }
}

// 🆕 (B) 저장 보정: original을 본문의 실제 문자열로 스냅 — "확실할 때만".
// exact로 찾히면(공백 손 안 댐) / 못 찾으면(null) / 공백무시가 모호하면(2곳+) → 손대지 않음.
// 공백무시로 '정확히 한 곳'에서 찾았을 때만 original을 본문 실제 구간으로 교체(correction·reason은 불변).
function snapOriginalToEssay(c, essayText) {
  if (!c || !c.original) return c
  const range = findOriginalRange(essayText, c.original)
  if (!range || range.exact || range.ambiguous) return c
  const actual = essayText.slice(range.start, range.end)
  if (!actual || actual === c.original) return c
  return { ...c, original: actual }
}

export function mergeCorrections(aiCorrections, essayText) {
  // AI corrections에서 안/않 오교정을 먼저 폐기(원문이 이미 맞으므로 대체 교정 만들지 않음)
  // 이어서 original을 본문 실제 문자열로 스냅(확실할 때만) — 띄어쓰기 교정에서 AI가
  // 공백을 '정리'해 본문과 어긋나던 original을 미래 저장분에 한해 바로잡는다.
  const ai = (Array.isArray(aiCorrections) ? aiCorrections : [])
    .filter(c => !isInvalidAnhToAn(c.original, c.correction))
    .map(c => snapOriginalToEssay(c, essayText))
  const ruleBased = findRuleBasedErrors(essayText)

  // AI가 이미 잡은 original을 set으로 만들기 (중복 회피)
  const aiOriginals = new Set(ai.map(c => c.original).filter(Boolean))

  // 규칙 기반에서 AI가 안 잡은 것만 추가
  for (const rb of ruleBased) {
    // 🆕 step257: 규칙기반 경로에도 안/않 오교정 가드 적용 (맞는 '않'을 '안'으로 바꾸는 항목 폐기)
    if (isInvalidAnhToAn(rb.original, rb.correction)) continue
    // 정확히 같은 original이 AI에 있으면 건너뛰기
    if (aiOriginals.has(rb.original)) continue
    // 또는 AI의 어떤 original이 이 ruleBased의 original을 포함하면 건너뛰기
    // (예: AI가 "왔다.그래서 아침에"로 잡았다면, "왔다.그래서"는 중복)
    const isContained = ai.some(c =>
      c.original && c.original.includes(rb.original)
    )
    if (isContained) continue

    ai.push(rb)
  }

  // 🆕 original과 correction이 사실상 동일한(고칠 게 없는) 교정 제거.
  // 예: AI가 "제 4조" → "제 4조"처럼 똑같이 주는 경우.
  // trim 후 같을 때만 버림 → 내부 공백이 다른 유효 띄어쓰기 교정("제 4조"→"제4조")은 유지.
  return ai.filter(c => {
    const o = (c && c.original != null) ? String(c.original).trim() : ''
    const k = (c && c.correction != null) ? String(c.correction).trim() : ''
    if (!o) return false   // original 없으면 화면에 표시 불가 → 제거
    return o !== k         // trim 후 완전히 같으면(고칠 것 없음) 제거
  })
}

```

## lib/loginHint.js

```js
// ============================================
// 학급 로그인 안내 자동 추론
// ============================================
// 목적: 학생이 로그인할 때 "내 아이디 뭐였지?" 안 물어보게.
// 학생 등록 직후 학급의 login_username_prefix를 자동으로 채워줍니다.
//
// 우선순위:
// 1. _auto 메타데이터(학년/반)가 있으면 가장 정확 → "{prefix}{grade}{class}"
// 2. 등록된 학생 아이디들에서 공통 접두사 자동 추출
// 3. 둘 다 실패하면 첫 학생 아이디를 예시로 사용
// ============================================
import { supabase } from './supabase'

/**
 * 문자열 배열에서 가장 긴 공통 접두사 찾기
 * 예: ['hg5101', 'hg5102', 'hg5103'] → 'hg51'
 * 예: ['hg5101', 'hg5201'] → 'hg5'
 * 예: ['alice', 'bob'] → ''
 */
export function findCommonPrefix(strings) {
  if (!strings || strings.length === 0) return ''
  if (strings.length === 1) return ''  // 1명만으로는 접두사 추출 의미 없음

  // 모두 소문자로 정규화
  const arr = strings.map(s => String(s || '').toLowerCase()).filter(Boolean)
  if (arr.length === 0) return ''

  let prefix = arr[0]
  for (let i = 1; i < arr.length; i++) {
    while (prefix && !arr[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
    }
    if (!prefix) return ''
  }
  // 너무 짧으면(0~1자) 의미 없음
  if (prefix.length < 2) return ''
  // 숫자로 끝나는 게 자연스러움 (예: hg51) - 아이디는 보통 "접두사+번호" 패턴
  // 끝이 숫자 1자리면 그 자리도 다양했을 가능성이 있어 한 칸 더 뺌
  // (단, 끝이 숫자 2자리 이상이면 그건 명확한 접두사로 봄)
  return prefix
}

/**
 * 학급 로그인 안내를 가능한 모든 방법으로 자동 설정
 *
 * @param {string} classId - 학급 ID
 * @param {object} options
 *   - autoMeta: { prefix, grade, class } (_auto 정보가 있으면 우선)
 *   - existingUsernames: 이미 등록된 학생 아이디 배열 (자동 추출 fallback)
 * @returns {Promise<{success: boolean, prefix: string|null, reason: string}>}
 */
export async function ensureLoginHint(classId, { autoMeta = null, existingUsernames = [] } = {}) {
  if (!classId) return { success: false, prefix: null, reason: 'no_class_id' }

  let hintPrefix = null
  let reason = ''

  // 1순위: _auto 메타데이터 (가장 정확)
  if (autoMeta && autoMeta.grade && autoMeta.class) {
    const p = (autoMeta.prefix || '').trim().toLowerCase() || 'sch'
    hintPrefix = `${p}${String(autoMeta.grade).trim()}${String(autoMeta.class).trim()}`
    reason = 'auto_meta'
  }

  // 2순위: 등록된 아이디들에서 공통 접두사 추출
  if (!hintPrefix && existingUsernames.length >= 2) {
    const common = findCommonPrefix(existingUsernames)
    if (common) {
      hintPrefix = common
      reason = 'common_prefix'
    }
  }

  // 3순위: 첫 아이디 자체를 예시로 (1명만 등록된 극단 케이스)
  if (!hintPrefix && existingUsernames.length === 1) {
    hintPrefix = String(existingUsernames[0]).toLowerCase()
    reason = 'single_example'
  }

  if (!hintPrefix) {
    return { success: false, prefix: null, reason: 'no_data' }
  }

  // DB에 저장 (기존 값이 있어도 덮어쓰지 않음 — 선생님이 수동 설정한 게 우선)
  const { data: existing } = await supabase.from('classes')
    .select('login_hint_enabled, login_username_prefix')
    .eq('id', classId).maybeSingle()

  // 이미 hint가 설정되어 있으면 건드리지 않음 (선생님 의도 보존)
  if (existing?.login_hint_enabled && existing?.login_username_prefix) {
    return { success: true, prefix: existing.login_username_prefix, reason: 'already_set' }
  }

  const { error } = await supabase.from('classes').update({
    login_hint_enabled: true,
    login_username_prefix: hintPrefix,
    login_default_password: '123456'
  }).eq('id', classId)

  if (error) {
    console.warn('[ensureLoginHint] update 실패:', error)
    return { success: false, prefix: hintPrefix, reason: 'update_error' }
  }
  console.log(`✅ 학급 로그인 안내 자동 저장 (방식: ${reason}):`, hintPrefix)
  return { success: true, prefix: hintPrefix, reason }
}

```

## lib/maskName.js

```js
// 이름 마스킹 유틸 (개인정보 최소화)
// 김민수 → 김*수, 홍길 → 홍*, 김 → 김(1자 이하 그대로)
export function maskName(name) {
  if (!name) return ''
  const s = String(name).trim()
  if (s.length <= 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}

// 한국 이름 마스킹 (부모 동의 1단계 "곽○윤 학생 맞나요?" 확인용 — 가운데 글자를 ○로)
// 평문 실명은 서버에만 두고, 마스킹 결과만 클라이언트로 내려보내려고 서버(API)에서 호출한다.
//   1글자  = 그대로            (김    → 김)      ※ 가릴 가운데가 없어 그대로 노출
//   2글자  = 마지막 글자 가림  (김유  → 김○)
//   3글자  = 가운데 글자 가림  (곽민윤 → 곽○윤)
//   4글자+ = 첫·끝만 남기고 가운데 전부 가림 (남궁민수 → 남○○수)
// 빈 값/널/공백뿐이면 '' 반환.
export function maskKoreanName(name) {
  if (name == null) return ''
  const s = String(name).trim()
  if (!s) return ''
  const chars = Array.from(s)   // 서로게이트(이모지 등) 안전 분해
  const n = chars.length
  if (n === 1) return chars[0]                 // 1글자: 그대로
  if (n === 2) return chars[0] + '○'           // 2글자: 마지막 가림
  return chars[0] + '○'.repeat(n - 2) + chars[n - 1]  // 3글자+: 첫·끝만 남김
}

```

## lib/nickname.js

```js
// 학생 닉네임 자동 생성
// 형식: "[형용사] [동물]" (예: "용감한 코끼리", "푸른 토끼")
// 학생이 가입할 때 자동으로 부여되고, DB의 profiles.nickname 컬럼에 저장됨

const ADJECTIVES = [
  '용감한', '따뜻한', '신비한', '귀여운', '활발한', '재빠른', '똑똑한', '친절한',
  '명랑한', '꾸준한', '씩씩한', '다정한', '엉뚱한', '눈부신', '반짝이는', '포근한',
  '재미있는', '진지한', '부드러운', '재치있는', '느긋한', '쾌활한', '소박한', '순수한',
  '강인한', '우아한', '솔직한', '단단한', '환한', '맑은', '푸른', '하얀',
  '노란', '주황', '분홍', '초록', '보라', '빨간', '은빛', '금빛'
]

const ANIMALS = [
  '코끼리', '토끼', '사자', '호랑이', '여우', '판다', '곰', '늑대',
  '고양이', '강아지', '햄스터', '다람쥐', '너구리', '오소리', '두더지', '족제비',
  '독수리', '부엉이', '제비', '참새', '비둘기', '갈매기', '학', '백조',
  '돌고래', '고래', '거북이', '문어', '오징어', '해마', '불가사리', '게',
  '나비', '잠자리', '벌', '개미', '무당벌레', '사슴벌레', '메뚜기', '귀뚜라미',
  '코알라', '캥거루', '치타', '얼룩말', '기린', '하마', '코뿔소', '거북'
]

/**
 * 랜덤 닉네임 생성
 * @returns {string} "[형용사] [동물]"
 */
export function generateNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const ani = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  return `${adj} ${ani}`
}

/**
 * 학급 내에서 중복되지 않는 닉네임 생성
 * @param {string[]} existingNicknames - 이미 사용 중인 닉네임 목록
 * @param {number} maxTries - 최대 시도 횟수
 * @returns {string} 중복 없는 닉네임
 */
export function generateUniqueNickname(existingNicknames = [], maxTries = 30) {
  const used = new Set(existingNicknames)
  for (let i = 0; i < maxTries; i++) {
    const nick = generateNickname()
    if (!used.has(nick)) return nick
  }
  // 중복 회피 실패 시 숫자 붙임
  return `${generateNickname()} ${Math.floor(Math.random() * 1000)}`
}

// ─────────────────────────────────────────────
// seed 기반 결정적 닉네임
// 닉네임이 없는 학생에게도 "항상 같은" 친근한 이름을 보여주기 위함.
// DB에 저장하지 않음(표시 전용). 화면마다 동일하게 나옴.
// username/id를 seed로 쓰므로 로그인 아이디가 그대로 노출되지 않음.
// ─────────────────────────────────────────────
function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function nicknameFromSeed(seed) {
  if (!seed) return '이름 없음'
  const h = hashString(String(seed))
  const adj = ADJECTIVES[h % ADJECTIVES.length]
  const ani = ANIMALS[Math.floor(h / ADJECTIVES.length) % ANIMALS.length]
  return `${adj} ${ani}`
}

```

## lib/notices.js

```js
// 맞춤법 안내 문구 (학생/교사 공용 상수)
// 맞춤법 표시는 AI 보조 결과라 가끔 놓칠 수 있음을 안내한다.
// 학생=참고용 안내만, 교사=안내 + "다시 검사(재평가)" 유도.

export const GRAMMAR_NOTICE_STUDENT =
  '✏️ 맞춤법 표시는 AI가 도와주는 거예요. 가끔 놓치거나 잘못 짚을 수 있으니 참고만 하고, 헷갈리면 선생님께 물어봐요.'

export const GRAMMAR_NOTICE_TEACHER =
  '맞춤법·띄어쓰기 표시는 AI가 도와드린 거예요. 완벽하진 않아 가끔 놓치기도 하니, 마지막엔 선생님께서 한 번 봐주시면 좋아요. 결과가 아쉬우면 아래에서 다시 검사할 수 있어요.'

```

## lib/pdfParser.js

```js
// PDF 파일에서 학생 명단 추출
// 나이스 명렬표 텍스트 PDF 대응
// 텍스트 추출 → 학년/반/번호/이름 패턴 인식

/**
 * PDF 파일을 읽어서 학생 목록을 추출
 * @param {File} file - PDF 파일 (브라우저 File 객체)
 * @returns {Promise<Array>} - [{ grade, classNum, number, name }, ...]
 */
export async function parsePdfStudentList(file) {
  // pdfjs-dist 동적 로드 (SSR 회피, 번들 크기 감소)
  const pdfjsLib = await import('pdfjs-dist/build/pdf')
  // worker 설정 - CDN으로 (Next.js와 호환성 위해)
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  // 모든 페이지에서 텍스트 + 위치 정보 추출
  const allItems = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    // 각 텍스트 조각의 x, y 좌표를 포함
    tc.items.forEach(it => {
      if (!it.str || !it.str.trim()) return
      allItems.push({
        text: it.str.trim(),
        x: it.transform[4],
        y: it.transform[5],
        page: p
      })
    })
  }

  if (allItems.length === 0) {
    throw new Error('PDF에서 텍스트를 추출할 수 없어요. 이미지로 된 PDF(스캔본)일 수 있어요. 엑셀 파일로 다시 시도해주세요.')
  }

  // y 좌표 기준으로 같은 줄(line) 묶기 (오차 ±3)
  // 정렬: 페이지 → y 내림차순 (PDF는 아래가 작은 y) → x 오름차순
  allItems.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page
    if (Math.abs(a.y - b.y) > 3) return b.y - a.y
    return a.x - b.x
  })

  const lines = []
  let current = null
  for (const it of allItems) {
    if (!current || current.page !== it.page || Math.abs(current.y - it.y) > 3) {
      current = { page: it.page, y: it.y, items: [it] }
      lines.push(current)
    } else {
      current.items.push(it)
    }
  }

  // 각 줄을 텍스트로 합치기 (x 정렬 후)
  const rows = lines.map(line => {
    line.items.sort((a, b) => a.x - b.x)
    return line.items.map(i => i.text).join(' ').trim()
  }).filter(r => r.length > 0)

  // 학생 행 패턴 찾기
  // 나이스 명렬표는 보통: "5  1  1  곽서윤" 또는 "5학년 1반 1번 곽서윤" 같은 형식
  const students = []

  for (const row of rows) {
    // 헤더 줄 스킵
    if (/^(학년|반|번호|성명|이름|비고|순번|학적|반편성)/.test(row)) continue
    if (/명렬표|출력일자|작성|페이지|page/i.test(row)) continue

    // 패턴 1: "학년숫자 반숫자 번호숫자 이름한글" (공백 또는 탭으로 구분)
    // 예: "5 1 1 곽서윤", "5  1  10  김지우"
    let m = row.match(/^(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+([가-힣]{2,5})(\s|$)/)
    if (m) {
      students.push({
        grade: m[1],
        classNum: m[2],
        number: m[3],
        name: m[4]
      })
      continue
    }

    // 패턴 2: "5학년 1반 1번 곽서윤"
    m = row.match(/(\d{1,2})학년\s*(\d{1,2})반\s*(\d{1,2})(?:번)?\s+([가-힣]{2,5})/)
    if (m) {
      students.push({
        grade: m[1],
        classNum: m[2],
        number: m[3],
        name: m[4]
      })
      continue
    }

    // 패턴 3: "01 곽서윤" 같이 번호와 이름만 (학년/반은 PDF 상단에서 추출해야 함)
    // → 일단 스킵, 추후 개선
  }

  return students
}

/**
 * PDF에서 학년/반 정보를 추출 (헤더 또는 첫 페이지에서)
 * 패턴 3 같은 경우에 보조적으로 사용
 */
export async function extractGradeClassFromPdf(file) {
  const pdfjsLib = await import('pdfjs-dist/build/pdf')
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(1)
  const tc = await page.getTextContent()
  const text = tc.items.map(i => i.str).join(' ')

  const m = text.match(/(\d{1,2})학년\s*(\d{1,2})반/)
  if (m) return { grade: m[1], classNum: m[2] }
  return null
}

```

## lib/prompts.server.js

```js
// ============================================
// 서버 전용 프롬프트 모듈
// ============================================
// ⚠️ 이 파일은 pages/api/ 의 서버 코드에서만 import 합니다.
// 절대 클라이언트(pages/ 페이지, components/)에서 import 하지 마세요.
// 그래야 프롬프트가 브라우저 번들에 포함되지 않아 F12로 노출되지 않습니다.
//
// 핵심 IP: 채점 일관성·루브릭 의도 존중·5학년 눈높이·인용 기반 피드백.
// ============================================

function buildRubricText(rubrics) {
  return rubrics.map((r, i) =>
    `${i + 1}. ${r.name} (${r.score}점)${r.hint ? `\n   → 평가 포인트: ${r.hint}` : ''}`
  ).join('\n')
}

// 첫 글 채점 프롬프트
export function gradingPrompt({ topic, essay, rubrics }) {
  const totalMax = rubrics.reduce((s, r) => s + r.score, 0)
  const rubricText = buildRubricText(rubrics)

  return `당신은 초등 5학년 글쓰기 선생님입니다. 학생의 글을 평가하고, 학생이 어떻게 더 잘 쓸 수 있을지 자세하고 친절한 피드백을 주세요.

📌 글쓰기 주제: ${topic.title}
${topic.description ? '📝 주제 설명: ' + topic.description : ''}

📊 평가 기준 (총 ${totalMax}점 만점):
${rubricText}

✍️ 학생이 쓴 글:
${essay}

⚠️ 채점 원칙 (꼭 지켜주세요):
1. 각 평가 기준의 "평가 포인트"를 글이 실제로 충족했는지 하나하나 확인하세요.
2. 평가 포인트를 모두 충족했으면 만점, 일부만 충족했으면 비례하여 감점.
3. **평가 기준의 의도를 그대로 따르세요.**
   - 기준 이름이 "상상력", "창의성", "기발함" 등이면 → 비현실적이거나 엉뚱한 설정 자체는 절대 감점 사유로 삼지 마세요. 오히려 신선한 발상을 높게 보세요.
   - 기준 이름이 "논리력", "근거", "설득력" 등이면 → 그때만 현실성/타당성을 보세요.
   - 평가 기준이 요구하지 않은 잣대로 깎으면 안 됩니다.
4. 주제와 완전히 무관한 글이면 점수를 크게 낮추세요.
5. 글의 완성도가 평가 핵심. 글자 수가 아니라 짜임새와 의미를 보세요.
6. **모든 학급/모든 학생에게 같은 기준을 적용**하세요.
7. 각 점수는 절대 해당 기준의 만점을 넘으면 안 됨.

💝 피드백 원칙 (이게 정말 중요해요):
이 학생은 5학년이고, 자기 점수가 왜 그렇게 나왔는지 이해해야 다음에 더 잘 쓸 수 있습니다.
- 🙏 **반드시 존댓말로 쓰세요** ("~했어요", "~좋아요", "~보세요"). 반말 절대 금지.
- "잘했어요", "좋아요" 같은 빈말 절대 금지
- 반드시 학생 글의 **구체적인 부분을 직접 인용**해서 짚어주세요
- 어려운 한자어, 어른 같은 표현 금지. 5학년이 일상에서 쓰는 말로.
- 따뜻하게, 격려하되, 솔직하게
- "이렇게 하면 더 좋아질 거예요" 식으로 다음 행동을 제시

📤 응답 형식:

▶ scores: 평가기준 순서대로 점수 배열

▶ rubric_reasons: 각 평가기준에 대한 점수 근거 (배열, scores와 길이 같음)
   필수 형식: "[학생 글의 구체 부분] 때문에 +N점. [부족한 부분] 때문에 -M점."
   - 80-150자, 학생이 점수를 납득하도록 충실하게
   - 만점 받았으면 어디가 특히 좋았는지
   - 감점됐으면 어디가 부족했는지 정확히 짚어주기
   예시: "'할머니 손이 거칠지만 따뜻했다'에서 감각적 표현이 살아있어요(+15점). 다만 거친 손에 대한 묘사가 한 줄뿐이라 더 자세히 썼으면 좋았어요(-5점)."

▶ total: 합계 (만점 초과 금지)

▶ overall: 종합 의견 (4-6문장)
   - 첫 문장: 글 전체의 인상을 따뜻하게 (인용 포함)
   - 중간: 인상 깊었던 부분 + 어떤 점이 빛났는지 구체적으로
   - 마지막: 다음번에 어떻게 하면 더 좋을지 한 마디로 격려
   - 어려운 단어 금지. "구체적", "묘사" 같은 단어는 OK지만 "수사", "구성미" 같은 한자어는 X

▶ good: 잘한 점 2가지. 형식 엄수:
   각 항목을 '- '로 시작하는 줄로 2개 쓰고 줄바꿈으로 구분하세요.
   ⚠️ '첫 번째 잘한 점'처럼 빈칸을 채우는 안내 문구를 그대로 출력하지 말고, 반드시 이 학생 글의 실제 내용으로 채우세요.
   - 각 80-120자
   - 반드시 학생 글에서 그 부분을 직접 따옴표로 인용 ("학생 글: '...' 부분이 ...")
   - 왜 그게 좋은지 설명 (어떤 능력이 보였는지)
   - 예시: "- '엄마 김치찌개의 매콤하고 시큰한 냄새'처럼 음식의 맛과 향을 살려서 표현한 부분이 정말 생생해요. 읽는 사람도 그 식탁 앞에 앉은 기분이 들 정도예요."

▶ improve: 발전시킬 점 2가지. 형식 엄수:
   각 항목을 '- '로 시작하는 줄로 2개 쓰고 줄바꿈으로 구분하세요.
   ⚠️ '첫 번째 발전점'처럼 빈칸을 채우는 안내 문구를 그대로 출력하지 말고, 반드시 이 학생 글의 실제 내용으로 채우세요.
   - 각 100-150자
   - 학생 글의 어디가 아쉬운지 + 어떻게 바꾸면 좋을지 구체적 방법까지
   - "더 자세히 써보세요" 같은 막연한 말 금지
   - 예시: "- '재미있었다'로 끝나는 부분이 많아요. 어떻게 재미있었는지 한두 문장 더 풀어 써보세요. 예를 들어 '친구가 갑자기 떡볶이를 두 그릇이나 시켜서 모두 놀랐다'처럼 구체적인 장면으로 보여주면 훨씬 생생해져요."

▶ improve_examples: 발전점에 대한 구체 예시 (배열, 2-3개)
   - 학생 글에서 고치면 좋을 부분 1-2개 골라서, 어떻게 바꾸면 좋을지 직접 보여주기
   - original: 학생 글에 정확히 등장하는 문장 (있는 그대로)
   - suggested: 이렇게 바꿔보면 어떨까 하는 한국어 예시
   - reason: 왜 이렇게 바꾸면 좋은지 30-60자
   - 예시:
     { original: "오늘 김치찌개를 먹었다. 맛있었다.",
       suggested: "오늘 점심에 엄마가 끓여준 김치찌개를 먹었다. 시큰한 김치 냄새가 코를 콕 찌르고, 한 숟갈 떠먹자마자 매콤한 맛이 입안 가득 퍼졌다.",
       reason: "맛을 어떻게 느꼈는지 감각으로 풀어 쓰면 글이 더 생생해져요." }

▶ corrections: 맞춤법/띄어쓰기 오류 — **명백한 오류는 빠짐없이 모두 잡아내세요.**
   1. original 필드에는 학생 글에 "정확히 그대로 등장하는" 문자열만 (한 글자도 다르면 안 됨). 글자·공백·줄바꿈까지 있는 그대로 복사하고, 띄어쓰기를 고친 형태로 적지 말 것
   2. 이미 마침표/쉼표/물음표가 찍힌 부분은 "마침표 누락"으로 잡지 말 것
   3. 띄어쓰기 오류는 학생 글에 실제로 띄어쓰기가 없는 경우에만
   4. 한국어 표준 맞춤법에 명백히 어긋난 것만 (자연스러운 구어체는 건드리지 말 것)
   5. reason은 5학년이 알아듣게 ("'안 되다'는 띄어 써요")
   6. 안/않: '-지 않다/않는/않은/않을/않고'의 보조용언은 항상 '않'이에요. '안'은 '안 가다'처럼 동사 앞에 띄어 쓰는 부사예요. 맞는 '않'을 '안'으로 고치지 마세요.
   7. 문장을 처음부터 끝까지 하나씩 읽으며 맞춤법·띄어쓰기·조사·문장부호 오류를 빠짐없이 찾으세요. 글을 끝까지 다 읽기 전에 멈추지 마세요. 단, 표준에서 띄어쓰기가 갈리는 합성어(예: "멸종위기종")는 무리하게 띄우라고 하지 마세요.
   8. 각 교정은 고친 표현(correction)이 문법적으로 옳은지 스스로 확인한 뒤에만 corrections에 포함하세요.

🎯 최종 목표: 이 학생이 피드백을 읽고 "아, 그래서 점수가 그랬구나. 다음엔 이렇게 써봐야지" 하고 행동할 수 있게.`
}

// 재평가 채점 프롬프트 (간결판 — 교사 재평가용)
export function regradePrompt({ topic, essay, rubrics }) {
  const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)
  const rubricText = buildRubricText(rubrics)

  return `당신은 초등 5학년 글쓰기 선생님입니다. 학생의 글을 평가하고, 다음에 더 잘 쓸 수 있도록 자세하고 친절한 피드백을 주세요.

📌 글쓰기 주제: ${topic.title}
${topic.description ? '📝 주제 설명: ' + topic.description : ''}

📊 평가 기준 (총 ${totalMax}점 만점):
${rubricText}

✍️ 학생이 쓴 글:
${essay}

⚠️ 채점 원칙:
1. 평가 포인트를 충족했는지 하나하나 확인. 모두 충족이면 만점.
2. 상상력/창의성 기준은 비현실 감점 금지. 논리/근거 기준일 때만 현실성 봄.
3. 주제 무관이면 크게 감점.
4. 글의 완성도가 핵심 (글자 수 아님).
5. 모든 학생에게 같은 기준.
6. 각 점수는 만점 초과 금지.

💝 피드백 원칙:
- 🙏 **반드시 존댓말로 쓰세요** ("~했어요", "~좋아요"). 반말 절대 금지.
- 빈말 금지 ("잘했어요", "좋아요"만 X)
- 학생 글의 구체적 부분 직접 인용 필수
- 어려운 한자어 금지, 5학년 일상 말로
- 따뜻하게, 솔직하게

📤 응답 형식:

▶ scores: 평가기준 순서대로 배열
▶ rubric_reasons (scores와 길이 같음): 각 80-150자, 점수 근거 + 어디가 부족한지 학생 글 인용
▶ total: 합계
▶ overall: 4-6문장. 인용 포함, 5학년 말로, 솔직하게 격려
▶ good: 잘한 점 2개. 각 항목을 '- '로 시작하는 줄로 쓰고 줄바꿈으로 구분. 각 80-120자, 학생 글 인용해서 왜 좋은지. ⚠️ '항목1' 같은 안내 문구를 그대로 출력하지 말고 실제 내용으로 채울 것
▶ improve: 발전점 2개. 각 항목을 '- '로 시작하는 줄로 쓰고 줄바꿈으로 구분. 각 100-150자, 어디가 아쉬운지 + 어떻게 고치면 좋을지. ⚠️ '항목1' 같은 안내 문구를 그대로 출력하지 말 것
▶ improve_examples: 2-3개 {original, suggested, reason}
   - original: 학생 글에 정확히 있는 문장
   - suggested: 어떻게 바꾸면 좋을지 예시
   - reason: 왜 30-60자
▶ corrections: 명백한 맞춤법/띄어쓰기 오류, original은 글에 정확히 있는 것만 (글자·공백·줄바꿈까지 그대로 복사 — 띄어쓰기 고친 형태로 적지 말 것)
   - 안/않: 보조용언 '-지 않-'(않는/않은/않고…)은 항상 '않'. 맞는 '않'을 '안'으로 고치지 말 것. 문장을 처음부터 끝까지 하나씩 읽으며 맞춤법·띄어쓰기·조사·문장부호 오류를 빠짐없이 찾되, 표준에서 띄어쓰기가 갈리는 합성어(예: "멸종위기종")는 무리하게 띄우지 말 것. correction이 옳은지 확인 후 포함.

🎯 목표: 학생이 "왜 이 점수이고 다음엔 어떻게 쓸지" 알도록.`
}

// 평가기준 hint(평가 포인트) 자동 생성 프롬프트
export function rubricHintPrompt({ topic, rubrics }) {
  return `초등 5학년 글쓰기 평가기준의 "평가 포인트(hint)"를 만들어주세요.

📌 글쓰기 주제: ${topic.title}
${topic.description ? '📝 주제 설명: ' + topic.description : ''}

📊 평가 기준:
${rubrics.map((r, i) => `${i + 1}. ${r.name} (${r.score}점)${r.hint ? ' [기존 hint: ' + r.hint + ']' : ' [hint 없음]'}`).join('\n')}

각 평가기준마다 5학년 글을 채점할 때 구체적으로 확인할 포인트를 3-4가지 적어주세요.
- 글의 완성도 중심 (글자 수는 언급하지 말 것)
- 평가 포인트는 누가 봐도 같은 판단을 내릴 수 있을 만큼 구체적으로
- 기존 hint가 있으면 그대로 유지, 없으면 새로 생성

JSON 형식 (rubrics 배열, 각 {name, hint, score}):`
}

// 수정본 채점 프롬프트
export function rewriteGradingPrompt({ topic, rewriteEssay, rubrics }) {
  const totalMax = rubrics.reduce((s, r) => s + r.score, 0)
  const rubricText = buildRubricText(rubrics)

  return `당신은 초등 5학년 글쓰기 선생님입니다. 학생이 다시 쓴 수정본을 평가하고, 다음에 더 잘 쓸 수 있도록 자세하고 친절한 피드백을 주세요.

📌 글쓰기 주제: ${topic.title}
${topic.description ? '📝 주제 설명: ' + topic.description : ''}

📊 평가 기준 (총 ${totalMax}점 만점):
${rubricText}

✍️ 학생 수정본:
${rewriteEssay}

⚠️ 채점 원칙 (꼭 지켜주세요):
1. 각 평가 기준의 "평가 포인트"를 수정본이 실제로 충족했는지 하나하나 확인하세요.
2. 평가 포인트를 모두 충족했으면 만점, 일부만 충족했으면 비례하여 감점.
3. **평가 기준의 의도를 그대로 따르세요.**
   - 상상력 기준은 비현실적 설정을 감점 사유로 삼지 마세요.
   - 논리/근거 기준일 때만 현실성을 봅니다.
4. 주제와 무관하면 점수를 크게 낮추세요.
5. 글의 완성도가 평가의 핵심.
6. 처음 글보다 좋아진 점을 종합의견에 반영하되, 점수는 수정본 자체의 완성도로 평가.
7. **모든 학급/모든 학생에게 같은 기준을 적용**하세요.
8. 각 점수는 절대 해당 기준의 만점을 넘으면 안 됨.

💝 피드백 원칙 (정말 중요):
- 🙏 **반드시 존댓말로 쓰세요** ("~했어요", "~좋아요", "~보세요"). 반말 절대 금지.
- "잘했어요", "좋아요" 같은 빈말 절대 금지
- 반드시 수정본의 **구체적 부분을 직접 인용**해서 짚어주기
- 어려운 한자어 금지, 5학년 일상 말로
- 따뜻하게, 솔직하게
- 처음 글에서 어떻게 좋아졌는지 격려

📤 응답 형식:

▶ scores: 평가기준 순서대로 점수 배열

▶ rubric_reasons: 각 평가기준 점수 근거 (scores와 길이 같음)
   - 80-150자, 학생이 점수를 납득하도록
   - 만점이면 어디가 좋았는지, 감점됐으면 어디가 부족한지
   - 수정본의 구체적 부분을 직접 인용

▶ total: 합계

▶ overall: 종합 의견 (4-6문장)
   - 처음 글에서 어떻게 좋아졌는지 구체적으로 짚어주기
   - 5학년이 알아듣는 쉬운 말로
   - 격려와 솔직함 함께

▶ good: 잘한 점 2가지. 각 항목을 '- '로 시작하는 줄로 2개 쓰고 줄바꿈으로 구분.
   ⚠️ '항목1'처럼 빈칸을 채우는 안내 문구를 그대로 출력하지 말고, 반드시 수정본의 실제 내용으로 채우세요.
   - 각 80-120자
   - 수정본에서 그 부분을 직접 인용
   - 왜 좋은지 설명

▶ improve: 더 발전시킬 점 2가지. 각 항목을 '- '로 시작하는 줄로 2개 쓰고 줄바꿈으로 구분.
   ⚠️ '항목1'처럼 빈칸을 채우는 안내 문구를 그대로 출력하지 말고, 반드시 수정본의 실제 내용으로 채우세요.
   - 각 100-150자
   - 어디가 아쉬운지 + 어떻게 바꾸면 좋을지 구체적 방법
   - 막연한 말 금지

▶ improve_examples: 발전점 구체 예시 (배열, 2-3개)
   - original: 수정본에 정확히 등장하는 문장
   - suggested: 어떻게 바꿔보면 좋을지 예시
   - reason: 왜 30-60자

▶ corrections: 맞춤법/띄어쓰기 오류 — 명백한 오류는 빠짐없이.
  1. original은 수정본에 정확히 그대로 등장하는 문자열만. 글자·공백·줄바꿈까지 있는 그대로 복사하고, 띄어쓰기를 고친 형태로 적지 말 것
  2. 이미 찍힌 마침표는 잡지 말 것
  3. 띄어쓰기는 실제 띄어쓰기 없는 경우만
  4. 같은 오류 여러 번 나오면 각각 다 잡기
  5. 안/않: 보조용언 '-지 않-'(않는/않은/않고…)은 항상 '않'. 맞는 '않'을 '안'으로 고치지 말 것
  6. 문장을 처음부터 끝까지 하나씩 읽으며 맞춤법·띄어쓰기·조사·문장부호 오류를 빠짐없이 찾되, 표준에서 띄어쓰기가 갈리는 합성어(예: "멸종위기종")는 무리하게 띄우지 말 것. correction이 문법적으로 옳은지 확인 후 포함

🎯 최종 목표: 학생이 피드백 보고 "이렇게 더 발전하면 되겠구나" 알 수 있게.`
}

// ============================================
// 주제 추천 / 평가기준 / 설명 생성 프롬프트
// ============================================

// 주제 묶음 추천 (일괄 등록용 / AI 추천 패널 공용)
export function topicBatchPrompt({ gradeText, count, theme, recentTitles, categoryText, levelText, userRequest, useCategorySpread, style }) {
  const g = gradeText || '초등 5학년'
  const hasTheme = theme && theme.trim()

  // style 'batch'(일괄등록) | 'suggest'(추천패널)
  if (style === 'suggest') {
    let p = `${g} 글쓰기 주제 ${count}개를 만들어줘.${count >= 2 ? ' 선생님이 그중 마음에 드는 것 하나를 고를 거야.' : ''}
${useCategorySpread
  ? `카테고리 지시 (중요!): ${count}개 주제는 반드시 서로 다른 카테고리에서 하나씩. 다음 ${count}개 카테고리를 각각 사용해주세요 → ${categoryText}`
  : `카테고리: ${categoryText}`}
난이도: ${levelText || '보통'}
최근 출제한 주제 (중복 절대 금지): ${recentTitles || '없음'}
`
    if (userRequest && userRequest.trim()) {
      p += `\n선생님 요청 사항: ${userRequest.trim()}\n위 요청을 반드시 반영해주세요.\n`
    }
    p += `
규칙:
${useCategorySpread
  ? '- 3개 주제는 각각 위에 지시된 카테고리에 충실하게'
  : '- 3개 주제는 서로 다른 접근 각도로 (경험/관찰/상상 등)'}
- title: 10-15자, ${g}이 재미있어할 구체적 주제
- description: 70-100자, 안내/지시형 (질문형 X), 학생이 무엇을 떠올리고 어떻게 쓸지 안내
- category: ${useCategorySpread ? '각 주제가 받은 카테고리명' : categoryText}

🚫 클리셰 금지: "아지트", "비밀의 장소", "내가 만든 세상", "내가 만약 ~라면", "소중한/특별한/잊지 못할 ~", "행복했던 순간", "기억에 남는 일"
✅ 좋은 주제: 학생이 "아, 그거!" 하고 떠올릴 구체적 장면

예시: "급식 시간의 작은 사건" / "내 인생의 첫 도전" / "쉬는 시간 5분 동안 일어난 일"

반드시 ${count}개 모두 완성해서 보내주세요. description 끝까지 다 쓰기.`
    return p
  }

  // style 'batch' (기본)
  let p = `${g} 글쓰기 주제 ${count}개를 만들어주세요.

`
  if (hasTheme) {
    p += `🎯 핵심 요구사항 (반드시 모든 주제에 반영):
"${theme.trim()}"

위 방향성을 ${count}개 주제 전부에 적용해주세요. 각 주제는 위 큰 방향 안에서 서로 다른 세부 주제/관점으로 만들어주세요.

`
  }
  p += `규칙:
- 만들어진 ${count}개 주제는 서로 중복되지 않게 다양하게 (${hasTheme ? '큰 방향은 유지하되 세부 내용/접근 방식이 다르게' : '카테고리/주제가 다양하게'})
- 최근 출제 주제와 중복 금지: ${recentTitles || '없음'}
- title: 10-15자, 흥미롭고 ${g} 학생들이 재미있어할 주제
- description: 70-100자의 글쓰기 안내 (질문형 X, 안내/지시형으로)
- category: 카테고리명${hasTheme ? ' (큰 방향성에 맞는 세부 카테고리)' : ' (예: "일상 경험", "상상력", "가족과 친구" 등)'}

🚫 절대 피할 작문 클리셰 (학생들이 매번 봐서 식상해함):
- "나의 아지트", "비밀의 장소", "나만의 공간" 류
- "내가 만약 ~라면", "내가 만든 세상" 류 (너무 추상적·일반적)
- "소중한 ~", "특별한 ~", "잊지 못할 ~" 류 (감상적·뻔함)
- "행복했던 순간", "기억에 남는 일" 류 (너무 광범위)
✅ 좋은 주제의 특징:
- 학생이 "아, 그거!" 하고 바로 떠올릴 구체적 장면/상황
- 글로 쓸 거리가 명확히 잡히는 구체성

좋은 예시${hasTheme ? ` (방향성 "${theme.trim()}"에 맞춘 예시는 아니고 형식만 참고)` : ''}:
- title: "내 인생의 첫 도전"
  description: "지금까지 처음 도전했던 일을 떠올려보세요. 그때 어떤 마음이었는지, 어떻게 도전했는지, 결과는 어땠는지 솔직하게 써보세요."
  category: "일상 경험"

위와 같은 형식으로 ${count}개 모두 만들어주세요. (반드시 ${count}개${hasTheme ? `, 그리고 모든 주제가 "${theme.trim()}" 방향성을 반영해야 합니다` : ''})`
  return p
}

// 단일 주제 추천
export function topicSinglePrompt({ gradeText, theme, otherTitles, recentTitles, categoryText, levelText, userRequest, style }) {
  const g = gradeText || '초등 5학년'
  const hasTheme = theme && theme.trim()

  if (style === 'suggest') {
    let p = `${g} 글쓰기 주제 1개를 만들어줘.
카테고리: ${categoryText}
난이도: ${levelText || '보통'}
중복 금지 (이미 후보 중이거나 최근 출제한 것): ${recentTitles || '없음'}
`
    if (userRequest && userRequest.trim()) {
      p += `\n선생님 요청 사항: ${userRequest.trim()}\n위 요청을 반드시 반영해주세요.\n`
    }
    p += `
규칙:
- title: 10-15자, ${g} 학생들이 재미있어할 주제
- description: 학생에게 글쓰기 방법 안내 (안내/지시형, 70-100자)
- 클리셰 회피: "아지트", "비밀의 장소", "내가 만약 ~라면", "소중한 ~", "기억에 남는 일" 등 추상적·뻔한 주제 금지
- 학생이 "아, 그거 있어!" 하고 떠올릴 구체적 장면을 담은 주제

좋은 예시:
- title: "내 인생의 첫 도전"
  description: "지금까지 처음 도전했던 일을 떠올려보세요. 그때 어떤 마음이었는지, 어떻게 도전했는지, 결과는 어땠는지 솔직하게 써보세요."`
    return p
  }

  // style 'batch'
  let p = `${g} 글쓰기 주제 1개를 새로 만들어주세요.

`
  if (hasTheme) {
    p += `🎯 핵심 방향성: "${theme.trim()}"\n이 방향에 맞는 주제를 만들어주세요.\n\n`
  }
  p += `중복 금지:
- 이번 일괄 등록의 다른 주제: ${otherTitles || '없음'}
- 최근 등록 주제: ${recentTitles || '없음'}

위 주제들과 다른 새로운 주제로 1개 만들어주세요.
- title: 10-15자
- description: 70-100자의 글쓰기 안내
- category: 카테고리명`
  return p
}

// 평가기준 생성 (주제 기반)
export function rubricGenPrompt({ gradeText, title, description }) {
  const g = gradeText || '초등 5학년'
  return `주제 "${title}"
${description ? '주제 설명: ' + description : ''}

위 주제에 정말 어울리는 ${g} 글쓰기 평가 기준 4개를 만들어줘.

⚠️ 주제 분석부터 하기:
이 주제에서 학생이 가장 잘 보여줘야 할 능력은 무엇인지 먼저 생각해보세요.
- 경험 회상이 중요한가? → "솔직한 표현", "자세한 묘사" 강조
- 상상력이 중요한가? → "창의성", "상상력" 강조
- 논리/주장이 중요한가? → "주장과 근거", "논리성" 강조
- 감정 전달이 중요한가? → "솔직한 표현", "감각적 표현" 강조

✅ name (평가 기준 이름) - 다음 카테고리에서 4개 선택:
[내용] 주제에 맞는 내용, 주제 표현, 구체적인 내용, 자세한 묘사, 솔직한 표현, 창의성, 상상력, 논리성, 주장과 근거
[형식] 글의 짜임새, 글의 구성, 처음-가운데-끝, 문단 구성
[표현] 풍부한 어휘, 다양한 표현, 비유 표현, 감각적 표현, 문장력
[기본] 맞춤법과 문법, 띄어쓰기

✅ hint (부가 설명) - 매우 중요!:
- 반드시 채워야 함 (빈 값 절대 금지)
- 주제 "${title}"의 맥락에서 학생이 무엇을 잘 표현해야 하는지 구체적으로
- 15-30자
- 4개 hint가 모두 서로 다른 내용이어야 함

배점 규칙:
- 합계 100점, 각 항목 10~40점 범위
- 주제에 가장 중요한 영역에 35-40점, 다음 25-30점, 다음 15-25점, 맞춤법 10-20점

각 항목은 반드시 {name, hint, score} 모두 채울 것. hint 빈 값 절대 금지.`
}

// 주제 설명(description) 생성
export function topicDescPrompt({ gradeText, title, levelText }) {
  const g = gradeText || '초등 5학년'
  return `${g} 글쓰기 주제: "${title}"
난이도: ${levelText || '보통'}

이 주제로 학생들이 글을 쓸 수 있도록 안내문(description)을 만들어줘.

규칙:
- 70-100자
- 안내/지시형으로 (질문형 금지)
- "무엇을 떠올리고, 어떻게 쓰면 좋을지" 구체적으로
- 학생이 글 쓰기 막막하지 않도록 친절하게`
}

// ============================================
// 예시 글 생성 / 챗봇 프롬프트
// ============================================

// 학생 글을 더 좋게 다시 쓴 예시 1편 생성
export function exampleEssayPrompt({ topicTitle, studentEssay }) {
  return `초등 5학년 학생이 쓴 다음 글을 더 좋게 다시 쓴 예시를 1편 만들어줘.
주제: ${topicTitle}

원본 글:
${studentEssay}

규칙:
- 5학년 학생 수준의 자연스러운 글
- 원본의 좋은 점은 살리고 부족한 점 보완
- 분량: 반드시 400자 이내 (절대 넘지 말 것)
- 따뜻하고 진솔한 느낌
- example 필드 하나만 채워서 반환`
}

// 글쓰기 도우미 챗봇 (글 대신 써주지 않고 질문·힌트만)
export function tutorChatPrompt({ gradeLabel, topicTitle, topicDescription, currentText, history }) {
  return `당신은 ${gradeLabel || '초등학교 고학년'} 학생의 글쓰기를 돕는 친절한 AI 도우미예요.

[글쓰기 주제]
${topicTitle || '(주제 없음)'}
${topicDescription || ''}

[학생이 지금까지 쓴 글]
${currentText ? currentText.slice(0, 1500) : '(아직 안 씀)'}

[대화 기록]
${history || ''}

[매우 중요한 규칙]
1. 절대로 학생의 글을 대신 써주지 마세요. 완성된 문장이나 문단을 제시하면 안 돼요.
2. 대신 생각을 이끄는 질문을 던지거나, 막힌 부분을 풀 힌트와 방향만 알려주세요.
   (예: "그때 어떤 기분이었어?", "예를 하나 떠올려볼까?", "그 장면을 더 자세히 설명해볼래?")
3. 초등학생 눈높이로, 짧고 따뜻하게. 존댓말로 "~해요", "~볼까요?" 말투.
4. 2~4문장으로 짧게. 길게 설명하지 마세요.
5. 맞춤법·주제와 관련 없는 질문(게임, 잡담 등)에는 "지금은 글쓰기를 도와줄게요!"라고 부드럽게 돌려주세요.

학생의 마지막 질문에 답해주세요:`
}

// ============================================
// 생기부 평어 자동 생성 프롬프트
// ============================================
// 학생의 누적 글·점수·피드백을 근거로 생활기록부 평어 초안 생성.
// 교사의 학기말 최대 업무(평어 작성)를 경감하는 핵심 IP.
export function schoolRecordPrompt({ gradeText, studentName, summaries, level, standards, count }) {
  const g = gradeText || '초등학교'
  const n = count || 4
  // summaries: [{title, score, max, overall, good, improve, date}, ...]
  // 토큰 절약 위해 핵심만 추리고 길면 자름
  const clip = (t, len) => (t && t.length > len ? t.slice(0, len) + '…' : (t || ''))
  const body = (summaries || []).map((s, i) =>
    `[글 ${i + 1}] ${s.title} (${s.score}/${s.max}점)
- 총평: ${clip(s.overall, 120) || '없음'}
- 잘한 점: ${clip(s.good, 100) || '없음'}`
  ).join('\n')

  // 전반적 수준 (교사 지정 또는 점수 자동). 평어 톤 조절용 — 등급어는 평어에 쓰지 않음
  const levelGuide = {
    '매우잘함': '글쓰기 능력이 우수한 학생입니다. 강점을 분명하게 드러내되 과장 없이 서술하세요.',
    '잘함': '글쓰기 능력이 양호한 학생입니다. 잘하는 점을 중심으로 쓰되 더 발전할 여지도 자연스럽게 담으세요.',
    '보통': '기본기를 갖춘 보통 수준의 학생입니다. 갖춘 점을 인정하면서 발전 가능성에 무게를 두세요.',
    '노력요함': '아직 발전이 필요한 학생입니다. 부정적으로 단정하지 말고, 작은 시도와 성장 가능성을 중심으로 격려하는 톤으로 쓰세요.'
  }
  const levelText = level && levelGuide[level]
    ? `\n[이 학생의 전반적 수준] ${level}\n→ ${levelGuide[level]}`
    : ''

  // 성취기준 (선택). 입력 시 평어가 이 기준의 도달 정도를 근거로 작성되도록
  const std = standards && standards.trim()
  const standardsText = std
    ? `\n[관련 성취기준] (이 평어는 아래 성취기준에 근거해서 작성하세요)
${std}
→ 위 성취기준에 비추어 학생이 어느 정도 도달했는지를 글 기록을 근거로 평어에 녹이세요. 성취기준의 핵심 표현(예: 근거를 들어 주장하기, 겪은 일을 실감 나게 표현하기 등)을 평어에 자연스럽게 반영하되, 성취기준 코드(예: [6국03-04])나 "성취기준"이라는 단어 자체는 평어에 쓰지 마세요.`
    : ''

  return `당신은 ${g} 담임 교사입니다. 한 학생이 한 학기 동안 쓴 글들의 기록을 보고, 학교생활기록부에 들어갈 "글쓰기/문해력 영역" 한 문장 평어 후보를 작성해주세요.

[학생이 쓴 글 기록] ${summaries?.length || 0}편
${body}${levelText}${standardsText}

[작성 규칙 — 매우 중요]
1. **한 문장 평어 후보 ${n}개**를 만드세요. 각 문장은 그 자체로 완결된 한 문장 평어.
2. **각 문장 60~80자**로, 구체적 근거(어떤 점에서 그러한지)를 담아 두루뭉술하지 않게.
3. 서로 다른 강조점으로 (예: 표현력 / 구성력 / 어휘 / 성실성 / 성장${std ? ' / 성취기준 도달' : ''}).
4. **등급 표현을 절대 쓰지 마세요.** "매우잘함/잘함/보통/노력요함" 같은 등급어, "○○ 수준" 표현 금지. 수준은 문장의 톤에만 반영.
5. **명사형 종결**로 쓰세요. ("~함", "~임", "~을 보임", "~이 돋보임", "~해 나감"). "~했어요", "~합니다", "~했다" 금지.
6. **긍정·발전 가능성 위주**로. 부정적 단정("~이 부족함", "~을 못함") 금지. 아쉬운 점은 "~을 익혀 나가고 있음", "~하려는 노력이 보임"처럼 진행·성장의 표현으로.
7. 개인정보(이름·구체적 사건)는 평어에 직접 쓰지 말 것.${std ? '\n8. 성취기준에 근거하여 도달 정도가 드러나게 쓰되, 성취기준 코드나 "성취기준"이라는 말은 직접 쓰지 말 것.' : ''}

[⚠️ 단어 다양성 — 매우 중요]
- "상상력", "창의력" 같은 특정 단어를 반복하지 마세요. 주제가 상상 글쓰기였더라도, 그것만 부각하지 말 것.
- 학생이 실제로 보인 글쓰기 능력을 **폭넓고 다양하게** 다루세요: 표현력·어휘력·문장 구성·글의 짜임·솔직한 감정 표현·구체적 묘사·논리적 전개·꾸준한 참여 태도·생각을 풀어내는 힘 등.
- 여러 후보 문장이 서로 **다른 능력**을 강조하도록. 같은 능력을 다른 말로 반복하지 말 것.

[중요]
- 실제 기록에 근거해서만 쓰세요. 없는 능력을 지어내지 말 것. 다만 표현은 늘 긍정적·발전적 방향으로.

[응답 형식]
▶ sentences: 한 문장 평어 후보 ${n}개 (배열). 위 규칙(60~80자, 명사형 종결, 등급어 없음, 구체적 근거)을 지킬 것.
   예: "일상에서 겪은 일을 솔직하게 떠올리고 감각적인 어휘로 구체적으로 묘사하여 장면이 생생하게 전달되도록 표현하는 능력이 돋보임."
▶ strengths: 이 학생 글쓰기의 강점 (교사 참고용 메모, 1-2문장)
▶ growth: 한 학기 동안의 성장/변화 (1-2문장, 변화가 뚜렷하지 않으면 현재 갖춘 점 중심)`
}

// ============================================
// 담임 코멘트 추천 프롬프트
// ============================================
// 교사의 기존 코멘트(말투 샘플)를 학습해, 현재 학생 글에 맞는
// 코멘트 초안을 그 선생님 말투로 생성.
export function commentSuggestPrompt({ styleSamples, essay, score, max, aiOverall, aiImprove }) {
  const samples = (styleSamples || []).filter(Boolean).slice(0, 15)
  const sampleText = samples.length >= 3
    ? `[이 선생님이 평소에 쓴 코멘트들] (말투·어조·이모지 사용 습관을 그대로 따라 하세요)
${samples.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : `[말투 참고] 이 선생님의 기존 코멘트가 부족해요. 따뜻하고 친근한 초등 담임 말투로 써주세요.`

  return `당신은 초등학교 담임 선생님입니다. 학생이 쓴 글에 남길 짧은 격려 코멘트 초안 2개를 만들어주세요.

${sampleText}

[학생이 쓴 글]
${(essay || '').slice(0, 800)}

[채점 결과] ${score ?? '?'} / ${max ?? 100}점
${aiOverall ? `[AI 총평 요약] ${String(aiOverall).slice(0, 200)}` : ''}
${aiImprove ? `[발전할 점 요약] ${String(aiImprove).slice(0, 200)}` : ''}

[작성 규칙]
1. **위 코멘트들의 말투를 그대로 따라 하세요** — 종결어미, 이모지 사용 여부·빈도, 호칭 습관, 문장 길이까지. 이 선생님이 직접 쓴 것처럼.
2. 이 학생 글의 **구체적인 내용을 언급**하세요. 누구에게나 할 수 있는 빈말 금지.
3. 각 코멘트는 1~3문장, 학생이 읽고 힘이 나는 따뜻한 내용.
4. 두 개는 서로 다른 방향으로: 하나는 칭찬 중심, 하나는 칭찬+다음 단계 제안.
5. 학생 이름이나 "○○" 같은 자리표시는 쓰지 마세요 (이름 없이 자연스럽게).
6. 점수가 낮아도 비난 금지 — 시도를 인정하고 한 걸음을 제안.

[응답 형식]
▶ comments: 코멘트 초안 2개 (배열)`
}

// admin 의견 분석 요약 프롬프트
export function feedbackSummaryPrompt({ feedbacks }) {
  const list = (feedbacks || [])
  const contents = list.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')
  return `다음은 "다온클래스" 교육용 웹앱에 들어온 ${list.length}개의 선생님 의견입니다. 카테고리별로 정리하고 우선순위와 대응 방안을 제안해주세요.

의견 목록:
${contents}

분석 형식:
- categories: 의견을 카테고리별로 묶기 (예: "기능 추가 요청", "버그 신고", "UI 개선" 등)
- priorityList: 우선순위 높은 의견 3-5개 (시급한 것부터)
- summary: 전체적인 인사이트 한 문단

이 분석 결과를 토대로 개발자(Claude)에게 다음 작업을 지시할 수 있도록 명확하게 정리해주세요.`
}

// 맞춤법·띄어쓰기만 골라내는 프롬프트 (교사 맞춤법 백필용)
export function grammarOnlyPrompt({ essay }) {
  return `다음 초등학생 글의 맞춤법과 띄어쓰기 오류를 찾아주세요.

학생 글:
${essay || ''}

규칙:
- 명백한 맞춤법/띄어쓰기 오류만 골라주세요
- original은 학생 글에 정확히 등장하는 표현이어야 합니다 (글자·공백·줄바꿈까지 있는 그대로 복사 — 띄어쓰기를 고친 형태로 적지 마세요)
- correction은 올바른 표기
- reason은 짧게 (예: "맞춤법 오류", "띄어쓰기")
- 안/않: '-지 않다/않는/않은/않을/않고'는 항상 '않'. '안'은 '안 가다'처럼 동사 앞 부사. 맞는 '않'을 '안'으로 고치지 마세요
- 문장을 처음부터 끝까지 하나씩 읽으며 맞춤법·띄어쓰기·조사·문장부호 오류를 빠짐없이 찾으세요. 표준에서 띄어쓰기가 갈리는 합성어(예: "멸종위기종")는 무리하게 띄우지 마세요
- 각 교정은 correction이 문법적으로 옳은지 확인한 뒤에만 포함하세요
- 빈 배열은 정말 오류가 하나도 없을 때만 쓰세요`
}

```

## lib/regrade.js

```js
// 🔄 AI 재평가 헬퍼
// 학생/주제 둘 다 공통 사용
// 이전 점수는 previous_* 컬럼에 백업 후 새 점수로 덮어쓰기

import { supabase } from './supabase'
import { callAI } from './aiClient'
import { mergeCorrections } from './koreanRules'

/**
 * 평가기준 hint가 비어있으면 AI로 자동 생성
 * (선생님이 만든 기준 이름만으로 채점 가이드 생성)
 */
async function ensureRubricHints(rubrics, topic) {
  const needHint = rubrics.filter(r => !r.hint || r.hint.trim().length < 5)
  if (needHint.length === 0) return rubrics // 모두 hint 있음 → 그대로

  try {
    // 🔒 프롬프트는 서버에서 구성 (키 서버격리 step153~: 키 인자 불필요)
    const result = await callAI('rubricHint', {
      topic: { title: topic.title, description: topic.description },
      rubrics,
    })

    if (!Array.isArray(result.rubrics)) return rubrics

    // 기존 rubrics + AI hint 병합
    return rubrics.map((r, i) => {
      if (r.hint && r.hint.trim().length >= 5) return r // 기존 유지
      const matched = result.rubrics.find(h => h.name === r.name) || result.rubrics[i]
      return {
        ...r,
        hint: matched?.hint || r.hint || ''
      }
    })
  } catch (e) {
    console.warn('hint 자동 생성 실패 (기존 rubrics로 진행):', e.message)
    return rubrics
  }
}

/**
 * 단일 글 재평가
 * @param {Object} submission - submissions row (essay_text, topic_id 필수)
 * @param {Object} topic - topics row (rubrics 포함)
 * @param {string} teacherId - 재평가를 실행한 선생님 ID
 * @returns {Promise<{success: boolean, error?: string, newScore?: number, oldScore?: number}>}
 */
export async function regradeSubmission(submission, topic, teacherId, opts = {}) {
  if (!submission || !topic) {
    return { success: false, error: '제출물/주제 정보 누락' }
  }
  if (!topic.rubrics || topic.rubrics.length === 0) {
    return { success: false, error: '평가기준이 없는 주제' }
  }
  if (!submission.essay_text) {
    return { success: false, error: '글 내용 없음' }
  }

  try {
    // 🆕 평가기준 hint 자동 보강 (없으면 AI가 만들어줌)
    const rubrics = await ensureRubricHints(topic.rubrics, topic)
    const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)

    // 🔒 프롬프트는 서버(/api/ai)에서 구성 — 핵심 IP 보호
    const result = await callAI('regrade', {
      topic: { title: topic.title, description: topic.description },
      essay: submission.essay_text,
      rubrics,
    })

    // 점수 검증 및 캡
    if (!Array.isArray(result.scores)) {
      result.scores = rubrics.map(r => Math.round(r.score * 0.7))
    }
    result.scores = result.scores.map((s, i) => {
      const max = rubrics[i]?.score || 25
      const n = Number(s) || 0
      return Math.max(0, Math.min(n, max))
    })
    if (typeof result.total !== 'number') {
      result.total = result.scores.reduce((a, b) => a + (Number(b) || 0), 0)
    }
    result.total = Math.max(0, Math.min(result.total, totalMax))

    // 🆕 rubric_reasons 검증: scores와 길이 맞추기
    if (!Array.isArray(result.rubric_reasons)) result.rubric_reasons = []
    while (result.rubric_reasons.length < result.scores.length) {
      result.rubric_reasons.push('')
    }
    result.rubric_reasons = result.rubric_reasons.slice(0, result.scores.length)

    // 🆕 improve_examples 검증
    if (!Array.isArray(result.improve_examples)) result.improve_examples = []
    result.improve_examples = result.improve_examples
      .filter(ex => ex && typeof ex === 'object' && ex.original && ex.suggested)
      .filter(ex => submission.essay_text.includes(ex.original))
      .slice(0, 3)

    // 이전 점수가 백업 안 된 경우만 백업 (재평가를 또 해도 최초 점수는 보존)
    const backupUpdate = {}
    if (submission.previous_scores === null || submission.previous_scores === undefined) {
      backupUpdate.previous_scores = submission.scores
      backupUpdate.previous_total_score = submission.total_score
      backupUpdate.previous_max_score = submission.max_score
      backupUpdate.previous_feedback_overall = submission.feedback_overall
      backupUpdate.previous_feedback_good = submission.feedback_good
      backupUpdate.previous_feedback_improve = submission.feedback_improve
    }

    // 🆕 어떤 모델로 채점됐는지 기록 (폴백 여부 판단)
    const usedModel = result.__usedModel || 'unknown'
    const MAIN_GRADING_MODEL = 'gemini-3.1-flash-lite'
    const isFallback = usedModel !== MAIN_GRADING_MODEL

    // DB 업데이트
    const { error } = await supabase.from('submissions').update({
      scores: result.scores,
      rubric_reasons: result.rubric_reasons,
      improve_examples: result.improve_examples,
      total_score: result.total,
      max_score: totalMax,
      feedback_overall: result.overall || '글을 잘 써주었어요!',
      feedback_good: result.good || '열심히 글을 썼어요.',
      feedback_improve: result.improve || '더 자세하게 써보세요.',
      corrections: mergeCorrections(Array.isArray(result.corrections) ? result.corrections : [], submission.essay_text),
      graded_with_model: usedModel,
      is_fallback_graded: isFallback,
      re_graded_at: new Date().toISOString(),
      re_graded_by: teacherId,
      ...backupUpdate
    }).eq('id', submission.id)

    if (error) throw error

    // 🆕 step261: 단일 재평가일 때만 예시 글 생성 (옵션). 실패해도 재평가 결과엔 영향 없음.
    if (opts.withExample === true) {
      try {
        const exResult = await callAI('exampleEssay', {
          topicTitle: topic.title,
          studentEssay: submission.essay_text,
        })
        if (exResult?.example) {
          await supabase.from('submissions').update({ example_text: exResult.example }).eq('id', submission.id)
        }
      } catch (exErr) {
        console.warn('재평가 예시 생성 실패 (재평가는 정상 완료):', exErr.message)
      }
    }

    return {
      success: true,
      newScore: result.total,
      oldScore: submission.total_score,
      maxScore: totalMax
    }
  } catch (e) {
    return { success: false, error: e.message || String(e) }
  }
}

```

## lib/sampleFeedback.js

```js
// ============================================
// step280: 신규 교사용 "맛보기" 샘플 AI 피드백 (정적/박제)
//   step282: 실제 학생 글("시간을 멈출 수 있다면")로 교체 — 신뢰감·현실성 ↑
// ============================================
// 신규 교사가 API 키 발급·학생 등록 등 긴 설정을 끝내기 전에는 실제 AI 피드백을
// 볼 수 없어 "쓸 만한지" 확인 못 하고 이탈한다. → 설정 전에 "샘플 학생 글 + 그 AI 피드백"을
// 미리 보여줘 가치를 체감시킨다. 실시간 AI 호출 없음(완전 정적), 비용·악용 0.
//
// 표시는 기존 components/StudentFeedbackCard.js 를 그대로 재사용한다(순수 props).
//   → 아래 객체는 StudentFeedbackCard 가 받는 { sub, topic } 형태와 100% 동일하게 박제.
//
// ⚠️ 절대 규칙: corrections[].original 은 essay_text 본문에 "글자 그대로" 존재해야 한다.
//   StudentFeedbackCard 의 filterValidCorrections 가 본문에서 못 찾는 교정은
//   밑줄·카운트에서 제외하므로, 없으면 맛보기가 깨진다.
//   (현재 6개 모두 essay_text.indexOf(original) >= 0 확인:
//    "들어간뒤" / "두번째" / "먹고 싶은것" / "멈춘뒤" / "세번째" / "한뒤")
// ※ essay_text 는 학생 원문 그대로(맞춤법 실수 포함) — 절대 고치지 말 것.
// ============================================

const ESSAY = '내가 만약 맘대로 시간이 멈출 수 있다면 먼저 하고 싶은 것은 콘서트 예약이다. 보통 티켓팅은 사람들이 같은 시간대에 몰려들어 티켓팅을 하기 때문에 힘들어질 수밖에 없다. 그래서 나는 미리 2분 전에 들어간뒤 시간이 되면 바로 시간을 멈춰버려 내가 바로 제일 앞 자리를 선택할 것이다. 두번째로 하고 싶은 것은 바로 먹고 싶은것 다 먹기이다. 나는 먹고 싶은게 정말 정말 수도 없이 많지만 다 먹기에는 내 몸과 시간이 부족하기 때문에 시간을 멈춘뒤 먹고 싶은 걸 마음껏 먹고 또 소화 시키고를 반복해 먹고 싶은 걸 다 먹어보고 싶다. 세번째로 하고 싶은 것은 다이어트이다. 다이어트는 계속 하게 된다면 힘들고 또 과하게 할 경우에는 위험할 수도 있기 때문에 나는 달리다 시간을 멈추고 쉬다가 또 시간을 다시 흐르게 한뒤 또 열심히 운동하며 나의 몸을 잘 관리 하고 싶다'

export const SAMPLE_TASTE = {
  topic: {
    title: '시간을 멈출 수 있다면',
    rubrics: [
      { name: '내용의 구체성', score: 30 },
      { name: '글의 짜임새', score: 30 },
      { name: '표현·어휘', score: 20 },
      { name: '맞춤법·띄어쓰기', score: 20 },
    ],
  },
  sub: {
    id: 'sample-taste',
    created_at: '2026-03-04T09:10:00+09:00',
    essay_text: ESSAY,
    total_score: 82,
    max_score: 100,
    // rubrics 와 같은 순서·길이
    scores: [27, 26, 16, 13],
    rubric_reasons: [
      "'시간 멈추기'라는 상상을 콘서트 예약·먹고 싶은 것 다 먹기·다이어트 세 가지로 구체적으로 풀어냈어요. +27점. 각 장면에 그때의 기분을 한 줄씩 더하면 더 생생해져요.",
      "'첫째·둘째·셋째'처럼 세 가지로 나눠 각각 '하고 싶은 것 + 이유'를 짝지어 쓴 짜임이 탄탄해요. +26점. 마지막에 전체를 묶는 마무리 문장을 더하면 완성도가 높아져요.",
      "'몰려들어', '마음껏', '소화 시키고를 반복해'처럼 상황을 살리는 표현을 잘 썼어요. +16점. 흉내내는 말이나 비유를 더하면 글맛이 더 살아나요.",
      "내용은 훌륭한데 의존명사('뒤', '것')와 '번째' 띄어쓰기가 여러 번 아쉬웠어요. +13점. 아래 빨간 밑줄만 고치면 훨씬 깔끔해져요.",
    ],
    feedback_overall: "'시간을 멈출 수 있다면'이라는 상상을 콘서트, 먹기, 운동까지 자기 생활과 연결해 구체적으로 풀어낸 점이 돋보여요. 흐름도 또렷하고 이유까지 잘 붙였어요. 띄어쓰기 몇 가지만 익히면 정말 완성도 높은 글이 될 거예요. 잘했어요!",
    feedback_good: "- '시간 멈추기'를 콘서트 예약·먹기·다이어트 세 가지로 구체적으로 상상했어요\n- 각 문단을 '하고 싶은 것 + 그 이유'로 짜임새 있게 전개했어요\n- 자기 생활과 연결해 솔직하고 재미있게 풀었어요",
    feedback_improve: "- 의존명사 '뒤'·'것'은 앞말과 띄어 써요 (들어간 뒤, 멈춘 뒤, 싶은 것). 규칙 하나라 한 번 익히면 쭉 고쳐져요\n- 순서를 나타내는 '번째'도 띄어 써요 (두 번째)\n- 마지막에 글 전체를 마무리하는 한 문장을 더해 보아요",
    improve_examples: [
      { original: '미리 2분 전에 들어간뒤 시간이 되면', suggested: '미리 2분 전에 들어간 뒤, 시간이 되면', reason: "의존명사 '뒤'는 앞말과 띄어 써요. '들어간 뒤'처럼요." },
      { original: '시간을 멈춘뒤 먹고 싶은 걸 마음껏 먹고', suggested: '시간을 멈춘 뒤, 먹고 싶은 걸 마음껏 먹고', reason: "여기도 '멈춘 뒤'로 띄어 쓰면 더 깔끔해요." },
    ],
    // ⚠️ 아래 original 6개는 위 ESSAY 본문에 글자 그대로 존재함(밑줄·카운트 일치). 등장 순서대로 정렬.
    corrections: [
      { original: '들어간뒤', correction: '들어간 뒤', reason: "의존명사 '뒤'는 앞말과 띄어 써요." },
      { original: '두번째', correction: '두 번째', reason: "순서를 나타내는 '번째'는 앞말과 띄어 써요." },
      { original: '먹고 싶은것', correction: '먹고 싶은 것', reason: "의존명사 '것'은 앞말과 띄어 써요." },
      { original: '멈춘뒤', correction: '멈춘 뒤', reason: "의존명사 '뒤'는 앞말과 띄어 써요." },
      { original: '세번째', correction: '세 번째', reason: "순서를 나타내는 '번째'는 앞말과 띄어 써요." },
      { original: '한뒤', correction: '한 뒤', reason: "의존명사 '뒤'는 앞말과 띄어 써요." },
    ],
  },
}

```

## lib/supabase.js

```js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'

const realClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,        // 브라우저에 세션 저장 (탭 닫아도 유지)
    autoRefreshToken: true,      // 토큰 자동 갱신
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'literacy-class-auth',
  }
})

// ============================================
// 임퍼소네이션 가드 (와이프 피드백 5번)
// ============================================
// 관리자가 다른 선생님 화면을 엿보는 중(?as= URL)에는
// 어떤 DB 쓰기도 일어나면 안 됨 (담임 모르게 = 데이터에 흔적 0)
// from(...).update/insert/delete/upsert 호출을 가로채서 차단
//
// 보호 대상 테이블: profiles, classes, topics, submissions 등 모든 비즈니스 테이블
// 제외: 'feedback'은 의견 작성 — 임퍼소네이션 중 사용자가 의견 안 보내니까 무관
//
// 차단 방식: 빈 결과 반환 + 콘솔 경고 (UI는 정상 동작처럼 보이지만 DB는 안 바뀜)
// ============================================
function isImpersonatingInBrowser() {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).has('as')
  } catch (e) {
    return false
  }
}

const WRITE_METHODS = ['update', 'insert', 'delete', 'upsert']
const BLOCKED_RESULT = Promise.resolve({
  data: null,
  error: { message: '엿보기 모드: 쓰기 작업이 차단되었습니다', code: 'IMPERSONATION_READONLY' }
})

function wrapBuilder(builder, tableName) {
  // 표 단위 from() 결과 객체를 감싸서, 쓰기 메서드만 가로챔
  return new Proxy(builder, {
    get(target, prop) {
      if (WRITE_METHODS.includes(prop)) {
        return (...args) => {
          if (isImpersonatingInBrowser()) {
            console.warn(`[impersonation] blocked ${prop} on ${tableName}`, args)
            // alert 한 번만 (페이지당)
            if (typeof window !== 'undefined' && !window.__impersonation_alerted) {
              window.__impersonation_alerted = true
              setTimeout(() => {
                alert('🔴 엿보기 모드에서는 변경할 수 없어요.\n관리자 페이지에서 본인 계정으로 작업하세요.')
                // 5초 후 다시 alert 허용
                setTimeout(() => { window.__impersonation_alerted = false }, 5000)
              }, 50)
            }
            // 그래도 builder 체이닝 (.select(), .eq() 등) 대응을 위해 chainable 반환
            return makeBlockedChain()
          }
          return target[prop].apply(target, args)
        }
      }
      return target[prop]
    }
  })
}

// 차단된 후의 체이닝(.select().eq().single() 등)도 안전하게 흡수
function makeBlockedChain() {
  const chain = new Proxy(function() {}, {
    get(t, prop) {
      if (prop === 'then') {
        // await 대응: 빈 결과 반환
        return (resolve) => resolve({ data: null, error: { message: 'blocked by impersonation' } })
      }
      // 모든 다른 메서드는 자기 자신을 반환 (체이닝 유지)
      return () => chain
    },
    apply() { return chain }
  })
  return chain
}

// supabase.from(...)을 가로채서 wrap된 builder 반환
export const supabase = new Proxy(realClient, {
  get(target, prop) {
    if (prop === 'from') {
      return (tableName) => wrapBuilder(target.from(tableName), tableName)
    }
    return target[prop]
  }
})

```

## lib/timeFormat.js

```js
// 🇰🇷 UTC ↔ 한국 시간 변환 헬퍼

/**
 * UTC 시간 문자열/Date → 한국 시간 "YYYY-MM-DD HH:MM"
 */
export const toKST = (utcStr) => {
  if (!utcStr) return ''
  try {
    const d = new Date(utcStr)
    if (isNaN(d.getTime())) {
      return typeof utcStr === 'string' ? utcStr.slice(0, 16).replace('T', ' ') : ''
    }
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    })
    return fmt.format(d).replace(',', '')
  } catch {
    return typeof utcStr === 'string' ? utcStr.slice(0, 16).replace('T', ' ') : ''
  }
}

/**
 * UTC 시간 문자열/Date → 한국 시간 "YYYY-MM-DD"
 */
export const toKSTDate = (utcStr) => {
  if (!utcStr) return ''
  try {
    const d = new Date(utcStr)
    if (isNaN(d.getTime())) {
      return typeof utcStr === 'string' ? utcStr.slice(0, 10) : ''
    }
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit'
    })
    return fmt.format(d)
  } catch {
    return typeof utcStr === 'string' ? utcStr.slice(0, 10) : ''
  }
}

```

## lib/useGrammarTooltip.js

```js
import { useEffect } from 'react'

/**
 * 맞춤법 빨간 밑줄 단어 위에 떠 있는 툴팁이
 * 모바일에서 화면 밖으로 짤리는 문제를 해결하는 공통 hook.
 *
 * 동작 방식:
 * - 페이지 어디에 있든 .grammar-error 요소를 탭/클릭하면
 *   document.body에 fixed 위치의 툴팁 div를 동적 생성.
 * - 화면 가장자리에서 짤리지 않도록 left/top을 viewport 안에 clamp.
 * - 다른 곳을 탭하거나 같은 단어를 다시 탭하면 닫힘.
 */
export default function useGrammarTooltip() {
  useEffect(() => {
    let activeTip = null
    let activeTarget = null

    const closeTip = () => {
      if (activeTip) {
        activeTip.remove()
        activeTip = null
        activeTarget = null
      }
    }

    const handler = (e) => {
      const target = e.target.closest && e.target.closest('.grammar-error')
      // 툴팁 자신을 클릭한 건 무시
      if (e.target.closest && e.target.closest('.grammar-tooltip')) return

      // 빨간 밑줄 단어가 아니면 → 열려있던 툴팁 닫기
      if (!target) {
        closeTip()
        return
      }

      // 같은 단어 다시 탭 → 닫기 (토글)
      if (target === activeTarget) {
        closeTip()
        return
      }

      // 새 툴팁 표시
      const correction = target.getAttribute('data-correction')
      if (!correction) return

      closeTip()

      const tip = document.createElement('div')
      tip.className = 'grammar-tooltip'
      tip.textContent = correction
      tip.style.cssText = [
        'position: fixed',
        'background: #1f2937',
        'color: white',
        'padding: 9px 13px',
        'border-radius: 8px',
        'font-size: 13px',
        'line-height: 1.5',
        'word-break: keep-all',
        'font-weight: 500',
        'box-shadow: 0 4px 14px rgba(0,0,0,0.18)',
        'z-index: 9999',
        'pointer-events: none',
        // 너비를 viewport에 맞게 제한
        'max-width: min(320px, calc(100vw - 24px))',
        'visibility: hidden', // 측정 후 보이게
      ].join(';')
      document.body.appendChild(tip)

      // 위치 계산
      const rect = target.getBoundingClientRect()
      const tipRect = tip.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const margin = 12

      // 가로 위치: 단어 가운데에 맞추되 화면 밖으로 안 나가게 clamp
      let left = rect.left + rect.width / 2 - tipRect.width / 2
      if (left < margin) left = margin
      if (left + tipRect.width > vw - margin) left = vw - tipRect.width - margin

      // 세로 위치: 기본은 단어 위, 위에 공간 없으면 아래
      let top = rect.top - tipRect.height - 8
      if (top < margin) top = rect.bottom + 8
      // 그래도 아래 공간 없으면 viewport 하단에 붙임
      if (top + tipRect.height > vh - margin) top = vh - tipRect.height - margin

      tip.style.left = left + 'px'
      tip.style.top = top + 'px'
      tip.style.visibility = 'visible'

      activeTip = tip
      activeTarget = target

      e.stopPropagation()
    }

    // 클릭/탭 모두 click 이벤트 하나로 처리 (touchstart는 이중 트리거 위험)
    document.addEventListener('click', handler)
    // 스크롤/리사이즈 시 닫기
    window.addEventListener('scroll', closeTip, true)
    window.addEventListener('resize', closeTip)

    return () => {
      document.removeEventListener('click', handler)
      window.removeEventListener('scroll', closeTip, true)
      window.removeEventListener('resize', closeTip)
      closeTip()
    }
  }, [])
}

```

## lib/usernameGen.js

```js
// 한글 초성 추출 유틸리티
// "한국초등학교" → "hgcdhg"
// "하랑초등학교" → "hrcdhg"

// 한글 자음 → 알파벳 매핑 (초성 표기용)
const INITIAL_TO_ALPHA = {
  'ㄱ': 'g', 'ㄲ': 'gg', 'ㄴ': 'n', 'ㄷ': 'd', 'ㄸ': 'dd',
  'ㄹ': 'r', 'ㅁ': 'm', 'ㅂ': 'b', 'ㅃ': 'bb', 'ㅅ': 's',
  'ㅆ': 'ss', 'ㅇ': 'h', 'ㅈ': 'j', 'ㅉ': 'jj', 'ㅊ': 'c',
  'ㅋ': 'k', 'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 'h'
}

const INITIAL_CONSONANTS = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']

/**
 * 한글 문자열의 초성을 알파벳으로 변환
 * @param {string} text - 한글 문자열 (예: "한국초등학교")
 * @returns {string} - 초성 알파벳 (예: "hgcdhg")
 */
export function toInitialAlpha(text) {
  if (!text) return ''
  let result = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    // 한글 음절 범위 (가-힣)
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const initialIdx = Math.floor((code - 0xAC00) / 588)
      const initialJamo = INITIAL_CONSONANTS[initialIdx]
      result += INITIAL_TO_ALPHA[initialJamo] || ''
    }
    // 영문/숫자는 그대로 (소문자)
    else if (/[a-zA-Z0-9]/.test(ch)) {
      result += ch.toLowerCase()
    }
  }
  return result
}

/**
 * 학교명에서 학교 prefix 추출 (초/중/고/대 제거)
 * "한국초등학교" → "한국초"
 * "서울중학교" → "서울중"
 */
function extractSchoolCore(schoolName) {
  if (!schoolName) return ''
  // "초등학교" / "중학교" / "고등학교" 같은 접미어를 짧게
  return schoolName
    .replace('초등학교', '초')
    .replace('중학교', '중')
    .replace('고등학교', '고')
    .replace('대학교', '대')
    .trim()
}

/**
 * 학생 아이디 자동 생성
 * 형식: [학교초성][학년][반][번호] (3자리 zero-padded)
 *
 * 예시:
 *   학교="한국초등학교", 학년=5, 반=1, 번호=1 → "hgc5101"
 *   학교="한국초등학교", 학년=5, 반=1, 번호=12 → "hgc5112"
 *   학교="하랑초등학교", 학년=5, 반=2, 번호=3 → "hrc5203"
 *
 * 학생이 외우기 좋고 충돌 가능성 낮음
 *
 * @param {object} opts
 * @param {string} opts.school - 학교 이름
 * @param {number|string} opts.grade - 학년 (1~6)
 * @param {number|string} opts.classNum - 반
 * @param {number|string} opts.number - 출석번호
 * @returns {string} 자동 생성된 아이디
 */
export function generateStudentUsername({ school, grade, classNum, number }) {
  const core = extractSchoolCore(school)
  const alpha = toInitialAlpha(core) || 'sch'
  const g = String(grade || '0').trim()
  const c = String(classNum || '0').trim()
  const n = String(number || '0').trim().padStart(2, '0')
  return `${alpha}${g}${c}${n}`.toLowerCase()
}

/**
 * 충돌이 있을 때 학교명 외에 추가 식별자를 붙이는 변형
 * @param {string} baseUsername
 * @param {number} suffix - 추가할 숫자
 */
export function makeUsernameVariant(baseUsername, suffix) {
  return `${baseUsername}${suffix}`
}

```

