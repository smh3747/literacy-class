import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import useGrammarTooltip from '../../lib/useGrammarTooltip'
import { splitFeedbackItems } from '../../lib/feedbackFormat'
import { findOriginalRange } from '../../lib/koreanRules'
import { pickStr } from '../../lib/pickStr'
import { stampLabel } from '../../lib/stamps'
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
    const orig = pickStr(c.original, c.error, c.wrong)   // step427: 비문자열 방어(깨진 항목 조용히 제외)
    const corr = pickStr(c.correction, c.fixed)
    const reason = pickStr(c.reason, c.type)
    if (!orig) return
    let from = 0
    let placed = false
    while (true) {
      const idx = essayText.indexOf(orig, from)
      if (idx === -1) break
      const overlap = matches.some(m => idx < m.end && idx + orig.length > m.start)
      if (!overlap) { matches.push({ start: idx, end: idx + orig.length, orig, corr, reason }); placed = true; break }
      from = idx + 1
    }
    // 🆕 정확 일치 실패 시 공백 허용 매칭 (위치 불확실하면 긋지 않음)
    if (!placed) {
      const range = findOriginalRange(essayText, orig)
      if (range && !range.exact) {
        const overlap = matches.some(m => range.start < m.end && range.end > m.start)
        if (!overlap) { matches.push({ start: range.start, end: range.end, orig: essayText.slice(range.start, range.end), corr, reason }) }
      }
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

// 🆕 step? : 접힘 카드 summary 공용 한 줄 (index.js step365 어포던스 재사용 — 회전 화살표·hover·펼치기 힌트)
function CollapseSummary({ title, badge = null, tone = 'gray' }) {
  const c = tone === 'purple'
    ? { arrow: 'text-purple-400', hover: 'hover:bg-purple-100', hint: 'text-purple-400' }
    : { arrow: 'text-gray-400', hover: 'hover:bg-gray-50', hint: 'text-gray-400' }
  return (
    <summary className={`list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-2 min-w-0 -mx-2 px-2 py-1 rounded-lg ${c.hover}`}>
      <span className={`${c.arrow} flex-shrink-0 transition-transform group-open:rotate-90`}>▶</span>
      {title}
      {badge}
      <span className={`ml-auto flex-shrink-0 text-xs ${c.hint} group-open:hidden`}>눌러서 펼치기</span>
    </summary>
  )
}

// 🆕 표시 전용: "(-35점)"·"(35점 감점)" 등 감점 표기를 학생 화면에서 숨김. DB 원문은 불변.
function stripPenalty(str) {
  if (!str) return str
  return String(str).replace(/\(\s*-?\d+\s*점(?:\s*감점)?\s*\)/g, '').replace(/\s{2,}/g, ' ').trim()
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
    // 🆕 step331: 진입 인증은 getSession(로컬, 왕복 없음). 실질 검증은 아래 profile RLS+role 가드.
    const { data: { session } } = await supabase.auth.getSession()
    const au = session?.user
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
    const origSub = items[0]                            // 🆕 원문(첫 글) — ⑥ 비교용
    const hasRevision = items.length >= 2               // 🆕 수정본 있으면 ⑥ 표시
    const oneThing = splitFeedbackItems(lastSub?.feedback_improve)[0]  // 🆕 ① 딱 한 가지 발전점
    const scoreDelta = hasRevision && typeof lastSub?.total_score === 'number' && typeof origSub?.total_score === 'number'
      ? lastSub.total_score - origSub.total_score : 0
    const maxAttempt = Math.max(...items.map(s => s.attempt || 1))
    const canRewrite = maxAttempt === 1 || (maxAttempt >= 2 && lastSub?.extra_rewrite_allowed)
    
    return (
      <>
        <Head><title>{g.title} - 다온클래스</title></Head>
        <style>{`
          .grammar-error { text-decoration: underline wavy #dc2626; text-decoration-thickness: 2px; text-underline-offset: 3px; background: #fee2e2; padding: 0 2px; border-radius: 2px; cursor: pointer; }
        `}</style>
        <div className="min-h-screen bg-gray-50">
          <Header user={user} onLogout={logout} />
          <main className="mx-auto px-4 py-6 space-y-4 max-w-3xl">
            <button onClick={() => setSelectedIdx(null)} className="text-sm text-gray-600">← 목록으로</button>
            
            <div className="bg-primary-light rounded-2xl p-4">
              <div className="text-xs text-primary-dark">📅 {g.date}</div>
              <h2 className="text-lg font-bold text-primary-dark">{g.title}</h2>
            </div>

            {/* ① 점수 + 🌟 이번엔 이것 하나만 기억해요 (최신본 기준) */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
              <div className="bg-gradient-to-br from-primary-light to-white border-2 border-primary/20 rounded-xl p-4 text-center">
                {/* 🆕 step436: 선생님 조정 점수 있으면 대표로, AI 점수는 작게 병기(병기형) */}
                <div className="text-3xl font-bold text-gray-900">
                  {lastSub?.teacher_score ?? lastSub?.total_score ?? 0} <span className="text-lg font-semibold text-gray-500">/ {lastSub?.max_score ?? 100}점</span>
                </div>
                {lastSub?.teacher_score != null && (
                  <div className="mt-1.5">
                    <span className="inline-flex items-center gap-1 bg-white text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-blue-200">
                      ✔ 선생님이 확인한 점수
                    </span>
                    <div className="text-[11px] text-gray-400 mt-1">AI 채점 {lastSub?.total_score ?? 0}점</div>
                  </div>
                )}
                {scoreDelta > 0 && (
                  <div className="mt-1 inline-block bg-green-100 text-green-800 text-sm font-semibold px-3 py-1 rounded-full">
                    🎉 처음 글보다 +{scoreDelta}점 올랐어요!
                  </div>
                )}
              </div>

              {oneThing && (
                <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4">
                  <h3 className="text-sm font-bold text-amber-900 mb-1.5 flex items-center gap-1.5">
                    <span>🌟</span> 이번엔 이것 하나만 기억해요
                  </h3>
                  <p className="text-lg text-amber-900 font-semibold break-keep leading-relaxed">{oneThing}</p>
                </div>
              )}
            </div>

            {/* 💛 선생님 코멘트 + 도장 — 항상 표시 (①아래·②위) */}
            {(lastSub?.teacher_comment || stampLabel(lastSub?.teacher_stamp)) && (
              <div className="space-y-3">
                {lastSub?.teacher_comment && (
                  <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4">
                    <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
                      <h4 className="font-bold text-yellow-900 flex items-center gap-1.5">
                        <span>💛</span> 선생님이 직접 남긴 코멘트
                      </h4>
                      {lastSub.teacher_comment_at && (
                        <span className="text-[11px] text-yellow-700">
                          {new Date(lastSub.teacher_comment_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <p className="text-yellow-900 whitespace-pre-wrap leading-relaxed break-keep text-sm">
                      {lastSub.teacher_comment}
                    </p>
                  </div>
                )}
                {stampLabel(lastSub?.teacher_stamp) && (
                  <div className="text-sm">
                    <span className="inline-flex items-center gap-1 bg-primary-light text-primary-dark font-semibold px-3 py-1.5 rounded-full">
                      선생님 도장: {stampLabel(lastSub.teacher_stamp)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ② 💬 종합 의견 — 펼침 유지 */}
            {lastSub?.feedback_overall && (
              <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <h4 className="font-bold mb-1 text-blue-900 flex items-center gap-1.5">
                  <span>💬</span> 종합 의견
                </h4>
                <p className="text-blue-900 break-keep leading-relaxed text-sm">{lastSub.feedback_overall}</p>
              </div>
            )}

            {/* ③ ▸ 내 글 보기 — 기본 접힘 */}
            <details className="group bg-white rounded-2xl p-4 shadow-sm">
              <CollapseSummary
                title={<h4 className="font-bold text-sm text-gray-800 flex-shrink-0">📝 내 글 보기</h4>}
                badge={lastSub?.corrections?.length > 0 && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full flex-shrink-0">
                    맞춤법/띄어쓰기 {lastSub.corrections.length}개
                  </span>
                )}
              />
              <div className="mt-3 space-y-2">
                <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{__html: applyGrammar(lastSub?.essay_text, lastSub?.corrections)}} />
                {lastSub?.corrections?.length > 0 && (
                  <p className="text-xs text-gray-500">💡 빨간 밑줄을 탭하면 올바른 표기를 볼 수 있어요</p>
                )}
              </div>
            </details>

            {/* ④ ▸ 항목별 점수 — 기본 접힘, 안쪽은 한 줄 컴팩트(이유 탭 펼침·감점표기 숨김) */}
            {Array.isArray(lastSub?.scores) && Array.isArray(g.rubrics) && g.rubrics.length > 0 && (
              <details className="group bg-white rounded-2xl p-4 shadow-sm">
                <CollapseSummary title={<h4 className="font-bold text-sm text-gray-800 flex-shrink-0">📊 항목별 점수</h4>} />
                <div className="mt-3 space-y-2 overflow-hidden">
                  {lastSub.scores.map((sc, idx) => {
                    const r = g.rubrics[idx] || { name: `기준 ${idx+1}`, score: 25 }
                    const pct = Math.round((sc / r.score) * 100)
                    const isFull = sc >= r.score
                    const reason = Array.isArray(lastSub.rubric_reasons) ? stripPenalty(lastSub.rubric_reasons[idx]) : null
                    const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
                    const hasDetail = !!(reason || r.hint || !isFull)
                    const row = (
                      <>
                        <span className={`flex-shrink-0 transition-transform group-open/row:rotate-90 ${hasDetail ? 'text-gray-400' : 'invisible'}`}>▶</span>
                        <span className="text-gray-800 text-sm font-semibold break-keep flex-shrink-0">
                          {r.name}
                          {isFull && <span className="ml-1 text-green-600">✓</span>}
                        </span>
                        <span className="flex-1 min-w-[40px] bg-gray-200 rounded-full h-2 overflow-hidden">
                          <span className={`${barColor} block h-full transition-all`} style={{width: pct + '%'}} />
                        </span>
                        <span className={`text-sm font-bold flex-shrink-0 ${isFull ? 'text-green-700' : 'text-gray-700'}`}>
                          {sc}/{r.score}점
                        </span>
                      </>
                    )
                    if (!hasDetail) {
                      return (
                        <div key={idx} className="min-w-0 bg-gray-50 rounded-lg p-3 border border-gray-100 flex items-center gap-2">
                          {row}
                        </div>
                      )
                    }
                    return (
                      <details key={idx} className="group/row min-w-0 bg-gray-50 rounded-lg p-3 border border-gray-100">
                        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-2 min-w-0 -mx-1 px-1 py-0.5 rounded-lg hover:bg-gray-100">
                          {row}
                        </summary>
                        <div className="mt-2 space-y-1.5">
                          {r.hint && <div className="text-xs text-gray-500 break-keep">📌 {r.hint}</div>}
                          {reason ? (
                            <p className="text-xs text-gray-700 leading-relaxed break-keep bg-white rounded p-2 border border-gray-200">
                              <span className="font-semibold text-gray-800">💡 이유: </span>
                              {reason}
                            </p>
                          ) : !isFull ? (
                            <p className="text-xs text-amber-700 leading-relaxed bg-amber-50 rounded p-2 border border-amber-200">
                              ⚠️ 이번에는 점수 근거가 나오지 않았어요. 위의 발전점을 참고해주세요.
                            </p>
                          ) : null}
                        </div>
                      </details>
                    )
                  })}
                </div>
              </details>
            )}

            {/* ⑤ ▸ 잘한 점 / 다음엔 이렇게 / 바꿔보기 — 기본 접힘 (내용물 불변) */}
            {(lastSub?.feedback_good || lastSub?.feedback_improve || (Array.isArray(lastSub?.improve_examples) && lastSub.improve_examples.length > 0)) && (
              <details className="group bg-white rounded-2xl p-4 shadow-sm">
                <CollapseSummary title={<h4 className="font-bold text-sm text-gray-800 flex-shrink-0">🌱 자세한 피드백</h4>} />
                <div className="mt-3 space-y-3 text-sm">
                  {lastSub?.feedback_good && (
                    <div className="bg-green-50 rounded-xl p-3 border border-green-100">
                      <h4 className="font-bold mb-1 text-green-900 flex items-center gap-1.5">
                        <span>⭐</span> 잘한 점
                      </h4>
                      <FeedbackList text={lastSub.feedback_good} color="green" />
                    </div>
                  )}
                  {lastSub?.feedback_improve && (
                    <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                      <h4 className="font-bold mb-1 text-amber-900 flex items-center gap-1.5">
                        <span>🌱</span> 다음엔 이렇게 해봐요
                      </h4>
                      <FeedbackList text={lastSub.feedback_improve} color="amber" />
                    </div>
                  )}
                  {Array.isArray(lastSub?.improve_examples) && lastSub.improve_examples.length > 0 && (
                    <div className="bg-purple-50 rounded-xl p-3 border-2 border-purple-200">
                      <h4 className="font-bold mb-2 text-purple-900 flex items-center gap-1.5">
                        <span>✏️</span> 이렇게 바꿔보면 어떨까요?
                      </h4>
                      <p className="text-xs text-purple-700 mb-2">예시예요. 참고만 하세요!</p>
                      <div className="space-y-2">
                        {lastSub.improve_examples.map((ex, exIdx) => (
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
              </details>
            )}

            {/* ⑥ ▸ 원문·수정본 비교 — 수정본 있을 때만, 기본 접힘 */}
            {hasRevision && (
              <details className="group bg-white rounded-2xl p-4 shadow-sm">
                <CollapseSummary title={<h4 className="font-bold text-sm text-gray-800 flex-shrink-0">📝 원문·수정본 비교</h4>} />
                <div className="mt-3 grid gap-4 lg:grid-cols-2 items-start">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h5 className="font-bold text-sm text-gray-700">📝 원문</h5>
                      {origSub?.corrections?.length > 0 && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">맞춤법 {origSub.corrections.length}개</span>
                      )}
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{__html: applyGrammar(origSub?.essay_text, origSub?.corrections)}} />
                    {origSub?.teacher_comment && (
                      <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3">
                        <div className="text-xs font-bold text-yellow-900 mb-1">💛 선생님 코멘트</div>
                        <p className="text-yellow-900 whitespace-pre-wrap leading-relaxed break-keep text-sm">{origSub.teacher_comment}</p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h5 className="font-bold text-sm text-primary-dark">✨ 수정본</h5>
                      {lastSub?.corrections?.length > 0 && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">맞춤법 {lastSub.corrections.length}개</span>
                      )}
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{__html: applyGrammar(lastSub?.essay_text, lastSub?.corrections)}} />
                  </div>
                </div>
              </details>
            )}

            {/* 📖 AI 예시 작품 — 맨 아래 항상 표시 (접힘 아님) */}
            {lastSub?.example_text && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="font-bold text-purple-900 text-sm mb-1">📖 AI 예시 작품</div>
                <p className="text-sm text-purple-900 whitespace-pre-wrap">{lastSub.example_text}</p>
              </div>
            )}

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
      <Head><title>내 글 기록 - 다온클래스</title></Head>
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
