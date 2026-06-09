import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { loadApiKey, saveApiKey as saveLocalApiKey, getFriendlyErrorMessage } from '../../lib/gemini'
import { callAI } from '../../lib/aiClient'
import Header from '../../components/Header'

export default function RecordPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)

  const [selectedId, setSelectedId] = useState('')
  const [subs, setSubs] = useState([])        // 선택 학생의 글 목록
  const [subsLoading, setSubsLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [level, setLevel] = useState('')  // 전반적 수준 (자동 또는 교사 지정)
  const [standards, setStandards] = useState('')  // 성취기준 (선택, 자유 입력)

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

    // 학급 학생 목록 (숨김 제외, 번호순)
    const { data: studs } = await supabase.from('profiles')
      .select('id, realname, username, number, is_hidden')
      .eq('class_id', profile.classes?.id).eq('role', 'student')
    const visible = (studs || []).filter(s => !s.is_hidden)
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999))
    setStudents(visible)
    setLoading(false)
  }

  // 학생 선택 시 그 학생의 글 모으기 (각 주제의 최신 시도)
  const pickStudent = async (id) => {
    setSelectedId(id)
    setResult(null); setError('')
    if (!id) { setSubs([]); return }
    setSubsLoading(true)
    const { data } = await supabase.from('submissions')
      .select('id, topic_title, total_score, max_score, feedback_overall, feedback_good, feedback_improve, attempt, created_at, topic_id')
      .eq('user_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })

    // 같은 주제는 가장 높은 attempt(최종본)만
    const byTopic = {}
    ;(data || []).forEach(s => {
      const k = s.topic_id || s.id
      if (!byTopic[k] || (s.attempt || 1) >= (byTopic[k].attempt || 1)) byTopic[k] = s
    })
    const finalList = Object.values(byTopic).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    setSubs(finalList)

    // 평균 점수 비율로 수준 자동 판정 (교사가 바꿀 수 있음)
    if (finalList.length > 0) {
      const ratios = finalList.map(s => (s.total_score ?? 0) / (s.max_score || 100))
      const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length
      const auto = avg >= 0.9 ? '매우잘함' : avg >= 0.7 ? '잘함' : avg >= 0.5 ? '보통' : '노력요함'
      setLevel(auto)
    } else {
      setLevel('')
    }
    setSubsLoading(false)
  }

  const generate = async () => {
    setError(''); setResult(null)
    if (subs.length === 0) { setError('이 학생의 글 기록이 없어요.'); return }
    const apiKey = classInfo?.api_key || loadApiKey()
    if (!apiKey) { setError('학급 API 키가 설정되어 있지 않아요. 설정에서 등록해주세요.'); return }

    // 학년 텍스트
    let gradeText = '초등학교'
    if (classInfo?.grade) gradeText = `초등학교 ${classInfo.grade}학년`
    else if (classInfo?.name) {
      const m = classInfo.name.match(/(\d)\s*학년/); if (m) gradeText = `초등학교 ${m[1]}학년`
    }

    // 글 요약 만들기 (이름은 보내지 않음 — 개인정보 보호)
    const summaries = subs.map(s => ({
      title: s.topic_title || '글',
      score: s.total_score ?? 0,
      max: s.max_score ?? 100,
      overall: s.feedback_overall || '',
      good: s.feedback_good || '',
      improve: s.feedback_improve || ''
    }))

    setGenerating(true)
    try {
      const r = await callAI('schoolRecord', apiKey, { gradeText, summaries, level, standards })
      setResult(r)
    } catch (e) {
      setError(getFriendlyErrorMessage ? getFriendlyErrorMessage(e) : (e.message || '생성 중 오류가 발생했어요'))
    }
    setGenerating(false)
  }

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key); setTimeout(() => setCopied(''), 1500)
    } catch { /* 무시 */ }
  }

  const selectedStudent = students.find(s => s.id === selectedId)
  const avgScore = subs.length > 0
    ? Math.round(subs.reduce((a, s) => a + (s.total_score ?? 0), 0) / subs.length)
    : 0

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">불러오는 중...</p>
      </div>
    )
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
              학생이 한 학기 동안 쓴 글과 평가를 바탕으로 생활기록부 평어 초안을 만들어요.
              초안을 그대로 쓰지 말고 <strong>반드시 교사가 검토·수정</strong>한 뒤 사용하세요.
            </p>
          </div>

          {/* 학생 선택 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-5">
            <label className="block text-sm font-semibold text-gray-800 mb-2">학생 선택</label>
            <select
              value={selectedId}
              onChange={e => pickStudent(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">— 학생을 선택하세요 —</option>
              {students.map(s => (
                <option key={s.id} value={s.id}>
                  {s.number ? `${s.number}번 ` : ''}{s.realname || s.username}
                </option>
              ))}
            </select>

            {selectedId && (
              <div className="mt-4 space-y-3">
                <div className="text-sm text-gray-600">
                  {subsLoading ? '글 불러오는 중...' : (
                    <>
                      쓴 글 <strong className="text-gray-900">{subs.length}편</strong>
                      {subs.length > 0 && <> · 평균 <strong className="text-gray-900">{avgScore}점</strong></>}
                    </>
                  )}
                </div>

                {subs.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-sm text-gray-700">전반적 수준:</label>
                    <select
                      value={level}
                      onChange={e => setLevel(e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value="매우잘함">매우잘함</option>
                      <option value="잘함">잘함</option>
                      <option value="보통">보통</option>
                      <option value="노력요함">노력요함</option>
                    </select>
                    <span className="text-xs text-gray-400">점수로 자동 설정됨 · 평어 톤에만 반영(문구엔 등급 안 나옴)</span>
                  </div>
                )}

                {subs.length > 0 && (
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      성취기준 <span className="text-gray-400 font-normal">(선택 · 입력하면 이 기준에 근거해 평어를 작성해요)</span>
                    </label>
                    <textarea
                      value={standards}
                      onChange={e => setStandards(e.target.value)}
                      rows={3}
                      placeholder={'예) [6국03-04] 적절한 근거와 알맞은 표현을 사용하여 주장하는 글을 쓴다.\n여러 개면 줄바꿈으로 넣으세요. 비워두면 글쓰기 능력 중심으로 작성돼요.'}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                    />
                  </div>
                )}

                <button
                  onClick={generate}
                  disabled={generating || subs.length === 0}
                  className="bg-primary text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
                >
                  {generating ? 'AI가 작성 중...' : '✨ 평어 초안 만들기'}
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800 mb-5">{error}</div>
          )}

          {/* 글 목록 미리보기 */}
          {selectedId && subs.length > 0 && !result && (
            <div className="bg-white rounded-2xl p-5 shadow-sm mb-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">이 학생이 쓴 글 ({subs.length}편)</h3>
              <ul className="space-y-2">
                {subs.map((s, i) => (
                  <li key={s.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                    <span className="text-gray-700 truncate mr-2">{i + 1}. {s.topic_title || '글'}</span>
                    <span className="text-gray-500 whitespace-nowrap">{s.total_score ?? 0}/{s.max_score ?? 100}점</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 결과 */}
          {result && (
            <div className="space-y-4">
              <RecordCard
                title="생기부용 평어 (줄글)"
                badge={`${(result.record_long || '').length}자`}
                text={result.record_long}
                onCopy={() => copy(result.record_long, 'long')}
                copied={copied === 'long'}
                highlight
              />

              {/* 한 문장 평어 후보 — 골라서 복사 */}
              {Array.isArray(result.sentences) && result.sentences.length > 0 && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-gray-900 mb-1">한 문장 평어 후보</h3>
                  <p className="text-xs text-gray-500 mb-3">마음에 드는 문장을 눌러 복사하세요. 여러 개를 골라 합쳐 써도 좋아요.</p>
                  <ul className="space-y-2">
                    {result.sentences.map((sent, i) => (
                      <li key={i}>
                        <button
                          onClick={() => copy(sent, `s${i}`)}
                          className="w-full text-left text-sm text-gray-800 bg-gray-50 hover:bg-primary/10 border border-gray-200 rounded-lg px-3 py-2.5 transition-colors flex items-start justify-between gap-2 group"
                        >
                          <span className="leading-relaxed break-keep">{sent}</span>
                          <span className="text-[11px] text-gray-400 group-hover:text-primary whitespace-nowrap mt-0.5">
                            {copied === `s${i}` ? '✓ 복사됨' : '복사'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(result.strengths || result.growth) && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
                  <h3 className="text-sm font-bold text-blue-900 mb-2">💡 교사 참고용 메모</h3>
                  {result.strengths && <p className="text-sm text-blue-900 mb-1"><strong>강점:</strong> {result.strengths}</p>}
                  {result.growth && <p className="text-sm text-blue-900"><strong>성장:</strong> {result.growth}</p>}
                </div>
              )}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 leading-relaxed">
                ⚠️ 이 평어는 AI가 만든 <strong>초안</strong>이에요. 학생을 가장 잘 아는 선생님이 사실과 다른 부분을 고치고,
                실제 관찰한 내용을 더해 완성해주세요. AI 초안을 그대로 생기부에 입력하지 마세요.
              </div>
              <button
                onClick={generate}
                disabled={generating}
                className="text-sm text-gray-500 underline hover:text-gray-700"
              >
                {generating ? '다시 만드는 중...' : '다른 표현으로 다시 만들기'}
              </button>
            </div>
          )}
        </main>
      </div>
    </>
  )
}

function RecordCard({ title, badge, text, onCopy, copied, highlight }) {
  return (
    <div className={`bg-white rounded-2xl p-5 shadow-sm ${highlight ? 'border-2 border-primary/30' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          {title}
          {badge && <span className="text-[11px] font-normal text-gray-400">{badge}</span>}
        </h3>
        <button
          onClick={onCopy}
          className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg font-medium text-gray-700 transition-colors"
        >
          {copied ? '✓ 복사됨' : '복사'}
        </button>
      </div>
      <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-keep">{text}</p>
    </div>
  )
}
