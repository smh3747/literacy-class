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
  { name: '다같은',            text: '다같은 옷',          original: '다같은',    correction: '다 같은' },    // step447
  { name: '편한함',            text: '편한함을 제공',       original: '편한함',    correction: '편안함' },     // step447
  { name: "때(살때)",          text: '서른 살때가 되면',    original: '살때',      correction: '살 때' },      // step475
  { name: "때(할때)",          text: '할때 조심',          original: '할때',      correction: '할 때' },      // step475
  { name: '숫자+만원',         text: '150만원을 드렸다',    original: '150만원',   correction: '150만 원' },   // step475
  // step575: 미검출 전수조사 편입(DB 빈도 상위 고정 패턴)
  { name: '시각(6시30분)',      text: '6시30분에 일어났다',  original: '6시30분',   correction: '6시 30분' },   // step575
  { name: '날짜(6월5일)',       text: '6월5일에 갔다',       original: '6월5일',    correction: '6월 5일' },    // step575
  { name: "때(고통스러울때)",   text: '고통스러울때 참았다',  original: '울때',      correction: '울 때' },      // step575(기존 규칙 커버 확인)
  { name: "때(그럴때마다)",     text: '그럴때마다 웃었다',    original: '럴때',      correction: '럴 때' },      // step575(기존 규칙 커버 확인)
  { name: '한번하기',          text: '한번하기로 했다',     original: '한번하기',  correction: '한 번 하기' }, // step575
  { name: '한번씩',            text: '한번씩 해봤다',       original: '한번씩',    correction: '한 번씩' },    // step575
  { name: '우리반',            text: '우리반을 사랑해',     original: '우리반',    correction: '우리 반' },    // step575
  { name: '그리고나서',        text: '그리고나서 밥을 먹었다', original: '그리고나서', correction: '그러고 나서' }, // step575('그리고 나서'도 틀린 형태라 표준형으로)
  { name: '이로인해',          text: '이로인해 문제가 생겼다', original: '이로인해',  correction: '이로 인해' },  // step575
  { name: '안된다고',          text: '이러면 안된다고 했다',  original: '안된다',    correction: '안 된다' },    // step575
  // step590: 8/28 실사례 편입(가고싶은·가고싶다·어떤곳·여행지 라는 0건 검출 → AI 단독 채점 널뛰기)
  { name: '고싶다',            text: '나는 이탈리아에 가고싶다.', original: '가고싶다',   correction: '가고 싶다' },     // step590
  { name: '고싶은',            text: '가고싶은 곳이 많다',      original: '가고싶은',   correction: '가고 싶은' },     // step590
  { name: '고싶어서',          text: '먹고싶어서 샀다',         original: '먹고싶어서', correction: '먹고 싶어서' },   // step590
  { name: '고싶습니다',        text: '하고싶습니다',            original: '하고싶습니다', correction: '하고 싶습니다' }, // step590
  { name: '어떤곳',            text: '어떤곳으로 갈까?',        original: '어떤곳',     correction: '어떤 곳' },       // step590
  { name: '여러곳',            text: '여러곳을 다녔다',         original: '여러곳',     correction: '여러 곳' },       // step590
  { name: "라는(띄어짐)",      text: '여행지 라는 말',          original: '여행지 라는', correction: '여행지라는' },   // step590
  { name: "잘 않나(문맥 포함 생성)", text: '이런 것은 기억이 잘 않나기 때문이다.', original: '잘 않나', correction: '잘 안 나' }, // step592: 9/1 인천산곡초 ×4
  // step598: '않나' + 용언(나오다·나가다·나다) — 뒤 문맥을 실어 생성(9/30 동북초 "매연이 않나오면" ×5 과차단)
  { name: '않나오면(나오다)',    text: '자동차에서 매연이 않나오면 공기가 좋아진다.', original: '않나오면', correction: '안 나오면' }, // step598
  { name: '않나갔다(나가다)',    text: '주말에는 밖에 않나갔다.',   original: '않나갔다', correction: '안 나갔다' },   // step598
  { name: '않나서(나다)',        text: '화가 않나서 웃었다.',       original: '않나서',   correction: '안 나서' },     // step598
  { name: '이/가 + 않나요',      text: '슬픈데 눈물이 않나요.',     original: '않나요',   correction: '안 나요' },     // step598
  { name: '이/가 + 않나(문맥 포함)', text: '아직도 실감이 않나 😂', original: '실감이 않나', correction: '실감이 안 나' }, // step598
  // step605: 10/1 전수 실험 편입 — ㄹ 수 있/없 · 이였 · 방학때 · 안/않 조사 확장(은/는/도)
  { name: 'ㄹ수 있(있을수 있다)',   text: '실수가 있을수 있다',        original: '을수 있',   correction: '을 수 있' },     // step605
  { name: 'ㄹ수는(될수는 없다)',    text: '왕이 될수는 없다',          original: '될수는',    correction: '될 수는' },      // step605
  { name: 'ㄹ수 없(어쩔수 없이)',   text: '어쩔수 없이 갔다',          original: '쩔수 없',   correction: '쩔 수 없' },     // step605
  { name: 'ㄹ수밖에(할수밖에 없)',  text: '할수밖에 없었다',           original: '할수밖에',  correction: '할 수밖에' },    // step605
  { name: '이였(경험이였다)',       text: '소중한 경험이였다',         original: '경험이였다', correction: '경험이었다' },  // step605
  { name: '이였(느낌이였습니다)',   text: '이상한 느낌이였습니다',     original: '느낌이였습니다', correction: '느낌이었습니다' }, // step605
  { name: '아니였다',               text: '내 잘못이 아니였다',        original: '아니였다',  correction: '아니었다' },     // step605
  { name: '방학때',                 text: '방학때 놀러 갔다',          original: '방학때',    correction: '방학 때' },      // step605
  { name: '여름방학때',             text: '여름방학때 바다에 갔다',    original: '방학때',    correction: '방학 때' },      // step605
  { name: '은 + 않나(문맥 포함)',   text: '아무리 해도 기억은 않나.',  original: '기억은 않나', correction: '기억은 안 나' }, // step605
  { name: '도 + 않나요',            text: '슬픈데 눈물도 않나요.',     original: '않나요',    correction: '안 나요' },      // step605
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
  { name: "'지 않나요'(보조용언)",   text: '선수들이 없어지지 않나요?' }, // step435
  { name: "'그만두지 않나요'",       text: '운동을 그만두지 않나요?' },   // step435
  { name: "'먹지 않나 싶다'",        text: '먹지 않나 싶다' },            // step435
  { name: "'하지않나요'(붙여쓴 것)", text: '하지않나요' },                // step435
  { name: "'다 같이'(띄어진 형태)",  text: '다 같이 갔다' },              // step447
  { name: "'바다같이'(조사 같이)",   text: '바다같이 넓다' },             // step447
  { name: "'볼때기'(뺨)",            text: '볼때기가 빨갛다' },           // step475
  { name: "'그때'(합성어)",          text: '그때 갔다' },                 // step475
  { name: "'한때'(합성어)",          text: '한때 유행' },                 // step475
  { name: "'제때'(합성어)",          text: '제때 왔다' },                 // step475
  { name: "'오만원권'(한글 수사)",   text: '오만원권 지폐' },             // step475
  { name: "'물때'(한 단어)",         text: '물때가 끼었다' },             // step475
  // step575: 신규 규칙 오탐 가드
  { name: "'3시간30분'(시간+분)",    text: '3시간30분 동안 걸었다' },     // step575: '시' 뒤가 '간'이라 제외
  { name: "'6시 30분'(정상 띄움)",   text: '6시 30분에 만났다' },         // step575
  { name: "'3개월20일'(개월+일)",    text: '3개월20일이 지났다' },        // step575: '월' 앞이 '개'라 제외
  { name: "'한번 가볼까'(부사 한번)", text: '한번 가볼까?' },             // step575
  { name: "'한번쯤'(미대상)",        text: '한번쯤 생각했다' },           // step575
  { name: "'우리반짝'(우연 결합)",   text: '우리반짝반짝 빛났다' },       // step575
  { name: "'제안된다'(접미사 되다)", text: '새 방법이 제안된다' },        // step575: 앞글자 가드
  { name: "'고안되면'(접미사 되다)", text: '새 장치가 고안되면 좋겠다' }, // step575: 앞글자 가드
  { name: "'참 안됐다'(형용사)",     text: '그 친구가 참 안됐다' },       // step575: '됐'이라 제외
  { name: "'안타깝다'(무관 단어)",   text: '정말 안타깝다' },             // step575
  // step590: 신규 규칙 오탐 가드
  { name: "'가고 싶다'(정상 띄움)",  text: '나는 바다에 가고 싶다' },      // step590
  { name: "'어떤 곳'(정상 띄움)",    text: '어떤 곳에 갔다' },             // step590
  { name: "'하라는 대로'(어미 라는)", text: '하라는 대로 했다' },           // step590: 앞이 붙어 있어 제외
  { name: "'그러라는'(어미 라는)",    text: '그러라는 말을 들었다' },       // step590
  { name: "'책 라는'(받침 가드)",     text: '책 라는 제목' },               // step590: 바른 형태는 '책이라는'이라 붙이지 않음
  // step605: 신규 규칙 오탐 가드
  { name: "'갈수록'(어미)",           text: '갈수록 어려워진다' },          // step605: '수' 뒤가 '록'이라 제외
  { name: "'일수가'(날수, 있/없 없음)", text: '출석 일수가 모자랐다' },     // step605: 조사 뒤에 있/없이 없어 제외
  { name: "'실수가 있었다'(명사)",    text: '작은 실수가 있었다' },         // step605: 앞 글자 가드
  { name: "'철수는 없었다'(이름)",    text: '철수는 없었다' },              // step605: 앞 글자 가드
  { name: "'별수 없이'(한 단어)",     text: '별수 없이 돌아왔다' },         // step605: 앞 글자 가드
  { name: "'민준이였다'(이름+였다)",  text: '내 짝은 민준이였다' },         // step605: '이였' 전면 치환 금지
  { name: "'종이였다'(명사+였다)",    text: '그것은 하얀 종이였다' },       // step605
  { name: "'어머니였다'(아니 아님)",  text: '그분은 어머니였다' },          // step605
  { name: "'점심때'(합성어)",         text: '점심때 만났다' },              // step605: 사전 등재 합성어 6종 — 절대 미포함
  { name: "'저녁때'(합성어)",         text: '저녁때 비가 왔다' },           // step605
  { name: "'그때'(합성어, 605)",      text: '그때 정말 놀랐다' },           // step605
  { name: "'이때'(합성어)",           text: '이때 문이 열렸다' },           // step605
  { name: "'한때'(합성어, 605)",      text: '한때 인기가 많았다' },         // step605
  { name: "'제때'(합성어, 605)",      text: '제때 도착했다' },              // step605
  { name: "'힘들지는 않나요'(보조용언)", text: '많이 힘들지는 않나요?' },   // step605: 조각도 생성 안 함
  { name: "'쉽지만은 않나'(보조용언)",   text: '생각보다 쉽지만은 않나?' }, // step605
]

// mergeCorrectionsDetailed(AI corrections, essay) 레벨 — 남는지(kept)/폐기(dropped)되는지.
const MERGE = [
  { name: '않기→안 기',           corr: { original: '않기',        correction: '안 기' },        essay: '지각하지 않기로 했다',   expect: 'dropped' },
  { name: '않지나있었다→안 지나 있었다', corr: { original: '않지나있었다', correction: '안 지나 있었다' }, essay: '1시간 밖에 않지나있었다', expect: 'kept' },   // step405
  { name: '모여 있다→모여 있어요', corr: { original: '모여 있다',   correction: '모여 있어요' },   essay: '아이들이 모여 있다',    expect: 'kept' },   // step409(문체 필터 없음)
  { name: '해결했습다→해결했습니다', corr: { original: '해결했습다', correction: '해결했습니다' }, essay: '문제를 해결했습다',    expect: 'kept' },
  { name: '막기위해→막기 위해',    corr: { original: '막기위해',    correction: '막기 위해' },    essay: '실수를 막기위해 애썼다', expect: 'kept' },
  { name: '기억 않나→기억 안 나(통과)', corr: { original: '기억 않나', correction: '기억 안 나' }, essay: '형 나 기억 않나?',    expect: 'kept' },    // step477
  { name: '생각 않나→생각 안 나(통과)', corr: { original: '생각 않나', correction: '생각 안 나' }, essay: '그때가 생각 않나?',   expect: 'kept' },    // step477
  { name: '않아→안 아(여전히 차단)',   corr: { original: '않아',      correction: '안 아' },      essay: '말이 않아 나온다',    expect: 'dropped' }, // step477
  { name: '실감이 않나→실감이 안 나(통과)', corr: { original: '실감이 않나', correction: '실감이 안 나' }, essay: '실감이 않나 😂',      expect: 'kept' },    // step484
  { name: '상상이 않나→상상이 안 나(통과)', corr: { original: '상상이 않나', correction: '상상이 안 나' }, essay: '도무지 상상이 않나?',  expect: 'kept' },    // step484
  { name: '힘들어하진 않나(정당 않, 차단)', corr: { original: '힘들어하진 않나', correction: '힘들어하진 안 나' }, essay: '친구가 힘들어하진 않나 걱정했다', expect: 'dropped' }, // step484
  { name: '믿기지가 않나(정당 않, 차단)',   corr: { original: '믿기지가 않나', correction: '믿기지가 안 나' }, essay: '정말 믿기지가 않나?', expect: 'dropped' }, // step484
  { name: '하지 않아서→하지 안 아서(차단)', corr: { original: '하지 않아서', correction: '하지 안 아서' }, essay: '숙제를 하지 않아서 혼났다', expect: 'dropped' }, // step542
  { name: '않아서→안 아서(차단)',           corr: { original: '않아서',     correction: '안 아서' },     essay: '숙제를 하지 않아서 혼났다', expect: 'dropped' }, // step542
  { name: '않아도→안 아도(차단)',           corr: { original: '않아도',     correction: '안 아도' },     essay: '먹지 않아도 배부르다',     expect: 'dropped' }, // step542
  { name: '않아프게→안 아프게(통과 유지)',   corr: { original: '않아프게',   correction: '안 아프게' },   essay: '주사를 않아프게 놔줬다',   expect: 'kept' },    // step542
  { name: '않아깝다→안 아깝다(통과 유지)',   corr: { original: '않아깝다',   correction: '안 아깝다' },   essay: '하나도 않아깝다',          expect: 'kept' },    // step542
  // step592: 부사 '잘' + 않나 → '잘 안 나' 통과(9/1 인천산곡초 "기억이 잘 않나기" ×4 과차단). '않아→안 아'·'믿기지가 않나' 차단은 유지.
  { name: '잘 않나→잘 안 나(통과)',         corr: { original: '잘 않나',   correction: '잘 안 나' },   essay: '이런 것은 기억이 잘 않나기 때문이다.', expect: 'kept' },    // step592 (AI 경로)
  { name: '잘 않나기→잘 안 나기(통과)',     corr: { original: '잘 않나기', correction: '잘 안 나기' }, essay: '이런 것은 기억이 잘 않나기 때문이다.', expect: 'kept' },    // step592
  { name: '잘 않아서→잘 안 아서(여전히 차단)', corr: { original: '잘 않아서', correction: '잘 안 아서' }, essay: '숙제를 잘 않아서 혼났다',               expect: 'dropped' }, // step592: '잘' 예외는 않나에만
  // step598: '않→안' 방향은 일괄 차단이 아니다. 용언 앞 부정 부사 자리는 통과, '-지 않나(요)' 보조용언은 차단.
  { name: '않나오면→안 나오면(통과)',           corr: { original: '않나오면', correction: '안 나오면' },               essay: '자동차에서 매연이 않나오면 공기가 좋아진다.', expect: 'kept' },    // step598 (AI 어절 경로)
  { name: '매연이 않나오면→매연이 안 나오면(통과)', corr: { original: '매연이 않나오면', correction: '매연이 안 나오면' }, essay: '자동차에서 매연이 않나오면 공기가 좋아진다.', expect: 'kept' },    // step598 (AI 구 경로)
  { name: '않나→안 나(문맥 없는 조각, 여전히 차단)', corr: { original: '않나', correction: '안 나' },                   essay: '친구가 힘들지는 않나 걱정했다',               expect: 'dropped' }, // step598
  { name: '먹지 않나요→먹지 안 나요(차단)',      corr: { original: '먹지 않나요', correction: '먹지 안 나요' },         essay: '너도 같이 먹지 않나요?',                     expect: 'dropped' }, // step598: "안 나요" 2글자 면제 누수 차단
  { name: '힘들지는 않나요→안 나요(차단)',       corr: { original: '힘들지는 않나요', correction: '힘들지는 안 나요' }, essay: '많이 힘들지는 않나요?',                      expect: 'dropped' }, // step598
  { name: '편지 않나왔다→편지 안 나왔다(통과)',  corr: { original: '편지 않나왔다', correction: '편지 안 나왔다' },     essay: '기다리던 편지 않나왔다',                     expect: 'kept' },    // step598: '지'로 끝나는 명사 뒤 용언은 통과
  // step605: 조사 확장(은/는/도) — 묶은 original이 화이트리스트를 통과(kept), '-지/-치 + 보조사' 뒤는 계속 차단.
  { name: '기억은 않나→기억은 안 나(통과)',     corr: { original: '기억은 않나', correction: '기억은 안 나' },     essay: '아무리 해도 기억은 않나.',      expect: 'kept' },    // step605
  { name: '눈물도 않나→눈물도 안 나(통과)',     corr: { original: '눈물도 않나', correction: '눈물도 안 나' },     essay: '슬픈데 눈물도 않나',            expect: 'kept' },    // step605
  { name: '매연이 않나→매연이 안 나(통과 유지)', corr: { original: '매연이 않나', correction: '매연이 안 나' },     essay: '이제 공장에서 매연이 않나',     expect: 'kept' },    // step605 (이/가 기존 동작 확인)
  { name: '쉽지만은 않나→쉽지만은 안 나(차단)', corr: { original: '쉽지만은 않나', correction: '쉽지만은 안 나' }, essay: '생각보다 쉽지만은 않나?',       expect: 'dropped' }, // step605
  { name: '먹지도 않나→먹지도 안 나(차단)',     corr: { original: '먹지도 않나', correction: '먹지도 안 나' },     essay: '밥을 먹지도 않나 보다',         expect: 'dropped' }, // step605
  // step598: 무의미 교정 정규화 — 눈에 같은 쌍은 조용히 제거(dropped에도 안 남음), 실제 띄어쓰기 교정은 유지.
  { name: '무의미(NBSP) 여름 방학→여름 방학',     corr: { original: '여름 방학', correction: '여름 방학' },  essay: '나는 여름 방학에 갔다',  expect: 'gone' }, // step598
  { name: '무의미(전각 공백)',                    corr: { original: '여름　방학', correction: '여름 방학' },  essay: '나는 여름　방학에 갔다',  expect: 'gone' }, // step598
  { name: '무의미(zero-width)',                   corr: { original: '여름​ 방학', correction: '여름 방학' }, essay: '나는 여름​ 방학에 갔다', expect: 'gone' }, // step598
  { name: '무의미(연속 공백)',                    corr: { original: '여름  방학', correction: '여름 방학' },      essay: '나는 여름  방학에 갔다',      expect: 'gone' }, // step598
  { name: '무의미(자모 분리 NFD)',                corr: { original: '여름 방학'.normalize('NFD'), correction: '여름 방학' }, essay: '나는 여름 방학에 갔다', expect: 'gone' }, // step598
  { name: '무의미(앞뒤 공백만 다름)',             corr: { original: '여름 방학', correction: ' 여름 방학 ' },     essay: '나는 여름 방학에 갔다',       expect: 'gone' }, // step598 (기존 trim 동작 유지)
  { name: '제 4조→제4조(실제 띄어쓰기 교정 유지)', corr: { original: '제 4조', correction: '제4조' },             essay: '제 4조에 따라 정했다',        expect: 'kept' }, // step598
  { name: '여름방학→여름 방학(실제 교정 유지)',    corr: { original: '여름방학', correction: '여름 방학' },        essay: '나는 여름방학에 갔다',        expect: 'kept' }, // step598
  // step560: 문체역행 필터 — 반말 압도 글(formal ≤ 1 && plain ≥ 3)에서만 반말→존댓말 교정 폐기.
  { name: '반말 글 한다→해요(문체역행 차단)', corr: { original: '아쉽기도 한다.', correction: '아쉽기도 해요.' }, essay: '오늘 바자회를 했다. 물건을 많이 팔았다. 정말 재미있었다. 아쉽기도 한다.', expect: 'dropped' }, // step560 (7/23 대구범어초 실사례)
  { name: '섞인 글 소개한다→소개합니다(통일 지적 보존)', corr: { original: '소개한다.', correction: '소개합니다.' }, essay: '제 친구를 소개합니다. 이 친구는 착해요. 같이 놀면 재미있어요. 오늘은 새 친구를 소개한다.', expect: 'kept' }, // step560 (호평초형 옳은 통일)
  { name: '반말 글 어느날→어느 날(맞춤법 교정 무영향)', corr: { original: '어느날', correction: '어느 날' }, essay: '어느날 학교에 갔다. 친구를 만났다. 같이 놀았다. 재미있었다.', expect: 'kept' }, // step560
  { name: '반말 글 해결했습다→해결했습니다(오타 교정 보존)', corr: { original: '해결했습다', correction: '해결했습니다' }, essay: '문제가 생겼다. 친구와 고민했다. 방법을 찾았다. 드디어 문제를 해결했습다.', expect: 'kept' }, // step560 (과거 isStyleChange가 죽였던 케이스, step409 재발 금지)
  // step609: '~입이다' 오타(입니다·이다 혼동)는 반말 글에서 폐기 대신 '이다'형으로 치환해 통과. keptAs = 최종 correction 기대값.
  { name: '반말 글 말입이다→말이다(치환 통과, 10/8)', corr: { original: '말입이다.', correction: '말입니다.', reason: "'입니다'로 써요" }, essay: '나는 축구가 좋다. 매일 공을 찬다. 친구들과 뛰면 신난다. 그게 내 말입이다.', expect: 'kept', keptAs: '말이다.', reasonAs: "'입이다'는 없는 말이에요. 이 글은 반말로 썼으니 '이다'로 써요" }, // step609
  { name: '반말 글 때문입이다→때문이다(치환 통과, 9/3)', corr: { original: '때문입이다', correction: '때문입니다', reason: '오타예요' }, essay: '늦게 일어났다. 버스를 놓쳤다. 지각을 했다. 알람이 안 울렸기 때문입이다.', expect: 'kept', keptAs: '때문이다', reasonAs: '오타예요' }, // step609 (reason에 '입니다' 없으면 AI reason 유지)
  { name: '섞인 글 말입이다→말입니다(치환 없이 그대로)', corr: { original: '말입이다.', correction: '말입니다.' }, essay: '제 취미를 소개합니다. 축구를 좋아해요. 매일 공을 차요. 그게 제 말입이다.', expect: 'kept' }, // step609 (반말 글 아니면 기존대로)
  { name: '반말 글 말입이다→말이에요(입니다 아님 → 기존대로 폐기)', corr: { original: '말입이다.', correction: '말이에요.' }, essay: '나는 축구가 좋다. 매일 공을 찬다. 친구들과 뛰면 신난다. 그게 내 말입이다.', expect: 'dropped' }, // step609
]

// step560: countSentenceStyles(essay) 직접 테스트 — 문체역행 필터의 발동 조건 판정 헬퍼.
const STYLE = [
  { name: '반말 4문장 → formal 0·plain 4', essay: '오늘 바자회를 했다. 물건을 많이 팔았다. 정말 재미있었다. 아쉽기도 한다.', formal: 0, plain: 4 },
  { name: '섞인 글 → formal 3·plain 1',    essay: '제 친구를 소개합니다. 이 친구는 착해요. 같이 놀면 재미있어요. 오늘은 새 친구를 소개한다.', formal: 3, plain: 1 },
  { name: '끝맺음 불명 문장 카운트 제외',   essay: '나의 꿈. 소방관이 되고 싶다. 사람들을 구하고 싶어서', formal: 0, plain: 1 },
]

;(async () => {
  const krPath = path.join(__dirname, '..', 'lib', 'koreanRules.js')
  const kr = await import(pathToFileURL(krPath).href)
  const { findRuleBasedErrors, mergeCorrectionsDetailed, mergeCorrections, countSentenceStyles } = kr

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
    // step609: keptAs가 있으면 치환된 correction(및 reasonAs)으로 남았는지 검사
    const want = c.keptAs != null ? c.keptAs : c.corr.correction
    const keptItem = corrections.find(x => x.correction === want)
    const kept = !!keptItem && (c.reasonAs == null || keptItem.reason === c.reasonAs)
    const drp = dropped.find(x => x.correction === c.corr.correction)
    let pass, detail
    if (c.expect === 'kept') {
      pass = kept && !drp
      detail = kept ? `corrections에 남음${c.keptAs != null ? `(→ ${want})` : ''}` : (keptItem ? `reason 불일치: ${keptItem.reason}` : `안 남음(dropped=${drp ? drp.drop_reason : '없음'}, 실제=${JSON.stringify(corrections.map(x => x.correction))})`)
    } else if (c.expect === 'gone') { // step598: 무의미 교정 — 조용히 제거(감시 기록에도 안 남음)
      pass = !kept && !drp
      detail = pass ? '조용히 제거됨' : (kept ? 'corrections에 남음(제거 안 됨)' : `dropped에 기록됨(${drp.drop_reason})`)
    } else { // dropped
      pass = !kept && !!drp
      detail = drp ? `dropped(${drp.drop_reason})` : (kept ? 'corrections에 남음(폐기 안 됨)' : '사라짐(dropped 아님)')
    }
    rec('MERGE', c.name, pass, detail)
  }

  // STYLE: countSentenceStyles 직접 테스트 (step560 — 문체역행 필터 발동 조건)
  for (const c of STYLE) {
    const r = countSentenceStyles(c.essay)
    const pass = r.formal === c.formal && r.plain === c.plain
    rec('STYLE', c.name, pass, pass ? `formal ${r.formal}·plain ${r.plain}` : `기대 formal ${c.formal}·plain ${c.plain}, 실제 formal ${r.formal}·plain ${r.plain}`)
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
