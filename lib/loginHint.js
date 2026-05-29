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
