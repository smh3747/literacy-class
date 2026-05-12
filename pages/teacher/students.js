import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

export default function StudentsPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadStatus, setUploadStatus] = useState(null)
  const [parsedStudents, setParsedStudents] = useState([])
  const [uploading, setUploading] = useState(false)
  // 인라인 편집 상태
  const [editingNumbers, setEditingNumbers] = useState({}) // {studentId: number}
  const [savingId, setSavingId] = useState(null)
  // 숨김 학생 보기 토글
  const [showHidden, setShowHidden] = useState(false)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(id, name, code)').eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    await loadStudents(profile.classes?.id)
    setLoading(false)
  }

  const loadStudents = async (classId) => {
    if (!classId) return
    const { data } = await supabase.from('profiles').select('*').eq('class_id', classId).eq('role', 'student').order('username')
    setStudents(data || [])
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    const XLSX = (await import('xlsx')).default || (await import('xlsx'))
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })
        
        // 헤더 찾기 (성명, 아이디 컬럼 위치)
        const header = rows[0] || []
        const nameIdx = header.findIndex(h => String(h).includes('성명') || String(h).includes('이름'))
        const idIdx = header.findIndex(h => String(h).includes('아이디'))
        const numIdx = header.findIndex(h => String(h).includes('번호'))
        
        if (nameIdx === -1 || idIdx === -1) {
          alert('엑셀에 "성명"과 "아이디" 컬럼이 있어야 해요!')
          return
        }

        const parsed = []
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          if (!row || !row[nameIdx] || !row[idIdx]) continue
          parsed.push({
            number: row[numIdx] || '',
            realname: String(row[nameIdx]).trim(),
            username: String(row[idIdx]).trim().toLowerCase()
          })
        }
        
        setParsedStudents(parsed)
        setUploadStatus(`📋 ${parsed.length}명의 학생이 감지되었어요. 아래에서 확인 후 "일괄 등록" 클릭`)
      } catch(err) {
        alert('엑셀 파일 읽기 실패: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const submitBulk = async () => {
    if (parsedStudents.length === 0) return
    if (!confirm(`${parsedStudents.length}명을 일괄 등록할게요.\n\n초기 비밀번호는 모두 "1234" 입니다.\n진행할까요?`)) return

    setUploading(true)
    try {
      const res = await fetch('/api/students-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ students: parsedStudents, classId: classInfo.id })
      })
      const result = await res.json()
      
      const msg = `✅ 성공: ${result.success.length}명\n❌ 실패: ${result.failed.length}명`
      const failedDetail = result.failed.length > 0 
        ? '\n\n실패 명단:\n' + result.failed.map(f => `- ${f.realname} (${f.username}): ${f.error}`).join('\n')
        : ''
      alert(msg + failedDetail)
      
      setParsedStudents([])
      setUploadStatus(null)
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('일괄 등록 실패: ' + e.message)
    }
    setUploading(false)
  }

  const resetPassword = async (studentId, username) => {
    if (!confirm(`${username}의 비밀번호를 "1234"로 초기화할까요?`)) return
    try {
      // Note: 실제로는 admin API 필요. 여기서는 안내만
      alert('비밀번호 초기화는 추후 추가됩니다. 학생에게 직접 변경 안내 부탁드립니다.')
    } catch(e) { alert('실패: ' + e.message) }
  }

  // 번호 인라인 편집 저장
  const saveNumber = async (studentId) => {
    const newNumber = (editingNumbers[studentId] || '').trim()
    setSavingId(studentId)
    try {
      const { error } = await supabase.from('profiles')
        .update({ number: newNumber || null })
        .eq('id', studentId)
      if (error) throw error
      // 로컬 상태 업데이트
      setStudents(prev => prev.map(s =>
        s.id === studentId ? { ...s, number: newNumber || null } : s
      ))
      // 편집 상태 클리어
      setEditingNumbers(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSavingId(null)
  }

  // 동의서 회신 체크 토글
  const toggleConsent = async (studentId, currentValue) => {
    const newValue = !currentValue
    setSavingId(studentId)
    try {
      const { error } = await supabase.from('profiles').update({
        consent_received: newValue,
        consent_received_at: newValue ? new Date().toISOString() : null
      }).eq('id', studentId)
      if (error) throw error
      setStudents(prev => prev.map(s =>
        s.id === studentId
          ? { ...s, consent_received: newValue, consent_received_at: newValue ? new Date().toISOString() : null }
          : s
      ))
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSavingId(null)
  }

  // 학생 숨김/복원 토글
  const toggleHidden = async (studentId, studentName, currentValue) => {
    const newValue = !currentValue
    if (newValue) {
      // 숨김 처리
      const reason = prompt(
        `🙈 "${studentName}" 학생을 숨김 처리할까요?\n\n` +
        `숨김 처리하면:\n` +
        `- 통계/그래프/제출 현황에서 제외됩니다\n` +
        `- 학생 본인은 여전히 로그인 가능 (데이터 보존)\n` +
        `- 언제든지 복원 가능합니다\n\n` +
        `사유를 입력해주세요 (선택, 예: 전출, 휴학 등):`,
        '전출'
      )
      if (reason === null) return // 취소

      setSavingId(studentId)
      try {
        const { error } = await supabase.from('profiles').update({
          is_hidden: true,
          hidden_at: new Date().toISOString(),
          hidden_reason: (reason || '').trim() || null
        }).eq('id', studentId)
        if (error) throw error
        await loadStudents(classInfo.id)
      } catch(e) {
        alert('실패: ' + e.message)
      }
      setSavingId(null)
    } else {
      // 복원
      if (!confirm(`"${studentName}" 학생을 다시 활성화할까요?`)) return
      setSavingId(studentId)
      try {
        const { error } = await supabase.from('profiles').update({
          is_hidden: false,
          hidden_at: null,
          hidden_reason: null
        }).eq('id', studentId)
        if (error) throw error
        await loadStudents(classInfo.id)
      } catch(e) {
        alert('실패: ' + e.message)
      }
      setSavingId(null)
    }
  }

  // 모든 학생 번호 일괄 저장 (편집 중인 것들만)
  const saveAllNumbers = async () => {
    const ids = Object.keys(editingNumbers)
    if (ids.length === 0) return alert('변경된 번호가 없어요')
    if (!confirm(`${ids.length}명의 번호를 저장할까요?`)) return

    let success = 0, failed = 0
    for (const id of ids) {
      try {
        const num = (editingNumbers[id] || '').trim()
        const { error } = await supabase.from('profiles')
          .update({ number: num || null }).eq('id', id)
        if (error) throw error
        success++
      } catch(e) { failed++ }
    }
    alert(`✅ 성공: ${success}명${failed > 0 ? `\n❌ 실패: ${failed}명` : ''}`)
    setEditingNumbers({})
    await loadStudents(classInfo.id)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>학생 관리 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">학생 관리</h1>
          </div>

          {/* 학급 정보 */}
          {classInfo && (
            <div className="bg-primary-light border border-primary rounded-2xl p-4">
              <div className="text-sm text-primary-dark">
                <strong>{classInfo.name}</strong> · 학생 가입 코드: <span className="font-mono font-bold tracking-widest">{classInfo.code}</span>
              </div>
            </div>
          )}

          {/* 일괄 등록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold mb-2">📋 학급명렬표 일괄 등록</h3>
            <p className="text-sm text-gray-600 mb-3">
              엑셀 파일(.xlsx)을 업로드하면 학생들이 한 번에 등록돼요. 초기 비밀번호는 모두 <strong>1234</strong> 입니다.
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="sr-only">엑셀 파일 선택</span>
                <input 
                  type="file" 
                  accept=".xlsx,.xls" 
                  onChange={handleFile}
                  className="w-full text-sm border border-gray-200 rounded-lg p-2 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-primary file:text-white"
                />
              </label>
              {uploadStatus && (
                <div className="text-sm bg-blue-50 text-blue-900 p-3 rounded-lg">{uploadStatus}</div>
              )}
              {parsedStudents.length > 0 && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 max-h-60 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left border-b">
                        <th className="py-1 px-2">번호</th>
                        <th className="py-1 px-2">이름</th>
                        <th className="py-1 px-2">아이디</th>
                      </tr></thead>
                      <tbody>
                        {parsedStudents.map((s, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-1 px-2">{s.number}</td>
                            <td className="py-1 px-2">{s.realname}</td>
                            <td className="py-1 px-2 font-mono text-xs">{s.username}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={submitBulk} disabled={uploading}
                    className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                    {uploading ? '등록 중...' : `📥 ${parsedStudents.length}명 일괄 등록`}
                  </button>
                </>
              )}
              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer hover:text-gray-700">📥 엑셀 양식 다운로드 안내</summary>
                <div className="mt-2 p-3 bg-gray-50 rounded">
                  엑셀에 다음 컬럼이 있어야 해요:<br/>
                  <code className="block mt-1 font-mono">학년 | 반 | 번호 | 성명 | 아이디 | 비고</code>
                  <p className="mt-2">아이디는 영문+숫자로 (예: harang01, minsu_k 등). 한글 ❌</p>
                </div>
              </details>
            </div>
          </div>

          {/* 등록된 학생 목록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-bold">
                👥 등록된 학생
                {(() => {
                  const active = students.filter(s => !s.is_hidden).length
                  const hidden = students.filter(s => s.is_hidden).length
                  return (
                    <span className="ml-1">
                      ({active}명{hidden > 0 && <span className="text-gray-400"> · 숨김 {hidden}명</span>})
                    </span>
                  )
                })()}
                {students.filter(s => !s.is_hidden).length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    동의서 회신 {students.filter(s => !s.is_hidden && s.consent_received).length}/{students.filter(s => !s.is_hidden).length}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {students.some(s => s.is_hidden) && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={showHidden}
                      onChange={e => setShowHidden(e.target.checked)}
                      className="w-3.5 h-3.5" />
                    <span>숨김 학생 보기</span>
                  </label>
                )}
                {Object.keys(editingNumbers).length > 0 && (
                  <button onClick={saveAllNumbers}
                    className="text-xs bg-primary text-white px-3 py-1 rounded-full">
                    💾 변경된 번호 {Object.keys(editingNumbers).length}건 일괄 저장
                  </button>
                )}
              </div>
            </div>

            {students.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">아직 등록된 학생이 없어요</p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  💡 번호칸은 직접 클릭해서 수정 / 동의서는 종이 회신 받으면 체크 / 🙈 버튼으로 전출생 숨김
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="py-2 px-2 w-20">번호</th>
                        <th className="py-2 px-2">이름</th>
                        <th className="py-2 px-2 hidden sm:table-cell">아이디</th>
                        <th className="py-2 px-2 text-center w-16">동의서</th>
                        <th className="py-2 px-2 text-center w-12">숨김</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...students]
                        .filter(s => showHidden || !s.is_hidden)
                        .sort((a, b) => {
                          // 숨김 학생은 아래로
                          if (a.is_hidden !== b.is_hidden) return a.is_hidden ? 1 : -1
                          const na = parseInt(a.number) || 999
                          const nb = parseInt(b.number) || 999
                          if (na !== nb) return na - nb
                          return (a.username || '').localeCompare(b.username || '')
                        }).map(s => {
                        const currentNumber = editingNumbers[s.id] !== undefined
                          ? editingNumbers[s.id]
                          : (s.number || '')
                        const isDirty = editingNumbers[s.id] !== undefined && editingNumbers[s.id] !== (s.number || '')

                        return (
                          <tr key={s.id}
                            className={`border-b border-gray-100 hover:bg-gray-50 ${s.is_hidden ? 'opacity-50 bg-gray-50' : ''}`}>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={currentNumber}
                                onChange={e => setEditingNumbers(prev => ({ ...prev, [s.id]: e.target.value }))}
                                onBlur={() => { if (isDirty) saveNumber(s.id) }}
                                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                                placeholder="-"
                                className={`w-14 p-1 text-center text-sm border rounded font-mono ${
                                  isDirty ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                                }`}
                                disabled={savingId === s.id || s.is_hidden}
                              />
                            </td>
                            <td className="py-2 px-2 font-medium">
                              {s.realname}
                              {s.is_hidden && s.hidden_reason && (
                                <span className="ml-2 text-xs text-gray-400">({s.hidden_reason})</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-xs text-gray-500 font-mono hidden sm:table-cell">{s.username}</td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => toggleConsent(s.id, s.consent_received)}
                                disabled={savingId === s.id || s.is_hidden}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded ${
                                  s.consent_received
                                    ? 'bg-green-100 text-green-700 border border-green-300'
                                    : 'bg-gray-100 text-gray-400 border border-gray-200 hover:bg-gray-200'
                                } disabled:opacity-40`}
                                title={s.consent_received ? '동의서 회신됨' : '동의서 미회신'}
                              >
                                {s.consent_received ? '✓' : '·'}
                              </button>
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => toggleHidden(s.id, s.realname, s.is_hidden)}
                                disabled={savingId === s.id}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded text-sm ${
                                  s.is_hidden
                                    ? 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'
                                    : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                                }`}
                                title={s.is_hidden ? '숨김 해제 (활성화)' : '숨김 처리 (전출생 등)'}
                              >
                                {s.is_hidden ? '↻' : '🙈'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
