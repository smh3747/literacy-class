// 교사용 "우리 반 랭킹" — 학생 랭킹(pages/student/ranking.js)의 계산 로직을 그대로 재사용.
//   차이: 교사 가드(getEffectiveProfile) + 임퍼소네이션, 실명 표시(displayStudentNameWithNumber),
//   전원 표시(top10 제한 없음) + 데이터 없는 학생 "아직 없음" 그룹, ranking_enabled off여도 교사는 봄.
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import ImpersonationBanner from '../../components/ImpersonationBanner'
import { getEffectiveProfile, withImpersonation } from '../../lib/impersonation'
import { displayStudentNameWithNumber } from '../../lib/displayName'

// 한국 시간 기준 오늘 날짜 (student/ranking.js와 동일)
function todayStr() {
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  return kst.toISOString().slice(0, 10)
}
// N일 전 날짜 (student/ranking.js와 동일)
function daysAgoStr(days) {
  const now = new Date()
  now.setDate(now.getDate() - days)
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  return kst.toISOString().slice(0, 10)
}

export default function TeacherRanking() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [rankings, setRankings] = useState({ avgScore: [], totalSubs: [], improvement: [] })
  const [allStudents, setAllStudents] = useState([])  // 우리 반 전원(숨김 제외) — "아직 없음" 그룹용
  const [period, setPeriod] = useState('week') // week / month / all
  const [loading, setLoading] = useState(true)

  useEffect(() => { checkAuth() }, [])
  useEffect(() => { if (user?.class_id) loadRankings(user, period) }, [period])

  const checkAuth = async () => {
    const { profile, isImpersonating: imp } = await getEffectiveProfile('*, classes:class_id(id, name, code, ranking_enabled)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    setClassInfo(profile.classes)
    await loadRankings(profile, period)
    setLoading(false)
  }

  const logout = async () => {
    if (isImpersonating) { router.push('/admin'); return }
    await supabase.auth.signOut(); router.push('/')
  }

  const loadRankings = async (profile, periodKey) => {
    if (!profile?.class_id) return

    // 같은 학급 학생들 (숨김 제외) — 교사 화면이라 실명/시드 폴백 위해 realname·username 포함
    const { data: students } = await supabase.from('profiles')
      .select('id, realname, nickname, username, number, is_hidden')
      .eq('class_id', profile.class_id).eq('role', 'student')
    const visible = (students || []).filter(s => !s.is_hidden)
    setAllStudents(visible)
    if (visible.length === 0) { setRankings({ avgScore: [], totalSubs: [], improvement: [] }); return }

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

    // 교사 화면은 전원 표시(top10 제한 없음)
    setRankings({ avgScore: avgList, totalSubs: subsList, improvement: improveList })
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500">로딩 중...</div></div>

  // 한 랭킹 카드 렌더링 (교사용 — 전원 표시 + "아직 없음" 그룹)
  const renderRanking = (title, list, unit, subtitle = null) => {
    const rankedIds = new Set(list.map(x => x.student.id))
    const missing = allStudents.filter(s => !rankedIds.has(s.id))
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <h3 className={`font-bold ${subtitle ? 'mb-1' : 'mb-3'}`}>{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mb-3 leading-relaxed">{subtitle}</p>}
        {list.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">아직 데이터가 부족해요</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto overflow-x-hidden pr-1">
            {list.map((item, idx) => {
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`
              return (
                <div key={item.student.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 min-w-0">
                  <span className={`w-7 flex-shrink-0 text-center ${idx < 3 ? 'text-xl' : 'text-sm font-bold text-gray-500'}`}>{medal}</span>
                  <span className="flex-1 min-w-0 truncate font-medium" title={displayStudentNameWithNumber(item.student)}>
                    {displayStudentNameWithNumber(item.student)}
                  </span>
                  <span className="flex-shrink-0 whitespace-nowrap text-right font-mono font-bold">{item.value}{unit}</span>
                </div>
              )
            })}
          </div>
        )}
        {missing.length > 0 && (
          <p className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 leading-relaxed">
            아직 기록 없음: {missing.map(s => displayStudentNameWithNumber(s)).join(', ')}
          </p>
        )}
      </div>
    )
  }

  return (
    <>
      <Head><title>우리 반 랭킹 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <ImpersonationBanner targetName={user?.realname} targetSchool={user?.school} />}
        <Header user={user} onLogout={logout} />
        <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href={withImpersonation('/teacher')} className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">🏆 우리 반 랭킹</h1>
          </div>

          {classInfo?.ranking_enabled === false && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
              학생에게는 랭킹이 꺼져 있어요. 이 화면은 선생님만 볼 수 있어요.
            </div>
          )}

          {/* 기간 선택 */}
          <div className="bg-white rounded-2xl p-3 shadow-sm">
            <div className="flex gap-2">
              <button onClick={() => setPeriod('week')}
                className={`flex-1 py-2 rounded-lg text-sm ${period === 'week' ? 'bg-primary text-white font-bold' : 'bg-gray-100 text-gray-600'}`}>이번 주</button>
              <button onClick={() => setPeriod('month')}
                className={`flex-1 py-2 rounded-lg text-sm ${period === 'month' ? 'bg-primary text-white font-bold' : 'bg-gray-100 text-gray-600'}`}>한 달</button>
              <button onClick={() => setPeriod('all')}
                className={`flex-1 py-2 rounded-lg text-sm ${period === 'all' ? 'bg-primary text-white font-bold' : 'bg-gray-100 text-gray-600'}`}>전체</button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {renderRanking('⭐ 평균 점수', rankings.avgScore, '점',
              '지금까지 쓴 주제들의 최고점을 평균 낸 점수예요. 한 편의 점수와는 달라요.')}
            {renderRanking('🔥 가장 많이 쓴 학생', rankings.totalSubs, '개')}
            {renderRanking('📈 가장 많이 성장한 학생', rankings.improvement, '점↑')}
          </div>
        </main>
      </div>
    </>
  )
}
