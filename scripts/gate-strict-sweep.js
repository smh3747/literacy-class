// step645: strict 스윕 분류(lib/strictCheck.server.js partitionSweep) 회귀 게이트 (읽기 전용 — lib는 import만, 네트워크·DB 없음)
//
// ▶ lib/strictCheck.server.js sweepPending/partitionSweep 수정 시 커밋 전 실행:  node scripts/gate-strict-sweep.js
//   규칙: 24시간 지난 pending은 교사당 상한과 무관하게 전부 만료(expiredIds), 보완 대상(picks)만 교사당 perTeacher건, 초과는 capped.
//
// ※ lib가 확장자 없는 상대 import를 쓰므로 gate-safety-block과 같은 해석 훅(node 22.15+). MODULE_TYPELESS 경고는 무해.

const path = require('path')
const { pathToFileURL } = require('url')
const nodeModule = require('module')

function registerExtensionlessHook() {
  if (typeof nodeModule.registerHooks !== 'function') throw new Error('node 22.15 이상이 필요해요(module.registerHooks 없음)')
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      try { return nextResolve(specifier, context) }
      catch (e) {
        // './prompts.server'처럼 점이 든 이름은 extname이 '.server'라 '.js' 미끝남 기준으로 보완
        if (specifier.startsWith('.') && !specifier.endsWith('.js')) return nextResolve(`${specifier}.js`, context)
        throw e
      }
    },
  })
}

;(async () => {
  registerExtensionlessHook()
  const { partitionSweep, PENDING_EXPIRE_HOURS } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'strictCheck.server.js')).href)
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })

  const now = Date.parse('2026-10-29T18:00:00Z')
  const H = 3600 * 1000
  const row = (id, hoursAgo, teacherId) => ({ id, created_at: new Date(now - hoursAgo * H).toISOString(), teacherId })
  // 오래된 순: 만료 5건(교사 A 3·B 2) → 24시간 안 7건(A 6·B 1)
  const rows = [
    row('e1', 200, 'A'), row('e2', 190, 'A'), row('e3', 100, 'B'), row('e4', 30, 'A'), row('e5', 25, 'B'),
    row('f1', 23, 'A'), row('f2', 20, 'A'), row('f3', 10, 'A'), row('f4', 5, 'B'), row('f5', 4, 'A'), row('f6', 3, 'A'), row('f7', 1, 'A'),
  ]
  const r = partitionSweep(rows, { nowMs: now, perTeacher: 4 })
  rec('유닛: 만료 5건은 교사 상한과 무관하게 전부 expiredIds(A 3·B 2)', r.expiredIds.join(',') === 'e1,e2,e3,e4,e5', r.expiredIds.join(','))
  rec('유닛: 보완 대상은 교사당 4건 — A 4건(f1 f2 f3 f5)·B 1건(f4), capped 2(f6 f7)',
    r.picks.map(p => p.id).join(',') === 'f1,f2,f3,f4,f5' && r.capped === 2, `${r.picks.map(p => p.id).join(',')} capped=${r.capped}`)
  rec('경계: 정확히 24시간은 만료 아님(> 기준), 24시간+1ms는 만료', (() => {
    const a = partitionSweep([{ id: 'x', created_at: new Date(now - PENDING_EXPIRE_HOURS * H).toISOString(), teacherId: 'A' }], { nowMs: now })
    const b = partitionSweep([{ id: 'y', created_at: new Date(now - PENDING_EXPIRE_HOURS * H - 1).toISOString(), teacherId: 'A' }], { nowMs: now })
    return a.expiredIds.length === 0 && a.picks.length === 1 && b.expiredIds.length === 1
  })(), '')
  rec('빈 입력·teacherId 없음(none 버킷) 안전', partitionSweep([], {}).picks.length === 0 && partitionSweep([row('n1', 1, null)], { nowMs: now }).picks.length === 1, '')
  rec('PENDING_EXPIRE_HOURS = 24', PENDING_EXPIRE_HOURS === 24, String(PENDING_EXPIRE_HOURS))

  let pass = 0, fail = 0
  for (const x of results) { if (x.pass) pass++; else fail++; console.log(`  ${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.detail ? `  — ${x.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
