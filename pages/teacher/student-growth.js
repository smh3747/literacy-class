import Head from 'next/head'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import { displayStudentNameWithNumber } from '../../lib/displayName'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

export default function StudentGrowth() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [allSubmissions, setAllSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedStudent, setSelectedStudent] = useState('all')
  const [sortMode, setSortMode] = useState('growth')  // 'growth'(성장순) | 'number'(번호순)
  const [gradeAvg, setGradeAvg] = useState(null)  // 🆕 step345: 우리 학년 전체 평균(참조선), RPC 비차단
  const sortedCardsRef = useRef([])  // 🆕 step343: 키보드 넘기기용 최신 정렬 목록

  useEffect(() => { check() }, [])

  // 🆕 step345: 학년 맥락 참조선 — grade_avg_stats RPC(비차단). 실패·grade 없음이면 문구 생략(화면 안 막음).
  useEffect(() => {
    const grade = classInfo?.grade
    if (!grade) { setGradeAvg(null); return }
    let alive = true
    ;(async () => {
      try {
        const { data } = await supabase.rpc('grade_avg_stats')
        const row = (data || []).find(r => String(r.grade) === String(grade))
        if (alive) setGradeAvg(row && row.avg_pct != null ? Math.round(row.avg_pct) : null)
      } catch (e) { if (alive) setGradeAvg(null) }
    })()
    return () => { alive = false }
  }, [classInfo?.grade])

  // 🆕 step343: 상세 모달 열림 시 Esc 닫기 / ←→ 이전·다음 학생 (현재 정렬 순서 기준)
  useEffect(() => {
    if (selectedStudent === 'all') return
    const onKey = (e) => {
      const cards = sortedCardsRef.current
      const idx = cards.findIndex(c => c.st.id === selectedStudent)
      if (e.key === 'Escape') setSelectedStudent('all')
      else if (e.key === 'ArrowLeft' && idx > 0) setSelectedStudent(cards[idx - 1].st.id)
      else if (e.key === 'ArrowRight' && idx >= 0 && idx < cards.length - 1) setSelectedStudent(cards[idx + 1].st.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedStudent])

  const check = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name, school)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    if (profile.classes?.id) {
      const { data: studentList } = await supabase.from('profiles').select('id, realname, nickname, username, number, is_hidden').eq('class_id', profile.classes.id).eq('role', 'student').order('username')
      const visibleStudents = (studentList || []).filter(s => !s.is_hidden)
      setStudents(visibleStudents)

      const studentIds = visibleStudents.map(s => s.id)
      if (studentIds.length > 0) {
        const { data: subs } = await supabase.from('submissions').select('*, topics(date)').in('user_id', studentIds).is('deleted_at', null).order('created_at')
        setAllSubmissions(subs || [])
      }
    }
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 학급 평균 그래프 데이터
  const getClassAvgChart = () => {
    // 주제별 평균 (최종본 기준, 100점 환산)
    const byTopic = {}
    allSubmissions.forEach(s => {
      const tId = s.topic_id
      if (!byTopic[tId]) byTopic[tId] = { date: s.topics?.date || s.created_at?.slice(0,10), title: s.topic_title || '주제', latest: {} }
      const cur = byTopic[tId].latest[s.user_id]
      if (!cur || (s.attempt || 1) > (cur.attempt || 1)) byTopic[tId].latest[s.user_id] = s
    })
    
    const sorted = Object.values(byTopic).sort((a,b) => new Date(a.date) - new Date(b.date))
    const labels = sorted.map(t => t.date?.slice(5) || '')
    const avgs = sorted.map(t => {
      const items = Object.values(t.latest)
      if (items.length === 0) return 0
      const total = items.reduce((sum, s) => sum + (s.total_score / s.max_score) * 100, 0)
      return Math.round(total / items.length)
    })
    
    return {
      labels,
      datasets: [{
        label: '학급 평균 (100점 환산)',
        data: avgs,
        borderColor: '#2d6a4f',
        backgroundColor: 'rgba(45, 106, 79, 0.1)',
        tension: 0.3,
        fill: true
      }]
    }
  }

  // 학생별 성장 그래프
  const getStudentChart = (studentId) => {
    const subs = allSubmissions.filter(s => s.user_id === studentId)
    const byTopic = {}
    subs.forEach(s => {
      const tId = s.topic_id
      if (!byTopic[tId]) byTopic[tId] = []
      byTopic[tId].push(s)
    })
    
    const sorted = Object.values(byTopic).map(items => {
      const sortedItems = [...items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
      return sortedItems[sortedItems.length - 1]
    }).sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
    
    return {
      labels: sorted.map(s => s.topics?.date?.slice(5) || s.created_at?.slice(5,10) || ''),
      datasets: [{
        label: '점수 (100점 환산)',
        data: sorted.map(s => Math.round((s.total_score / s.max_score) * 100)),
        borderColor: '#2d6a4f',
        backgroundColor: 'rgba(45, 106, 79, 0.1)',
        tension: 0.3
      }]
    }
  }

  // 🆕 step342: 공용 주제 리스트(날짜순) — 주제별 학생 최종점수(attempt 최대) + 학급 평균
  const pctOf = (s) => (s && s.max_score) ? (s.total_score / s.max_score) * 100 : 0
  const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

  const buildTopicList = () => {
    const byTopic = {}
    allSubmissions.forEach(s => {
      const tId = s.topic_id
      if (!byTopic[tId]) byTopic[tId] = { topicId: tId, date: s.topics?.date || s.created_at?.slice(0, 10), title: s.topic_title || null, best: {} }
      const cur = byTopic[tId].best[s.user_id]
      if (!cur || (s.attempt || 1) > (cur.attempt || 1)) byTopic[tId].best[s.user_id] = s
    })
    return Object.values(byTopic).map(t => {
      const finals = {}
      Object.entries(t.best).forEach(([uid, s]) => { finals[uid] = pctOf(s) })
      const vals = Object.values(finals)
      return { topicId: t.topicId, date: t.date, title: t.title, finals, classAvg: mean(vals) }
    }).sort((a, b) => new Date(a.date) - new Date(b.date))
  }

  // 학급 성장(절대 점수): 최근 5개 평균 − 이전 5개 평균 (10개 미만이면 반반, 4개 미만이면 보류)
  const classGrowth = (topicList) => {
    const avgs = topicList.map(t => t.classAvg)
    const n = avgs.length
    if (n < 4) return { insufficient: true }
    let recent, prev
    if (n >= 10) { recent = avgs.slice(-5); prev = avgs.slice(-10, -5) }
    else { const h = Math.floor(n / 2); prev = avgs.slice(0, h); recent = avgs.slice(h) }
    const X = mean(recent), Y = mean(prev), G = X - Y
    const status = G >= 3 ? 'up' : G <= -3 ? 'down' : 'flat'
    return { insufficient: false, G, X: Math.round(X), Y: Math.round(Y), mRecent: recent.length, mPrev: prev.length, status }
  }

  // 학생 성장(상대 점수 = 최종 − 학급평균): 뒤 절반 평균 − 앞 절반 평균
  const studentGrowth = (id, topicList) => {
    const rels = []
    topicList.forEach(t => { if (t.finals[id] != null) rels.push(t.finals[id] - t.classAvg) })
    const n = rels.length
    if (n < 3) return { status: 'insufficient', count: n }
    let front, back
    if (n === 3) { front = rels.slice(0, 1); back = rels.slice(1) }
    else { const h = Math.floor(n / 2); front = rels.slice(0, h); back = rels.slice(h) }
    const g = mean(back) - mean(front)
    const status = g >= 3 ? 'up' : g <= -3 ? 'down' : 'flat'
    return { status, g, avgRel: Math.round(mean(rels)), count: n }
  }

  // 스파크라인 좌표(절대 최종점수, 날짜순 → 0~100을 SVG로)
  const sparklinePoints = (id, topicList, w = 88, h = 28) => {
    const ys = topicList.filter(t => t.finals[id] != null).map(t => t.finals[id])
    if (ys.length < 2) return null
    const stepX = w / (ys.length - 1)
    return ys.map((y, i) => `${(i * stepX).toFixed(1)},${(h - (Math.max(0, Math.min(100, y)) / 100) * h).toFixed(1)}`).join(' ')
  }

  // 개별 상세 — 주제별 첫 시도→최종→개선폭
  const rewriteRows = (id) => {
    const byTopic = {}
    allSubmissions.filter(s => s.user_id === id).forEach(s => {
      const tId = s.topic_id
      if (!byTopic[tId]) byTopic[tId] = { date: s.topics?.date || s.created_at?.slice(0, 10), title: s.topic_title || null, items: [] }
      byTopic[tId].items.push(s)
    })
    return Object.values(byTopic).map(t => {
      const items = [...t.items].sort((a, b) => (a.attempt || 1) - (b.attempt || 1))
      const first = items[0], last = items[items.length - 1]
      const hasRewrite = (last.attempt || 1) > (first.attempt || 1)
      return {
        label: t.title || (t.date ? t.date.slice(5) : ''),
        date: t.date,
        firstPct: Math.round(pctOf(first)),
        finalPct: Math.round(pctOf(last)),
        improvement: hasRewrite ? Math.round(pctOf(last)) - Math.round(pctOf(first)) : null,
        hasRewrite,
      }
    }).sort((a, b) => new Date(a.date) - new Date(b.date))
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  const topicList = buildTopicList()
  const cg = classGrowth(topicList)
  // 🆕 step345: 우리 반 전체 평균(주제별 학급평균의 평균) — 학년 참조선 문구용(기존 값 재사용)
  const classOverallAvg = topicList.length ? Math.round(mean(topicList.map(t => t.classAvg))) : null
  const classChart = getClassAvgChart()
  const studentChart = selectedStudent !== 'all' ? getStudentChart(selectedStudent) : null

  // 학생별 성장 카드 + 정렬(성장순: up>flat>down·insufficient 맨 뒤·같은 그룹 g 내림 / 번호순)
  const studentCards = students.map(st => ({ st, growth: studentGrowth(st.id, topicList) }))
  const growthRank = (x) => x.growth.status === 'insufficient' ? -Infinity : x.growth.g
  const sortedCards = [...studentCards].sort((a, b) =>
    sortMode === 'number'
      ? (parseInt(a.st.number) || 999) - (parseInt(b.st.number) || 999)
      : growthRank(b) - growthRank(a)
  )

  sortedCardsRef.current = sortedCards

  const selStudent = selectedStudent !== 'all' ? students.find(s => s.id === selectedStudent) : null
  const detailRows = selStudent ? rewriteRows(selStudent.id) : []
  const rewrittenRows = detailRows.filter(r => r.hasRewrite)
  const rewriteAvgGain = rewrittenRows.length ? Math.round(mean(rewrittenRows.map(r => r.improvement))) : 0
  // 모달 이전/다음(현재 정렬 순서)
  const selIdx = selStudent ? sortedCards.findIndex(c => c.st.id === selStudent.id) : -1
  const prevCard = selIdx > 0 ? sortedCards[selIdx - 1] : null
  const nextCard = (selIdx >= 0 && selIdx < sortedCards.length - 1) ? sortedCards[selIdx + 1] : null

  const chartOptions = (title) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, title: { display: true, text: title } },
    scales: { y: { min: 0, max: 100, ticks: { stepSize: 20 } } }
  })

  // 판정별 스타일/문구
  const STATUS = {
    up:   { badge: 'bg-green-100 text-green-700',  arrow: '↗', label: '성장 중' },
    flat: { badge: 'bg-gray-100 text-gray-600',    arrow: '→', label: '유지' },
    down: { badge: 'bg-amber-100 text-amber-700',  arrow: '↘', label: '요즘 주춤해요' },
  }

  return (
    <>
      <Head><title>학생 성장 그래프 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">📊 학생 성장 그래프</h1>
          </div>

          {allSubmissions.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-gray-500">
              <p>아직 제출된 글이 없어요</p>
            </div>
          ) : (
            <>
              {/* ① 결론 카드 — 우리 반 성장 요약 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                {cg.insufficient ? (
                  <h2 className="text-lg font-bold text-gray-700">아직 주제가 부족해요</h2>
                ) : (
                  <>
                    <h2 className={`text-xl font-bold ${cg.status === 'up' ? 'text-green-700' : cg.status === 'down' ? 'text-amber-700' : 'text-gray-700'}`}>
                      {cg.status === 'up' ? `📈 우리 반, 성장하고 있어요 (+${cg.G.toFixed(1)}점)`
                        : cg.status === 'down' ? '우리 반, 요즘 주춤해요'
                        : '우리 반, 꾸준해요'}
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                      최근 주제 {cg.mRecent}개 평균 {cg.X}점 · 이전 {cg.mPrev}개 평균 {cg.Y}점
                    </p>
                  </>
                )}
                {classInfo?.grade && gradeAvg != null && classOverallAvg != null && (
                  <p className="text-sm text-gray-600 mt-2">
                    전체 {classInfo.grade}학년 평균은 {gradeAvg}점이에요. 우리 반은 {classOverallAvg}점이에요.
                  </p>
                )}
                <details className="group mt-3">
                  <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-2 -mx-2 px-2 py-1 rounded-lg hover:bg-gray-50 text-sm text-gray-600">
                    <span className="text-gray-400 transition-transform group-open:rotate-90">▶</span>
                    <span>추이 그래프 보기</span>
                  </summary>
                  <div className="h-48 mt-2">
                    <Line data={classChart} options={chartOptions('학급 평균 점수 추이 (보조 자료)')} />
                  </div>
                </details>
              </div>

              {/* ② 학생별 성장 그리드 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h3 className="font-bold">학생별 성장</h3>
                    <p className="text-xs text-gray-400 mt-0.5">화살표는 최근 변화, 점수는 반 평균 대비 위치예요</p>
                  </div>
                  <div className="flex gap-1 text-xs">
                    <button onClick={() => setSortMode('growth')}
                      className={`px-3 py-1.5 rounded-lg ${sortMode === 'growth' ? 'bg-primary text-white font-semibold' : 'bg-gray-100 text-gray-600'}`}>성장순</button>
                    <button onClick={() => setSortMode('number')}
                      className={`px-3 py-1.5 rounded-lg ${sortMode === 'number' ? 'bg-primary text-white font-semibold' : 'bg-gray-100 text-gray-600'}`}>번호순</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {sortedCards.map(({ st, growth }) => {
                    const insufficient = growth.status === 'insufficient'
                    const sp = insufficient ? null : sparklinePoints(st.id, topicList)
                    const stt = STATUS[growth.status]
                    const isSel = selectedStudent === st.id
                    return (
                      <button key={st.id} onClick={() => setSelectedStudent(isSel ? 'all' : st.id)}
                        className={`text-left rounded-xl border p-3 transition hover:shadow-md ${
                          isSel ? 'border-primary ring-2 ring-primary/30' : insufficient ? 'border-gray-100 bg-gray-50' : 'border-gray-100 bg-white'
                        }`}>
                        <div className="text-sm font-semibold text-gray-800 truncate">{displayStudentNameWithNumber(st)}</div>
                        {insufficient ? (
                          <p className="text-xs text-gray-400 mt-2">아직 판단 일러요 (제출 {growth.count}개)</p>
                        ) : (
                          <>
                            <div className="mt-1 flex items-center gap-1 flex-wrap">
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${stt.badge}`}>{stt.arrow} {stt.label}</span>
                              <span className="text-[11px] text-gray-500">반 평균 대비 {growth.avgRel >= 0 ? '+' : ''}{growth.avgRel}점</span>
                            </div>
                            {sp && (
                              <svg viewBox="0 0 88 28" className="w-full h-7 mt-2" preserveAspectRatio="none">
                                <polyline points={sp} fill="none" stroke="#2d6a4f" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                              </svg>
                            )}
                          </>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ③ 개별 상세 — 모달 (카드 클릭 시). 배경 클릭·✖·Esc로 닫기, ◀▶·←→로 이전·다음 */}
              {selStudent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
                  onClick={() => setSelectedStudent('all')}>
                  <div className="bg-white rounded-2xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto space-y-3"
                    onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between gap-1">
                      <button onClick={() => prevCard && setSelectedStudent(prevCard.st.id)} disabled={!prevCard}
                        className="text-sm px-2 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent flex-shrink-0">◀ 이전</button>
                      <h3 className="font-bold text-center flex-1 truncate px-1">{displayStudentNameWithNumber(selStudent)} 성장 상세</h3>
                      <button onClick={() => nextCard && setSelectedStudent(nextCard.st.id)} disabled={!nextCard}
                        className="text-sm px-2 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent flex-shrink-0">다음 ▶</button>
                      <button onClick={() => setSelectedStudent('all')}
                        className="text-sm text-gray-500 hover:bg-gray-100 px-2 py-1.5 rounded-lg flex-shrink-0">✖</button>
                    </div>
                    {studentChart && studentChart.labels.length > 0 ? (
                      <div className="h-44">
                        <Line data={studentChart} options={chartOptions('점수 추이 (100점 환산)')} />
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 py-6 text-center">아직 제출한 글이 없어요</p>
                    )}
                    {rewrittenRows.length > 0 && (
                      <p className="text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg p-2.5">
                        다시쓰기한 주제에서 평균 +{rewriteAvgGain}점 올렸어요.
                      </p>
                    )}
                    {detailRows.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-gray-500 border-b border-gray-200">
                              <th className="text-left py-1.5 pr-2 font-medium">주제</th>
                              <th className="text-right py-1.5 px-2 font-medium">첫 시도</th>
                              <th className="text-right py-1.5 px-2 font-medium">최종</th>
                              <th className="text-right py-1.5 pl-2 font-medium">개선</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailRows.map((r, i) => (
                              <tr key={i} className="border-b border-gray-50">
                                <td className="py-1.5 pr-2 text-gray-700 truncate max-w-[10rem]">{r.label}</td>
                                <td className="py-1.5 px-2 text-right text-gray-500">{r.hasRewrite ? `${r.firstPct}점` : '1회 제출'}</td>
                                <td className="py-1.5 px-2 text-right font-semibold text-gray-800">{r.finalPct}점</td>
                                <td className={`py-1.5 pl-2 text-right font-semibold ${r.improvement > 0 ? 'text-green-700' : r.improvement < 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                                  {r.hasRewrite ? `${r.improvement >= 0 ? '+' : ''}${r.improvement}점` : '·'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </>
  )
}
