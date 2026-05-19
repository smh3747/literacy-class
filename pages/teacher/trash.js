// 🗑️ 선생님 쓰레기통
// - 30일 보관 후 자동 영구 삭제 (기간은 학급 설정에서 변경 가능)
// - [복원] / [영구 삭제] 가능
import { useEffect, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

export default function TeacherTrash() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles')
      .select('*, classes(id, name, code, trash_retention_days)')
      .eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    await loadTrash(profile.classes?.id)
    setLoading(false)
  }

  const loadTrash = async (classId) => {
    if (!classId) return
    // 학급 학생들의 쓰레기통 글
    const { data: students } = await supabase.from('profiles')
      .select('id, realname, number').eq('class_id', classId).eq('role', 'student')
    const studentMap = {}
    ;(students || []).forEach(s => { studentMap[s.id] = s })
    const studentIds = (students || []).map(s => s.id)
    if (studentIds.length === 0) { setItems([]); return }

    const { data: subs } = await supabase.from('submissions')
      .select('*')
      .in('user_id', studentIds)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })

    const enriched = (subs || []).map(s => ({
      ...s,
      student: studentMap[s.user_id]
    }))
    setItems(enriched)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 복원
  const restore = async (subId, studentName) => {
    if (!confirm(`"${studentName}" 학생의 글을 복원할까요?\n다시 학생/통계/랭킹에 보이게 됩니다.`)) return
    setBusyId(subId)
    try {
      const { error } = await supabase.from('submissions').update({
        deleted_at: null,
        deleted_by: null,
        delete_reason: null
      }).eq('id', subId)
      if (error) throw error
      await loadTrash(classInfo.id)
      alert('✅ 복원 완료!')
    } catch (e) {
      alert('실패: ' + e.message)
    }
    setBusyId(null)
  }

  // 영구 삭제
  const permaDelete = async (subId, studentName) => {
    if (!confirm(`⚠️ "${studentName}" 학생의 글을 영구 삭제할까요?\n\n· 이 작업은 되돌릴 수 없어요\n· DB에서 완전히 사라집니다\n· 다시 확인해주세요!`)) return
    if (!confirm(`정말로 영구 삭제하시겠습니까? 마지막 확인입니다.`)) return
    setBusyId(subId)
    try {
      const { error } = await supabase.from('submissions').delete().eq('id', subId)
      if (error) throw error
      await loadTrash(classInfo.id)
      alert('🗑️ 영구 삭제 완료')
    } catch (e) {
      alert('실패: ' + e.message)
    }
    setBusyId(null)
  }

  // 자동 삭제 기간 변경
  const updateRetention = async (days) => {
    if (!classInfo) return
    const { error } = await supabase.from('classes')
      .update({ trash_retention_days: days })
      .eq('id', classInfo.id)
    if (error) return alert('실패: ' + error.message)
    setClassInfo({ ...classInfo, trash_retention_days: days })
    alert(`✅ 자동 삭제 기간이 ${days}일로 변경됐어요.`)
  }

  // 남은 일수 계산
  const retentionDays = classInfo?.trash_retention_days || 30
  const daysLeft = (deletedAt) => {
    if (!deletedAt) return null
    const deleted = new Date(deletedAt).getTime()
    const expires = deleted + retentionDays * 24 * 60 * 60 * 1000
    const now = Date.now()
    const ms = expires - now
    if (ms <= 0) return 0
    return Math.ceil(ms / (24 * 60 * 60 * 1000))
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>쓰레기통 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">🗑️ 쓰레기통</h1>
          </div>

          {/* 자동 삭제 기간 설정 */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="font-bold text-sm mb-2">⏳ 자동 영구 삭제 기간</h2>
            <p className="text-xs text-gray-600 mb-2">
              쓰레기통에 들어온 글은 <strong>{retentionDays}일 후</strong> 자동으로 영구 삭제됩니다.
            </p>
            <div className="flex gap-2 flex-wrap">
              {[7, 30, 60, 90, 180].map(d => (
                <button key={d}
                  onClick={() => updateRetention(d)}
                  className={`px-3 py-1.5 rounded text-xs font-medium ${
                    retentionDays === d
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}>
                  {d}일
                </button>
              ))}
            </div>
          </div>

          {/* 쓰레기통 글 목록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h2 className="font-bold mb-3">📋 보관된 글 ({items.length}개)</h2>

            {items.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <div className="text-4xl mb-2">🗑️</div>
                <p className="text-sm">쓰레기통이 비어있어요</p>
                <p className="text-xs text-gray-400 mt-1">학생글 보기에서 🗑️ 버튼으로 글을 옮길 수 있어요</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map(s => {
                  const left = daysLeft(s.deleted_at)
                  const isExpiringSoon = left !== null && left <= 7
                  return (
                    <div key={s.id} className={`border rounded-lg p-4 space-y-2 ${
                      isExpiringSoon ? 'border-red-200 bg-red-50/30' : 'border-gray-200'
                    }`}>
                      <div className="flex items-start justify-between flex-wrap gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {s.student?.number ? `${s.student.number}. ` : ''}{s.student?.realname || '(알 수 없음)'}
                            <span className="ml-2 text-xs text-gray-500">
                              {(s.attempt||1) === 1 ? '📝 첫 글' : `✨ 수정본 ${s.attempt}`}
                            </span>
                            {s.total_score !== null && s.total_score !== undefined && (
                              <span className="ml-2 text-xs text-gray-500">{s.total_score}/{s.max_score}점</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            📌 {s.topic_title || '(주제 없음)'}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            🗑️ 삭제: {new Date(s.deleted_at).toLocaleString('ko-KR')}
                            {s.delete_reason && <span className="ml-2 text-gray-700">· 사유: {s.delete_reason}</span>}
                          </div>
                        </div>
                        <div className={`text-xs font-bold px-2 py-1 rounded ${
                          isExpiringSoon ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {left === 0 ? '곧 자동 삭제' : `${left}일 남음`}
                        </div>
                      </div>

                      {/* 글 내용 미리보기 */}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">글 내용 미리보기</summary>
                        <div className="mt-2 bg-gray-50 rounded p-2 text-gray-700 whitespace-pre-wrap line-clamp-6 max-h-32 overflow-y-auto">
                          {s.essay_text}
                        </div>
                      </details>

                      {/* 액션 */}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => restore(s.id, s.student?.realname || '학생')}
                          disabled={busyId === s.id}
                          className="flex-1 py-1.5 bg-blue-100 text-blue-700 rounded text-xs font-medium hover:bg-blue-200 disabled:opacity-50"
                        >
                          ↻ 복원
                        </button>
                        <button
                          onClick={() => permaDelete(s.id, s.student?.realname || '학생')}
                          disabled={busyId === s.id}
                          className="flex-1 py-1.5 bg-red-100 text-red-700 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-50"
                        >
                          🗑️ 영구 삭제
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
