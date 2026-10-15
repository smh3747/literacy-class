// step627: 피크 판정 창(lib/peakWindow.js) + 예시 생성 흐름 판정(lib/exampleDefer.js) 회귀 게이트
//   (읽기 전용 — lib는 import만, 네트워크·DB 없음)
//
// ▶ 두 파일 수정 시 커밋 전 실행:  node scripts/gate-peak-window.js
//   규칙: 학급별 최근 60초 채점 요청 수를 요청 시각 기준으로 세고, 이번 포함 3건째부터 피크.
//   학급 간 독립, 창 밖(60초 경과) 기록은 버림, key 없으면 0. 하나라도 FAIL이면 exit 1.

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const lib = (f) => import(pathToFileURL(path.join(__dirname, '..', 'lib', f)).href)
  const { recordAndCount, isPeak, PEAK_THRESHOLD, PEAK_WINDOW_MS, _reset, _size } = await lib('peakWindow.js')
  const { decideExampleFlow } = await lib('exampleDefer.js')

  const results = []
  const rec = (group, name, pass, detail) => results.push({ group, name, pass, detail })
  const T0 = 1_760_000_000_000

  // ── WINDOW: 건수·임계 ──
  _reset()
  {
    const c1 = recordAndCount('A', T0)
    const c2 = recordAndCount('A', T0 + 1000)
    const c3 = recordAndCount('A', T0 + 2000)
    rec('WINDOW', '1·2건째는 비피크, 3건째부터 피크(이번 포함)', !isPeak(c1) && !isPeak(c2) && isPeak(c3) && c3 === 3, `${c1},${c2},${c3}`)
    const c4 = recordAndCount('A', T0 + 3000)
    rec('WINDOW', '4건째도 피크(건수 4)', isPeak(c4) && c4 === 4, String(c4))
    rec('WINDOW', `PEAK_THRESHOLD=3 · PEAK_WINDOW_MS=60000`, PEAK_THRESHOLD === 3 && PEAK_WINDOW_MS === 60_000, `${PEAK_THRESHOLD}/${PEAK_WINDOW_MS}`)
  }
  // 동시 25명: 첫 요청부터 즉시 반영(같은 ms)
  _reset()
  {
    const counts = []
    for (let i = 0; i < 25; i++) counts.push(recordAndCount('A', T0))
    const peaks = counts.filter(c => isPeak(c)).length
    rec('WINDOW', '동시 25건(같은 ms) → 3건째부터 23건 피크', peaks === 23 && counts[2] === 3, `peaks=${peaks}`)
  }
  // 창 만료
  _reset()
  {
    recordAndCount('A', T0); recordAndCount('A', T0 + 500); recordAndCount('A', T0 + 1000)
    const after59 = recordAndCount('A', T0 + 59_000)
    _reset()
    recordAndCount('A', T0); recordAndCount('A', T0 + 500); recordAndCount('A', T0 + 1000)
    const after61 = recordAndCount('A', T0 + 61_000)
    rec('WINDOW', '59초 뒤 요청은 창 안(4건) / 61초 뒤는 창 비워져 1건', after59 === 4 && after61 === 1, `${after59}/${after61}`)
  }
  // 경계: 정확히 60초 전 기록은 버림(<= now - window)
  _reset()
  {
    recordAndCount('A', T0)
    const c = recordAndCount('A', T0 + 60_000)
    rec('WINDOW', '정확히 60초 전 기록은 창 밖(1건)', c === 1, String(c))
  }

  // ── ISOLATION: 학급 간 독립 ──
  _reset()
  {
    recordAndCount('A', T0); recordAndCount('A', T0); recordAndCount('A', T0)
    const b = recordAndCount('B', T0 + 10)
    rec('ISOLATION', '학급 A 피크(3건)여도 학급 B 첫 요청은 1건·비피크', b === 1 && !isPeak(b), String(b))
  }
  // 빈 창 정리(메모리)
  _reset()
  {
    recordAndCount('A', T0); recordAndCount('B', T0)
    recordAndCount('C', T0 + 61_000)   // A·B는 창 밖 → 정리
    rec('ISOLATION', '다른 학급의 빈 창은 호출 때 정리(남은 key 1개)', _size() === 1, `size=${_size()}`)
  }

  // ── INPUT: key 방어 ──
  _reset()
  {
    const n1 = recordAndCount(null, T0), n2 = recordAndCount(undefined, T0), n3 = recordAndCount('', T0)
    rec('INPUT', 'key null·undefined·빈 문자열 → 0, 기록 없음', n1 === 0 && n2 === 0 && n3 === 0 && _size() === 0, `${n1},${n2},${n3},size=${_size()}`)
    rec('INPUT', 'isPeak 비숫자 → false', !isPeak(null) && !isPeak(undefined) && !isPeak('x'), '')
  }

  // ── FLOW: 예시 생성 흐름 ──
  {
    rec('FLOW', '__exampleDeferred: true → deferred', decideExampleFlow({ __exampleDeferred: true }) === 'deferred', '')
    rec('FLOW', '플래그 없음·false·null·비객체 → auto',
      decideExampleFlow({}) === 'auto' && decideExampleFlow({ __exampleDeferred: false }) === 'auto'
      && decideExampleFlow(null) === 'auto' && decideExampleFlow(undefined) === 'auto' && decideExampleFlow('x') === 'auto'
      && decideExampleFlow({ __exampleDeferred: 'true' }) === 'auto', '')
  }

  // ── 출력 ──
  let fail = 0
  for (const r of results) {
    if (!r.pass) fail++
    console.log(`${r.pass ? 'PASS' : 'FAIL'} [${r.group}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  }
  console.log(`\n${results.length - fail}/${results.length} PASS${fail ? ` · ${fail} FAIL` : ''}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('게이트 실행 오류:', e); process.exit(1) })
