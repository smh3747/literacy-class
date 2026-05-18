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
export function mergeCorrections(aiCorrections, essayText) {
  const ai = Array.isArray(aiCorrections) ? [...aiCorrections] : []
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
