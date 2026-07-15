import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import { displayStudentName } from '../../lib/displayName'

// 한국 시간 기준 오늘 날짜 — step497: getTimezoneOffset 이중 가산 버그 수정
function todayStr() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

export default function SubmissionStatus() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [topics, setTopics] = useState([])
  const [selectedTopicId, setSelectedTopicId] = useState('')
  const [students, setStudents] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [topicFilter, setTopicFilter] = useState('all') // step494: all / class / challenge(source_supply_id 유무)
  const [weeklyChallengeCount, setWeeklyChallengeCount] = useState(null) // step494: 이번 주 챌린지 참여 학생 수(필터 무관)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name, school)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    if (profile.classes?.id) {
      // 주제 목록 (최근 30개)
      const { data: topicList } = await supabase.from('topics')
        .select('id, date, title, source_supply_id')   // step494: 챌린지 필터 판정용 컬럼 추가
        .eq('teacher_id', profile.id)
        .is('supply_type', null)   // step479: 공급 원본 격리
        .order('date', { ascending: false })
        .limit(30)
      setTopics(topicList || [])

      // step494: 이번 주(KST 월~일) 챌린지 참여 학생 수 — 필터와 무관한 소지표(실패 무시)
      try {
        const kstNow = new Date(Date.now() + 9 * 3600 * 1000)
        const monday = new Date(kstNow)
        monday.setUTCDate(kstNow.getUTCDate() - ((kstNow.getUTCDay() + 6) % 7))
        const sunday = new Date(monday)
        sunday.setUTCDate(monday.getUTCDate() + 6)
        const { data: weekChTopics } = await supabase.from('topics')
          .select('id').eq('teacher_id', profile.id)
          .not('source_supply_id', 'is', null)
          .gte('date', monday.toISOString().slice(0, 10))
          .lte('date', sunday.toISOString().slice(0, 10))
        const chIds = (weekChTopics || []).map(t => t.id)
        if (chIds.length === 0) {
          setWeeklyChallengeCount(0)
        } else {
          const { data: chSubs } = await supabase.from('submissions')
            .select('user_id').in('topic_id', chIds).is('deleted_at', null)
          setWeeklyChallengeCount(new Set((chSubs || []).map(s => s.user_id)).size)
        }
      } catch (e) { /* 소지표 실패는 무시 */ }

      // 오늘 주제를 기본 선택
      const today = todayStr()
      const todayTopic = (topicList || []).find(t => t.date === today)
      const initialId = todayTopic ? todayTopic.id : (topicList?.[0]?.id || '')
      setSelectedTopicId(initialId)

      // 학급 학생 목록 (숨김 제외)
      const { data: studentList } = await supabase.from('profiles')
        .select('id, realname, nickname, username, number, is_hidden')
        .eq('class_id', profile.classes.id).eq('role', 'student')
      const visibleStudents = (studentList || []).filter(s => !s.is_hidden)
      setStudents(visibleStudents)

      // 선택된 주제의 제출 목록 로드
      if (initialId && visibleStudents.length > 0) {
        await loadSubmissions(initialId, visibleStudents)
      }
    }
    setLoading(false)
  }

  const loadSubmissions = async (topicId, studentList = students) => {
    const studentIds = studentList.map(s => s.id)
    if (studentIds.length === 0) { setSubmissions([]); return }

    const { data: subs } = await supabase.from('submissions')
      .select('id, user_id, total_score, max_score, created_at, attempt, reported, teacher_comment')
      .eq('topic_id', topicId)
      .in('user_id', studentIds)
      .is('deleted_at', null)
    setSubmissions(subs || [])
  }

  const handleTopicChange = async (topicId) => {
    setSelectedTopicId(topicId)
    if (topicId) await loadSubmissions(topicId)
  }

  // step494: 필터 변경 — 현재 선택 주제가 필터에서 빠지면 첫 주제로 자동 전환
  const matchesFilter = (t, filter) =>
    filter === 'all' ? true : filter === 'challenge' ? !!t.source_supply_id : !t.source_supply_id
  const handleFilterChange = async (k) => {
    setTopicFilter(k)
    const visible = topics.filter(t => matchesFilter(t, k))
    if (!visible.some(t => t.id === selectedTopicId)) {
      const next = visible[0]?.id || ''
      setSelectedTopicId(next)
      if (next) await loadSubmissions(next)
      else setSubmissions([])
    }
  }

  // 미제출 학생 명단을 클립보드에 복사
  const copyAbsentList = (list, label = '미제출') => {
    if (list.length === 0) return alert(`${label} 학생이 없어요!`)
    const text = list
      .map(s => `${s.number ? s.number + '번 ' : ''}${displayStudentName(s)}`)
      .join(', ')
    navigator.clipboard.writeText(text)
      .then(() => alert(`📋 ${list.length}명의 명단이 복사됐어요!\n\n${text}`))
      .catch(() => prompt('아래 내용을 복사해주세요:', text))
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  // 제출/미제출 분류
  const submittedUserIds = new Set(submissions.map(s => s.user_id))
  const submitted = students.filter(s => submittedUserIds.has(s.id))
  const absent = students.filter(s => !submittedUserIds.has(s.id))
  const selectedTopic = topics.find(t => t.id === selectedTopicId)

  // 정렬: 번호순
  const sortByNumber = (a, b) => {
    const na = parseInt(a.number) || 999
    const nb = parseInt(b.number) || 999
    if (na !== nb) return na - nb
    return displayStudentName(a).localeCompare(displayStudentName(b))
  }
  submitted.sort(sortByNumber)
  absent.sort(sortByNumber)

  // 학생별 최고 점수 (attempt 여러 개일 때)
  const bestSubByUser = {}
  submissions.forEach(s => {
    const cur = bestSubByUser[s.user_id]
    if (!cur || (s.total_score || 0) > (cur.total_score || 0)) {
      bestSubByUser[s.user_id] = s
    }
  })

  // 💡 도움이 필요한 학생: 최고 점수가 만점의 60% 미만
  const needHelp = submitted.filter(s => {
    const best = bestSubByUser[s.id]
    if (!best) return false
    const max = best.max_score || 100
    return (best.total_score || 0) / max < 0.6
  })

  // 💬 코멘트 대기: 최신 글에 담임 코멘트가 없는 학생
  const latestSubByUser = {}
  submissions.forEach(s => {
    const cur = latestSubByUser[s.user_id]
    if (!cur || (s.attempt || 1) > (cur.attempt || 1)) latestSubByUser[s.user_id] = s
  })
  const needComment = submitted.filter(s => {
    const latest = latestSubByUser[s.id]
    return latest && !latest.teacher_comment
  })

  return (
    <>
      <Head><title>제출 현황 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">📋 제출 현황</h1>
          </div>

          {/* 주제 선택 */}
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            {/* step494: 학급 주제/챌린지 3단 필터 — source_supply_id 유무로 판정 */}
            <div className="bg-gray-50 rounded-xl p-1 flex gap-1 mb-3">
              {[['all', '전체'], ['class', '학급 주제'], ['challenge', '🌏 챌린지']].map(([k, label]) => (
                <button key={k} onClick={() => handleFilterChange(k)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
                    topicFilter === k ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            <label className="block text-xs text-gray-600 mb-1">주제 선택</label>
            {topics.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">등록된 주제가 없어요</p>
            ) : (() => {
              const visible = topics.filter(t => matchesFilter(t, topicFilter))
              if (visible.length === 0) {
                return <p className="text-sm text-gray-500 py-4 text-center">이 필터에 해당하는 주제가 없어요</p>
              }
              return (
                <select value={selectedTopicId} onChange={e => handleTopicChange(e.target.value)}
                  className="w-full p-2 border border-gray-200 rounded-lg text-sm">
                  {visible.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.date === todayStr() ? '🌟 ' : ''}{t.source_supply_id ? '🌏 ' : ''}{t.date} · {t.title}
                    </option>
                  ))}
                </select>
              )
            })()}
            {weeklyChallengeCount != null && (
              <p className="text-xs text-sky-700 mt-2">🌏 이번 주 챌린지 참여 {weeklyChallengeCount}명</p>
            )}
          </div>

          {students.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center text-gray-500">
              <p className="text-sm">학급에 학생이 없어요</p>
              <Link href="/teacher/students" className="text-xs text-primary underline mt-2 inline-block">
                학생 관리로 이동 →
              </Link>
            </div>
          ) : !selectedTopic ? (
            <div className="bg-white rounded-2xl p-10 text-center text-gray-500">
              <p className="text-sm">주제를 선택해주세요</p>
            </div>
          ) : (
            <>
              {/* 요약 카드 */}
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
                  <div className="text-2xl font-bold text-primary">{students.length}</div>
                  <div className="text-xs text-gray-500 mt-1">전체</div>
                </div>
                <div className="bg-green-50 rounded-2xl p-4 text-center border border-green-200">
                  <div className="text-2xl font-bold text-green-700">{submitted.length}</div>
                  <div className="text-xs text-green-700 mt-1">✓ 제출</div>
                </div>
                <div className="bg-amber-50 rounded-2xl p-4 text-center border border-amber-200">
                  <div className="text-2xl font-bold text-amber-700">{absent.length}</div>
                  <div className="text-xs text-amber-700 mt-1">미제출</div>
                </div>
                <div className="bg-rose-50 rounded-2xl p-4 text-center border border-rose-200">
                  <div className="text-2xl font-bold text-rose-700">{needHelp.length}</div>
                  <div className="text-xs text-rose-700 mt-1">💡 도움 필요</div>
                </div>
                <div className="bg-blue-50 rounded-2xl p-4 text-center border border-blue-200">
                  <div className="text-2xl font-bold text-blue-700">{needComment.length}</div>
                  <div className="text-xs text-blue-700 mt-1">💬 코멘트 대기</div>
                </div>
              </div>

              {/* 진행률 바 */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-center mb-2 text-xs">
                  <span className="text-gray-600">제출률</span>
                  <span className="font-bold text-primary">
                    {Math.round((submitted.length / students.length) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="bg-gradient-to-r from-green-400 to-green-600 h-full transition-all"
                    style={{width: `${(submitted.length / students.length) * 100}%`}} />
                </div>
              </div>

              {/* 미제출 학생 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                  <h3 className="font-bold text-amber-900">
                    🚨 미제출 학생 ({absent.length}명)
                  </h3>
                  {absent.length > 0 && (
                    <button onClick={() => copyAbsentList(absent)}
                      className="text-xs bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1.5 rounded-full">
                      📋 명단 복사
                    </button>
                  )}
                </div>
                {absent.length === 0 ? (
                  <p className="text-sm text-green-600 py-4 text-center">🎉 모두 제출했어요!</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {absent.map(s => (
                      <div key={s.id} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
                        {s.number && <span className="text-xs text-amber-700 mr-1.5">{s.number}번</span>}
                        <span className="font-medium">{displayStudentName(s)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 💡 도움이 필요한 학생 (점수 60% 미만) */}
              {needHelp.length > 0 && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                    <h3 className="font-bold text-rose-900">
                      💡 도움이 필요한 학생 ({needHelp.length}명)
                      <span className="text-xs font-normal text-gray-400 ml-2">점수가 60% 미만이에요</span>
                    </h3>
                    <button onClick={() => copyAbsentList(needHelp, '도움 필요')}
                      className="text-xs bg-rose-100 text-rose-800 hover:bg-rose-200 px-3 py-1.5 rounded-full">
                      📋 명단 복사
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {needHelp.sort(sortByNumber).map(s => {
                      const best = bestSubByUser[s.id]
                      return (
                        <Link key={s.id} href={`/teacher/submissions?topic=${selectedTopicId}&student=${s.id}`}
                          className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm flex items-center justify-between hover:bg-rose-100 hover:border-rose-300 transition-colors">
                          <span>
                            {s.number && <span className="text-xs text-rose-700 mr-1.5">{s.number}번</span>}
                            <span className="font-medium">{displayStudentName(s)}</span>
                          </span>
                          <span className="text-xs text-rose-600">{best?.total_score ?? 0}/{best?.max_score ?? 100}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 💬 코멘트 대기 (최신 글에 담임 코멘트 없음) */}
              {needComment.length > 0 && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                    <h3 className="font-bold text-blue-900">
                      💬 코멘트 기다리는 학생 ({needComment.length}명)
                      <span className="text-xs font-normal text-gray-400 ml-2">최신 글에 담임 코멘트가 아직 없어요</span>
                    </h3>
                    <Link href={`/teacher/submissions?topic=${selectedTopicId}`}
                      className="text-xs bg-blue-100 text-blue-800 hover:bg-blue-200 px-3 py-1.5 rounded-full">
                      ✏️ 코멘트 쓰러 가기
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {needComment.sort(sortByNumber).map(s => (
                      <Link key={s.id} href={`/teacher/submissions?topic=${selectedTopicId}&student=${s.id}`}
                        className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm hover:bg-blue-100 hover:border-blue-300 transition-colors block">
                        {s.number && <span className="text-xs text-blue-700 mr-1.5">{s.number}번</span>}
                        <span className="font-medium">{displayStudentName(s)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* 제출 학생 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <h3 className="font-bold text-green-900 mb-3">
                  ✅ 제출한 학생 ({submitted.length}명)
                </h3>
                {submitted.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">아직 제출한 학생이 없어요</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 mb-2">💡 학생 이름을 클릭하면 글과 피드백을 바로 볼 수 있어요</p>
                    <div className="space-y-1">
                      {submitted.map(s => {
                        const best = bestSubByUser[s.id]
                        const userSubs = submissions.filter(sub => sub.user_id === s.id)
                        const hasReport = userSubs.some(sub => sub.reported)
                        return (
                          <Link
                            key={s.id}
                            href={`/teacher/submissions?topic=${selectedTopicId}&student=${s.id}`}
                            className="flex items-center justify-between p-2 rounded hover:bg-blue-50 text-sm cursor-pointer transition group"
                          >
                            <div className="flex items-center gap-2">
                              {s.number && (
                                <span className="text-xs text-gray-500 font-mono w-8 text-center">{s.number}번</span>
                              )}
                              <span className="font-medium group-hover:text-primary group-hover:underline">{displayStudentName(s)}</span>
                              {userSubs.length > 1 && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  +{userSubs.length - 1} 수정
                                </span>
                              )}
                              {hasReport && (
                                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                                  🚨 신고
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {best && (
                                <span className="text-xs font-mono text-gray-600">
                                  {best.total_score}/{best.max_score}
                                </span>
                              )}
                              <span className="text-gray-400 group-hover:text-primary">→</span>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>

              <div className="text-center pt-2">
                <Link href={`/teacher/submissions?topic=${selectedTopicId}`} className="text-sm text-primary hover:underline">
                  → 전체 학생 글 보기
                </Link>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}
