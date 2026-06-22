// ⚠️ 임시 관리자 도구 (step233) — 재잠금 "리허설" 전용. 한 번 쓰고 삭제할 페이지.
//   admin 전용. 입력한 student_id 만 처리(전체 일괄 금지). 7420 학급 포함 시 실행 거부.
//   잠금: 기존 /api/consent-paper (action:'lock') 를 50명 배치로 반복 호출(새 잠금 로직 없음).
//   복원: /api/relock-restore (방법 A — realname_backup_step233 에서 복원).
//   ※ 본실행(1437명) 아님 — 6975 테스트 학생 2~3명으로 동작 확인용.
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

const BATCH_SIZE = 50
const BLOCKED_CLASS_CODE = '7420'   // 보호 학급 — 포함 시 실행 거부

export default function RelockRehearsal() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [idsText, setIdsText] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const [summary, setSummary] = useState(null)

  useEffect(() => { checkAuth() }, [])
  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('id, role, realname, school').eq('id', au.id).maybeSingle()
    if (!profile || profile.role !== 'admin') { alert('관리자만 접근 가능해요!'); router.push('/teacher'); return }
    setUser(profile)
    setLoading(false)
  }
  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const parseIds = () => Array.from(new Set(
    idsText.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
  ))
  const addLog = (line) => setLog(prev => [...prev, line])

  // 읽기 전용 사전 점검 — 7420 보호 + 존재 확인
  const preflight = async (ids) => {
    const { data, error } = await supabase.from('profiles')
      .select('id, realname, class_id, classes:class_id(code, name)')
      .in('id', ids)
    if (error) throw new Error('대상 조회 실패: ' + error.message)
    const foundMap = {}
    ;(data || []).forEach(r => { foundMap[r.id] = r })
    const notFound = ids.filter(id => !foundMap[id])
    const offenders7420 = (data || []).filter(r => r.classes?.code === BLOCKED_CLASS_CODE)
    return { notFound, offenders7420, found: data || [] }
  }

  const guard = async (ids) => {
    addLog(`입력 id ${ids.length}개. 사전 점검 중...`)
    const { notFound, offenders7420, found } = await preflight(ids)
    if (offenders7420.length > 0) {
      addLog(`🚫 보호 학급(${BLOCKED_CLASS_CODE}) 학생 ${offenders7420.length}명 포함 — 실행 거부: ${offenders7420.map(r => r.id).join(', ')}`)
      alert(`${BLOCKED_CLASS_CODE} 학급 학생이 ${offenders7420.length}명 포함되어 실행을 막았어요.`)
      return null
    }
    if (notFound.length > 0) addLog(`⚠️ 존재하지 않는 id ${notFound.length}개(건너뜀): ${notFound.join(', ')}`)
    const codes = [...new Set(found.map(r => r.classes?.code).filter(Boolean))]
    addLog(`✅ 점검 통과. 대상 ${found.length}명 · 학급코드: ${codes.join(', ') || '-'}`)
    return found.map(r => r.id)
  }

  const runLock = async () => {
    const ids = parseIds()
    if (ids.length === 0) { alert('student_id를 입력하세요'); return }
    if (!confirm(`입력한 ${ids.length}명의 실명을 잠급니다. 진행할까요?`)) return
    setBusy(true); setLog([]); setSummary(null)
    try {
      const validIds = await guard(ids)
      if (!validIds) { setBusy(false); return }
      if (validIds.length === 0) { addLog('처리할 유효 id 없음.'); setBusy(false); return }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('세션 만료 — 새로고침 후 다시 시도하세요.')

      const acc = { relocked: [], skipped: [] }
      for (let i = 0; i < validIds.length; i += BATCH_SIZE) {
        const batch = validIds.slice(i, i + BATCH_SIZE)
        addLog(`배치 ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length}명 잠금 호출...`)
        const res = await fetch('/api/consent-paper', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentIds: batch, accessToken: session.access_token, action: 'lock' })
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok || !d.ok) { addLog(`  ❌ 배치 실패: ${d.error || res.status}`); continue }
        const r = d.results || {}
        acc.relocked.push(...(r.relocked || []))
        acc.skipped.push(...(r.skipped || []))
        addLog(`  → 잠금 ${(r.relocked || []).length} · skip ${(r.skipped || []).length}`)
      }
      setSummary({ mode: 'lock', relocked: acc.relocked.length, skipped: acc.skipped.length })
      addLog(`완료: 잠금 ${acc.relocked.length}명 · skip ${acc.skipped.length}명${acc.skipped.length ? ` (${acc.skipped.join(', ')})` : ''}`)
    } catch (e) {
      addLog('오류: ' + (e.message || e))
    }
    setBusy(false)
  }

  const runRestore = async () => {
    const ids = parseIds()
    if (ids.length === 0) { alert('student_id를 입력하세요'); return }
    if (!confirm(`입력한 ${ids.length}명을 백업(realname_backup_step233)에서 복원합니다. 진행할까요?`)) return
    setBusy(true); setLog([]); setSummary(null)
    try {
      const validIds = await guard(ids)
      if (!validIds) { setBusy(false); return }
      if (validIds.length === 0) { addLog('처리할 유효 id 없음.'); setBusy(false); return }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('세션 만료 — 새로고침 후 다시 시도하세요.')

      const acc = { restored: [], noBackup: [], failed: [] }
      for (let i = 0; i < validIds.length; i += BATCH_SIZE) {
        const batch = validIds.slice(i, i + BATCH_SIZE)
        addLog(`배치 ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length}명 복원 호출...`)
        const res = await fetch('/api/relock-restore', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentIds: batch, accessToken: session.access_token })
        })
        const d = await res.json().catch(() => ({}))
        if (!res.ok || !d.ok) { addLog(`  ❌ 배치 실패: ${d.error || res.status}`); continue }
        const r = d.results || {}
        acc.restored.push(...(r.restored || []))
        acc.noBackup.push(...(r.noBackup || []))
        acc.failed.push(...(r.failed || []))
        addLog(`  → 복원 ${(r.restored || []).length} · 백업없음 ${(r.noBackup || []).length} · 실패 ${(r.failed || []).length}`)
      }
      setSummary({ mode: 'restore', restored: acc.restored.length, noBackup: acc.noBackup.length, failed: acc.failed.length })
      addLog(`완료: 복원 ${acc.restored.length}명 · 백업없음 ${acc.noBackup.length} · 실패 ${acc.failed.length}`)
    } catch (e) {
      addLog('오류: ' + (e.message || e))
    }
    setBusy(false)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>재잠금 리허설 (임시) - 관리자</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl p-4 text-sm leading-relaxed">
            <p className="font-bold">⚠️ 임시 관리자 도구 (step233) — 재잠금 리허설 전용</p>
            <ul className="list-disc pl-5 mt-1 space-y-0.5 text-xs">
              <li>입력한 <strong>student_id만</strong> 처리해요(전체 일괄 없음).</li>
              <li><strong>{BLOCKED_CLASS_CODE} 학급</strong> 학생이 하나라도 있으면 실행을 막아요.</li>
              <li>리허설이니 <strong>6975 테스트 학생 2~3명</strong>만 넣으세요.</li>
              <li>본실행(1437명) 아님 — 동작 확인 후 <strong>이 페이지·API는 삭제</strong>하세요.</li>
            </ul>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
            <label className="block text-sm font-medium">재잠금/복원할 student_id (쉼표 또는 줄바꿈 구분)</label>
            <textarea value={idsText} onChange={e => setIdsText(e.target.value)} rows={5}
              placeholder={'예:\n11111111-2222-3333-4444-555555555555\n66666666-7777-8888-9999-000000000000'}
              disabled={busy}
              className="w-full p-3 border border-gray-300 rounded-lg text-sm font-mono" />
            <div className="flex gap-2 flex-wrap">
              <button onClick={runLock} disabled={busy}
                className="px-4 py-2.5 bg-rose-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-rose-700">
                🔒 재잠금 실행
              </button>
              <button onClick={runRestore} disabled={busy}
                className="px-4 py-2.5 bg-white border border-gray-300 text-gray-800 rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-gray-50">
                ↩ 백업에서 복원
              </button>
            </div>
          </div>

          {summary && (
            <div className="bg-white rounded-2xl p-4 shadow-sm text-sm">
              {summary.mode === 'lock'
                ? <p>🔒 잠금 <strong className="text-rose-600">{summary.relocked}</strong>명 · skip <strong>{summary.skipped}</strong>명</p>
                : <p>↩ 복원 <strong className="text-green-700">{summary.restored}</strong>명 · 백업없음 {summary.noBackup} · 실패 {summary.failed}</p>}
            </div>
          )}

          {log.length > 0 && (
            <div className="bg-gray-900 text-gray-100 rounded-2xl p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
              {log.join('\n')}
            </div>
          )}
        </main>
      </div>
    </>
  )
}
