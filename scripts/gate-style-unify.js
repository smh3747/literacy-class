// step623: styleUnify 표식(lib/styleUnify.js) 회귀 게이트 (읽기 전용 — lib는 import만, 네트워크·DB 접근 없음)
//
// ▶ lib/styleUnify.js 수정 시 커밋 전 실행:  node scripts/gate-style-unify.js
//   서버가 정한 "소수 문장 → 다수 문체 통일" 교정에만 styleUnify: true 가 붙고,
//   일관된 글·소수 문장 밖 교정·끝맺음이 다수 문체가 아닌 교정에는 붙지 않는지 고정한다.
//   배경: C-1 일일 스캔이 반말→존댓말 교정을 전부 '문체개입'으로 적재해 옳은 통일 교정(10/8 "마쳤다→마쳤습니다")이
//   의심 교정 탭에 쌓임. 하나라도 FAIL이면 exit 1.
//
// ※ 실행 시 node가 "MODULE_TYPELESS_PACKAGE_JSON" 경고를 낼 수 있다(무해).

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const { tagStyleUnify } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'styleUnify.js')).href)

  const results = []
  const rec = (group, name, pass, detail) => results.push({ group, name, pass, detail })
  const flags = (list) => list.map(c => c.styleUnify === true ? 1 : 0).join('')
  const C = (original, correction, reason = '') => ({ original, correction, reason })

  // 존댓말 다수(4문장) + 반말 1문장 — 10/8 실사례 모양
  const FORMAL_MAJ = '오늘은 학교에서 독서 수업을 했습니다. 저는 동화책을 골랐어요. 책을 다 읽고 느낀 점을 썼습니다. 우리 반에는 책을 소중히 다루는 법이 있다. 다음에도 열심히 읽겠습니다.'
  // 반말 다수(4문장) + 존댓말 1문장
  const PLAIN_MAJ = '주말에 가족과 바다에 갔다. 파도가 정말 컸다. 동생과 모래성을 만들었다. 점심은 김밥을 먹었어요. 다음에 또 가고 싶다.'

  // ── TAG: 표식이 붙어야 하는 경우 ──
  {
    const input = [C('됬어요', '됐어요', "'됬'은 없는 글자예요"), C('있다', '있습니다', '존댓말로 통일해요'), C('골랐어요', '골랐습니다', '존댓말 맞춤')]
    const out = tagStyleUnify(input, FORMAL_MAJ)
    const ok = flags(out) === '010' && out.length === 3 && out[1].original === '있다' && out[1].correction === '있습니다' && out[1].reason === '존댓말로 통일해요'
      && !('styleUnify' in out[0]) && !('styleUnify' in out[2])
    rec('TAG', '존댓말 다수+반말 1문장: 통일 교정에만 부여, 다른 교정·순서·필드 불변', ok, `flags=${flags(out)} len=${out.length}`)
  }
  {
    const out = tagStyleUnify([C('우리 반에는 책을 소중히 다루는 법이 있다.', '우리 반에는 책을 소중히 다루는 법이 있습니다.')], FORMAL_MAJ)
    rec('TAG', '소수 문장 통째 original(마침표 포함) → 부여', flags(out) === '1', `flags=${flags(out)}`)
  }
  {
    const out = tagStyleUnify([C('법이있다', '법이 있습니다')], FORMAL_MAJ)
    rec('TAG', '공백 차이(법이있다 vs 본문 법이 있다) → 정규화 후 부여', flags(out) === '1', `flags=${flags(out)}`)
  }
  {
    const out = tagStyleUnify([C('있다', '있어요')], FORMAL_MAJ)
    rec('TAG', '다수 문체가 ~요 끝맺음이어도 부여', flags(out) === '1', `flags=${flags(out)}`)
  }
  {
    const out = tagStyleUnify([C('먹었어요', '먹었다', '반말로 통일')], PLAIN_MAJ)
    rec('TAG', '반말 다수+존댓말 1문장: 존댓말→반말 통일에 부여', flags(out) === '1', `flags=${flags(out)}`)
  }

  // ── step660: '아니다' 예외(spell 659 정합) + 끝 기호 ; : ──
  // 존댓말 다수(4문장) + '아니다' 1문장 — 핸드오버 §13 "아니다→아니에요" 실사례 모양
  const FORMAL_MAJ_ANIDA = '오늘은 학교에서 독서 수업을 했습니다. 저는 동화책을 골랐어요. 책을 다 읽고 느낀 점을 썼습니다. 책은 장난감이 아니다. 다음에도 열심히 읽겠습니다.'
  {
    const out = tagStyleUnify([C('아니다', '아니에요', '존댓말로 통일해요')], FORMAL_MAJ_ANIDA)
    rec('TAG', "step660 ① 존댓말 다수 글의 '아니다.'→'아니에요.' → 부여('아니다'는 반말 끝)", flags(out) === '1', `flags=${flags(out)}`)
  }
  {
    const out = tagStyleUnify([C('책은 장난감이 아니다.', '책은 장난감이 아닙니다.')], FORMAL_MAJ_ANIDA)
    rec('TAG', "step660 ① 문장 통째 '아니다.'→'아닙니다.' → 부여", flags(out) === '1', `flags=${flags(out)}`)
  }
  {
    // 존댓말 다수(4문장) + 반말 1문장, 글 안에서 그 문장 뒤에 쌍반점이 붙은 모양 → AI original "할것이다.;"
    const essay = '오늘은 학교에서 독서 수업을 했습니다. 저는 동화책을 골랐어요. 책을 다 읽고 느낀 점을 썼습니다. 앞으로 더 열심히 할 것이다.; 다음에도 열심히 읽겠습니다.'
    const out = tagStyleUnify([C('할것이다.;', '할 것입니다.')], essay)
    rec('TAG', "step660 ② original '할것이다.;'(쌍반점 끝) → '할 것입니다.' → 부여(끝 기호 ; 제거)", flags(out) === '1', `flags=${flags(out)}`)
    const out2 = tagStyleUnify([C('할것이다:', '할 것입니다.')], essay)
    rec('TAG', "step660 ② original '할것이다:'(콜론 끝) → 부여(끝 기호 : 제거)", flags(out2) === '1', `flags=${flags(out2)}`)
  }
  {
    // 반말 다수(4문장, '아니다' 포함) + 존댓말 1문장 — minority가 'formal'이라 '아니다→아니에요'는 소수 문장 밖
    const essay = '주말에 가족과 바다에 갔다. 파도가 정말 컸다. 바다는 수영장이 아니다. 점심은 김밥을 먹었어요. 다음에 또 가고 싶다.'
    const out = tagStyleUnify([C('아니다', '아니에요', '존댓말')], essay)
    rec('NOTAG', "step660 ③ 반말 다수 글의 '아니다'→'아니에요' → 미부여(minority=formal, 종전과 같음)", flags(out) === '0', `flags=${flags(out)}`)
  }

  // ── NOTAG: 표식이 붙지 않아야 하는 경우 ──
  {
    const essay = '주말에 가족과 바다에 갔다. 파도가 정말 컸다. 동생과 모래성을 만들었다. 다음에 또 가고 싶다.'
    const out = tagStyleUnify([C('갔다', '갔습니다', '존댓말로 써요')], essay)
    rec('NOTAG', '100% 반말(일관) 글의 반말→존댓말 교정 → 미부여(minority null)', flags(out) === '0', `flags=${flags(out)}`)
  }
  {
    const out = tagStyleUnify([C('먹었다', '먹었습니다', '존댓말')], PLAIN_MAJ)
    rec('NOTAG', '소수 문장 밖(다수 문장) 교정 → 미부여', flags(out) === '0', `flags=${flags(out)}`)
  }
  {
    const out = tagStyleUnify([C('우리 반에는', '저희 반에는', '존댓말 표현')], FORMAL_MAJ)
    rec('NOTAG', '소수 문장 안이지만 끝맺음이 다수 문체가 아닌 교정 → 미부여', flags(out) === '0', `flags=${flags(out)}`)
  }
  {
    const out = tagStyleUnify([C('있다', '있습니다')], '책을 읽었습니다. 재미있는 법이 있다.')
    rec('NOTAG', '동률(1:1) → 미부여', flags(out) === '0', `flags=${flags(out)}`)
  }
  {
    const out = tagStyleUnify([C('있다', '있습니다')], '재미있는 법이 있다.')
    rec('NOTAG', '한 문장 글 → 미부여', flags(out) === '0', `flags=${flags(out)}`)
  }
  {
    const out = tagStyleUnify([C('먹었다', '먹었습니다')], PLAIN_MAJ)
    rec('NOTAG', '반말 다수 글에서 반말→존댓말(역방향) → 미부여', flags(out) === '0', `flags=${flags(out)}`)
  }

  // ── GUARD: 입력 방어 ──
  {
    const a = tagStyleUnify(null, FORMAL_MAJ)
    const b = tagStyleUnify([C('있다', '있습니다')], '')
    const c = tagStyleUnify([null, 'x', C('있다', '있습니다')], FORMAL_MAJ)
    const ok = Array.isArray(a) && a.length === 0 && flags(b) === '0' && c.length === 3 && c[0] === null && c[1] === 'x' && c[2].styleUnify === true
    rec('GUARD', 'null 목록·빈 글·비객체 항목 통과', ok, `a=${a.length} b=${flags(b)} c=${c.length}`)
  }

  // ── 출력 ──
  let fail = 0
  for (const r of results) {
    if (!r.pass) fail++
    console.log(`${r.pass ? 'PASS' : 'FAIL'} [${r.group}] ${r.name}${r.pass ? '' : '  ← ' + r.detail}`)
  }
  console.log(`\n합계: ${results.length}건 중 PASS ${results.length - fail} · FAIL ${fail}`)
  if (fail > 0) process.exitCode = 1
})().catch(e => {
  console.error('게이트 실행 실패:', e)
  process.exitCode = 1
})
