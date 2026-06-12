// ============================================
// AI 글쓰기 도우미 챗봇 (학생용)
// ============================================
// 교사가 학급 설정에서 켰을 때만 글쓰기 화면에 나타남.
// 글을 대신 써주지 않고 생각을 이끄는 질문·힌트만 제공.
// 학생당 하루 5회 제한 (Gemini 무료 한도 보호).
// ============================================
import { useState, useRef, useEffect } from 'react'
import { callAI } from '../lib/aiClient'
import { supabase } from '../lib/supabase'

const DAILY_LIMIT = 5

export default function TutorChat({ topic, currentText, studentName, userId, grade }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])  // {role:'user'|'assistant', text}
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [usedCount, setUsedCount] = useState(0)
  const [usageLoaded, setUsageLoaded] = useState(false)
  const scrollRef = useRef(null)

  const today = () => new Date().toISOString().slice(0, 10)

  // 오늘 사용량 로드
  useEffect(() => {
    if (!open || !userId || usageLoaded) return
    ;(async () => {
      try {
        const { data } = await supabase.from('tutor_chat_usage')
          .select('count').eq('user_id', userId).eq('used_date', today()).maybeSingle()
        setUsedCount(data?.count || 0)
      } catch (e) {}
      setUsageLoaded(true)
    })()
  }, [open, userId, usageLoaded])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  const remaining = DAILY_LIMIT - usedCount
  const canAsk = remaining > 0 && !loading

  const bumpUsage = async () => {
    const next = usedCount + 1
    setUsedCount(next)
    try {
      await supabase.from('tutor_chat_usage')
        .upsert({ user_id: userId, used_date: today(), count: next }, { onConflict: 'user_id,used_date' })
    } catch (e) {}
  }

  const send = async () => {
    const q = input.trim()
    if (!q || !canAsk) return
    setInput('')
    const newMessages = [...messages, { role: 'user', text: q }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const gradeLabel = grade ? `초등학교 ${grade}학년` : '초등학교 고학년'
      const history = newMessages.slice(-6).map(m =>
        `${m.role === 'user' ? '학생' : '도우미'}: ${m.text}`
      ).join('\n')

      // 🔒 프롬프트는 서버에서 구성
      const answer = await callAI('tutorChat', {
        gradeLabel,
        topicTitle: topic?.title,
        topicDescription: topic?.description,
        currentText,
        history,
      })
      setMessages([...newMessages, { role: 'assistant', text: (answer || '').trim() || '음, 다시 한 번 물어봐 줄래요?' }])
      await bumpUsage()
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', text: '앗, 지금은 도와주기 어려워요. 잠시 후 다시 시도해 주세요.' }])
    }
    setLoading(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 bg-primary text-white rounded-full shadow-lg px-4 py-3 text-sm font-semibold hover:bg-primary-dark flex items-center gap-2">
        🤖 글쓰기 도우미
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[90vw] max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col" style={{ height: '70vh', maxHeight: '520px' }}>
      {/* 헤더 */}
      <div className="flex items-center justify-between p-3 border-b border-gray-100 bg-primary-light rounded-t-2xl">
        <div>
          <h4 className="font-bold text-sm text-primary-dark">🤖 글쓰기 도우미</h4>
          <p className="text-[11px] text-primary-dark/70">오늘 {remaining}번 더 물어볼 수 있어요</p>
        </div>
        <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-800 text-lg px-2">✕</button>
      </div>

      {/* 대화 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 leading-relaxed">
            글을 쓰다 막혔나요? 편하게 물어봐요!<br/>
            <span className="text-gray-400">
              예) "어떻게 시작해야 할지 모르겠어요" · "이 다음에 뭘 써야 할까요?" · "더 자세히 쓰려면 어떻게 해요?"
            </span><br/><br/>
            <span className="text-amber-700">💡 도우미는 글을 대신 써주지 않아요. 생각을 도와줄 뿐이에요!</span>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-keep ${
              m.role === 'user' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-800'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-500 rounded-2xl px-3 py-2 text-sm">생각 중... 🤔</div>
          </div>
        )}
      </div>

      {/* 입력 */}
      <div className="p-3 border-t border-gray-100">
        {remaining <= 0 ? (
          <p className="text-xs text-center text-gray-500 py-2">
            오늘은 도우미를 다 썼어요. 내일 다시 만나요! 🌙<br/>
            <span className="text-gray-400">스스로 더 써보는 것도 좋은 연습이에요</span>
          </p>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send() }}
              placeholder="궁금한 걸 물어봐요"
              disabled={loading}
              className="flex-1 p-2 border border-gray-200 rounded-lg text-sm"
            />
            <button
              onClick={send}
              disabled={!canAsk || !input.trim()}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-40">
              보내기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
