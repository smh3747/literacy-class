// step673: 관리자 "🧪 시험 학생으로 열기" — 순수 함수(브라우저·서버 공용). 게이트: scripts/gate-test-student.js
//   실검증 때 관리자가 시험 전용 학생으로 한 번에 로그인해, 제출·채점이 실제 학생 경로를 그대로 타게 한다.
//   원칙: 관리자 권한을 학생 쓰기 경로에 풀지 않는다(엿보기 쓰기 차단 불변). 진짜 학생 세션으로 바꿔 탄다.
//   안전: 전환 대상은 아래 상수의 "칸 번호"로만 고른다. 서버 API는 학생 id·아이디를 입력으로 받지 않는다.
//         그래서 실제 학생 계정으로는 어떤 요청으로도 전환할 수 없다.

// 시험 반(가입 코드 6975)
export const TEST_CLASS_ID = 'f0b64c29-1ec2-45a0-aa20-887b74c991b3'

// 시험 전용 학생 아이디(칸 1·2). 계정은 scripts/make-test-students.mjs로 만든다.
export const TEST_STUDENT_USERNAMES = ['sihum6975a', 'sihum6975b']
export const TEST_STUDENT_NICKNAMES = ['시험 학생 1', '시험 학생 2']

export const TEST_EMAIL_DOMAIN = 'writing.class'

// 칸 번호(1부터) → 아이디. 정수 1~N만 통과, 그 밖은 null.
export function testUsernameOfSlot(slot) {
  if (typeof slot !== 'number' || !Number.isInteger(slot)) return null
  if (slot < 1 || slot > TEST_STUDENT_USERNAMES.length) return null
  return TEST_STUDENT_USERNAMES[slot - 1]
}

export function testEmailOfSlot(slot) {
  const u = testUsernameOfSlot(slot)
  return u ? `${u}@${TEST_EMAIL_DOMAIN}` : null
}

/**
 * 이 프로필이 지정된 시험 학생인가. 넷 다 맞아야 true:
 *   역할 student · 시험 반 소속 · 아이디가 지정 목록에 있음 · 삭제되지 않음
 */
export function isTestStudentProfile(profile) {
  if (!profile || typeof profile !== 'object') return false
  if (profile.role !== 'student') return false
  if (profile.class_id !== TEST_CLASS_ID) return false
  if (typeof profile.username !== 'string' || !TEST_STUDENT_USERNAMES.includes(profile.username)) return false
  if (profile.deleted_at) return false
  return true
}

/**
 * 로그인 링크를 내줘도 되는가(서버 최종 판정). 하나라도 어긋나면 이유 문자열, 통과면 null.
 * @param {{ slot, profile, authUser, linkUserId }} p
 *   profile    : profiles 행(아이디·시험 반으로 찾은 것)
 *   authUser   : 그 id의 인증 계정({ id, email })
 *   linkUserId : 발급된 링크가 가리키는 계정 id(발급 뒤 대조, 발급 전에는 생략)
 */
export function testStudentRefusal({ slot, profile, authUser, linkUserId } = {}) {
  const username = testUsernameOfSlot(slot)
  if (!username) return 'bad_slot'
  if (!isTestStudentProfile(profile)) return 'not_test_student'
  if (profile.username !== username) return 'slot_mismatch'
  if (!authUser || authUser.id !== profile.id) return 'auth_mismatch'
  if (String(authUser.email || '').toLowerCase() !== testEmailOfSlot(slot)) return 'email_mismatch'
  if (linkUserId !== undefined && linkUserId !== profile.id) return 'link_mismatch'
  return null
}

// ── 시험 창의 로그인 분리 ──
//   같은 브라우저에서 관리자 창과 시험 학생 창이 로그인을 덮어쓰지 않게, 시험 창은 세션을 그 탭 안(sessionStorage)에만 둔다.
//   착지 주소(/test-student)로 들어온 탭에 표식을 남기고, 표식이 있는 탭은 저장 위치·저장 이름을 따로 쓴다.
export const TEST_TAB_PATH = '/test-student'
export const TEST_TAB_FLAG = 'daon_test_student_tab'
export const AUTH_STORAGE_KEY = 'literacy-class-auth'
export const TEST_AUTH_STORAGE_KEY = 'literacy-class-auth-test'

/**
 * 이 탭이 시험 창인가. 착지 주소면 표식을 남긴다(부작용은 넘겨받은 저장소에만).
 * @param {{ pathname?: string, sessionStore?: { getItem, setItem } }} env
 */
export function isTestTab({ pathname, sessionStore } = {}) {
  if (!sessionStore) return false
  try {
    if (pathname === TEST_TAB_PATH) sessionStore.setItem(TEST_TAB_FLAG, '1')
    return sessionStore.getItem(TEST_TAB_FLAG) === '1'
  } catch (_) { return false }
}
