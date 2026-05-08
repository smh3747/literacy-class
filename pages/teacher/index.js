import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import ApiKeyManager from '../../components/ApiKeyManager'

export default function TeacherHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [stats, setStats] = useState({ students: 0, topics: 0 })
  const [loading, setLoading] = useState(true)

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
    
    if (profile.classes?.id) {
      const [s, t] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('class_id', profile.classes.id).eq('role', 'student'),
        supabase.from('topics').select('id', { count: 'exact', head: true }).eq('teacher_id', profile.id)
      ])
      setStats({ students: s.count || 0, topics: t.count || 0 })
    }
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const regenerateClassCode = async () => {
    if (!classInfo) return
    if (!confirm(`학급 가입 코드를 재발급할까요?\n\n현재: ${classInfo.code}\n\n⚠️ 재발급하면 기존 코드는 사용할 수 없어요. 학생들에게 새 코드를 알려야 해요!`)) return
    
    try {
      let newCode, attempts = 0
      while (attempts < 10) {
        newCode = String(Math.floor(1000 + Math.random() * 9000))
        const { data: existing } = await supabase.from('classes').select('id').eq('code', newCode).maybeSingle()
        if (!existing) break
        attempts++
      }
      
      const { error } = await supabase.from('classes').update({ code: newCode }).eq('id', classInfo.id)
      if (error) throw error
      
      setClassInfo({ ...classInfo, code: newCode })
      alert(`✅ 새 학급 코드: ${newCode}\n\n학생들에게 새 코드를 알려주세요!`)
    } catch(e) {
      alert('재발급 실패: ' + e.message)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500">로딩 중...</div></div>

  return (
    <>
      <Head><title>선생님 화면 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">{user.realname} 선생님 환영합니다!</h2>
              <p className="text-sm text-gray-600 mt-1">
                {user.role === 'admin' ? '👑 관리자' : '👩‍🏫 담임 교사'}
                {user.school && <span className="ml-2 text-gray-500">· {user.school}</span>}
              </p>
            </div>
            {user.role === 'admin' && (
              <Link href="/admin" className="text-sm bg-purple-100 text-purple-700 px-4 py-2 rounded-lg font-medium hover:bg-purple-200">
                🛡️ 관리자 모드
              </Link>
            )}
          </div>

          {/* 학급 정보 카드 */}
          {classInfo && (
            <div className="bg-primary-light border-2 border-primary rounded-2xl p-5">
              <div className="text-xs text-primary-dark font-semibold mb-1">📋 우리 학급</div>
              <div className="text-2xl font-bold text-primary-dark mb-3">{classInfo.name}</div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xs text-primary-dark mb-1">학생 가입 코드</div>
                  <div className="text-3xl font-mono font-bold tracking-widest text-primary-dark">{classInfo.code}</div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-primary-dark">학생 <strong>{stats.students}</strong>명</div>
                  <div className="text-primary-dark">주제 <strong>{stats.topics}</strong>개</div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <p className="text-xs text-gray-700">학생들에게 위 코드를 알려주세요</p>
                <button onClick={regenerateClassCode}
                  className="text-xs bg-white border border-primary text-primary px-3 py-1 rounded-full hover:bg-primary-light">
                  🔄 코드 재발급
                </button>
              </div>
            </div>
          )}

          {/* API 키 관리 */}
          <ApiKeyManager classId={classInfo?.id} />

          {/* 메뉴 */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Link href="/teacher/topics" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📚</div>
              <h3 className="font-bold mb-1">주제 관리</h3>
              <p className="text-xs text-gray-500">오늘의 글쓰기 주제 등록</p>
            </Link>
            <Link href="/teacher/students" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">👥</div>
              <h3 className="font-bold mb-1">학생 관리</h3>
              <p className="text-xs text-gray-500">학급명렬표 일괄 등록</p>
            </Link>
            <Link href="/teacher/submissions" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📝</div>
              <h3 className="font-bold mb-1">학생 글 보기</h3>
              <p className="text-xs text-gray-500">주제별 학생 글 + 피드백</p>
            </Link>
            <div className="bg-gray-100 rounded-2xl p-5 border border-gray-200 opacity-60">
              <div className="text-3xl mb-2">📊</div>
              <h3 className="font-bold mb-1">학생 기록</h3>
              <p className="text-xs text-gray-500">학생별 성장 그래프 (추후)</p>
            </div>
          </div>
        </main>
      </div>
    </>
  )
}
