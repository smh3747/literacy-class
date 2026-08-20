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
      // step572: 삭제된 계정 강제 종료 — 전 기기 로그아웃(global 기본값) 의도적 유지
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
