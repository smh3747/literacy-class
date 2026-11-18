// ============================================
// step683: 학생 홈 "틀 먼저" — 오늘 주제 카드만 이 기기에 잠깐 적어 둔다.
// ============================================
// 배경: 학생 홈은 조회가 모두 끝나야 화면이 떴다(그동안 "로딩 중..." 한 줄). 틀을 먼저 그리고,
//   어제도 오늘도 같은 기기를 쓰는 학생에게는 방금 전에 본 오늘 주제 카드를 먼저 보여 준다.
// 원칙(공용 태블릿):
//   - 적는 것은 주제 카드 4칸(id·title·description·date)뿐. 점수·제출 여부·수정 가능 여부·시간 잠금·채점 대기 상태는 적지 않는다.
//   - 키에 학생 id와 한국 날짜를 넣는다. 다른 학생·다른 날짜의 것은 읽지 않고, 진입할 때 지운다.
//   - 로그아웃하면 전부 지운다.
//   - 이 카드는 보여 주기만 한다. 글쓰기 칸과 [제출]은 서버 응답이 와야 열린다(틀 화면에는 입력 칸이 없다).
// 순수 함수(저장소를 인자로 받는다) — 게이트가 가짜 저장소로 검증한다.

export const HOME_TOPIC_PREFIX = 'lc-home-topic:'
export const HOME_TOPIC_FIELDS = ['id', 'title', 'description', 'date']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export function homeTopicKey(studentId, day) {
  if (!UUID_RE.test(String(studentId || '')) || !DAY_RE.test(String(day || ''))) return null
  return `${HOME_TOPIC_PREFIX}${studentId}:${day}`
}

// 주제 행에서 카드 4칸만 고른다(그 밖의 칸은 버린다).
export function pickHomeTopicFields(topic) {
  if (!topic || typeof topic !== 'object' || !topic.id || !topic.title) return null
  const out = {}
  for (const k of HOME_TOPIC_FIELDS) out[k] = topic[k] === undefined || topic[k] === null ? '' : String(topic[k])
  return out
}

// 읽기: 이 학생·오늘 것만. 날짜가 다르거나 모양이 이상하면 null.
export function readHomeTopic(storage, studentId, day) {
  try {
    const key = homeTopicKey(studentId, day)
    if (!storage || !key) return null
    const raw = storage.getItem(key)
    if (!raw) return null
    const picked = pickHomeTopicFields(JSON.parse(raw))
    if (!picked || picked.date !== day) return null
    return picked
  } catch (_) { return null }
}

// 쓰기: 오늘 날짜의 주제만 적는다(지난 주제·날짜 없는 주제는 적지 않는다).
export function writeHomeTopic(storage, studentId, day, topic) {
  try {
    const key = homeTopicKey(studentId, day)
    const picked = pickHomeTopicFields(topic)
    if (!storage || !key || !picked || picked.date !== day) return false
    storage.setItem(key, JSON.stringify(picked))
    return true
  } catch (_) { return false }
}

function homeKeys(storage) {
  const keys = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k.indexOf(HOME_TOPIC_PREFIX) === 0) keys.push(k)
    }
  } catch (_) { /* 저장소 접근 불가 */ }
  return keys
}

// 진입할 때: 이 학생·오늘 것만 남기고 나머지(다른 학생·지난 날짜)를 지운다. 지운 개수를 돌려준다.
export function sweepHomeTopic(storage, studentId, day) {
  if (!storage) return 0
  const keep = homeTopicKey(studentId, day)
  let n = 0
  for (const k of homeKeys(storage)) {
    if (k === keep) continue
    try { storage.removeItem(k); n++ } catch (_) {}
  }
  return n
}

// 로그아웃할 때: 전부 지운다.
export function clearHomeTopic(storage) {
  if (!storage) return 0
  let n = 0
  for (const k of homeKeys(storage)) { try { storage.removeItem(k); n++ } catch (_) {} }
  return n
}

// 브라우저 저장소(없으면 null). 서버 렌더·사생활 보호 모드에서 던지지 않는다.
export function homeStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch (_) { return null }
}
