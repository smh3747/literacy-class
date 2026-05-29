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
