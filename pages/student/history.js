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

export default function StudentHistory() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [grouped, setGrouped] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedIdx, setSelectedIdx] = useState(null)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/student/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', au.id).maybeSingle()
    if (!profile || profile.role !== 'student') {
      await supabase.auth.signOut(); router.push('/student/login'); return
    }
    setUser(profile)
    
    const { data } = await supabase.from('submissions').select('*, topics(title, date)').eq('user_id', profile.id).order('created_at', { ascending: false })
    
    // 주제별로 그룹화
    const groups = {}
    ;(data || []).forEach(s => {
      const title = s.topic_title || (s.topics?.title) || '주제 없음'
      const date = (s.topics?.date) || (s.created_at ? s.created_at.slice(0, 10) : '')
      const key = (s.topic_id || 'no') + '_' + title
      if (!groups[key]) groups[key] = { title, date, items: [] }
      groups[key].items.push(s)
    })
    setGrouped(Object.values(groups).sort((a,b) => new Date(b.date) - new Date(a.date)))
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  // 디테일 화면
  if (selectedIdx !== null && grouped[selectedIdx]) {
    const g = grouped[selectedIdx]
    const items = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
    const lastSub = items[items.length - 1]
    const maxAttempt = Math.max(...items.map(s => s.attempt || 1))
    const canRewrite = maxAttempt === 1 || (maxAttempt >= 2 && lastSub?.extra_rewrite_allowed)
    
    return (
      <>
        <Head><title>{g.title} - 문해력 수업</title></Head>
        <style>{`
          .grammar-error { text-decoration: underline wavy #dc2626; text-decoration-thickness: 2px; text-underline-offset: 3px; background: #fee2e2; padding: 0 2px; border-radius: 2px; cursor: help; position: relative; }
          .grammar-error:hover::after { content: attr(data-correction); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: #1f2937; color: white; padding: 6px 10px; border-radius: 6px; font-size: 12px; white-space: nowrap; z-index: 100; margin-bottom: 6px; }
        `}</style>
        <div className="min-h-screen bg-gray-50">
          <Header user={user} onLogout={logout} />
          <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            <button onClick={() => setSelectedIdx(null)} className="text-sm text-gray-600">← 목록으로</button>
            
            <div className="bg-primary-light rounded-2xl p-4">
              <div className="text-xs text-primary-dark">📅 {g.date}</div>
              <h2 className="text-lg font-bold text-primary-dark">{g.title}</h2>
            </div>

            {items.map((s, i) => (
              <div key={s.id} className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-sm">
                    {(s.attempt||1) === 1 ? '📝 첫 번째 글' : (s.attempt||1) === 2 ? '✨ 수정본' : `✨ 수정본 ${s.attempt}`}
                  </h3>
                  <span className="text-base font-bold">{s.total_score}/{s.max_score}점</span>
                </div>

                {s.corrections?.length > 0 && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full inline-block">
                    맞춤법/띄어쓰기 {s.corrections.length}개
                  </span>
                )}
                <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{__html: applyGrammar(s.essay_text, s.corrections)}} />

                <div className="space-y-2 text-sm">
                  <div><strong>💬 종합 의견:</strong> <span className="text-gray-700">{s.feedback_overall}</span></div>
                  <div><strong>⭐ 잘한 점:</strong> <span className="text-gray-700">{s.feedback_good}</span></div>
                  <div><strong>🌱 발전시킬 점:</strong> <span className="text-gray-700">{s.feedback_improve}</span></div>
                </div>

                {s.example_text && (i === items.length - 1) && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <div className="font-bold text-purple-900 text-sm mb-1">📖 AI 예시 작품</div>
                    <p className="text-sm text-purple-900 whitespace-pre-wrap">{s.example_text}</p>
                  </div>
                )}
              </div>
            ))}

            {canRewrite ? (
              <Link href="/student" className="block w-full py-3 bg-primary text-white rounded-xl font-semibold text-center">
                ✏️ {maxAttempt === 1 ? '다시 쓰기 (첫 수정)' : '추가 수정하기 (선생님 허가됨)'}
              </Link>
            ) : maxAttempt >= 2 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                ✅ 이미 수정본을 제출했어요. 추가 수정을 원하면 선생님께 요청해주세요.
              </div>
            )}
          </main>
        </div>
      </>
    )
  }

  // 목록 화면
  return (
    <>
      <Head><title>내 글 기록 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">📚 내 글 기록</h2>
            <Link href="/student" className="text-sm text-primary hover:underline">오늘 글쓰기 →</Link>
          </div>

          {grouped.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-gray-500">
              <div className="text-4xl mb-2">📝</div>
              <p className="text-sm">아직 쓴 글이 없어요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {grouped.map((g, idx) => {
                const sorted = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
                const first = sorted[0]
                const last = sorted[sorted.length - 1]
                const isImproved = first.id !== last.id
                
                return (
                  <button key={idx} onClick={() => setSelectedIdx(idx)}
                    className="w-full bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition text-left">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm mb-1 truncate">{g.title}</div>
                        <div className="text-xs text-gray-500">{g.date}</div>
                      </div>
                      <div className="text-right text-xs ml-3">
                        {isImproved ? (
                          <>
                            <div className="text-gray-500">첫 글 {first.total_score}점</div>
                            <div className="font-bold">최종 {last.total_score}/{last.max_score}점
                              {last.total_score > first.total_score && <span className="text-green-600 ml-1">↑{last.total_score - first.total_score}</span>}
                            </div>
                          </>
                        ) : (
                          <div className="font-bold">{first.total_score}/{first.max_score}점</div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </main>
      </div>
    </>
  )
}
