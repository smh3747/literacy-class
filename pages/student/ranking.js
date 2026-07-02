import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

// 한국 시간 기준 오늘 날짜
function todayStr() {
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  return kst.toISOString().slice(0, 10)
}

// N일 전 날짜
function daysAgoStr(days) {
  const now = new Date()
  now.setDate(now.getDate() - days)
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  return kst.toISOString().slice(0, 10)
}

export default function StudentRanking() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [rankings, setRankings] = useState({ avgScore: [], totalSubs: [], improvement: [] })
  const [period, setPeriod] = useState('week') // week / month / all
  const [loading, setLoading] = useState(true)
  const [myRanks, setMyRanks] = useState({ avgScore: null, totalSubs: null, improvement: null })
  const [myAvgDetail, setMyAvgDetail] = useState(null)  // 🆕 step320: 내 평균 점수 근거(값·주제 수), avgList 재사용

  useEffect(() => { checkAuth() }, [])
  useEffect(() => { if (user?.class_id) loadRankings(user, period) }, [period])

  const checkAuth = async () => {
    // 🆕 step331: 진입 인증은 getSession(로컬, 왕복 없음). 실질 검증은 아래 profile RLS+role 가드.
    const { data: { session } } = await supabase.auth.getSession()
    const au = session?.user
    if (!au) { router.push('/student/login'); return }
    const { data: profile } = await supabase.from('profiles')
      .select('*, classes:class_id(id, name, ranking_enabled)').eq('id', au.id).maybeSingle()
    if (!profile || profile.role !== 'student') {
      await supabase.auth.signOut(); router.push('/student/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    if (profile.classes?.ranking_enabled === false) {
      // 랭킹 비활성화
      setLoading(false)
      return
    }

    await loadRankings(profile, period)
    setLoading(false)
  }

  const loadRankings = async (profile, periodKey) => {
    if (!profile?.class_id) return

    // 같은 학급 학생들 (숨김 제외)
    const { data: students } = await supabase.from('profiles')
      .select('id, nickname, number, is_hidden')
      .eq('class_id', profile.class_id).eq('role', 'student')
    const visible = (students || []).filter(s => !s.is_hidden)
    if (visible.length === 0) { setRankings({ avgScore: [], totalSubs: [], improvement: [] }); setMyAvgDetail(null); return }

    const studentIds = visible.map(s => s.id)

    // 기간 필터
    let dateFilter = null
    if (periodKey === 'week') dateFilter = daysAgoStr(7)
    else if (periodKey === 'month') dateFilter = daysAgoStr(30)

    let q = supabase.from('submissions')
      .select('user_id, total_score, max_score, created_at, attempt, topic_id')
      .in('user_id', studentIds)
      .is('deleted_at', null)
    if (dateFilter) q = q.gte('created_at', dateFilter)
    const { data: allSubs } = await q

    // 학생별 통계
    const stats = {}
    visible.forEach(s => {
      stats[s.id] = {
        student: s,
        bestPerTopic: {}, // topic_id -> best submission
        count: 0,
        firstAttempts: [],
        rewriteAttempts: []
      }
    })

    ;(allSubs || []).forEach(s => {
      const st = stats[s.user_id]
      if (!st) return
      const key = s.topic_id
      const cur = st.bestPerTopic[key]
      if (!cur || (s.total_score || 0) > (cur.total_score || 0)) {
        st.bestPerTopic[key] = s
      }
      st.count++
      if ((s.attempt || 1) === 1) st.firstAttempts.push(s)
      else st.rewriteAttempts.push(s)
    })

    // 평균 점수 랭킹
    const avgList = Object.values(stats)
      .map(st => {
        const tops = Object.values(st.bestPerTopic)
        if (tops.length === 0) return null
        const avg = tops.reduce((s, x) => s + (x.total_score / x.max_score) * 100, 0) / tops.length
        return { student: st.student, value: Math.round(avg * 10) / 10, topicCount: tops.length }
      })
      .filter(Boolean)
      .filter(x => x.topicCount >= 1)
      .sort((a, b) => b.value - a.value)

    // 제출 횟수 랭킹
    const subsList = Object.values(stats)
      .map(st => ({ student: st.student, value: st.count }))
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value)

    // 향상도 랭킹
    const improveList = Object.values(stats)
      .map(st => {
        if (st.firstAttempts.length === 0 || st.rewriteAttempts.length === 0) return null
        const firstAvg = st.firstAttempts.reduce((s, x) => s + (x.total_score / x.max_score) * 100, 0) / st.firstAttempts.length
        const rewriteAvg = st.rewriteAttempts.reduce((s, x) => s + (x.total_score / x.max_score) * 100, 0) / st.rewriteAttempts.length
        return { student: st.student, value: Math.round((rewriteAvg - firstAvg) * 10) / 10 }
      })
      .filter(Boolean)
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value)

    // 내 순위
    const myAvgRank = avgList.findIndex(x => x.student.id === profile.id) + 1 || null
    const mySubsRank = subsList.findIndex(x => x.student.id === profile.id) + 1 || null
    const myImproveRank = improveList.findIndex(x => x.student.id === profile.id) + 1 || null
    setMyRanks({ avgScore: myAvgRank, totalSubs: mySubsRank, improvement: myImproveRank })
    // 🆕 step320: 내 평균 근거 병기용 — 기존 avgList 재사용(재계산 없음)
    const myAvgItem = avgList.find(x => x.student.id === profile.id) || null
    setMyAvgDetail(myAvgItem ? { value: myAvgItem.value, topicCount: myAvgItem.topicCount } : null)

    setRankings({
      avgScore: avgList.slice(0, 10),
      totalSubs: subsList.slice(0, 10),
      improvement: improveList.slice(0, 10)
    })
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  if (classInfo?.ranking_enabled === false) {
    return (
      <>
        <Head><title>랭킹 - 다온클래스</title></Head>
        <div className="min-h-screen bg-gray-50">
          <Header user={user} onLogout={logout} />
          <main className="max-w-3xl mx-auto px-4 py-12 text-center">
            <div className="text-5xl mb-3">🚫</div>
            <h2 className="text-lg font-bold mb-2">랭킹 기능이 꺼져있어요</h2>
            <p className="text-sm text-gray-600">선생님께서 비활성화하셨어요</p>
            <Link href="/student" className="mt-6 inline-block text-primary hover:underline">← 메인으로</Link>
          </main>
        </div>
      </>
    )
  }

  const myNickname = user?.nickname || `${user?.number || ''}번`

  // 한 랭킹 카드 렌더링
  const renderRanking = (title, list, unit, myRank, subtitle = null, myDetail = null) => (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <h3 className={`font-bold ${subtitle ? 'mb-1' : 'mb-3'}`}>{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mb-3 leading-relaxed">{subtitle}</p>}
      {list.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">아직 데이터가 부족해요</p>
      ) : (
        <>
          <div className="space-y-2">
            {list.map((item, idx) => {
              const isMe = item.student.id === user?.id
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`
              return (
                <div key={item.student.id}
                  className={`flex items-center justify-between p-2.5 rounded-lg ${
                    isMe ? 'bg-primary-light border-2 border-primary' : 'bg-gray-50'
                  }`}>
                  <div className="flex items-center gap-3">
                    <span className={`w-7 text-center ${idx < 3 ? 'text-xl' : 'text-sm font-bold text-gray-500'}`}>
                      {medal}
                    </span>
                    <span className={`font-medium ${isMe ? 'text-primary-dark' : ''}`}>
                      {item.student.nickname || `${item.student.number || '?'}번`}
                      {isMe && <span className="ml-1 text-xs text-primary">(나)</span>}
                    </span>
                  </div>
                  <span className="font-mono font-bold">{item.value}{unit}</span>
                </div>
              )
            })}
          </div>
          {myDetail ? (
            <div className="mt-3 pt-3 border-t border-gray-200 text-center text-xs text-gray-600">
              ⭐ 내 순위: <strong className="text-primary">{myRank}등</strong>
              {' · '}내 평균 {myDetail.value}점 (주제 {myDetail.topicCount}개 기준)
            </div>
          ) : (myRank && myRank > 10 && (
            <div className="mt-3 pt-3 border-t border-gray-200 text-center text-xs text-gray-600">
              ⭐ 내 순위: <strong className="text-primary">{myRank}등</strong>
            </div>
          ))}
        </>
      )}
    </div>
  )

  return (
    <>
      <Head><title>랭킹 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/student" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">🏆 우리반 글쓰기 랭킹</h1>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            <p className="font-medium mb-1">🎭 익명 랭킹이에요</p>
            <p className="text-xs leading-relaxed">
              친구들이 내 이름을 알 수 없어요. 나에게는 <strong>"{myNickname}"</strong>(이)라는 닉네임이 있어요.
              <br/>
              순위는 격려와 동기 부여를 위한 거예요. 1등이 아니어도 글을 꾸준히 쓰는 게 가장 멋져요!
            </p>
          </div>

          {/* 기간 선택 */}
          <div className="bg-white rounded-2xl p-3 shadow-sm">
            <div className="flex gap-2">
              <button onClick={() => setPeriod('week')}
                className={`flex-1 py-2 rounded-lg text-sm ${
                  period === 'week' ? 'bg-primary text-white font-bold' : 'bg-gray-100 text-gray-600'
                }`}>이번 주</button>
              <button onClick={() => setPeriod('month')}
                className={`flex-1 py-2 rounded-lg text-sm ${
                  period === 'month' ? 'bg-primary text-white font-bold' : 'bg-gray-100 text-gray-600'
                }`}>한 달</button>
              <button onClick={() => setPeriod('all')}
                className={`flex-1 py-2 rounded-lg text-sm ${
                  period === 'all' ? 'bg-primary text-white font-bold' : 'bg-gray-100 text-gray-600'
                }`}>전체</button>
            </div>
          </div>

          {renderRanking('⭐ 평균 점수', rankings.avgScore, '점', myRanks.avgScore,
            '지금까지 쓴 주제들의 최고점을 평균 낸 점수예요. 한 편의 점수와는 달라요.',
            myAvgDetail)}
          {renderRanking('🔥 가장 많이 쓴 학생', rankings.totalSubs, '개', myRanks.totalSubs)}
          {renderRanking('📈 가장 많이 성장한 학생', rankings.improvement, '점↑', myRanks.improvement)}

          <div className="bg-white rounded-2xl p-4 shadow-sm text-xs text-gray-600 leading-relaxed">
            <p className="font-bold mb-1">📋 랭킹 계산 방법</p>
            <ul className="space-y-1 list-disc pl-4">
              <li><strong>평균 점수:</strong> 주제별 최고 점수의 평균 (백분율)</li>
              <li><strong>가장 많이 쓴:</strong> 제출한 글의 총 개수 (수정본 포함)</li>
              <li><strong>가장 많이 성장한:</strong> 수정본 평균 - 첫 글 평균 (점수 향상도)</li>
            </ul>
          </div>
        </main>
      </div>
    </>
  )
}
