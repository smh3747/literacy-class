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
