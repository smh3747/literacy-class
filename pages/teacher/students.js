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
            <h3 className="font-bold mb-3">👥 등록된 학생 ({students.length}명)</h3>
            {students.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">아직 등록된 학생이 없어요</p>
            ) : (
              <div className="space-y-2">
                {[...students].sort((a, b) => {
                  const na = parseInt(a.number) || 999
                  const nb = parseInt(b.number) || 999
                  if (na !== nb) return na - nb
                  return (a.username || '').localeCompare(b.username || '')
                }).map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      {s.number && (
                        <span className="text-xs font-mono bg-white border border-gray-200 px-2 py-1 rounded">
                          {s.number}번
                        </span>
                      )}
                      <div>
                        <div className="font-medium">{s.realname}</div>
                        <div className="text-xs text-gray-500 font-mono">{s.username}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
