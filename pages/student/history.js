import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import useGrammarTooltip from '../../lib/useGrammarTooltip'
import { splitFeedbackItems } from '../../lib/feedbackFormat'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

function FeedbackList({ text, color = 'gray' }) {
  if (!text) return null
  const items = splitFeedbackItems(text)
  
  const colorClasses = { green: 'text-green-900', amber: 'text-amber-900', blue: 'text-blue-900', gray: 'text-gray-700' }
  const dotClasses = { green: 'bg-green-600', amber: 'bg-amber-600', blue: 'bg-blue-600', gray: 'bg-gray-400' }
  
  if (items.length <= 1) {
    return <p className={`text-sm ${colorClasses[color]} break-keep leading-relaxed`}>{items[0] || text}</p>
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${dotClasses[color]} mt-2`}></span>
          <span className={`text-sm ${colorClasses[color]} break-keep leading-relaxed flex-1`}>{item}</span>
        </li>
      ))}
    </ul>
  )
}

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
  useGrammarTooltip()
  const [user, setUser] = useState(null)
  const [grouped, setGrouped] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedIdx, setSelectedIdx] = useState(null)

  useEffect(() => { checkAuth() }, [])

  // 🆕 디테일 화면 진입 시 — 그 주제의 미확인 담임 코멘트 읽음 처리
  useEffect(() => {
    if (selectedIdx === null || !grouped[selectedIdx]) return
    const g = grouped[selectedIdx]
    const unreadIds = (g.items || [])
      .filter(s => s.teacher_comment && !s.teacher_comment_read_at)
      .map(s => s.id)
    if (unreadIds.length === 0) return
    supabase.from('submissions')
      .update({ teacher_comment_read_at: new Date().toISOString() })
      .in('id', unreadIds)
      .then(() => {})
      .catch(() => {})  // 실패해도 무시 (다음에 또 시도됨)
  }, [selectedIdx])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/student/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', au.id).maybeSingle()
    if (!profile || profile.role !== 'student') {
      await supabase.auth.signOut(); router.push('/student/login'); return
    }
    setUser(profile)
    
    const { data } = await supabase.from('submissions').select('*, topics(title, date)').eq('user_id', profile.id).is('deleted_at', null).order('created_at', { ascending: false })
    
    // 주제별로 그룹화
    const groups = {}
    ;(data || []).forEach(s => {
      const title = s.topic_title || (s.topics?.title) || '주제 없음'
      const date = (s.topics?.date) || (s.created_at ? s.created_at.slice(0, 10) : '')
      const key = (s.topic_id || 'no') + '_' + title
      if (!groups[key]) groups[key] = { title, date, topic_id: s.topic_id, items: [] }
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
          .grammar-error { text-decoration: underline wavy #dc2626; text-decoration-thickness: 2px; text-underline-offset: 3px; background: #fee2e2; padding: 0 2px; border-radius: 2px; cursor: pointer; }
        `}</style>
        <div className="min-h-screen bg-gray-50">
          <Header user={user} onLogout={logout} />
          <main className={`mx-auto px-4 py-6 space-y-4 ${items.length >= 2 ? 'max-w-3xl xl:max-w-[1500px] xl:px-8' : 'max-w-3xl'}`}>
            <button onClick={() => setSelectedIdx(null)} className="text-sm text-gray-600">← 목록으로</button>
            
            <div className="bg-primary-light rounded-2xl p-4">
              <div className="text-xs text-primary-dark">📅 {g.date}</div>
              <h2 className="text-lg font-bold text-primary-dark">{g.title}</h2>
            </div>

            {/* 🆕 첫 글·수정본 좌우 병렬 (데스크탑), 모바일은 위아래 */}
            <div className={`grid gap-4 items-stretch ${items.length >= 2 ? 'lg:grid-cols-2' : ''}`}>
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
                <div className={`bg-gray-50 rounded-lg p-3 text-sm leading-relaxed ${
                  items.length >= 2 ? 'lg:h-[420px] lg:overflow-y-auto' : ''
                }`}
                  dangerouslySetInnerHTML={{__html: applyGrammar(s.essay_text, s.corrections)}} />
                {s.corrections?.length > 0 && (
                  <p className="text-xs text-gray-500">💡 빨간 밑줄을 탭하면 올바른 표기를 볼 수 있어요</p>
                )}

                {/* 🆕 담임 선생님 코멘트 — 글 바로 아래 (가까이) */}
                {s.teacher_comment && (
                  <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4">
                    <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
                      <h4 className="font-bold text-yellow-900 flex items-center gap-1.5">
                        <span>💛</span> 선생님이 직접 남긴 코멘트
                      </h4>
                      {s.teacher_comment_at && (
                        <span className="text-[11px] text-yellow-700">
                          {new Date(s.teacher_comment_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <p className="text-yellow-900 whitespace-pre-wrap leading-relaxed break-keep text-sm">
                      {s.teacher_comment}
                    </p>
                  </div>
                )}

                {/* 🆕 AI 점수·피드백 — 열고 닫기 (기본 열림) */}
                <details open className="group">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-700 hover:text-gray-900 flex items-center gap-1 py-1 select-none list-none">
                    <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                    🤖 AI 점수·피드백 보기
                  </summary>
                  <div className="space-y-3 mt-2">

                {/* 항목별 점수 + 점수 근거 */}
                {Array.isArray(s.scores) && Array.isArray(g.rubrics) && g.rubrics.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-bold text-gray-800">📊 항목별 점수와 이유</h4>
                    {s.scores.map((sc, idx) => {
                      const r = g.rubrics[idx] || { name: `기준 ${idx+1}`, score: 25 }
                      const pct = Math.round((sc / r.score) * 100)
                      const isFull = sc >= r.score
                      const reason = Array.isArray(s.rubric_reasons) ? s.rubric_reasons[idx] : null
                      const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
                      return (
                        <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-100 lg:min-h-[150px]">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-800 font-semibold">
                              {r.name}
                              {isFull && <span className="ml-1 text-green-600">✓</span>}
                            </span>
                            <span className={`font-bold ${isFull ? 'text-green-700' : 'text-gray-700'}`}>
                              {sc}/{r.score}점
                            </span>
                          </div>
                          <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                            <div className={`${barColor} h-full transition-all`} style={{width: pct + '%'}} />
                          </div>
                          {reason ? (
                            <p className="text-xs text-gray-700 leading-relaxed break-keep bg-white rounded p-2 border border-gray-200 mt-2">
                              <span className="font-semibold text-gray-800">💡 이유: </span>
                              {reason}
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="space-y-3 text-sm">
                  <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                    <h4 className="font-bold mb-1 text-blue-900 flex items-center gap-1.5">
                      <span>💬</span> 종합 의견
                    </h4>
                    <p className="text-blue-900 break-keep leading-relaxed">{s.feedback_overall}</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-3 border border-green-100">
                    <h4 className="font-bold mb-1 text-green-900 flex items-center gap-1.5">
                      <span>⭐</span> 잘한 점
                    </h4>
                    <FeedbackList text={s.feedback_good} color="green" />
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                    <h4 className="font-bold mb-1 text-amber-900 flex items-center gap-1.5">
                      <span>🌱</span> 발전시킬 점
                    </h4>
                    <FeedbackList text={s.feedback_improve} color="amber" />
                  </div>

                  {/* 🆕 발전점 구체 예시 */}
                  {Array.isArray(s.improve_examples) && s.improve_examples.length > 0 && (
                    <div className="bg-purple-50 rounded-xl p-3 border-2 border-purple-200">
                      <h4 className="font-bold mb-2 text-purple-900 flex items-center gap-1.5">
                        <span>✏️</span> 이렇게 바꿔보면 어떨까요?
                      </h4>
                      <p className="text-xs text-purple-700 mb-2">예시예요. 참고만 하세요!</p>
                      <div className="space-y-2">
                        {s.improve_examples.map((ex, exIdx) => (
                          <div key={exIdx} className="bg-white rounded-lg border border-purple-200 overflow-hidden">
                            <div className="px-3 py-2 bg-red-50 border-b border-red-100">
                              <div className="text-[11px] text-red-700 font-semibold mb-0.5">현재</div>
                              <p className="text-sm text-gray-800 break-keep">{ex.original}</p>
                            </div>
                            <div className="px-3 py-2 bg-green-50 border-b border-green-100">
                              <div className="text-[11px] text-green-700 font-semibold mb-0.5">예시</div>
                              <p className="text-sm text-gray-900 break-keep leading-relaxed">{ex.suggested}</p>
                            </div>
                            {ex.reason && (
                              <div className="px-3 py-1.5 bg-purple-50 border-t border-purple-100">
                                <p className="text-[11px] text-purple-700 break-keep">💡 {ex.reason}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                  </div>
                </details>

                {s.example_text && (i === items.length - 1) && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <div className="font-bold text-purple-900 text-sm mb-1">📖 AI 예시 작품</div>
                    <p className="text-sm text-purple-900 whitespace-pre-wrap">{s.example_text}</p>
                  </div>
                )}
              </div>
            ))}
            </div>

            {canRewrite ? (
              <Link
                href={g.topic_id ? `/student?topic=${g.topic_id}` : '/student'}
                className="block w-full py-3 bg-primary text-white rounded-xl font-semibold text-center"
              >
                ✏️ {maxAttempt === 1 ? '다시 쓰기 (첫 수정)' : '추가 수정하기 (선생님이 허가함)'}
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
  // 그래프 데이터 준비 (시간순으로 최종본 점수)
  const chartData = (() => {
    if (grouped.length === 0) return null
    const sorted = [...grouped].sort((a,b) => new Date(a.date) - new Date(b.date))
    const labels = sorted.map(g => g.date?.slice(5) || '')
    const finals = sorted.map(g => {
      const sortedItems = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
      const last = sortedItems[sortedItems.length - 1]
      return Math.round((last.total_score / last.max_score) * 100)
    })
    return {
      labels,
      datasets: [{
        label: '점수 (100점 환산)',
        data: finals,
        borderColor: '#2d6a4f',
        backgroundColor: 'rgba(45, 106, 79, 0.1)',
        tension: 0.3,
        fill: true,
      }]
    }
  })()

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      title: { display: true, text: '나의 글쓰기 점수 변화' }
    },
    scales: {
      y: { min: 0, max: 100, ticks: { stepSize: 20 } }
    }
  }

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

          {chartData && grouped.length >= 2 && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <Line data={chartData} options={chartOptions} />
            </div>
          )}

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
