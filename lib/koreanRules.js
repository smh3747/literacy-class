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
      check: (m, before) => /[ㄹ을를던]/.test(before.slice(-1)) || ['할','갈','올','볼','쓸','읽을','만들','이룰'].some(p => m.startsWith(p)),
      build: (m) => m.replace('수있', ' 수 있'),
      reason: '"할 수 있다"는 띄어 써요'
    },
    // "할수없다" → "할 수 없다"
    {
      regex: /([가-힣])수없/g,
      check: (m, before) => /[ㄹ을를던]/.test(before.slice(-1)) || ['할','갈','올','볼','쓸','읽을','만들','이룰'].some(p => m.startsWith(p)),
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
