// lib/koreanRules.js 회귀 게이트 스위트 (읽기 전용 — koreanRules는 import만, 수정 안 함)
//
// ▶ lib/koreanRules.js 수정 시 커밋 전 필수 실행:  node scripts/gate-korean-rules.js
//   과거 수정(step309~409)이 안 깨졌는지 자동 확인한다. 하나라도 FAIL이면 exit 1.
//
// 케이스는 "현재 코드가 실제로 잡는/안 잡는 동작"을 고정한 것이다(새 기대가 아니라 회귀 방지).
// 규칙을 의도적으로 바꿔 케이스가 바뀌면, 이 파일의 기대값도 같은 커밋에서 갱신할 것.
//
// ※ 실행 시 node가 "MODULE_TYPELESS_PACKAGE_JSON" 경고를 낼 수 있다(koreanRules가 ESM인데
//   package.json에 type 없음). 무해하며 게이트 결과에 영향 없음.

const path = require('path')
const { pathToFileURL } = require('url')

// findRuleBasedErrors(text)가 (original, correction) 쌍을 만들어야 하는 케이스.
// 값은 현재 규칙의 실제 출력을 실측해 고정(규칙마다 대표 1~2개).
const DETECT = [
  { name: "조사 '의'",        text: '아빠 의 몸',        original: '아빠 의',   correction: '아빠의' },
  { name: '어느날',           text: '어느날 아침에',      original: '어느날',    correction: '어느 날' },
  { name: '다른점',           text: '다른점이 있다',      original: '다른점',    correction: '다른 점' },
  { name: '멀리있',           text: '멀리있는 별',        original: '멀리있',    correction: '멀리 있' },
  { name: "이였다(들이 였다)", text: '외계인들이 였다',    original: '들이 였다', correction: '들이었다' },
  { name: '이였다(붙음)',      text: '외계인들이였다',     original: '들이였다',  correction: '들이었다' },
  { name: "시키다(화이트리스트)", text: '로봇을 정지 시켰다', original: '정지 시켰', correction: '정지시켰' },
  { name: '되다(본격화)',      text: '본격화 된 계획',     original: '본격화 된', correction: '본격화된' },
  { name: '하기위해',         text: '이기기위해 노력했다', original: '이기기위해', correction: '이기기 위해' },
  { name: '의존명사 것(는것)',  text: '방법이 없다는것과',  original: '는것',      correction: '는 것' },
  { name: '의존명사 것(을것)',  text: '읽으면 좋을것 같다', original: '을것',      correction: '을 것' },
  { name: '의존명사 거(는거)',  text: '먹을게 없는거 같다', original: '는거',      correction: '는 거' },
  { name: '의존명사 거(갈거)',  text: '학교에 갈거야',      original: '갈거',      correction: '갈 거' },
  { name: "것 이다",          text: '중요한 것 이다',     original: '것 이다',   correction: '것이다' },
  { name: '안/않(않좋)',       text: '기분이 않좋다',      original: '않좋',      correction: '안 좋' },
  { name: '안/않(않된)',       text: '그러면 않된다',      original: '않된',      correction: '안 된' },
  { name: '할수있다',         text: '나도 할수있다',      original: '할수있',    correction: '할 수 있' },
  { name: '첫번째',           text: '첫번째 도전',        original: '첫번째',    correction: '첫 번째' },
  { name: "의존명사 건(있는건)", text: '들어가 있는건 또',   original: '있는건',    correction: '있는 건' },   // step425
  { name: "의존명사 건(하는건)", text: '하는건 어렵다',      original: '하는건',    correction: '하는 건' },   // step425
  { name: '사리지다(집니다)',   text: '상자는 사리집니다',   original: '사리집니다', correction: '사라집니다' }, // step425
  { name: '사리지다(졌다)',     text: '갑자기 사리졌다',    original: '사리졌다',   correction: '사라졌다' },   // step425
]

// findRuleBasedErrors(text)가 아무 교정도 만들면 안 되는 케이스(과거 오탐 방지).
const NO_FALSE_POSITIVE = [
  { name: "'의좋은' 오탐",     text: '의좋은 형제 이야기' },
  { name: '고양이였다(정상)',   text: '그것은 고양이였다' },
  { name: '심부름 시켜서(본동사)', text: '동생에게 심부름 시켜서' },
  { name: '이것저것',          text: '이것저것 샀다' },
  { name: '근거가 있다',        text: '분명한 근거가 있다' },
  { name: '거리가 멀다',        text: '학교까지 거리가 멀다' },
  { name: '하락(하다 아님)',    text: '주가가 하락했다' },
  { name: '안아주고(안다 활용)', text: '엄마가 안아주고 웃었다' },
  { name: '별것(합성어)',       text: '별것 아니다' },
  { name: "'않고'(정상 활용)",  text: '먹지 않고 잤다' },
  { name: '물건(명사)',         text: '물건을 샀다' },           // step425
  { name: '사건(명사)',         text: '사건이 일어났다' },        // step425
  { name: '조건(명사)',         text: '조건이 맞다' },           // step425
  { name: '라면 사리(명사)',    text: '라면 사리를 추가했다' },   // step425
  { name: '사리 분별(명사)',    text: '사리 분별을 잘한다' },     // step425
]

// mergeCorrectionsDetailed(AI corrections, essay) 레벨 — 남는지(kept)/폐기(dropped)되는지.
const MERGE = [
  { name: '않기→안 기',           corr: { original: '않기',        correction: '안 기' },        essay: '지각하지 않기로 했다',   expect: 'dropped' },
  { name: '않지나있었다→안 지나 있었다', corr: { original: '않지나있었다', correction: '안 지나 있었다' }, essay: '1시간 밖에 않지나있었다', expect: 'kept' },   // step405
  { name: '모여 있다→모여 있어요', corr: { original: '모여 있다',   correction: '모여 있어요' },   essay: '아이들이 모여 있다',    expect: 'kept' },   // step409(문체 필터 없음)
  { name: '해결했습다→해결했습니다', corr: { original: '해결했습다', correction: '해결했습니다' }, essay: '문제를 해결했습다',    expect: 'kept' },
  { name: '막기위해→막기 위해',    corr: { original: '막기위해',    correction: '막기 위해' },    essay: '실수를 막기위해 애썼다', expect: 'kept' },
]

;(async () => {
  const krPath = path.join(__dirname, '..', 'lib', 'koreanRules.js')
  const kr = await import(pathToFileURL(krPath).href)
  const { findRuleBasedErrors, mergeCorrectionsDetailed, mergeCorrections } = kr

  const results = []
  const rec = (group, name, pass, detail) => results.push({ group, name, pass, detail })

  // DETECT: 기대 (original, correction) 쌍이 결과에 있어야 함
  for (const c of DETECT) {
    const errs = findRuleBasedErrors(c.text)
    const hit = errs.some(e => e.original === c.original && e.correction === c.correction)
    rec('DETECT', c.name, hit, hit ? `${c.original}→${c.correction}` : `기대 ${c.original}→${c.correction} 없음. 실제=${JSON.stringify(errs.map(e => e.original + '→' + e.correction))}`)
  }

  // NO_FALSE_POSITIVE: 빈 결과여야 함
  for (const c of NO_FALSE_POSITIVE) {
    const errs = findRuleBasedErrors(c.text)
    const pass = errs.length === 0
    rec('NO_FP', c.name, pass, pass ? '(없음)' : `오탐=${JSON.stringify(errs.map(e => e.original + '→' + e.correction))}`)
  }

  // MERGE: kept / dropped
  for (const c of MERGE) {
    const { corrections, dropped } = mergeCorrectionsDetailed([c.corr], c.essay)
    const kept = corrections.some(x => x.correction === c.corr.correction)
    const drp = dropped.find(x => x.correction === c.corr.correction)
    let pass, detail
    if (c.expect === 'kept') {
      pass = kept && !drp
      detail = kept ? 'corrections에 남음' : `안 남음(dropped=${drp ? drp.drop_reason : '없음'})`
    } else { // dropped
      pass = !kept && !!drp
      detail = drp ? `dropped(${drp.drop_reason})` : (kept ? 'corrections에 남음(폐기 안 됨)' : '사라짐(dropped 아님)')
    }
    rec('MERGE', c.name, pass, detail)
  }

  // MERGE(정규화): AI corrections의 비문자열 필드가 병합을 깨거나 살아남지 않는지 (step426)
  // 배경: AI가 correction·reason에 undefined/null/숫자를 주면 그대로 저장돼 학생 퀴즈 .trim() 크래시.
  //       original이 숫자면 snap 내부 .replace에서 merge 자체가 TypeError로 터지던 경로도 있었음.
  {
    // (1) correction이 undefined → 문자열 ''로 정규화되어 에러 없이 유지
    try {
      const { corrections } = mergeCorrectionsDetailed([{ original: '되요', correction: undefined }], '그러면 되요 라고 했다')
      const item = corrections.find(x => x.original === '되요')
      const pass = !!item && item.correction === '' && typeof item.correction === 'string' && typeof item.reason === 'string'
      rec('MERGE', 'correction undefined → 빈 문자열 정규화', pass, pass ? "correction=''(string)" : `실제=${JSON.stringify(item)}`)
    } catch (e) {
      rec('MERGE', 'correction undefined → 빈 문자열 정규화', false, `예외: ${e.message}`)
    }
    // (2) original이 숫자 → TypeError 없이 merge 완료 + '123'으로 문자열화
    try {
      const { corrections } = mergeCorrectionsDetailed([{ original: 123, correction: '테스트' }], '오늘 날씨가 좋다')
      const item = corrections.find(x => x.original === '123')
      const pass = !!item && typeof item.original === 'string'
      rec('MERGE', "original 숫자 → '123' 문자열화(에러 없음)", pass, pass ? "original='123'(string)" : `실제=${JSON.stringify(corrections)}`)
    } catch (e) {
      rec('MERGE', "original 숫자 → '123' 문자열화(에러 없음)", false, `예외: ${e.message}`)
    }
    // (3) reason이 null → 문자열 ''
    try {
      const { corrections } = mergeCorrectionsDetailed([{ original: '되요', correction: '돼요', reason: null }], '그러면 되요 라고 했다')
      const item = corrections.find(x => x.original === '되요')
      const pass = !!item && item.reason === '' && typeof item.reason === 'string'
      rec('MERGE', 'reason null → 빈 문자열 정규화', pass, pass ? "reason=''(string)" : `실제=${JSON.stringify(item)}`)
    } catch (e) {
      rec('MERGE', 'reason null → 빈 문자열 정규화', false, `예외: ${e.message}`)
    }
    // (4) 전수 검사: AI(비문자열 혼입) + 규칙 기반 병합 결과 전 항목이 세 필드 모두 string
    try {
      const { corrections } = mergeCorrectionsDetailed(
        [{ original: '되요', correction: undefined }, { original: 123, correction: '테스트', reason: null }],
        '어느날 되요 그리고 123 이야기'
      )
      const bad = corrections.filter(x => typeof x.original !== 'string' || typeof x.correction !== 'string' || typeof x.reason !== 'string')
      const pass = corrections.length > 0 && bad.length === 0
      rec('MERGE', '결과 전 항목 typeof string 전수 검사', pass, pass ? `${corrections.length}건 전부 string` : `비문자열 항목=${JSON.stringify(bad)}`)
    } catch (e) {
      rec('MERGE', '결과 전 항목 typeof string 전수 검사', false, `예외: ${e.message}`)
    }
  }

  // 하위호환: mergeCorrections(래퍼) === mergeCorrectionsDetailed().corrections
  {
    const essay = '아빠 의 몸은 따뜻했다. 어느날 아침 할수있다고 믿었다.'
    const same = JSON.stringify(mergeCorrections([], essay)) === JSON.stringify(mergeCorrectionsDetailed([], essay).corrections)
    rec('COMPAT', 'mergeCorrections === Detailed.corrections', same, same ? '동일' : '불일치')
  }

  // 출력
  let pass = 0, fail = 0
  let curGroup = ''
  for (const r of results) {
    if (r.group !== curGroup) { console.log(`\n[${r.group}]`); curGroup = r.group }
    if (r.pass) pass++; else fail++
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  — ${r.detail}`)
  }
  const total = pass + fail
  console.log(`\n전체 ${pass}/${total} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  // process.exit()는 파이프 출력 시 stdout을 flush 전에 잘라 표가 사라진다.
  // exitCode만 세팅하고 자연 종료시켜 출력이 온전히 나오게 한다.
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.message ? e.message : e); process.exitCode = 1 })
