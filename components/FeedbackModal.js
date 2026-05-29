import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function FeedbackModal({ onClose }) {
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    if (content.trim().length < 5) return alert('의견을 자세히 써주세요!')
    setSubmitting(true)
    try {
      // 로그인 상태면 작성자 ID 첨부 (와이프 피드백 2번: 누가 줬는지 추적)
      const { data: { user } } = await supabase.auth.getUser()
      const payload = { content: content.trim() }
      if (user?.id) payload.user_id = user.id

      const { error } = await supabase.from('feedback').insert(payload)
      if (error) throw error
      setDone(true)
      setTimeout(() => onClose(), 1500)
    } catch(e) {
      alert('전송 실패: ' + e.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        {done ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">✨</div>
            <h3 className="text-lg font-bold text-gray-900">감사합니다!</h3>
            <p className="text-sm text-gray-600 mt-2">소중한 의견을 잘 받았어요</p>
          </div>
        ) : (
          <>
            <h3 className="text-lg font-bold mb-2">의견 보내기</h3>
            <p className="text-sm text-gray-600 mb-4">
              불편한 점, 개선 제안 등을 자유롭게 보내주세요.
            </p>
            <textarea
              className="w-full p-3 border border-gray-200 rounded-lg text-sm"
              rows="5"
              placeholder="여기에 내용을 입력해주세요..."
              value={content}
              onChange={e => setContent(e.target.value)}
              disabled={submitting}
            />
            <div className="flex gap-2 mt-4">
              <button onClick={onClose} disabled={submitting} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">
                취소
              </button>
              <button onClick={submit} disabled={submitting} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50">
                {submitting ? '보내는 중...' : '보내기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
