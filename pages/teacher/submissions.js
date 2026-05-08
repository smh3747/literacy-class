import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

function escapeHtml(text) {
  if (!text) return ''
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function applyGrammar(essayText, corrections) {
  if (!essayText) return ''
  if (!corrections?.length) return escapeHtml(essayText).replace(/\n/g,'<br>')
  const matches = []
  corrections.forEach(c => {
    const orig = c.original || c.error || c.wrong || ''
    const corr = c.correction || c.fixed || ''
    const reason = c.reason || c.type || ''
    if (!orig) return
    let from = 0
    while (true) {
      const idx = essayText.indexOf(orig, from)
      if (idx === -1) break
      const overlap = matches.some(m => idx < m.end && idx + orig.length > m.start)
      if (!overlap) { matches.push({ start: idx, end: idx + orig.length, orig, corr, reason }); break }
      from = idx + 1
    }
  })
  matches.sort((a,b) => a.start - b.start)
  let result = '', last = 0
  matches.forEach(m => {
    if (m.start > last) result += escapeHtml(essayText.slice(last, m.start))
    const tip = m.corr ? `${m.corr}${m.reason ? ' (' + m.reason + ')' : ''}` : '오류'
    result += `<span class="grammar-error" data-correction="${escapeHtml(tip)}">${escapeHtml(m.orig)}</span>`
    last = m.end
  })
  if (last < essayText.length) result += escapeHtml(essayText.slice(last))
  return result.replace(/\n/g, '<br>')
}

export default function TeacherSubmissions() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('topics') // topics / topicStudents / studentDetail
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [topicStudents, setTopicStudents] = useState([])
  const [selectedStudent, setSelectedStudent] = useState(null)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(id, name, code)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    
    const { data } = await supabase.from('topics').select('*').eq('teacher_id', profile.id).order('date', { ascending: false }).limit(30)
    setTopics(data || [])
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const openTopic = async (topic) => {
    setSelectedTopic(topic)
    
    // 같은 학급 학생들의 이 주제 제출본
    const { data: students } = await supabase.from('profiles').select('id, realname, username').eq('class_id', classInfo.id).eq('role', 'student')
    const studentIds = (students || []).map(s => s.id)
    if (studentIds.length === 0) { setTopicStudents([]); setView('topicStudents'); return }
    
    const { data: subs } = await supabase.from('submissions').select('*').eq('topic_id', topic.id).in('user_id', studentIds)
    
    const byStudent = {}
    students.forEach(s => { byStudent[s.id] = { profile: s, items: [] } })
    ;(subs || []).forEach(s => {
      if (byStudent[s.user_id]) byStudent[s.user_id].items.push(s)
    })
    
    setTopicStudents(Object.values(byStudent).filter(g => g.items.length > 0))
    setView('topicStudents')
  }

  const openStudent = (student) => {
    setSelectedStudent(student)
    setView('studentDetail')
  }

  const allowExtraRewrite = async (subId) => {
    if (!confirm('이 학생에게 추가 수정을 허용하시겠어요?\n허용하면 학생이 한 번 더 글을 고칠 수 있어요.')) return
    const { error } = await supabase.from('submissions').update({ extra_rewrite_allowed: true }).eq('id', subId)
    if (error) return alert('실패: ' + error.message)
    alert('✅ 추가 수정이 허용되었어요!')
    openTopic(selectedTopic) // 새로고침
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>학생 글 보기 - 문해력 수업</title></Head>
      <style>{`
        .grammar-error { text-decoration: underline wavy #dc2626; text-decoration-thickness: 2px; text-underline-offset: 3px; background: #fee2e2; padding: 0 2px; border-radius: 2px; cursor: help; position: relative; }
        .grammar-error:hover::after { content: attr(data-correction); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: #1f2937; color: white; padding: 6px 10px; border-radius: 6px; font-size: 12px; white-space: nowrap; z-index: 100; margin-bottom: 6px; }
      `}</style>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          
          {view === 'topics' && (
            <>
              <div className="flex items-center gap-3">
                <Link href="/teacher" className="text-gray-600">←</Link>
                <h1 className="text-xl font-bold">학생 글 보기</h1>
              </div>
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <h3 className="font-bold mb-3">📚 등록된 주제 ({topics.length}개)</h3>
                {topics.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8 text-center">등록된 주제가 없어요. 먼저 주제를 등록해주세요.</p>
                ) : (
                  <div className="space-y-2">
                    {topics.map(t => (
                      <button key={t.id} onClick={() => openTopic(t)}
                        className="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition">
                        <div className="font-medium text-sm">{t.title}</div>
                        <div className="text-xs text-gray-500 mt-1">{t.date}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {view === 'topicStudents' && selectedTopic && (
            <>
              <button onClick={() => setView('topics')} className="text-sm text-gray-600">← 주제 목록</button>
              <div className="bg-primary-light rounded-2xl p-4">
                <div className="text-xs text-primary-dark">📅 {selectedTopic.date}</div>
                <h2 className="text-lg font-bold text-primary-dark">{selectedTopic.title}</h2>
                <div className="text-xs text-primary-dark mt-1">{topicStudents.length}명 제출</div>
              </div>

              {topicStudents.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 text-center text-gray-500">
                  <p>아직 제출한 학생이 없어요</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-5 shadow-sm space-y-2">
                  {topicStudents.map(g => {
                    const sorted = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
                    const first = sorted[0]
                    const last = sorted[sorted.length - 1]
                    const isImproved = first.id !== last.id
                    const pasted = sorted.some(s => s.paste_detected)
                    return (
                      <button key={g.profile.id} onClick={() => openStudent(g)}
                        className="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition flex justify-between items-center">
                        <div>
                          <div className="font-medium text-sm">
                            {g.profile.realname}
                            {pasted && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⚠️ 복붙</span>}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">@{g.profile.username}</div>
                        </div>
                        <div className="text-right text-xs">
                          {isImproved ? (
                            <>
                              <div className="text-gray-500">첫 {first.total_score}점</div>
                              <div className="font-bold">최종 {last.total_score}/{last.max_score}점
                                {last.total_score > first.total_score && <span className="text-green-600 ml-1">↑{last.total_score - first.total_score}</span>}
                              </div>
                            </>
                          ) : (
                            <div className="font-bold">{last.total_score}/{last.max_score}점</div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {view === 'studentDetail' && selectedStudent && selectedTopic && (
            <>
              <button onClick={() => setView('topicStudents')} className="text-sm text-gray-600">← 학생 목록</button>
              <div className="bg-primary-light rounded-2xl p-4">
                <h2 className="text-lg font-bold text-primary-dark">{selectedStudent.profile.realname}</h2>
                <div className="text-xs text-primary-dark mt-1">{selectedTopic.title} · {selectedTopic.date}</div>
              </div>

              {[...selectedStudent.items].sort((a,b) => (a.attempt||1) - (b.attempt||1)).map((s, i, arr) => {
                const isLast = i === arr.length - 1
                const showAllowBtn = isLast && (s.attempt||1) >= 2 && !s.extra_rewrite_allowed
                return (
                  <div key={s.id} className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                    <div className="flex justify-between items-center">
                      <h3 className="font-bold text-sm">
                        {(s.attempt||1) === 1 ? '📝 첫 번째 글' : (s.attempt||1) === 2 ? '✨ 수정본' : `✨ 수정본 ${s.attempt}`}
                      </h3>
                      <div className="flex items-center gap-2">
                        {s.paste_detected && <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">⚠️ 복붙 {s.paste_count || 1}회</span>}
                        <span className="text-base font-bold">{s.total_score}/{s.max_score}점</span>
                      </div>
                    </div>

                    {s.corrections?.length > 0 && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full inline-block">
                        맞춤법/띄어쓰기 {s.corrections.length}개
                      </span>
                    )}
                    <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{__html: applyGrammar(s.essay_text, s.corrections)}} />

                    {Array.isArray(s.scores) && (
                      <div className="space-y-2">
                        {s.scores.map((sc, idx) => {
                          const r = selectedTopic.rubrics[idx] || { name: `기준 ${idx+1}`, score: 25 }
                          const pct = Math.round((sc / r.score) * 100)
                          return (
                            <div key={idx}>
                              <div className="flex justify-between text-xs">
                                <span className="text-gray-700 font-medium">{r.name}</span>
                                <span>{sc}/{r.score}</span>
                              </div>
                              {r.hint && <div className="text-xs text-gray-500 mt-0.5">💡 {r.hint}</div>}
                              <div className="bg-gray-100 rounded-full h-1.5 mt-1"><div className="bg-primary h-full rounded-full" style={{width: pct + '%'}} /></div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div className="space-y-2 text-sm pt-2 border-t">
                      <div><strong>💬 종합:</strong> {s.feedback_overall}</div>
                      <div><strong>⭐ 잘한 점:</strong> {s.feedback_good}</div>
                      <div><strong>🌱 발전:</strong> {s.feedback_improve}</div>
                    </div>

                    {showAllowBtn && (
                      <button onClick={() => allowExtraRewrite(s.id)}
                        className="w-full py-2 bg-purple-100 text-purple-700 rounded-lg font-medium text-sm hover:bg-purple-200">
                        ✏️ 이 학생에게 추가 수정 허용
                      </button>
                    )}
                    {isLast && s.extra_rewrite_allowed && (
                      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs p-2 rounded text-center">
                        ✓ 추가 수정 허용됨 (학생이 다시 쓰기 가능)
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </main>
      </div>
    </>
  )
}
