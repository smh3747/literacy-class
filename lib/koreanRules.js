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
      check: (m) => ((m.charCodeAt(0) - 0xAC00) % 28) === 8,
      build: (m) => m.replace('수있', ' 수 있'),
      reason: '"할 수 있다"는 띄어 써요'
    },
    // "할수없다" → "할 수 없다"
    {
      regex: /([가-힣])수없/g,
      check: (m) => ((m.charCodeAt(0) - 0xAC00) % 28) === 8,
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
      // '-지 않-' 보조용언 맥락 가드: '않' 앞 글자(공백 건너뛰고)가 '지'면("지않"·"지 않" 모두)
      // 정당한 보조용언이므로 교정을 만들지 않는다. (실사례: "없어지지 않나요"의 '않나' 오교정)
      // ※ 알려진 미검출: "편지 않쓰고"처럼 '지'로 끝나는 명사 뒤 오류는 놓침 — 미검출은 감수, 오교정은 금물.
      let k = match.index - 1
      while (k >= 0 && /\s/.test(text[k])) k--
      if (k >= 0 && text[k] === '지') continue
      const next = match[1]
      // "않다", "않았", "않은", "않을", "않으", "않고", "않지", "않네", "않도록", "않습니다" 등은 정상 활용
      if (/^[다았었은을으고지네도만는기음겠냐아던게세소습][가-힣]?/.test(next + (text[match.index + 2] || ''))) continue
      if (['다','은','을','으','고','지','네','도','만','았','었','니','며','자','거','구','는','기','음','겠','냐','아','던','게','세','소','습'].includes(next)) continue
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
    { wrong: '편한함', right: '편안함', reason: '"편안함"이 올바른 표기예요' }, // step447 (indexOf 기반이라 띄어진 '편한 함'은 미매칭)
  ]
  for (const t of COMMON_TYPOS) {
    let idx = 0
    while ((idx = text.indexOf(t.wrong, idx)) !== -1) {
      errors.push({ original: t.wrong, correction: t.right, reason: t.reason })
      idx += t.wrong.length
    }
  }

  // 조사 '의' 띄어쓰기: "아빠 의 몸" → "아빠의 몸"
  // '의' 앞뒤 모두 공백일 때만(독립 조사) 매칭. '의사/의견' 같은 단어 배제.
  {
    const pattern = /([가-힣]+)\s의(?=\s|[.,!?]|$)/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      const prev = match[1]
      // '의 좋은 형제'(전래동화 표현)는 '의좋은'의 띄어쓰기 오류라 앞말에 붙이지 않음.
      // lookahead라 match[0]에 뒤 공백이 없어 slice가 공백을 가리키므로 트림 후 '좋' 확인.
      if (text.slice(match.index + match[0].length).replace(/^\s+/, '').startsWith('좋')) continue
      errors.push({
        original: `${prev} 의`,
        correction: `${prev}의`,
        reason: "조사 '의'는 앞말에 붙여 써요"
      })
    }
  }

  // 관형사·부사 + 뒷말 붙여쓰기: 모양 고정된 것만
  // "어느날"→"어느 날", "다른점"→"다른 점", "멀리있"→"멀리 있"
  {
    const spacingPairs = [
      { wrong: '어느날', right: '어느 날', reason: '"어느 날"은 띄어 써요' },
      { wrong: '다른점', right: '다른 점', reason: '"다른 점"은 띄어 써요' },
      { wrong: '멀리있', right: '멀리 있', reason: '"멀리 있다"는 띄어 써요' },
    ]
    for (const p of spacingPairs) {
      let idx = 0
      while ((idx = text.indexOf(p.wrong, idx)) !== -1) {
        errors.push({ original: p.wrong, correction: p.right, reason: p.reason })
        idx += p.wrong.length
      }
    }
  }

  // 접미사 '시키다' 띄어쓰기: "작동 시킵니다" → "작동시킵니다"
  // '시키다'가 접미사로 확실히 붙는 동작성 명사만 화이트리스트로 잡는다.
  // ('심부름 시키다' '청소 시키다'처럼 본동사로 띄어 쓰는 경우 오탐을 피하려 좁게 한정)
  {
    const sikida = ['작동', '정지', '가동', '이동', '변화', '향상', '발전', '진정', '집중', '완성', '오염', '악화', '완화', '감소', '증가', '회복']
    for (const stem of sikida) {
      const pattern = new RegExp(`${stem}\\s(시[키켜킨킬킴킵켰])`, 'g')
      let match
      while ((match = pattern.exec(text)) !== null) {
        const tail = match[1]  // "시키" 또는 "시켜"
        errors.push({
          original: `${stem} ${tail}`,
          correction: `${stem}${tail}`,
          reason: "'시키다'는 앞말에 붙여 써요"
        })
      }
    }
  }

  // '이였다' → '이었다' — 단, '이'로 끝나는 명사(고양이·종이·민준이 등) 뒤 '였다'는 맞는 표현이라
  // 모양만으로 구분 불가. '이' 앞이 명사 일부일 수 없는 확실한 두 형태만 잡는다:
  // "~들이였다"(복수 '들'+조사 '이'), "~것이였다"(의존명사 '것'+조사 '이'). 나머지는 AI 담당.
  {
    const pattern = /(들|것)이였(다|고|어|을까|는데|지만|으니|어서)/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      const head = match[1]
      const tail = match[2]
      errors.push({
        original: `${head}이였${tail}`,
        correction: `${head}이었${tail}`,
        reason: '"이다"의 지난 일은 "이었다"로 써요 ("이였다"는 틀려요)'
      })
    }
  }

  // '였다' 분리형: "외계인들이 였다" → "외계인들이었다"
  // '였다'는 '이었다'의 준말이라 단독 어절 불가. 앞말 '이'가 명사 일부(고양이)인지
  // 조사(들이)인지 모양으로 구분 불가 → 조사 확정인 '들이·것이'로만 한정.
  {
    const pattern = /(들|것)이\s+였(다|고|어|을까|는데|지만|으니|어서)/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      const head = match[1]
      const tail = match[2]
      errors.push({
        original: match[0],
        correction: `${head}이었${tail}`,
        reason: '"이다"의 지난 일은 "이었다"로 붙여 써요'
      })
    }
  }

  // 접미사 '되다' 띄어쓰기: "마비 되는" → "마비되는"
  // '시키다'와 동일하게, 접미사로 확실히 붙는 동작성 명사만 화이트리스트로.
  {
    const doeda = ['마비', '완성', '오염', '악화', '완화', '진행', '지속', '중단', '해결', '변화', '발전', '회복', '감소', '증가', '반복', '완료', '충전', '방전', '작동', '본격화']
    for (const stem of doeda) {
      const pattern = new RegExp(`${stem}\\s(되[가-힣]+|된[가-힣]*|됐[가-힣]*|됨|됩[가-힣]*)`, 'g')
      let match
      while ((match = pattern.exec(text)) !== null) {
        const tail = match[1]  // "되는" "되어" "된다" 등 앞 두 글자
        errors.push({
          original: `${stem} ${tail}`,
          correction: `${stem}${tail}`,
          reason: "'되다'는 앞말에 붙여 써요"
        })
      }
    }
  }

  // 접미사 '하다' 띄어쓰기: "공개 해야" → "공개해야"
  // '하다'는 본동사 쓰임("요리를 해야")이 많아 확실한 동작성 명사만 화이트리스트로.
  // 둘째 글자를 활용 어미로 제한(하락·하루·하늘 같은 일반어 배제), 뒤 [가-힣]*로 활용 전체 캡처.
  {
    const hada = ['공개', '방지', '의무화', '본격화', '실천', '실현', '보장', '예방', '감소', '증가', '보호', '회복']
    for (const stem of hada) {
      const pattern = new RegExp(`${stem}\\s(하[는니다며면여겠려고지되자][가-힣]*|해[가-힣]*|했[가-힣]*|합니다|한다)`, 'g')
      let match
      while ((match = pattern.exec(text)) !== null) {
        const tail = match[1]
        errors.push({
          original: `${stem} ${tail}`,
          correction: `${stem}${tail}`,
          reason: "'~하다'가 붙은 말은 앞말에 붙여 써요"
        })
      }
    }
  }

  // '~기 위해' 띄어쓰기: "하기위해" → "하기 위해"
  // 명사형 어미 '기' + '위해'는 항상 띄움. "기위해"가 붙는 정당한 단어는 없어 예외 없음.
  {
    const pattern = /([가-힣]+기)위해/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      const head = match[1]
      errors.push({
        original: `${head}위해`,
        correction: `${head} 위해`,
        reason: "'~기 위해'는 띄어 써요"
      })
    }
  }

  // ─────────────────────────────────────────────
  // 의존명사 '것/거' 띄어쓰기: 관형사형 어미 뒤의 '것/거'는 띄어 쓴다.
  // "없다는것"→"없다는 것", "좋을것"→"좋을 것", "갈거야"→"갈 거야"
  // 관형사형(ㄹ받침 / '는' / '던') 바로 뒤일 때만 잡아 '이것·별것' 등 오탐 방지.
  // ('은'받침은 '근거·논거'류 오교정 위험이 커 제외 — 미검출은 감수, 오교정은 금물)
  // ─────────────────────────────────────────────
  {
    // 명사 일부인 '것/거'(합성어·구어)는 건드리지 않는다
    const DEP_COMPOUNDS = ['이것', '그것', '저것', '아무것', '별것', '날것', '들것', '탈것', '물것', '별거']
    // 앞 한글 1글자 + 것/거 + (뒤가 조사·문장부호·공백·끝)일 때만
    const pattern = /([가-힣])(것|거)(?=[\s.,!?)"']|은|는|이|가|을|를|과|와|도|만|야|다|의|$)/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      const prev = match[1]
      const dep = match[2]
      if (DEP_COMPOUNDS.includes(prev + dep)) continue
      // 관형사형 어미 판별: 앞 음절이 ㄹ받침(종성 8)이거나 '는'·'던'
      const jong = (prev.charCodeAt(0) - 0xac00) % 28
      if (jong !== 8 && prev !== '는' && prev !== '던') continue
      errors.push({
        original: `${prev}${dep}`,
        correction: `${prev} ${dep}`,
        reason: `'${dep}'은 앞말과 띄어 써요`
      })
    }
  }

  // 의존명사 '것' + 조사 '이다' 결합: "것 이다" → "것이다"
  // 서술격 조사 '이다'는 앞말에 붙여 쓴다.
  {
    const pattern = /것\s+(이다|이고|이라|이야|입니다|이에요|이었다)/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      errors.push({
        original: `것 ${match[1]}`,
        correction: `것${match[1]}`,
        reason: "'이다'는 앞말에 붙여 써요"
      })
    }
  }

  // 의존명사 '건'('것은'의 준말) 띄어쓰기: "있는건" → "있는 건"
  // 물건·사건·조건 같은 명사 오탐 위험이 커서(앞이 '는'이 아님) '는건' 패턴만 잡는다.
  {
    const pattern = /([가-힣])는건(?=[\s.,!?이가을를도만]|$)/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      errors.push({
        original: `${match[1]}는건`,
        correction: `${match[1]}는 건`,
        reason: "'건'은 앞말과 띄어 써요"
      })
    }
  }

  // 관형형 'ㄹ' + 의존명사 '때' 붙여쓰기: "살때"→"살 때", "할때"→"할 때", "그럴때"→"그럴 때"
  // '때' 뒤가 경계(공백·문장부호·조사 에/는/가/도/마다/부터/까지·끝)일 때만 — '볼때기'(뺨) 오탐 방지.
  // '그때·이때·한때·제때'는 앞이 ㄹ받침이 아니라 구조적으로 제외. '물때'(끼는 때)는 ㄹ받침 정당 단어라 명시 제외.
  {
    const pattern = /([가-힣])때(?=[\s.,!?]|에|는|가|도|마다|부터|까지|$)/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      const prev = match[1]
      if (((prev.charCodeAt(0) - 0xac00) % 28) !== 8) continue  // ㄹ받침만
      if (prev === '물') continue  // '물때'는 한 단어
      errors.push({
        original: `${prev}때`,
        correction: `${prev} 때`,
        reason: "'때'는 앞말과 띄어 써요"
      })
    }
  }

  // 숫자 + '만원' 붙여쓰기: "150만원"→"150만 원" (단위명사 '원'은 띄어 씀)
  // 숫자 바로 뒤 '만원'만 — 한글 수사('오만원' 등)는 숫자가 아니라 구조적 제외(오탐 위험 회피).
  {
    const pattern = /(\d+)만원/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      errors.push({
        original: `${match[1]}만원`,
        correction: `${match[1]}만 원`,
        reason: `"만 원"처럼 돈 단위 '원'은 띄어 써요`
      })
    }
  }

  // 부사 '다' + '같은/같이' 붙여쓰기: "다같은 옷"→"다 같은", "다같이 놀자"→"다 같이"
  // '다' 앞이 한글이면 제외 — "바다같이 넓다"의 '같이'는 조사라 붙여 쓰는 게 맞음(오탐 방지).
  // '다같-'으로 시작하는 정당한 단어 없음('다같이'는 '다 같이'의 비표준 붙여쓰기).
  {
    const pattern = /다같(은|이)/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      const prev = text[match.index - 1]
      if (prev && /[가-힣]/.test(prev)) continue
      errors.push({
        original: `다같${match[1]}`,
        correction: `다 같${match[1]}`,
        reason: `'다 같${match[1]}'처럼 '다'는 띄어 써요`
      })
    }
  }

  // '사라지다'의 오타 '사리지다': 활용형 커버 위해 정규식으로(COMMON_TYPOS는 단순 치환이라 부적합).
  // 명사 '사리'(라면 사리·사리 분별)는 뒤 글자가 목록에 없어 매칭 안 됨.
  // ※ 알려진 잔여 오탐: '몸을 사리진 않았다'·'도사리진' 같은 드문 활용이 '진'에 걸릴 수 있음(5학년 글에서 극히 드묾).
  {
    const pattern = /사리(집니다|진다|졌다|져서|지고|지면|질|진)/g
    let match
    while ((match = pattern.exec(text)) !== null) {
      errors.push({
        original: `사리${match[1]}`,
        correction: `사라${match[1]}`,
        reason: "'사라지다'가 올바른 표현이에요"
      })
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
// 정당한 '않→안' 교정 화이트리스트: 붙여 쓴 '안다'(품에 안다) 동사 활용형으로의 교정은 통과.
// 실전 과차단(07-06): "않아주고→안아주고"(옳은 교정)가 차단됨. 아래 두 검사가 모두 공백을
// 제거한 교정문으로 판정해 "안 아"(불가능 형태)와 "안아"(안다 활용)를 구분 못 하던 맹점.
// fail-safe: 명시된 활용형(안아·안고·안으며)만, 아래 조건 전부 충족할 때만 예외. 애매하면 차단 쪽.
function isAndaVerbCorrection(original, correction) {
  const o = String(original || '')
  const c = String(correction || '')
  // '-지 않-' 보조용언 문맥이면 예외 아님 ("먹지 않아→먹지 안아" 오교정은 기존대로 차단)
  if (/지\s*않/.test(o)) return false
  const oNoWs = o.replace(/\s+/g, '')
  const cNoWs = c.replace(/\s+/g, '')
  if (!/않/.test(oNoWs)) return false
  // 순수 않→안 치환만 (다른 글자 변화가 있으면 예외 아님)
  if (oNoWs.replace(/않/g, '안') !== cNoWs) return false
  // 띄어 쓴 '안 '(부사꼴)이 있거나 '안'으로 끝나면 예외 아님 ("않기→안 기", "않나→안 나" 차단 유지)
  if (/안\s/.test(c) || /안$/.test(cNoWs)) return false
  // 교정문의 모든 '안'이 명시된 안다 활용형(안아/안고/안으며)으로 이어져야 함
  const anParts = cNoWs.match(/안[가-힣]{1,2}/g) || []
  return anParts.length > 0 && anParts.every(p => /^안(아|고|으며)/.test(p))
}

// 안/않 오교정 차단(false positive 가드):
// 보조용언 '-지 않-'(않는/않은/않을/않고/않다…)은 항상 '않'. 맞는 '않'을 '안'으로 바꾸는 교정은 무조건 틀림.
// original의 '않'을 전부 '안'으로 치환한 게 correction과 같고, 그 '안'이 활용어미 앞이면 오교정으로 판정.
// (안/않 능동 탐지는 추가하지 않음 — 과교정 유발. 여기선 "맞는 걸 틀리게 바꾸는 교정"만 폐기.)
function isInvalidAnhToAn(original, correction) {
  if (!original || !correction) return false
  // 붙여 쓴 '안다' 동사 활용형으로의 정당 교정은 오교정 아님 (위 화이트리스트)
  if (isAndaVerbCorrection(original, correction)) return false
  // '않' + 어미(습니다/습니까/습디다…)를 '안 ' + 어미로 쪼갠 교정은 무조건 오교정.
  // '안'은 부사라 뒤에 어미가 홀로 올 수 없음 → "안 습니다"는 존재 불가 형태.
  {
    const oNoWs = String(original).replace(/\s+/g, '')
    const cNoWs = String(correction).replace(/\s+/g, '')
    // 원문이 '않습/않습니/않습니다' 계열인데 교정이 '안'으로 시작하며 '습'을 어미로 떼어낸 경우
    if (/않습/.test(oNoWs) && /^안/.test(cNoWs) && oNoWs.replace(/않/g, '안') === cNoWs) {
      return true
    }
  }
  const o = String(original).replace(/\s+/g, '')
  const c = String(correction).replace(/\s+/g, '')
  if (!/않/.test(o)) return false
  // 부정부사 '안'+띄어쓴 용언은 정당 교정 → 검사(1)(2) 모두 제외.
  // '안 ' 뒤에 한글이 2글자 이상 이어질 때만(진짜 용언 "안 지나"·"안 고파"). 한 글자 어미뿐인 "안 아"·"안 은"은 계속 차단.
  // ("안 습니다"류는 위 '않습' 블록·isImpossibleCorrection이 이미 차단하므로 안전)
  if (/안\s[가-힣][가-힣]/.test(correction)) return false
  // (1) 순수 치환: original의 '않'을 전부 '안'으로 치환한 결과가 correction과 같고,
  //     그 '안'이 활용어미 앞이면(=원래 보조용언 '않') 무조건 오교정
  if (o.replace(/않/g, '안') === c && /안[는은을던고다아았지게며나도세기음겠냐]/.test(c)) return true
  // (2) 비순수 치환: AI가 다른 글자·어미도 함께 바꿔 (1)의 완전일치를 빠져나가는 경우
  //     (예: "않기로 했다" → "안 기로 했어요"). 원문에 정당한 '않+어미' 활용형이 있는데
  //     교정에서 '않' 개수가 줄고 '안+어미 조각'이 생겼으면 오교정으로 판정.
  //     정당 교정은 통과: "않되→안 돼"(되는 어미 아님), "하지않고→하지 않고"(않 개수 그대로).
  //     fail-safe: "보지 않았다→안았다" 같은 의미 재작성형도 차단되지만 그건 교정이 아니므로 과차단 허용.
  const ENDINGS = '다고지기아은는을으았었네습겠도던게며니냐자거소세음만'
  return new RegExp(`않[${ENDINGS}]`).test(o) &&
    (c.match(/않/g) || []).length < (o.match(/않/g) || []).length &&
    new RegExp(`안[${ENDINGS}]`).test(c)
}

// fail-safe 최종 필터: correction 모양 자체가 한국어에 불가능한 형태면 생성 경로 불문 폐기.
// '안'은 부사라 뒤에 용언(동사·형용사)이 와야 함. "안 기", "안 습니다"처럼
// '안 ' 뒤에 어미 조각이 홀로 오는 교정은 원문이 뭐든 무조건 오교정.
// ※ 어미 목록에서 빠진 게 있어도 "오교정 하나를 못 거름"으로 끝날 뿐,
//   정당한 교정("안 좋아요" 등 용언 시작)은 절대 안 버림 — 실패 방향이 안전한 나열.
// 기·게·지·고는 용언 시작 글자이기도 해 (?![가-힣])로 '뒤에 글자 없을 때'만 어미로 판정.
// '기'만은 뒤에 조사가 붙은 꼴("안 기로 했다", "안 기를")도 잡음 — 부사 '안' 뒤에
// 명사구 '기+조사'가 홀로 올 수 없어 안전. '기는'은 동사 '기다'의 "안 기는"이 정당해 제외.
function isImpossibleCorrection(correction) {
  if (!correction) return false
  const c = String(correction)
  // "안 " 뒤가 어미 조각으로 시작하면 불가능 형태
  return /(^|[^가-힣])안\s(기[를로가만에]?(?![가-힣])|음|게(?![가-힣])|지(?![가-힣])|고(?![가-힣])|다(?![가-힣])|는|은|을|습|았|었|겠|냐|니(?![가-힣])|며|서(?![가-힣])|요(?![가-힣]))/.test(c)
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

// 🆕 mergeCorrections의 본체 — 필터에서 폐기된 항목까지 함께 반환하는 버전.
// 오교정 자동 감시(품질 모니터)에서 "AI가 뭘 잘못 시도했는지"를 기록하기 위한 관찰 지점.
// 반환: { corrections: [...최종 배열...], dropped: [...폐기 항목(+drop_reason)...] }
//  - drop_reason '안않오교정': isInvalidAnhToAn에 걸린 항목 (AI·규칙기반 양쪽 경로)
//  - drop_reason '불가능형태': isImpossibleCorrection에 걸린 항목
//  - 무의미 교정(original===correction)과 중복 회피(dedup)는 오교정이 아니므로 기록 안 함.
export function mergeCorrectionsDetailed(aiCorrections, essayText) {
  const dropped = []
  // AI corrections 정규화: 필드가 비문자열(undefined/숫자/객체)이어도 이후 단계·저장·화면이 안전하게.
  // original이 없거나 빈 항목은 화면에 표시 불가라 제거. (규칙 기반 산출물은 전부 문자열이라 영향 없음)
  const normalized = (Array.isArray(aiCorrections) ? aiCorrections : [])
    .map(c => {
      if (!c || typeof c !== 'object') return null
      const original = c.original == null ? '' : String(c.original)
      const correction = c.correction == null ? '' : String(c.correction)
      const reason = c.reason == null ? '' : String(c.reason)
      if (!original.trim()) return null
      return { ...c, original, correction, reason }
    })
    .filter(Boolean)
  // AI corrections에서 안/않 오교정을 먼저 폐기(원문이 이미 맞으므로 대체 교정 만들지 않음)
  // 이어서 original을 본문 실제 문자열로 스냅(확실할 때만) — 띄어쓰기 교정에서 AI가
  // 공백을 '정리'해 본문과 어긋나던 original을 미래 저장분에 한해 바로잡는다.
  const ai = normalized
    .filter(c => {
      if (isInvalidAnhToAn(c.original, c.correction)) {
        dropped.push({ ...c, drop_reason: '안않오교정' })
        return false
      }
      return true
    })
    .map(c => snapOriginalToEssay(c, essayText))
  const ruleBased = findRuleBasedErrors(essayText)

  // AI가 이미 잡은 original을 set으로 만들기 (중복 회피)
  const aiOriginals = new Set(ai.map(c => c.original).filter(Boolean))

  // 규칙 기반에서 AI가 안 잡은 것만 추가
  for (const rb of ruleBased) {
    // 🆕 step257: 규칙기반 경로에도 안/않 오교정 가드 적용 (맞는 '않'을 '안'으로 바꾸는 항목 폐기)
    if (isInvalidAnhToAn(rb.original, rb.correction)) {
      dropped.push({ ...rb, drop_reason: '안않오교정' })
      continue
    }
    // 정확히 같은 original이 AI에 있으면 건너뛰기
    if (aiOriginals.has(rb.original)) continue
    // 또는 AI의 어떤 original이 이 ruleBased의 original을 포함하면 건너뛰기
    // (예: AI가 "왔다.그래서 아침에"로 잡았다면, "왔다.그래서"는 중복)
    const isContained = ai.some(c =>
      c.original && String(c.original).includes(rb.original)
    )
    if (isContained) continue

    ai.push(rb)
  }

  // 🆕 original과 correction이 사실상 동일한(고칠 게 없는) 교정 제거.
  // 예: AI가 "제 4조" → "제 4조"처럼 똑같이 주는 경우.
  // trim 후 같을 때만 버림 → 내부 공백이 다른 유효 띄어쓰기 교정("제 4조"→"제4조")은 유지.
  // (무의미 교정은 노이즈라 dropped에도 넣지 않음)
  const corrections = ai.filter(c => {
    const o = (c && c.original != null) ? String(c.original).trim() : ''
    const k = (c && c.correction != null) ? String(c.correction).trim() : ''
    if (!o) return false   // original 없으면 화면에 표시 불가 → 제거
    return o !== k         // trim 후 완전히 같으면(고칠 것 없음) 제거
  }).filter(c => {
    if (isImpossibleCorrection(c.correction)) {
      dropped.push({ ...c, drop_reason: '불가능형태' })
      return false
    }
    return true
  })

  return { corrections, dropped }
}

// 기존 호출부용 래퍼 — 최종 corrections만 반환 (동작 불변).
export function mergeCorrections(aiCorrections, essayText) {
  return mergeCorrectionsDetailed(aiCorrections, essayText).corrections
}
