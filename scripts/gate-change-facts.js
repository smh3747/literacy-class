// step608: 수정본 변경 사실(lib/changeFacts.js) 회귀 게이트 (읽기 전용 — lib는 import만, 네트워크·DB 접근 없음)
//
// ▶ lib/changeFacts.js 수정 시 커밋 전 실행:  node scripts/gate-change-facts.js
//   띄어쓰기·문장부호만 바뀐 수정본이 '내용 변경'(추가·삭제 문장)으로 집계되지 않는지,
//   notationOnly 플래그(spell 세션 프롬프트가 읽는 이름)가 정확히 그 경우에만 true인지 고정한다.
//   배경: 10/8 송림초 5-6 9회 제출 — 마침표 없는 한 문장에 띄어쓰기·마침표만 넣은 수정본이 "문장 N개 추가"로
//   집계돼 AI가 내용 항목을 전부 만점까지 올림(82→99).
//   하나라도 FAIL이면 exit 1.
//
// ※ 실행 시 node가 "MODULE_TYPELESS_PACKAGE_JSON" 경고를 낼 수 있다(무해).

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const { computeChangeFacts, normalizeNotation, notationEditAllowance, editDistance } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'changeFacts.js')).href)

  const results = []
  const rec = (group, name, pass, detail) => results.push({ group, name, pass, detail })
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const summary = (f) => f ? `prev ${f.prevChars}/cur ${f.curChars}/Δ${f.deltaPct}%/added ${f.addedCount}/removed ${f.removedCount}/notationOnly ${f.notationOnly}` : 'null'

  // ── NOTATION: 표기만 변경 → notationOnly=true, 추가·삭제 0, 글자 수 동일 ──
  {
    // (1) 실사례 모양: 마침표 없는 한 문장 → 띄어쓰기·마침표를 넣은 글
    const prev = '주말에가족과바다에갔다동생이파도가와하고소리쳤다정말재미있었다다음에또가고싶다'
    const cur = '주말에 가족과 바다에 갔다. 동생이 "파도가 와!" 하고 소리쳤다. 정말 재미있었다. 다음에 또 가고 싶다.'
    const f = computeChangeFacts(prev, cur)
    const ok = !!f && f.notationOnly === true && f.addedCount === 0 && f.removedCount === 0 && same(f.added, []) && same(f.removed, [])
      && f.prevChars === f.curChars && f.deltaPct === 0
    rec('NOTATION', '(1) 마침표 없는 한 문장 → 띄어쓰기·마침표 추가', ok, summary(f))
  }
  {
    // (2) 띄어쓰기만 변경(문장부호는 처음부터 있음)
    const prev = '나는 학교에서 친구와 놀았다. 재미있었다.'
    const cur = '나는 학교 에서 친구 와 놀았다. 재미 있었다.'
    const f = computeChangeFacts(prev, cur)
    const ok = !!f && f.notationOnly === true && f.addedCount === 0 && f.removedCount === 0 && f.prevChars === f.curChars
    rec('NOTATION', '(2) 띄어쓰기만 변경', ok, summary(f))
  }
  {
    // (3) 문장부호만 변경(쉼표·느낌표·말줄임표 추가, 따옴표 추가)
    const prev = '엄마가 말했다 빨리 와 나는 뛰어갔다'
    const cur = '엄마가 말했다. "빨리 와!" 나는 뛰어갔다…'
    const f = computeChangeFacts(prev, cur)
    const ok = !!f && f.notationOnly === true && f.addedCount === 0 && f.removedCount === 0 && f.prevChars === f.curChars
    rec('NOTATION', '(3) 쉼표·느낌표·말줄임표·따옴표만 추가', ok, summary(f))
  }
  {
    // (4) 줄바꿈·문단 나누기만 변경
    const prev = '첫째 날에는 바다에 갔다. 둘째 날에는 산에 갔다.'
    const cur = '첫째 날에는 바다에 갔다.\n\n둘째 날에는 산에 갔다.\n'
    const f = computeChangeFacts(prev, cur)
    const ok = !!f && f.notationOnly === true && f.addedCount === 0 && f.removedCount === 0
    rec('NOTATION', '(4) 줄바꿈·문단 나누기만 변경', ok, summary(f))
  }

  {
    // (5) 실사례 8→9차 모양: 띄어쓰기·마침표 추가 + 조사 교정 2곳(남자은→남자는) + 콜론 제거 → 편집거리 2 ≤ 허용치 3 → true
    const prev = '만약:발야구시합에서패한후느낀점이라면내친구가다른친구들에게화를냈다나는친절하고화를내지않으면서경기를진행하면좋겠다남자은화만내고여자들은화를내지않으면서경기를진행하는데남자은화를내면서하니너무어려운경기였다우리반은화내는반같다너무심한것같다나는경기가재미있으면됐는데우리반은너무화내서하니너무화내는것이라고하는거는내생각이다'
    const cur = '만약 발야구 시합에서 패한 후 느낀점이라면 내 친구가 다른 친구들에게 화를 냈다. 나는 친절하고 화를 내지 않으면서 경기를 진행하면 좋겠다. 남자는 화만 내고, 여자들은 화를 내지 않으면서 경기를 진행하는데, 남자는 화를 내면서 하니 너무 어려운 경기였다. 우리 반은 화내는 반 같다. 너무 심한 것 같다. 나는 경기가 재미있으면 됐는데 우리 반은 너무 화내서 하니 너무 화내는 것이라고 하는 거는 내 생각이다.'
    const f = computeChangeFacts(prev, cur)
    const ok = !!f && f.notationOnly === true && f.normEditDistance === 2 && f.prevChars === f.curChars
    rec('NOTATION', '(5) 실사례형: 띄어쓰기·마침표 추가 + 조사 교정 2곳 + 콜론 제거 → true(편집거리 2)', ok, summary(f) + ` dist=${f?.normEditDistance}`)
  }
  {
    // (6) 맞춤법 교정만 — 허용치는 글자 수 1%(최소 3·최대 6). 약 100자에 4곳 → false, 같은 4곳이 약 460자면 → true
    const body = '오늘은 학교에서 체육을 했다 친구와 피구를 하다가 공에 맞아서 아팠다 그래도 친구가 괜찮냐고 물어봐 줘서 기분이 나아졌다 다음에는 더 잘 피하고 싶다 집에 와서 엄마에게 이야기했더니 웃으셨다 '  // 정규화 약 90자
    const fixes = [['됬', '됐'], ['않', '안'], ['어떻해', '어떡해'], ['왠지', '웬지']]
    const tail = '그래서 기분이 좋아졌다 됬다 않 돼 어떻해 왠지 '
    const prevShort = body + tail                     // 약 100자(정규화) → 허용치 3
    const curShort = fixes.reduce((s, [a, b]) => s.replace(a, b), prevShort)
    const prevLong = body.repeat(5) + tail            // 약 460자 → 허용치 4
    const curLong = fixes.reduce((s, [a, b]) => s.replace(a, b), prevLong)
    const fs_ = computeChangeFacts(prevShort, curShort)
    const fl = computeChangeFacts(prevLong, curLong)
    const ok = !!fs_ && fs_.notationOnly === false && notationEditAllowance(fs_.prevChars) === 3
      && !!fl && fl.notationOnly === true && fl.normEditDistance === 4 && notationEditAllowance(fl.prevChars) === 4
    rec('NOTATION', '(6) 맞춤법 4곳 교정: 약 100자면 허용치 3 초과 → false / 약 460자면 허용치 4 → true', ok, `short: ${summary(fs_)} (allow ${notationEditAllowance(fs_?.prevChars || 0)}) / long: ${summary(fl)} dist=${fl?.normEditDistance} (allow ${notationEditAllowance(fl?.prevChars || 0)})`)
  }
  {
    // (7) 짧은 새 문장(7자)을 200자 글에 추가 → 허용치 3 초과 → false(내용 변경), added에 그 문장
    const body = '오늘은 학교에서 체육을 했다. 친구와 피구를 하다가 공에 맞아서 아팠다. 그래도 친구가 괜찮냐고 물어봐 줘서 기분이 나아졌다. 다음에는 더 잘 피하고 싶다. 집에 와서 엄마에게 이야기했더니 웃으셨다. 저녁에는 숙제를 하고 일찍 잤다. 내일은 체육이 없어서 조금 아쉽다. 그래도 수학 시간은 기대된다.'
    const f = computeChangeFacts(body, body + ' 정말 기쁜 하루였다.')
    const ok = !!f && f.notationOnly === false && same(f.added, ['정말 기쁜 하루였다.']) && f.normEditDistance === null
    rec('NOTATION', '(7) 200자 글에 7자 새 문장 → false(허용치 3 초과), added에 그 문장', ok, summary(f) + ` dist=${f?.normEditDistance}`)
  }
  {
    const ok = notationEditAllowance(50) === 3 && notationEditAllowance(400) === 4 && notationEditAllowance(1000) === 6 && notationEditAllowance(0) === 3
      && editDistance('남자은화만', '남자는화만') === 1 && editDistance('가나다', '가나다') === 0 && editDistance('가나다라마', '가', 2) === 3
    rec('NOTATION', '허용치: 50자→3·400자→4·1000자→6 / editDistance 기본·limit 조기 종료', ok, `${notationEditAllowance(50)},${notationEditAllowance(400)},${notationEditAllowance(1000)} / ${editDistance('남자은화만', '남자는화만')},${editDistance('가나다라마', '가', 2)}`)
  }

  // ── SAME: 글자 그대로 같은 글 → notationOnly=false, 추가·삭제 0, 글자 수 동일(프롬프트 기존 '변경 없음' 경로) ──
  {
    const prev = '주말에 가족과 바다에 갔다. 정말 재미있었다.'
    const f = computeChangeFacts(prev, prev)
    const f2 = computeChangeFacts(prev, `  ${prev}\n`)  // 앞뒤 공백만
    const ok = !!f && f.notationOnly === false && f.addedCount === 0 && f.removedCount === 0 && f.prevChars === f.curChars
      && !!f2 && f2.notationOnly === false && f2.addedCount === 0
    rec('SAME', '글자 그대로 동일(앞뒤 공백 차이 포함) → notationOnly=false·변경 0', ok, `${summary(f)} / trim: ${summary(f2)}`)
  }

  // ── CONTENT: 내용 변경 → notationOnly=false, 추가·삭제 문장 인용 ──
  const base = '주말에 가족과 바다에 갔다. 동생이 "누나, 파도가 와!" 하고 소리쳤다. 정말 재미있었다.'
  {
    // (a) 장난 줄 추가
    const prank = 'ㅋㅋㅋㅋ 몰라 몰라 아무거나'
    const f = computeChangeFacts(base, `${base} ${prank}`)
    const ok = !!f && f.notationOnly === false && same(f.added, [prank]) && f.addedCount === 1 && f.removedCount === 0 && f.curChars > f.prevChars && f.deltaPct > 0
    rec('CONTENT', '(a) 장난 줄 추가 → added에 그 줄, removed 0, 글자 수 증가', ok, summary(f))
  }
  {
    // (b-1) 문장 고쳐 쓰기(단어 교체) → 고치기 전은 removed, 고친 뒤는 added
    const cur = base.replace('정말 재미있었다.', '정말 신나는 하루였다.')
    const f = computeChangeFacts(base, cur)
    const ok = !!f && f.notationOnly === false && same(f.added, ['정말 신나는 하루였다.']) && same(f.removed, ['정말 재미있었다.'])
    rec('CONTENT', '(b-1) 문장 고쳐 쓰기(단어 교체) → 전/후 문장이 removed/added에', ok, summary(f) + ` added=${JSON.stringify(f?.added)} removed=${JSON.stringify(f?.removed)}`)
    // (b-2) 문장 확장(앞에 말 덧붙임) → 원래 문장은 새 문장에 포함되므로 삭제 아님. added만(내용이 늘었을 뿐 빠진 건 없음)
    const cur2 = base.replace('정말 재미있었다.', '파도가 발등을 간질여서 정말 재미있었다.')
    const f2 = computeChangeFacts(base, cur2)
    const ok2 = !!f2 && f2.notationOnly === false && same(f2.added, ['파도가 발등을 간질여서 정말 재미있었다.']) && f2.removedCount === 0
    rec('CONTENT', '(b-2) 문장 확장(말 덧붙임) → added만, removed 0', ok2, summary(f2) + ` added=${JSON.stringify(f2?.added)}`)
  }
  {
    // (c) 문장 삭제
    const cur = base.replace(' 정말 재미있었다.', '')
    const f = computeChangeFacts(base, cur)
    const ok = !!f && f.notationOnly === false && f.addedCount === 0 && same(f.removed, ['정말 재미있었다.']) && f.deltaPct < 0
    rec('CONTENT', '(c) 문장 삭제 → removed에 그 문장, 글자 수 감소', ok, summary(f))
  }
  {
    // (d) 문장부호 추가 + 새 문장 추가가 함께 → notationOnly=false, 새 문장만 added(기존 문장은 경계가 바뀌어도 추가 아님)
    const prev = '주말에가족과바다에갔다동생이파도가와하고소리쳤다정말재미있었다'
    const cur = '주말에 가족과 바다에 갔다. 동생이 "파도가 와!" 하고 소리쳤다. 정말 재미있었다. 다음에는 조개도 줍고 싶다.'
    const f = computeChangeFacts(prev, cur)
    const ok = !!f && f.notationOnly === false && same(f.added, ['다음에는 조개도 줍고 싶다.']) && f.addedCount === 1 && f.removedCount === 0
    rec('CONTENT', '(d) 표기 변경 + 새 문장 1개 → 새 문장만 added, 기존 문장은 추가 아님', ok, summary(f) + ` added=${JSON.stringify(f?.added)}`)
  }
  {
    // (e) 문장 순서만 바꿈 → added/removed 0, 글자 수 동일, notationOnly=false (프롬프트는 글자 수 동일+변경 0 → 기존 '변경 없음' 경로)
    const cur = '정말 재미있었다. 주말에 가족과 바다에 갔다. 동생이 "누나, 파도가 와!" 하고 소리쳤다.'
    const f = computeChangeFacts(base, cur)
    const ok = !!f && f.notationOnly === false && f.addedCount === 0 && f.removedCount === 0 && f.prevChars === f.curChars
    rec('CONTENT', '(e) 문장 순서만 바꿈 → 변경 0·글자 수 동일·notationOnly=false', ok, summary(f))
  }
  {
    // (f) 문장 합치기/나누기(내용 동일) → added/removed 0, notationOnly=true
    const prev = '바다에 갔다. 그리고 수영을 했다.'
    const cur = '바다에 갔다 그리고 수영을 했다.'
    const f = computeChangeFacts(prev, cur)
    const ok = !!f && f.addedCount === 0 && f.removedCount === 0 && f.notationOnly === true
    rec('CONTENT', '(f) 문장 합치기(마침표 제거)·내용 동일 → 변경 0', ok, summary(f))
  }
  {
    // (g) 같은 문장 반복 추가 → added 0(이미 포함된 내용), 글자 수 증가, notationOnly=false → 프롬프트 '변경 없음' 아님
    const f = computeChangeFacts(base, `${base} 정말 재미있었다.`)
    const ok = !!f && f.addedCount === 0 && f.removedCount === 0 && f.curChars > f.prevChars && f.notationOnly === false
    rec('CONTENT', '(g) 같은 문장 반복 → added 0·글자 수 증가·notationOnly=false', ok, summary(f))
  }

  // ── CAP: 5개 상한·120자 절단은 유지, addedCount는 상한 전 실제 개수 ──
  {
    const extra = Array.from({ length: 7 }, (_, i) => `새 문장 ${i + 1}번이다.`)
    const longLine = '아'.repeat(150) + '.'
    const f = computeChangeFacts(base, `${base} ${extra.join(' ')} ${longLine}`)
    const ok = !!f && f.added.length === 5 && f.addedCount === 8 && f.added.every(s => s.length <= 120)
    const f2 = computeChangeFacts(base, `${base} ${longLine}`)
    const ok2 = !!f2 && f2.added.length === 1 && f2.added[0].length === 120
    rec('CAP', '추가 8문장 → added 5개·addedCount 8 / 150자 문장 → 120자 절단', ok && ok2, `${summary(f)} added.length=${f?.added.length} / long=${f2?.added[0]?.length}`)
  }

  // ── GUARD: 입력 방어 ──
  {
    const ok = computeChangeFacts(null, 'a') === null && computeChangeFacts('a', undefined) === null
      && computeChangeFacts('', 'a') === null && computeChangeFacts('a', '   ') === null && computeChangeFacts(123, 'a') === null
    rec('GUARD', '비문자열·빈 문자열 → null', ok, '')
  }
  {
    const ok = normalizeNotation(' 가, 나. 다! "라"… (마): 바~사-아 ') === '가나다라마바사아' && normalizeNotation(null) === ''
    rec('GUARD', 'normalizeNotation: 공백·.,!?…:;~-·괄호·따옴표 제거', ok, `→ "${normalizeNotation(' 가, 나. 다! "라"… (마): 바~사-아 ')}"`)
  }

  // ── 결과 출력 ──
  let pass = 0, fail = 0
  let lastGroup = ''
  for (const r of results) {
    if (r.group !== lastGroup) { console.log(`\n[${r.group}]`); lastGroup = r.group }
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`)
    r.pass ? pass++ : fail++
  }
  console.log(`\n합계: ${pass + fail}건 중 PASS ${pass} · FAIL ${fail}`)
  if (fail > 0) process.exitCode = 1
})().catch(e => { console.error('게이트 실행 실패:', e); process.exitCode = 1 })
