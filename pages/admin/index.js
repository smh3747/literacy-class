import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

export default function AdminHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState({ teachers: 0, classes: 0, students: 0, submissions: 0, today: 0 })
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [feedbacks, setFeedbacks] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', au.id).maybeSingle()
    if (!profile || profile.role !== 'admin') {
      alert('관리자만 접근 가능해요!')
      router.push('/teacher')
      return
    }
    setUser(profile)
    await loadAll()
    setLoading(false)
  }

  const loadAll = async () => {
    const today = new Date()
    const todayKr = new Date(today.getTime() + (9 * 3600 * 1000) - (today.getTimezoneOffset() * 60 * 1000)).toISOString().slice(0, 10)
    
    const [teachersRes, classesRes, studentsRes, submissionsRes, todayRes, feedbackRes] = await Promise.all([
      supabase.from('profiles').select('*, classes(name, code)').in('role', ['teacher', 'admin']).order('created_at', { ascending: false }),
      supabase.from('classes').select('*, profiles!classes_teacher_id_fkey(realname, school)').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
      supabase.from('submissions').select('id', { count: 'exact', head: true }),
      supabase.from('submissions').select('id', { count: 'exact', head: true }).gte('created_at', todayKr + 'T00:00:00'),
      supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(50)
    ])

    setTeachers(teachersRes.data || [])
    setClasses(classesRes.data || [])
    setFeedbacks(feedbackRes.data || [])
    
    setStats({
      teachers: (teachersRes.data || []).filter(t => t.role !== 'admin').length,
      classes: (classesRes.data || []).length,
      students: studentsRes.count || 0,
      submissions: submissionsRes.count || 0,
      today: todayRes.count || 0
    })
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const toggleTeacherBan = async (teacher) => {
    if (teacher.role === 'admin') return alert('관리자는 차단할 수 없어요')
    const action = teacher.is_banned ? '해제' : '차단'
    if (!confirm(`${teacher.realname} 선생님을 ${action}하시겠어요?\n\n${teacher.is_banned ? '해제하면 다시 로그인 가능해요' : '차단하면 로그인 불가능, 학급 운영 중지'}`)) return
    
    const { error } = await supabase.from('profiles').update({ is_banned: !teacher.is_banned }).eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
    alert(`${action} 완료!`)
    await loadAll()
  }

  const toggleClassActive = async (cls) => {
    const action = cls.is_active === false ? '활성화' : '비활성화'
    if (!confirm(`"${cls.name}" 학급을 ${action}하시겠어요?\n\n${action === '비활성화' ? '비활성화하면 학생 가입/글쓰기 모두 중지됩니다' : '활성화하면 다시 정상 운영됩니다'}`)) return
    
    const { error } = await supabase.from('classes').update({ is_active: cls.is_active === false }).eq('id', cls.id)
    if (error) return alert('실패: ' + error.message)
    alert(`${action} 완료!`)
    await loadAll()
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>관리자 페이지 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">🛡️ 관리자 페이지</h1>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full font-semibold">SUPER ADMIN</span>
            </div>
            <Link href="/teacher" className="text-sm text-gray-600 hover:text-primary">
              ← 선생님 모드로
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: '선생님', val: stats.teachers, icon: '👨‍🏫', color: 'bg-blue-50 text-blue-900' },
              { label: '학급', val: stats.classes, icon: '🏫', color: 'bg-green-50 text-green-900' },
              { label: '학생', val: stats.students, icon: '🎒', color: 'bg-purple-50 text-purple-900' },
              { label: '누적 글쓰기', val: stats.submissions, icon: '📝', color: 'bg-orange-50 text-orange-900' },
              { label: '오늘', val: stats.today, icon: '✨', color: 'bg-pink-50 text-pink-900' }
            ].map(s => (
              <div key={s.label} className={`${s.color} rounded-xl p-4`}>
                <div className="text-2xl mb-1">{s.icon}</div>
                <div className="text-xs opacity-75">{s.label}</div>
                <div className="text-2xl font-bold">{s.val}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-1 bg-white rounded-xl p-1 border border-gray-200 overflow-x-auto">
            {[
              { id: 'overview', label: '👥 선생님' },
              { id: 'classes', label: '🏫 학급' },
              { id: 'submissions', label: '📝 학생 글' },
              { id: 'feedbacks', label: `💬 의견 (${feedbacks.length})` }
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 min-w-fit py-2 px-3 rounded-lg text-sm font-medium whitespace-nowrap ${tab === t.id ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <h3 className="font-bold mb-3">👨‍🏫 가입한 선생님 ({teachers.length}명)</h3>
              {teachers.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">가입한 선생님이 없어요</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left">이름</th>
                        <th className="p-2 text-left">학교</th>
                        <th className="p-2 text-left">아이디</th>
                        <th className="p-2 text-left">학급</th>
                        <th className="p-2 text-left">권한</th>
                        <th className="p-2 text-left">가입일</th>
                        <th className="p-2 text-left">상태</th>
                        <th className="p-2 text-center">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teachers.map(t => (
                        <tr key={t.id} className={`border-b border-gray-100 ${t.is_banned ? 'bg-red-50' : ''}`}>
                          <td className="p-2 font-medium">{t.realname}</td>
                          <td className="p-2 text-gray-600">{t.school || '-'}</td>
                          <td className="p-2 text-gray-600 font-mono text-xs">{t.username}</td>
                          <td className="p-2 text-gray-600">{t.classes?.name || '-'}</td>
                          <td className="p-2">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${t.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                              {t.role === 'admin' ? '관리자' : '교사'}
                            </span>
                          </td>
                          <td className="p-2 text-xs text-gray-500">{t.created_at?.slice(0, 10)}</td>
                          <td className="p-2">
                            {t.is_banned ? (
                              <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">차단됨</span>
                            ) : (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">정상</span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {t.role !== 'admin' && (
                              <button onClick={() => toggleTeacherBan(t)}
                                className={`text-xs px-3 py-1 rounded ${t.is_banned ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}>
                                {t.is_banned ? '차단 해제' : '차단'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'classes' && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <h3 className="font-bold mb-3">🏫 학급 목록 ({classes.length}개)</h3>
              {classes.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">학급이 없어요</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left">학급명</th>
                        <th className="p-2 text-left">담임</th>
                        <th className="p-2 text-left">학교</th>
                        <th className="p-2 text-left">코드</th>
                        <th className="p-2 text-left">API 키</th>
                        <th className="p-2 text-left">상태</th>
                        <th className="p-2 text-center">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classes.map(c => (
                        <tr key={c.id} className={`border-b border-gray-100 ${c.is_active === false ? 'bg-gray-100 opacity-60' : ''}`}>
                          <td className="p-2 font-medium">{c.name}</td>
                          <td className="p-2 text-gray-600">{c.profiles?.realname || '-'}</td>
                          <td className="p-2 text-gray-600">{c.profiles?.school || '-'}</td>
                          <td className="p-2 font-mono text-sm">{c.code}</td>
                          <td className="p-2">
                            {c.api_key ? (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">✅</span>
                            ) : (
                              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">미등록</span>
                            )}
                          </td>
                          <td className="p-2">
                            {c.is_active === false ? (
                              <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full">비활성</span>
                            ) : (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">활성</span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <button onClick={() => toggleClassActive(c)}
                              className={`text-xs px-3 py-1 rounded ${c.is_active === false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
                              {c.is_active === false ? '활성화' : '비활성화'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'submissions' && <AdminSubmissions />}

          {tab === 'feedbacks' && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <h3 className="font-bold mb-3">💬 받은 의견 ({feedbacks.length}건)</h3>
              {feedbacks.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">받은 의견이 없어요</p>
              ) : (
                <div className="space-y-3">
                  {feedbacks.map(f => (
                    <div key={f.id} className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">{f.created_at?.slice(0, 16).replace('T', ' ')}</div>
                      <div className="text-sm whitespace-pre-wrap">{f.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </main>
      </div>
    </>
  )
}

function AdminSubmissions() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedClass, setSelectedClass] = useState('all')
  const [classList, setClassList] = useState([])
  const [selectedSubmission, setSelectedSubmission] = useState(null)

  useEffect(() => { load() }, [selectedClass])

  const load = async () => {
    setLoading(true)
    const { data: classData } = await supabase.from('classes').select('id, name')
    setClassList(classData || [])
    
    let query = supabase.from('submissions')
      .select('*, profiles!submissions_user_id_fkey(realname, username, class_id), topics(title, date)')
      .order('created_at', { ascending: false })
      .limit(100)
    
    const { data } = await query
    let filtered = data || []
    
    if (selectedClass !== 'all') {
      filtered = filtered.filter(s => s.profiles?.class_id === selectedClass)
    }
    
    setSubmissions(filtered)
    setLoading(false)
  }

  if (selectedSubmission) {
    return <SubmissionDetail sub={selectedSubmission} onBack={() => setSelectedSubmission(null)} />
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">📝 학생 글 (최근 100건)</h3>
        <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}
          className="text-sm border border-gray-200 rounded p-2">
          <option value="all">모든 학급</option>
          {classList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">로딩 중...</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">학생 글이 없어요</p>
      ) : (
        <div className="space-y-2">
          {submissions.map(s => (
            <button key={s.id} onClick={() => setSelectedSubmission(s)}
              className="w-full text-left bg-gray-50 hover:bg-gray-100 rounded-lg p-3 flex justify-between items-center">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  {s.profiles?.realname || '?'} 
                  <span className="text-xs text-gray-500 ml-2">({s.attempt === 1 ? '첫 글' : '수정본'})</span>
                  {s.paste_detected && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⚠️ 복붙</span>}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {s.topic_title || s.topics?.title || '-'} · {s.created_at?.slice(0, 16).replace('T', ' ')}
                </div>
              </div>
              <div className="text-sm font-bold ml-3">{s.total_score}/{s.max_score}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SubmissionDetail({ sub, onBack }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <button onClick={onBack} className="text-sm text-gray-600">← 목록으로</button>
      <div className="bg-primary-light rounded-lg p-3">
        <div className="font-bold">{sub.profiles?.realname}</div>
        <div className="text-xs text-gray-700">{sub.topic_title} · {sub.created_at?.slice(0, 16).replace('T', ' ')}</div>
      </div>
      <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap leading-relaxed">{sub.essay_text}</div>
      <div className="space-y-2 text-sm pt-2 border-t">
        <div><strong>점수:</strong> {sub.total_score}/{sub.max_score}점</div>
        <div><strong>💬 종합:</strong> {sub.feedback_overall}</div>
        <div><strong>⭐ 잘한 점:</strong> {sub.feedback_good}</div>
        <div><strong>🌱 발전:</strong> {sub.feedback_improve}</div>
        {sub.paste_detected && <div className="text-red-600 text-xs">⚠️ 붙여넣기 {sub.paste_count}회 감지됨</div>}
      </div>
    </div>
  )
}
