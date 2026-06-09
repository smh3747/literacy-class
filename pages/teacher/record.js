import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { loadApiKey, saveApiKey as saveLocalApiKey, getFriendlyErrorMessage } from '../../lib/gemini'
import { callAI } from '../../lib/aiClient'
import Header from '../../components/Header'

async function loadSummaries(studentId) {
  const { data } = await supabase.from('submissions')
    .select('id, topic_title, total_score, max_score, feedback_overall, feedback_good, feedback_improve, attempt, created_at, topic_id')
    .eq('user_id', studentId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  const byTopic = {}
  ;(data || []).forEach(s => {
    const k = s.topic_id || s.id
    if (!byTopic[k] || (s.attempt || 1) >= (byTopic[k].attempt || 1)) byTopic[k] = s
  })
  return Object.values(byTopic).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
}

function autoLevel(subs) {
  if (!subs.length) return ''
  const ratios = subs.map(s => (s.total_score ?? 0) / (s.max_score || 100))
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length
  return avg >= 0.9 ? '매우잘함' : avg >= 0.7 ? '잘함' : avg >= 0.5 ? '보통' : '노력요함'
}

function toSummaries(subs) {
  return subs.map(s => ({
    title: s.topic_title || '글',
    score: s.total_score ?? 0,
    max: s.max_score ?? 100,
    overall: s.feedback_overall || '',
    good: s.feedback_good || '',
    improve: s.feedback_improve || ''
  }))
}

export default function RecordPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [gradeText, setGradeText] = useState('초등학교')

  const [standards, setStandards] = useState('')
  const [copied, setCopied] = useState('')

  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, current: '' })
  const [batchResults, setBatchResults] = useState([])

  const [showSingle, setShowSingle] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [subs, setSubs] = useState([])
  const [level, setLevel] = useState('')
  const [generating, setGenerating] = useState(false)
  const [single, setSingle] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles')
      .select('*, classes:class_id(id, name, code, api_key, grade)')
      .eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    if (profile.classes?.api_key) saveLocalApiKey(profile.classes.api_key)

    let gt = '초등학교'
    if (profile.classes?.grade) gt = `초등학교 ${profile.classes.grade}학년`
    else if (profile.classes?.name) {
      const m = profile.classes.name.match(/(\d)\s*학년/); if (m) gt = `초등학교 ${m[1]}학년`
    }
    setGradeText(gt)

    const { data: studs } = await supabase.from('profiles')
      .select('id, realname, username, number, is_hidden')
      .eq('class_id', profile.classes?.id).eq('role', 'student')
    const visible = (studs || []).filter(s => !s.is_hidden)
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999))
    setStudents(visible)
    setLoading(false)
  }

  const getKey = () => classInfo?.api_key || loadApiKey()

  const runBatch = async () => {
    const key = getKey()
    if (!key) { alert('학급 API 키가 설정되어 있지 않아요. 설정에서 등록해주세요.'); return }
    if (students.length === 0) { alert('학생이 없어요.'); return }
    if (!confirm(`학생 ${students.length}명의 평어를 한 번에 만들까요?\n\n· AI를 학생 수만큼 호출해요 (수 분 소요)\n· 글이 없는 학생은 건너뜁니다`)) return

    setBatchRunning(true)
    setBatchResults([])
    setBatchProgress({ done: 0, total: students.length, current: '' })

    const results = []
    for (let i = 0; i < students.length; i++) {
      const stu = students[i]
      setBatchProgress({ done: i, total: students.length, current: stu.realname || stu.username })
      try {
        const studentSubs = await loadSummaries(stu.id)
        if (studentSubs.length === 0) {
          results.push({ student: stu, sentences: [], level: '', skipped: true })
          setBatchResults([...results]); continue
        }
        const lv = autoLevel(studentSubs)
        const r = await callAI('schoolRecord', key, {
          gradeText, summaries: toSummaries(studentSubs), level: lv, standards, count: 2
        })
        results.push({ student: stu, sentences: r.sentences || [], level: lv })
      } catch (e) {
        results.push({ student: stu, sentences: [], error: getFriendlyErrorMessage ? getFriendlyErrorMessage(e) : (e.message || '실패') })
      }
      setBatchResults([...results])
    }
    setBatchProgress({ done: students.length, total: students.length, current: '' })
    setBatchRunning(false)
  }

  const pickStudent = async (id) => {
    setSelectedId(id); setSingle(null); setError('')
    if (!id) { setSubs([]); setLevel(''); return }
    const studentSubs = await loadSummaries(id)
    setSubs(studentSubs)
    setLevel(autoLevel(studentSubs))
  }

  const genSingle = async () => {
    setError(''); setSingle(null)
    if (subs.length === 0) { setError('이 학생의 글 기록이 없어요.'); return }
    const key = getKey()
    if (!key) { setError('학급 API 키가 설정되어 있지 않아요.'); return }
    setGenerating(true)
    try {
      const r = await callAI('schoolRecord', key, {
        gradeText, summaries: toSummaries(subs), level, standards, count: 4
      })
      setSingle(r)
    } catch (e) {
      setError(getFriendlyErrorMessage ? getFriendlyErrorMessage(e) : (e.message || '생성 중 오류'))
    }
    setGenerating(false)
  }

  const copy = async (text, k) => {
    try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1500) } catch {}
  }

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">불러오는 중...</p></div>
  }

  return (
    <>
      <Head><title>생기부 평어 도우미 · 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} />
        <main className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">📝 생기부 평어 도우미</h1>
            <p className="text-sm text-gray-600 mt-1">
              학급 전체의 한 문장 평어 후보를 한 번에 만들어, 골라서 바로 붙여넣으세요.
              초안이니 <strong>반드시 교사가 검토·수정</strong>한 뒤 사용하세요.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm mb-5">
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              성취기준 <span className="text-gray-400 font-normal">(선택 · 입력하면 이 기준에 근거해 평어를 작성해요)</span>
            </label>
            <textarea
              value={standards}
              onChange={e => setStandards(e.target.value)}
              rows={2}
              placeholder={'예) [6국03-04] 적절한 근거와 알맞은 표현을 사용하여 주장하는 글을 쓴다.\n비워두면 글쓰기 능력 중심으로 작성돼요.'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            />
            <button
              onClick={runBatch}
              disabled={batchRunning}
              className="mt-3 w-full sm:w-auto bg-primary text-white px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              {batchRunning
                ? `만드는 중... (${batchProgress.done}/${batchProgress.total})`
                : `✨ 학급 전체 평어 한 번에 만들기 (${students.length}명)`}
            </button>
          </div>

          {batchRunning && (
            <div className="bg-white rounded-2xl p-4 shadow-sm mb-5">
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="bg-primary h-full transition-all" style={{ width: `${batchProgress.total ? (batchProgress.done / batchProgress.total * 100) : 0}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {batchProgress.current ? `${batchProgress.current} 작성 중...` : '준비 중...'} ({batchProgress.done}/{batchProgress.total})
              </p>
            </div>
          )}

          {batchResults.length > 0 && (
            <div className="space-y-3 mb-6">
              {batchResults.map(({ student, sentences, level: lv, error: err, skipped }) => (
                <div key={student.id} className="bg-white rounded-2xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-gray-900">
                      {student.number ? `${student.number}번 ` : ''}{student.realname || student.username}
                      {lv && <span className="ml-2 text-[11px] font-normal text-gray-400">({lv})</span>}
                    </h3>
                  </div>
                  {skipped ? (
                    <p className="text-xs text-gray-400">쓴 글이 없어 건너뜀</p>
                  ) : err ? (
                    <p className="text-xs text-red-500">{err}</p>
                  ) : (
                    <ul className="space-y-2">
                      {sentences.map((sent, i) => (
                        <li key={i}>
                          <button
                            onClick={() => copy(sent, `${student.id}-${i}`)}
                            className="w-full text-left text-sm text-gray-800 bg-gray-50 hover:bg-primary/10 border border-gray-200 rounded-lg px-3 py-2.5 transition-colors flex items-start justify-between gap-2 group"
                          >
                            <span className="leading-relaxed break-keep">{sent}</span>
                            <span className="text-[11px] text-gray-400 group-hover:text-primary whitespace-nowrap mt-0.5">
                              {copied === `${student.id}-${i}` ? '✓ 복사됨' : '복사'}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 leading-relaxed">
                ⚠️ AI가 만든 <strong>초안</strong>이에요. 학생을 가장 잘 아는 선생님이 사실과 다른 부분을 고치고 실제 관찰을 더해 완성해주세요.
              </div>
            </div>
          )}

          <details className="bg-white rounded-2xl shadow-sm" open={showSingle} onToggle={e => setShowSingle(e.target.open)}>
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-gray-700 select-none">
              🔍 학생 한 명 자세히 보기 (후보 더 많이)
            </summary>
            <div className="px-5 pb-5 space-y-4">
              <select
                value={selectedId}
                onChange={e => pickStudent(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">— 학생 선택 —</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>{s.number ? `${s.number}번 ` : ''}{s.realname || s.username}</option>
                ))}
              </select>

              {selectedId && subs.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-600">글 {subs.length}편 · 평균 {Math.round(subs.reduce((a, s) => a + (s.total_score ?? 0), 0) / subs.length)}점</span>
                  <label className="text-sm text-gray-700 ml-2">수준:</label>
                  <select value={level} onChange={e => setLevel(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm">
                    <option value="매우잘함">매우잘함</option>
                    <option value="잘함">잘함</option>
                    <option value="보통">보통</option>
                    <option value="노력요함">노력요함</option>
                  </select>
                  <button onClick={genSingle} disabled={generating} className="bg-primary text-white px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50">
                    {generating ? '작성 중...' : '후보 만들기'}
                  </button>
                </div>
              )}
              {selectedId && subs.length === 0 && <p className="text-sm text-gray-400">이 학생은 쓴 글이 없어요.</p>}
              {error && <p className="text-sm text-red-600">{error}</p>}

              {single && Array.isArray(single.sentences) && (
                <div>
                  <ul className="space-y-2">
                    {single.sentences.map((sent, i) => (
                      <li key={i}>
                        <button
                          onClick={() => copy(sent, `single-${i}`)}
                          className="w-full text-left text-sm text-gray-800 bg-gray-50 hover:bg-primary/10 border border-gray-200 rounded-lg px-3 py-2.5 transition-colors flex items-start justify-between gap-2 group"
                        >
                          <span className="leading-relaxed break-keep">{sent}</span>
                          <span className="text-[11px] text-gray-400 group-hover:text-primary whitespace-nowrap mt-0.5">
                            {copied === `single-${i}` ? '✓ 복사됨' : '복사'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {(single.strengths || single.growth) && (
                    <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900">
                      {single.strengths && <p><strong>강점:</strong> {single.strengths}</p>}
                      {single.growth && <p className="mt-1"><strong>성장:</strong> {single.growth}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </details>
        </main>
      </div>
    </>
  )
}
