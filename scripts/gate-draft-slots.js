// step651: 저장 슬롯(lib/draftSlots.js) 회귀 게이트 (읽기 전용 — lib는 import만, 가짜 storage 주입)
//
// ▶ lib/draftSlots.js 수정 시 커밋 전 실행:  node scripts/gate-draft-slots.js
//   규칙: 현재 슬롯 갱신 / 80자 이상 변화·3분 경과면 새 슬롯 / 주제·단계별 5개·전체 20개 상한 / 제출 시 해당 슬롯 삭제 /
//         구 draft:*·essay_backup_* 키 1회 이관 / 저장 실패 시 false.

const path = require('path')
const { pathToFileURL } = require('url')

function fakeStorage({ failAt = Infinity } = {}) {
  const m = new Map()
  return {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > failAt) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e } m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    _m: m,
  }
}

;(async () => {
  const L = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'draftSlots.js')).href)
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })
  const T0 = Date.parse('2026-10-30T01:00:00Z')

  // ── SNAPSHOT ──
  {
    let r = L.upsertSnapshot([], { topicId: 'A', phase: 'write', text: '첫 문장', now: T0 })
    rec('첫 저장 → 슬롯 1개 생성', r.created && r.slots.length === 1 && r.currentId === r.slots[0].id, JSON.stringify(r.slots.map(s => s.chars)))
    const r2 = L.upsertSnapshot(r.slots, { topicId: 'A', phase: 'write', text: '첫 문장을 조금 더', now: T0 + 2000, currentId: r.currentId })
    rec('작은 변화(80자 미만·3분 내) → 같은 슬롯 갱신(개수 1)', !r2.created && r2.slots.length === 1 && r2.slots[0].text === '첫 문장을 조금 더' && r2.currentId === r.currentId, '')
    const big = '가'.repeat(100)
    const r3 = L.upsertSnapshot(r2.slots, { topicId: 'A', phase: 'write', text: big, now: T0 + 4000, currentId: r2.currentId })
    rec('80자 이상 변화 → 새 슬롯(개수 2, 이전 슬롯 동결)', r3.created && r3.slots.length === 2 && r3.slots.some(s => s.text === '첫 문장을 조금 더'), String(r3.slots.length))
    const r4 = L.upsertSnapshot(r3.slots, { topicId: 'A', phase: 'write', text: big + '!', now: T0 + 4000 + 3 * 60 * 1000 + 1, currentId: r3.currentId })
    rec('3분 경과 → 새 슬롯(개수 3)', r4.created && r4.slots.length === 3, String(r4.slots.length))
    const r5 = L.upsertSnapshot(r4.slots, { topicId: 'A', phase: 'write', text: '   ', now: T0 + 9000, currentId: r4.currentId })
    rec('빈 글(공백) → 저장 안 함', !r5.created && r5.slots.length === 3, '')
    const r6 = L.upsertSnapshot(r4.slots, { topicId: 'A', phase: 'rewrite', text: '수정본', now: T0 + 9000, currentId: r4.currentId })
    rec('단계가 다르면(write→rewrite) 새 슬롯', r6.created && r6.slots.length === 4, '')
  }
  // ── PRUNE ──
  {
    let slots = []
    for (let i = 0; i < 8; i++) slots.push({ id: 'a' + i, topicId: 'A', phase: 'write', text: 'x' + i, chars: 2, baseChars: 2, createdAt: T0 + i, savedAt: T0 + i })
    const p = L.prune(slots)
    rec('주제·단계별 5개 상한 — 최신 5개(a3~a7) 유지', p.length === 5 && p.map(s => s.id).sort().join(',') === 'a3,a4,a5,a6,a7', p.map(s => s.id).join(','))
    let many = []
    for (let t = 0; t < 6; t++) for (let i = 0; i < 4; i++) many.push({ id: `${t}-${i}`, topicId: 'T' + t, phase: 'write', text: 'x', chars: 1, baseChars: 1, createdAt: T0 + t * 10 + i, savedAt: T0 + t * 10 + i })
    const p2 = L.prune(many)
    rec('전체 20개 상한 — 24개 중 최신 20개(T1~T5 전부, T0 제외)', p2.length === 20 && !p2.some(s => s.topicId === 'T0'), String(p2.length))
    const rm = L.removeSlotsFor(p2, 'T5', 'write')
    rec('제출 시 그 주제·단계 슬롯 삭제(T5 write 4개 제거 → 16)', rm.length === 16, String(rm.length))
  }
  // ── STORAGE·이관·실패 ──
  {
    const st = fakeStorage()
    L._setStorageForTest(st)
    st.setItem('draft:TOPIC1:U1:write', JSON.stringify({ text: '옛 초안', savedAt: '2026-10-29T01:00:00.000Z' }))
    st.setItem('draft:TOPIC1:U1:write:prev', JSON.stringify({ text: '더 옛 초안', savedAt: '2026-10-28T01:00:00.000Z' }))
    st.setItem('essay_backup_U1_TOPIC2_write', '아주 옛 백업')
    st.setItem('essay_backup_U1_TOPIC2_feedback', '고아')
    st.setItem('draft:TOPIC9:U2:write', JSON.stringify({ text: '남의 초안', savedAt: '2026-10-29T01:00:00.000Z' }))
    const slots = L.loadSlots('U1')
    rec('구 키 이관: draft·prev·essay_backup(write) → 슬롯 3개, 고아·남의 키는 제외', slots.length === 3 && slots.every(s => ['옛 초안', '더 옛 초안', '아주 옛 백업'].includes(s.text)), slots.map(s => s.text).join('|'))
    rec('이관 뒤 구 키 삭제(U1 것만), 남의 키 유지, 인덱스 키 생성', !st.getItem('draft:TOPIC1:U1:write') && !st.getItem('essay_backup_U1_TOPIC2_feedback') && !!st.getItem('draft:TOPIC9:U2:write') && !!st.getItem(L.indexKey('U1')), '')
    rec('두 번째 loadSlots는 인덱스에서(이관 재실행 없음)', L.loadSlots('U1').length === 3, '')
    const st2 = fakeStorage({ failAt: 150 })
    L._setStorageForTest(st2)
    const okSmall = L.saveSlots('U1', [{ id: '1', topicId: 'A', phase: 'write', text: 'x', chars: 1, baseChars: 1, createdAt: 1, savedAt: 1 }])
    const okBig = L.saveSlots('U1', Array.from({ length: 4 }, (_, i) => ({ id: String(i), topicId: 'A', phase: 'write', text: 'y'.repeat(40), chars: 40, baseChars: 40, createdAt: i, savedAt: i })))
    rec('저장 실패(용량): 작은 건 true, 큰 건 절반 재시도 후에도 실패면 false', okSmall === true && okBig === false, `${okSmall}/${okBig}`)
  }
  rec('previewOf 60자 절단·공백 정리', L.previewOf('가  나\n다' + 'x'.repeat(100)).length === 61 && L.previewOf(' a  b ') === 'a b', '')

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
