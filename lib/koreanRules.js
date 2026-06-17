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
      if (/[다았었은을으고지네도만][가-힣]?/.test(next + (text[match.index + 2] || ''))) continue
      if (['다','은','을','으','고','지','네','도','만','았','었','니','며','자','거','구'].includes(next)) continue
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

export function mergeCorrections(aiCorrections, essayText) {
  // AI corrections에서 안/않 오교정을 먼저 폐기(원문이 이미 맞으므로 대체 교정 만들지 않음)
  const ai = (Array.isArray(aiCorrections) ? aiCorrections : [])
    .filter(c => !isInvalidAnhToAn(c.original, c.correction))
  const ruleBased = findRuleBasedErrors(essayText)

  // AI가 이미 잡은 original을 set으로 만들기 (중복 회피)
  const aiOriginals = new Set(ai.map(c => c.original).filter(Boolean))

  // 규칙 기반에서 AI가 안 잡은 것만 추가
  for (const rb of ruleBased) {
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

  return ai
}
