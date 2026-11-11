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

// ── step674: 시험 주제 자동 준비 ──
//   "시험 학생으로 열기"를 누를 때 시험 반에 오늘 날짜 주제가 없으면, 서버가 가장 최근 학급 주제를 복사해 하루 1개 만든다.
export const TEST_TOPIC_PREFIX = '[시험] '

/**
 * 복사해서 넣을 주제 행. 원본이 쓸 수 없으면 null.
 *   원본 조건: 시험 반 담임의 학급 주제(공급 원본·챌린지 복사본 아님), 제목·평가 기준 있음.
 *   복사하는 것: 제목(앞에 "[시험] ")·설명·평가 기준·글자 수·다시 쓰기 설정. 시간 잠금·마감·공급 표식은 복사하지 않는다.
 */
export function buildTestTopicRow(src, { today, teacherId } = {}) {
  if (!src || typeof src !== 'object') return null
  if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null
  if (!teacherId || src.teacher_id !== teacherId) return null
  if (src.supply_type || src.source_supply_id) return null
  if (typeof src.title !== 'string' || !src.title.trim()) return null
  if (!Array.isArray(src.rubrics) || src.rubrics.length === 0) return null
  const baseTitle = src.title.startsWith(TEST_TOPIC_PREFIX) ? src.title.slice(TEST_TOPIC_PREFIX.length) : src.title
  return {
    date: today,
    title: TEST_TOPIC_PREFIX + baseTitle,
    description: src.description ?? null,
    rubrics: src.rubrics,
    teacher_id: teacherId,
    class_id: src.class_id ?? null,
    lock_enabled: false,
    min_length: src.min_length ?? null,
    max_length: src.max_length ?? null,
    max_rewrites: src.max_rewrites ?? null,
    require_rewrite_change: src.require_rewrite_change ?? null,
  }
}

// ── step674: 관리자 집계에서 시험 반 제외 ──
//   켜 두면 관리자 합산 카드(학생·누적 글쓰기·오늘)와 "⏱ 채점 시간"·시도·구간 표에서 시험 반(6975) 전체를 뺀다.
//   교사·학생 화면과 학급별 표, 실제 학급의 집계 방식에는 영향이 없다.
export const EXCLUDE_TEST_CLASS_FROM_ADMIN_STATS = true

export function isExcludedFromAdminStats(classId) {
  return EXCLUDE_TEST_CLASS_FROM_ADMIN_STATS && !!classId && classId === TEST_CLASS_ID
}

// 합계에서 시험 반 몫을 뺀 값. 숫자가 아니면 그대로 둔다(빼기 조회가 실패해도 종전 값 유지). 0 아래로 내려가지 않는다.
export function minusTestClass(total, testCount) {
  const t = Number(total) || 0
  if (!EXCLUDE_TEST_CLASS_FROM_ADMIN_STATS) return t
  const c = Number(testCount)
  if (!Number.isFinite(c) || c <= 0) return t
  return Math.max(0, t - c)
}

// ── step674: 시험 글 정리 ──
//   지정된 시험 학생의 글만 휴지통으로 보낸다(완전 삭제 아님, 기존 휴지통 흐름과 같은 3필드).
export const TEST_CLEANUP_REASON = '시험 글 정리(관리자)'
