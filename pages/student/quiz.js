// 🧩 step360: 학생 맞춤법 퀴즈 1차 (백로그 ⑦)
// 내 글의 교정 기록(submissions.corrections)만으로 2지선다 5문제를 만든다.
// 순수 클라이언트 퀴즈: 점수 저장·랭킹 연동 없음(DB 쓰기 0, 읽기 1회뿐).
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

const QUIZ_SIZE = 5

// 배열 셔플 (Fisher-Yates)
const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function StudentQuiz() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pool, setPool] = useState([])          // 고유 (original→correction) 쌍 전체
  const [questions, setQuestions] = useState([]) // 이번 판 5문제 (swap: 버튼 좌우 무작위)
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState(null)     // 'original' | 'correction' | null
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)

  useEffect(() => { checkAuth() }, [])

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

    // corrections만 가볍게: 내 글 최근 100건, 삭제 제외 (반드시 본인 것만)
    const { data } = await supabase.from('submissions')
      .select('corrections')
      .eq('user_id', profile.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100)

    // 문제 풀 구성 — 기존 읽기 코드(applyGrammarHighlights 등)와 동일한 옛 필드명 폴백
    const nextPool = []
    const seen = new Set()
    ;(data || []).forEach(row => {
      (Array.isArray(row.corrections) ? row.corrections : []).forEach(c => {
        const original = (c.original || c.error || c.wrong || '').trim()
        const correction = (c.correction || c.fixed || c.suggestion || '').trim()
        const reason = (c.reason || c.type || c.category || '').trim()
        if (!original || !correction || original === correction) return  // 문제 성립 불가
        const key = original + '→' + correction
        if (seen.has(key)) return  // 같은 쌍 중복 제거
        seen.add(key)
        nextPool.push({ original, correction, reason })
      })
    })
    setPool(nextPool)
    if (nextPool.length >= QUIZ_SIZE) startQuiz(nextPool)
    setLoading(false)
  }

  // 새 판 시작: 무작위 5개 + 문제마다 버튼 좌우 무작위
  const startQuiz = (fromPool) => {
    const qs = shuffle(fromPool).slice(0, QUIZ_SIZE).map(q => ({ ...q, swap: Math.random() < 0.5 }))
    setQuestions(qs)
    setIdx(0)
    setPicked(null)
    setScore(0)
    setFinished(false)
  }

  const pick = (which) => {
    if (picked) return  // 이미 답했으면 무시
    setPicked(which)
    if (which === 'correction') setScore(s => s + 1)
  }

  const next = () => {
    if (idx + 1 >= questions.length) { setFinished(true); return }
    setIdx(i => i + 1)
    setPicked(null)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  const q = questions[idx]
  // 버튼 표시 순서 (정답 위치 무작위)
  const options = q
    ? (q.swap ? ['correction', 'original'] : ['original', 'correction'])
    : []

  return (
    <>
      <Head><title>맞춤법 퀴즈 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-2">
            <Link href="/student" className="text-gray-600">←</Link>
            <h1 className="text-lg font-bold text-gray-900">🧩 맞춤법 퀴즈</h1>
          </div>

          {/* 기록 부족: 안내만 */}
          {pool.length < QUIZ_SIZE ? (
            <div className="bg-white rounded-2xl p-6 shadow-sm text-center space-y-3">
              <div className="text-4xl">🌱</div>
              <p className="font-bold text-gray-800">아직 퀴즈를 만들 기록이 부족해요.</p>
              <p className="text-sm text-gray-600">글을 더 쓰면 내가 틀렸던 맞춤법으로 퀴즈가 만들어져요.</p>
              <Link href="/student" className="inline-block mt-2 bg-primary text-white text-sm font-medium px-4 py-2 rounded-xl hover:opacity-90 transition">
                ✏️ 글 쓰러 가기
              </Link>
            </div>
          ) : finished ? (
            /* 결과 화면 */
            <div className="bg-white rounded-2xl p-6 shadow-sm text-center space-y-3">
              <div className="text-4xl">{score === QUIZ_SIZE ? '🏆' : score >= 3 ? '🎉' : '💪'}</div>
              <p className="text-xl font-bold text-gray-900">{QUIZ_SIZE}개 중 {score}개 맞혔어요!</p>
              <p className="text-sm text-gray-600">
                {score === QUIZ_SIZE
                  ? '완벽해요! 내가 틀렸던 맞춤법을 다 익혔어요.'
                  : score >= 3
                    ? '잘하고 있어요! 틀린 문제를 다시 보면 더 늘어요.'
                    : '괜찮아요. 다시 풀면서 하나씩 익히면 돼요.'}
              </p>
              <div className="flex justify-center gap-2 pt-1">
                <button onClick={() => startQuiz(pool)}
                  className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-xl hover:opacity-90 transition">
                  🔄 다시 풀기
                </button>
                <Link href="/student" className="text-sm text-gray-600 px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition">
                  🏠 홈으로
                </Link>
              </div>
            </div>
          ) : q && (
            /* 문제 화면 */
            <div className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>문제 {idx + 1} / {questions.length}</span>
                <span>맞힌 개수 {score}개</span>
              </div>
              <p className="font-bold text-gray-900">다음 중 맞는 표현은 무엇일까요?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {options.map(which => {
                  const label = which === 'correction' ? q.correction : q.original
                  let style = 'bg-gray-50 border-gray-200 text-gray-800 hover:bg-gray-100'
                  if (picked) {
                    if (which === 'correction') style = 'bg-green-50 border-green-400 text-green-800 font-bold'  // 정답 하이라이트
                    else if (picked === which) style = 'bg-red-50 border-red-300 text-red-700'                    // 내가 고른 오답
                    else style = 'bg-gray-50 border-gray-200 text-gray-400'
                  }
                  return (
                    <button key={which} type="button" onClick={() => pick(which)} disabled={!!picked}
                      className={`border-2 rounded-xl px-4 py-4 text-base transition text-center break-all ${style}`}>
                      {label}
                    </button>
                  )
                })}
              </div>

              {picked && (
                <div className={`rounded-xl p-3 text-sm ${picked === 'correction' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
                  <p className="font-bold">
                    {picked === 'correction' ? '⭕ 맞았어요!' : `❌ 아쉬워요. 맞는 표현은 "${q.correction}"이에요.`}
                  </p>
                  {q.reason && <p className="mt-1 text-gray-700">왜냐하면: {q.reason}</p>}
                </div>
              )}

              {picked && (
                <button onClick={next}
                  className="w-full bg-primary text-white text-sm font-medium py-2.5 rounded-xl hover:opacity-90 transition">
                  {idx + 1 >= questions.length ? '🏁 결과 보기' : '👉 다음 문제'}
                </button>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  )
}
