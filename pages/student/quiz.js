// 🧩 step360: 학생 맞춤법 퀴즈 1차 (백로그 ⑦)
// 내 글의 교정 기록(submissions.corrections)만으로 2지선다 5문제를 만든다.
// 순수 클라이언트 퀴즈: 점수 저장·랭킹 연동 없음(DB 쓰기 0, 읽기 1회뿐).
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import { pickStr } from '../../lib/pickStr'  // step598: 로컬 복제본 → 공용 헬퍼(step427, 동일 로직)
import { mergeCorrectionsDetailed, findRuleBasedErrors, findOriginalRange } from '../../lib/koreanRules'

const QUIZ_SIZE = 5
const CONTEXT_CHARS = 40  // step598: 문맥 표시 — 교정 위치 앞뒤 글자 수

// 🆕 step598: 출제 재료 안전화 (10/1 학생 의견 3건: 보기 동일·"안 는" 정답·문맥 없음)
//   저장된 corrections는 채점 시점 필터를 통과한 것뿐이라, 필터 이전 저장분·병합 실패 폴백 저장분이 섞여 있다.
//   퀴즈 쪽에서 (1) 현행 필터 재적용 (2) 정규화 비교 (3) 의심 교정 기록 제외 (4) 문맥 위치 확인을 거친 것만 쓴다.
// 정규화 키: NFC + 특수 공백(NBSP·전각·zero-width·BOM) → 일반 공백, 연속 공백 한 칸, trim.
//   "여름 방학"(NBSP) vs "여름 방학"(공백)처럼 눈에 안 보이는 차이로 '다른 보기'가 되는 것을 막는다.
const normKey = (s) => String(s ?? '')
  .normalize('NFC')
  .replace(/[   -​  　﻿]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
const pairKey = (o, c) => normKey(o) + '→' + normKey(c)

// 문맥 1줄 재료: 교정 위치 앞뒤 CONTEXT_CHARS자. 위치 자체는 화면에서 빈칸으로 둔다(보기 둘 다 문맥에서 새지 않게).
const buildContext = (essay, range) => {
  const clean = (s) => s.replace(/\s+/g, ' ')
  const from = Math.max(0, range.start - CONTEXT_CHARS)
  const to = Math.min(essay.length, range.end + CONTEXT_CHARS)
  return {
    before: (from > 0 ? '…' : '') + clean(essay.slice(from, range.start)),
    after: clean(essay.slice(range.end, to)) + (to < essay.length ? '…' : '')
  }
}

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
      await supabase.auth.signOut({ scope: 'local' }); router.push('/student/login'); return
    }
    setUser(profile)

    // 내 글 최근 100건, 삭제 제외 (반드시 본인 것만). step598: 문맥 표시·필터 재적용을 위해 id·essay_text 추가.
    const { data } = await supabase.from('submissions')
      .select('id, corrections, essay_text')
      .eq('user_id', profile.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100)

    // 🆕 step598: 의심 교정 기록(correction_alerts)에 오른 쌍은 출제 제외.
    //   - submission_id가 내 글인 행(저장 후 pg_cron 사후 감시가 적재) + blocked_user_id가 나인 행(채점 시 차단 기록)
    //   - 읽기 1회뿐, 화면 표시 없음. 테이블 RLS는 수동 생성이라 학생 SELECT 가능 여부 미확인 → 실패·빈 결과면 제외 없이 진행(fail-open).
    const excluded = new Set()
    try {
      const subIds = (data || []).map(r => r.id).filter(Boolean)
      let q = supabase.from('correction_alerts').select('original, correction').limit(500)
      q = subIds.length > 0
        ? q.or(`blocked_user_id.eq.${profile.id},submission_id.in.(${subIds.join(',')})`)
        : q.eq('blocked_user_id', profile.id)
      const { data: alerts, error } = await q
      if (error) throw error
      ;(alerts || []).forEach(a => {
        const k = pairKey(a.original, a.correction)
        if (k !== '→') excluded.add(k)
      })
    } catch (e) { console.warn('의심 교정 기록 조회 실패(퀴즈는 계속):', e?.message) }

    // 문제 풀 구성 — 기존 읽기 코드(applyGrammarHighlights 등)와 동일한 옛 필드명 폴백
    const nextPool = []
    const seen = new Set()
    ;(data || []).forEach(row => {
      const essay = typeof row.essay_text === 'string' ? row.essay_text : ''
      if (!essay.trim()) return  // 문맥을 만들 본문이 없으면 이 글의 교정은 출제 제외
      // 저장된 쌍(옛 필드명 폴백 포함)을 표준 필드로 맞춘다. 이후 단계는 이 목록만 재료로 본다.
      const saved = (Array.isArray(row.corrections) ? row.corrections : [])
        .map(c => (c && typeof c === 'object') ? {
          original: pickStr(c.original, c.error, c.wrong),
          correction: pickStr(c.correction, c.fixed, c.suggestion),
          reason: pickStr(c.reason, c.type, c.category)
        } : null)
        .filter(c => c && c.original && c.correction)
      if (saved.length === 0) return
      const savedKeys = new Set(saved.map(c => pairKey(c.original, c.correction)))

      // (1) 현행 필터 재적용: 안않오교정·불가능형태·문체역행·무의미 — 과거 저장분에도 지금 기준을 적용.
      //     병합이 규칙으로 새로 찍어낸 항목은 '당시 학생이 받은 교정'이 아니라 savedKeys로 걸러 제외한다.
      let merged
      try { merged = mergeCorrectionsDetailed(saved, essay).corrections } catch { return }
      // (4) 규칙기반으로도 검출되는 쌍은 신뢰도가 높아 출제 우선순위를 준다(표시 불변).
      //     규칙 산출물은 조각("할수있"→"할 수 있")이라 저장 교정("할수있다고"→"할 수 있다고")과 정확히 같지 않다.
      //     → 규칙 original이 저장 original에, 규칙 correction이 저장 correction에 (정규화 후) 포함되면 검증된 것으로 본다.
      let ruleErrs = []
      try {
        ruleErrs = findRuleBasedErrors(essay)
          .map(r => ({ o: normKey(r.original), c: normKey(r.correction) }))
          .filter(r => r.o && r.c)
      } catch {}
      const isRuleVerified = (o, c) => {
        const nO = normKey(o), nC = normKey(c)
        return ruleErrs.some(r => nO.includes(r.o) && nC.includes(r.c))
      }

      merged.forEach(c => {
        const original = pickStr(c.original)
        const correction = pickStr(c.correction)
        const reason = pickStr(c.reason)
        if (!original || !correction) return
        const key = pairKey(original, correction)
        if (!savedKeys.has(key)) return                       // 저장돼 있던 교정만
        if (normKey(original) === normKey(correction)) return // (2) 정규화 후 같으면 문제 성립 불가
        if (excluded.has(key)) return                         // (3) 의심 교정 기록 있음
        if (seen.has(key)) return                             // 같은 쌍 중복 제거
        // (5) 문맥: 본문에서 위치를 확실히 찾은 것만(못 찾음·2곳 이상 모호 → 제외)
        const range = findOriginalRange(essay, original)
        if (!range || range.ambiguous) return
        seen.add(key)
        nextPool.push({ original, correction, reason, ruleVerified: ruleKeys.has(key), context: buildContext(essay, range) })
      })
    })
    setPool(nextPool)
    if (nextPool.length >= QUIZ_SIZE) startQuiz(nextPool)
    setLoading(false)
  }

  // 새 판 시작: 무작위 5개 + 문제마다 버튼 좌우 무작위
  //   step598: 규칙기반으로 검증된 쌍을 앞에 두고(각 그룹 안에서는 무작위), 보기 두 개가 정규화 후 같은 문항은 이중 방어로 제외.
  const startQuiz = (fromPool) => {
    const ordered = [...shuffle(fromPool.filter(q => q.ruleVerified)), ...shuffle(fromPool.filter(q => !q.ruleVerified))]
    const qs = ordered
      .filter(q => normKey(q.original) !== normKey(q.correction))
      .slice(0, QUIZ_SIZE)
      .map(q => ({ ...q, swap: Math.random() < 0.5 }))
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

  const logout = async () => { await supabase.auth.signOut({ scope: 'local' }); router.push('/') }

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
              {/* step598: 내 글 문맥 1줄 — 교정 위치는 빈칸(보기 둘 다 문맥에서 새지 않게) */}
              {q.context && (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-3 py-2 break-all">
                  📝 내 글: "{q.context.before}<span className="inline-block min-w-[3rem] border-b-2 border-gray-400 mx-0.5 align-baseline">&nbsp;</span>{q.context.after}"
                </p>
              )}
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
