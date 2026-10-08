// 📐 step595/608: 수정본 vs 직전 글 변경 사실 계산 — 순수 함수(서버·스크립트 공용, 프롬프트 내용 없음).
//   서버(pages/api/ai.js type 'rewriteGrading')가 직전 본문과 수정본을 넣어 계산하고, 결과를
//   rewriteGradingPrompt(lib/prompts.server.js)의 changeFacts 인자로 넘긴다. 모델이 "분량이 줄었다"를
//   지어내지 못하게 하는 서버 측 사실. scripts/gate-change-facts.js가 검증한다.
//
//   step608 표기 정규화: 띄어쓰기·문장부호만 바뀐 것을 '내용 변경'으로 세지 않는다.
//   배경(10/8 송림초 5-6, 9회 제출): 첫 글이 마침표 없는 한 문장이라, 띄어쓰기·마침표만 넣은 수정본이
//   "문장 N개 추가"로 집계돼 AI가 내용 항목을 전부 만점까지 올렸다(82→99).
//   - 글자 수(prevChars·curChars): 공백·문장부호(NOTATION_CHARS)를 뺀 길이.
//   - 문장 비교: 줄바꿈·./!/? 로 나눈 뒤 각 문장의 정규화 키가 상대 글 전체(정규화)에 부분 문자열로
//     있으면 '같은 내용'. 완전 일치 대신 포함 판정을 쓰는 이유는 문장 경계가 바뀌어도(마침표 없던 한 덩어리 글 ↔
//     마침표로 나뉜 여러 문장, 문장 합치기·나누기) 같은 내용이면 추가·삭제로 잡지 않기 위해서다.
//     방향은 보수적(추가를 적게 잡음 → 인용할 문장이 없으면 점수 상승 불가)이라 점수 부풀림 쪽 오류는 안 난다.
//   - notationOnly(boolean): 글자 그대로는 다르지만 내용은 같은 글 → true. 두 경우다.
//       ① 정규화하면 완전히 같음(띄어쓰기·문장부호만 변경)
//       ② 정규화한 두 글의 편집거리가 아주 작음(맞춤법 수준의 글자 교정: 됬→됐, 않→안, 남자은→남자는).
//          허용치 = max(NOTATION_EDIT_MIN, 글자 수×NOTATION_EDIT_RATIO)이고 NOTATION_EDIT_MAX를 넘지 않는다.
//          (실사례 8→9차: 띄어쓰기·마침표 추가 + 조사 교정 2곳 → 편집거리 2.) 짧은 문장 하나를 새로 넣은 것도
//          허용치 안에 들 수 있으나(최대 6자), 그 정도는 내용 항목 점수를 바꿀 변화가 아니다.
//     프롬프트(spell 세션)가 이 이름을 읽어 "맞춤법·문법 항목 외의 항목은 직전 점수와 동일" 지시를 넣는다.
//     글자 그대로 같은 글은 false(추가·삭제 0 + 글자 수 동일 → 프롬프트의 기존 '변경 없음' 경로).
//   - normEditDistance: 정규화한 두 글의 편집거리(같으면 0, 허용치를 크게 넘으면 계산 생략 → null). 로그·검증용.
//   - addedCount·removedCount: 5개 상한을 적용하기 전 실제 개수(added·removed 배열은 상한·120자 절단 유지).
//   순수 함수, 실패하면 null(채점은 항상 계속).

export const CHANGE_FACTS_MAX_SENTENCES = 5
export const CHANGE_FACTS_SENTENCE_CHARS = 120
export const NOTATION_EDIT_MIN = 3
export const NOTATION_EDIT_MAX = 6
export const NOTATION_EDIT_RATIO = 0.01

// 표기로 취급해 비교에서 빼는 글자: 공백 전부 + 문장부호(. , ! ? … : ; ~ - ·) + 따옴표·괄호류.
export const NOTATION_CHARS = /[\s.,!?…:;~\-·"'“”‘’()[\]{}]/g

// 공백·문장부호를 뺀 비교용 문자열
export function normalizeNotation(s) {
  return String(s == null ? '' : s).replace(NOTATION_CHARS, '')
}

// 맞춤법 수준 교정으로 볼 편집거리 허용치(정규화 글자 수 기준)
export function notationEditAllowance(chars) {
  return Math.min(NOTATION_EDIT_MAX, Math.max(NOTATION_EDIT_MIN, Math.floor(chars * NOTATION_EDIT_RATIO)))
}

// Levenshtein 편집거리. limit을 넘는 게 확실하면 바로 limit+1을 돌려준다(긴 글에서 낭비 방지).
export function editDistance(a, b, limit = Infinity) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > limit) return limit + 1
    prev = cur
  }
  return prev[b.length]
}

// 줄바꿈·./!/? 기준 문장 분리. 인용용 텍스트(공백 압축한 원문)와 비교용 키(정규화)를 함께 돌려준다.
function splitSentences(s) {
  return s
    .replace(/([.!?])\s*/g, '$1\n')
    .split('\n')
    .map(x => x.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map(text => ({ text, key: normalizeNotation(text) }))
    .filter(x => x.key)  // 문장부호만 있는 조각 제외
}

export function computeChangeFacts(prevText, curText) {
  try {
    if (typeof prevText !== 'string' || typeof curText !== 'string') return null
    if (!prevText.trim() || !curText.trim()) return null
    const prevNorm = normalizeNotation(prevText)
    const curNorm = normalizeNotation(curText)
    const prevChars = prevNorm.length
    const curChars = curNorm.length
    const deltaPct = prevChars > 0 ? Math.round((curChars - prevChars) / prevChars * 100) : null
    const allowance = notationEditAllowance(Math.max(prevChars, curChars))
    const dist = editDistance(prevNorm, curNorm, allowance)
    const normEditDistance = dist > allowance ? null : dist
    const notationOnly = prevText.trim() !== curText.trim() && dist <= allowance
    // 상대 글 전체(정규화)에 포함되지 않는 문장만 추가/삭제. 같은 키는 한 번만.
    const pick = (sentences, otherNorm) => {
      const seen = new Set()
      const out = []
      for (const s of sentences) {
        if (seen.has(s.key)) continue
        seen.add(s.key)
        if (!otherNorm.includes(s.key)) out.push(s.text)
      }
      return out
    }
    const addedAll = pick(splitSentences(curText), prevNorm)
    const removedAll = pick(splitSentences(prevText), curNorm)
    const cap = (arr) => arr.slice(0, CHANGE_FACTS_MAX_SENTENCES).map(x => x.slice(0, CHANGE_FACTS_SENTENCE_CHARS))
    return {
      prevChars, curChars, deltaPct,
      added: cap(addedAll),
      removed: cap(removedAll),
      addedCount: addedAll.length,
      removedCount: removedAll.length,
      notationOnly,
      normEditDistance,
    }
  } catch (e) {
    console.warn('변경 사실 계산 실패(무시):', e?.message)
    return null
  }
}
