import Head from 'next/head'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getFriendlyErrorMessage } from '../../lib/gemini'
import { callAI } from '../../lib/aiClient'
import Header from '../../components/Header'
import { displayStudentName } from '../../lib/displayName'

export default function GrammarBackfill() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [hasApiKey, setHasApiKey] = useState(false)  // 키 서버격리(step153~): class_secrets 기준
  const [topics, setTopics] = useState([])
  const [selectedTopicId, setSelectedTopicId] = useState('')
  const [submissions, setSubmissions] = useState([]) // 선택 주제의 제출물
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '', errors: [] })
  const [logs, setLogs] = useState([])
  const cancelRef = useRef(false)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    // 키 서버격리(step153~): 키 등록 여부만 확인. AI 호출은 서버가 학급 키 조회.
    if (profile.classes?.id) {
      try {
        const { data: keyCheck } = await supabase.from('class_secrets')
          .select('class_id').eq('class_id', profile.classes.id).maybeSingle()
        setHasApiKey(!!keyCheck)
      } catch (e) { setHasApiKey(false) }
    }

    if (profile.classes?.id) {
      const { data: topicList } = await supabase.from('topics')
        .select('id, date, title')
        .eq('teacher_id', profile.id)
        .is('supply_type', null)   // step479: 공급 원본 격리
        .order('date', { ascending: false })
        .limit(60)
      setTopics(topicList || [])
    }
    setLoading(false)
  }

  // 주제 선택 시 그 주제의 모든 제출물 로드
  const handleTopicChange = async (topicId) => {
    setSelectedTopicId(topicId)
    setSelectedIds(new Set())
    if (!topicId || !classInfo?.id) { setSubmissions([]); return }

    // 우리 반 학생만 (숨김 제외)
    const { data: studs } = await supabase.from('profiles')
      .select('id, realname, nickname, username, number, is_hidden')
      .eq('class_id', classInfo.id).eq('role', 'student')
    const visible = (studs || []).filter(s => !s.is_hidden)
    const ids = visible.map(s => s.id)
    if (ids.length === 0) { setSubmissions([]); return }

    const { data: subs } = await supabase.from('submissions')
      .select('id, user_id, essay_text, corrections, total_score, max_score, attempt, created_at')
      .eq('topic_id', topicId)
      .in('user_id', ids)
      .is('deleted_at', null)
      .order('created_at')

    // 학생 정보 매핑
    const studMap = {}
    visible.forEach(s => { studMap[s.id] = s })
    const enriched = (subs || []).map(s => ({
      ...s,
      student: studMap[s.user_id],
      hasCorrections: Array.isArray(s.corrections) && s.corrections.length > 0
    }))
    setSubmissions(enriched)

    // 기본적으로 "맞춤법 정보 없는 글" 자동 선택
    const autoSelect = new Set(enriched.filter(s => !s.hasCorrections).map(s => s.id))
    setSelectedIds(autoSelect)
  }

  // 체크박스 토글
  const toggleOne = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }
  const selectAll = () => setSelectedIds(new Set(submissions.map(s => s.id)))
  const selectNone = () => setSelectedIds(new Set())
  const selectEmpty = () => setSelectedIds(new Set(submissions.filter(s => !s.hasCorrections).map(s => s.id)))

  // 맞춤법 일괄 적용
  const runBackfill = async () => {
    const targets = submissions.filter(s => selectedIds.has(s.id))
    if (targets.length === 0) return alert('선택된 글이 없어요')

    if (!hasApiKey) {
      alert('Gemini API 키가 설정되지 않았어요.\n주제 관리에서 먼저 API 키를 등록해주세요.')
      return
    }

    if (!confirm(
      `📝 맞춤법 피드백 일괄 추가\n\n` +
      `대상: ${targets.length}개 글\n` +
      `예상 소요 시간: 약 ${Math.ceil(targets.length * 5 / 60)}~${Math.ceil(targets.length * 10 / 60)}분\n` +
      `※ Gemini API 호출 ${targets.length}회 발생\n\n` +
      `점수/의견은 그대로 두고 빨간 밑줄 정보만 추가됩니다.\n` +
      `계속할까요?`
    )) return

    cancelRef.current = false
    setProcessing(true)
    setLogs([])
    setProgress({ done: 0, total: targets.length, current: '', errors: [] })

    let done = 0
    const errors = []

    for (const sub of targets) {
      if (cancelRef.current) {
        addLog('⏸ 중단되었습니다')
        break
      }
      const studentName = displayStudentName(sub.student)
      setProgress(p => ({ ...p, current: `${studentName}의 글 처리 중...`, done }))

      try {
        // 🔒 프롬프트는 서버(/api/ai)에서 구성 — 키 서버격리 + IP 보호
        const result = await callAI('grammarOnly', { essay: sub.essay_text })
        // 규칙 기반 보강은 서버(pages/api/ai.js)에서 병합 완료 — result.corrections 그대로 사용
        const corrections = Array.isArray(result.corrections) ? result.corrections : []

        // DB 업데이트 (기존 corrections 덮어쓰기)
        const { error } = await supabase.from('submissions')
          .update({ corrections })
          .eq('id', sub.id)
        if (error) throw error

        addLog(`✅ ${studentName}: 맞춤법 ${corrections.length}개 발견`)
        // 로컬 상태도 업데이트
        setSubmissions(prev => prev.map(s =>
          s.id === sub.id ? { ...s, corrections, hasCorrections: corrections.length > 0 } : s
        ))
      } catch(e) {
        const msg = getFriendlyErrorMessage(e)
        errors.push({ name: studentName, error: msg })
        addLog(`❌ ${studentName}: ${msg}`)

        // 429 오류면 잠시 대기
        if (String(e?.message || '').includes('429')) {
          addLog('⏳ API 한도 초과 - 30초 대기 후 재개')
          await sleep(30000)
        }
      }

      done++
      setProgress(p => ({ ...p, done, errors }))

      // API rate limit 보호: 글 간 1.5초 대기
      if (done < targets.length && !cancelRef.current) {
        await sleep(1500)
      }
    }

    setProgress(p => ({ ...p, current: '', done }))
    setProcessing(false)

    const successCount = done - errors.length
    // 🔔 step348: 알림 센터 — 맞춤법 일괄 완료 알림(비차단, 실패해도 원 동작 무관)
    try {
      if (user?.id && successCount > 0) {
        await supabase.rpc('create_notification', {
          p_recipient: user.id,
          p_type: 'grammar_done',
          p_title: '맞춤법 일괄 검사가 끝났어요',
          p_body: `글 ${successCount}개에 맞춤법을 반영했어요`,
          p_link: '/teacher/grammar-backfill'
        })
      }
    } catch (e) { console.warn('알림 생성 실패:', e?.message) }
    alert(
      `🎉 작업 완료!\n\n` +
      `✅ 성공: ${successCount}개\n` +
      (errors.length > 0 ? `❌ 실패: ${errors.length}개\n\n실패 학생:\n${errors.map(e => `- ${e.name}`).join('\n')}` : '')
    )
  }

  const addLog = (msg) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString('ko-KR'), msg }].slice(-50))
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  const cancel = () => {
    if (!confirm('지금까지 처리된 결과는 그대로 유지됩니다.\n중단할까요?')) return
    cancelRef.current = true
    addLog('🛑 사용자가 중단 요청')
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  const emptyCount = submissions.filter(s => !s.hasCorrections).length
  const filledCount = submissions.filter(s => s.hasCorrections).length

  return (
    <>
      <Head><title>맞춤법 일괄 적용 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">📝 맞춤법 피드백 일괄 적용</h1>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
            <p className="font-medium mb-1">💡 이 기능은 무엇인가요?</p>
            <p className="text-xs leading-relaxed">
              이전에 작성된 글에 <strong>빨간 밑줄(맞춤법/띄어쓰기) 정보가 빠져있는 경우</strong> 한꺼번에 채워줍니다.
              점수, 종합 의견, 잘한 점, 발전 점 등 <strong>다른 피드백은 그대로 유지</strong>됩니다.
              Gemini API를 호출하므로 글 개수만큼 API 사용량이 발생합니다.
            </p>
          </div>

          {/* 주제 선택 */}
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <label className="block text-xs text-gray-600 mb-1">1️⃣ 주제 선택</label>
            {topics.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">등록된 주제가 없어요</p>
            ) : (
              <select value={selectedTopicId} onChange={e => handleTopicChange(e.target.value)}
                disabled={processing}
                className="w-full p-2 border border-gray-200 rounded-lg text-sm">
                <option value="">-- 주제를 선택하세요 --</option>
                {topics.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.date} · {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedTopicId && (
            <>
              {/* 요약 + 선택 도구 */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div className="text-sm">
                    <span className="font-bold">전체 {submissions.length}개</span>
                    {submissions.length > 0 && (
                      <span className="text-gray-500 ml-2">
                        · 맞춤법 있음 <span className="text-green-600">{filledCount}</span>
                        · 없음 <span className="text-amber-600">{emptyCount}</span>
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-primary">
                    선택됨: {selectedIds.size}개
                  </div>
                </div>
                {submissions.length > 0 && !processing && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button onClick={selectAll}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded">전체 선택</button>
                    <button onClick={selectNone}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded">선택 해제</button>
                    <button onClick={selectEmpty}
                      className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded">
                      맞춤법 없는 글만 ({emptyCount}개)
                    </button>
                  </div>
                )}
              </div>

              {/* 글 목록 */}
              {submissions.length === 0 ? (
                <div className="bg-white rounded-2xl p-10 text-center text-gray-500">
                  <p className="text-sm">이 주제에 제출된 글이 없어요</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <h3 className="font-bold mb-3 text-sm">2️⃣ 적용할 글 선택</h3>
                  <div className="space-y-1 max-h-96 overflow-y-auto">
                    {submissions.map(s => {
                      const checked = selectedIds.has(s.id)
                      return (
                        <label key={s.id}
                          className={`flex items-start gap-2 p-2 rounded cursor-pointer text-sm ${
                            checked ? 'bg-blue-50' : 'hover:bg-gray-50'
                          } ${processing ? 'opacity-60 cursor-not-allowed' : ''}`}>
                          <input type="checkbox" checked={checked}
                            onChange={() => toggleOne(s.id)}
                            disabled={processing}
                            className="mt-1 w-4 h-4" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {s.student?.number && (
                                <span className="text-xs text-gray-500 font-mono">{s.student.number}번</span>
                              )}
                              <span className="font-medium">{displayStudentName(s.student)}</span>
                              <span className="text-xs text-gray-500">
                                {(s.attempt || 1) === 1 ? '첫 글' : `수정본 ${s.attempt}`}
                              </span>
                              {s.hasCorrections ? (
                                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                                  맞춤법 {s.corrections.length}개
                                </span>
                              ) : (
                                <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                                  맞춤법 정보 없음
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-0.5">
                              {(s.essay_text || '').slice(0, 80)}
                            </p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 실행 영역 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <h3 className="font-bold mb-3 text-sm">3️⃣ 실행</h3>
                {processing ? (
                  <>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span>{progress.current || '준비 중...'}</span>
                        <span className="font-mono font-bold">{progress.done} / {progress.total}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-400 to-blue-600 h-full transition-all"
                          style={{width: `${(progress.done / progress.total) * 100}%`}} />
                      </div>
                      <button onClick={cancel}
                        className="w-full py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-medium">
                        🛑 중단
                      </button>
                    </div>
                  </>
                ) : (
                  <button onClick={runBackfill}
                    disabled={selectedIds.size === 0}
                    className="w-full py-3 bg-primary text-white rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed">
                    {selectedIds.size > 0
                      ? `🚀 ${selectedIds.size}개 글에 맞춤법 피드백 적용`
                      : '글을 선택해주세요'}
                  </button>
                )}
              </div>

              {/* 로그 */}
              {logs.length > 0 && (
                <div className="bg-gray-900 text-gray-100 rounded-2xl p-4 text-xs font-mono">
                  <div className="font-bold mb-2 text-gray-400">📋 작업 로그</div>
                  <div className="space-y-0.5 max-h-60 overflow-y-auto">
                    {logs.map((l, i) => (
                      <div key={i}>
                        <span className="text-gray-500">[{l.time}]</span> {l.msg}
                      </div>
                    ))}
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
