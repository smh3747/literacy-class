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
