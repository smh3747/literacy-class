import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function PasswordChangeModal({ onClose, onSuccess }) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const submit = async () => {
    setError('')
    if (!currentPw || !newPw || !confirmPw) {
      return setError('모든 항목을 입력해주세요')
    }
    if (newPw.length < 6) {
      return setError('새 비밀번호는 6자 이상이어야 해요')
    }
    if (newPw !== confirmPw) {
      return setError('새 비밀번호가 일치하지 않아요')
    }
    if (currentPw === newPw) {
      return setError('현재 비밀번호와 같은 비밀번호로 변경할 수 없어요')
    }

    setLoading(true)
    try {
      // 현재 비밀번호 확인 (재로그인으로 검증)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('로그인 정보를 찾을 수 없어요')
      
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPw
      })
      
      if (signInErr) {
        throw new Error('현재 비밀번호가 틀렸어요')
      }
      
      // 비밀번호 업데이트
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw })
      if (updateErr) throw updateErr

      // step161: 초기화 후 강제 변경 플래그 해제 등 후처리
      try { await onSuccess?.() } catch (e) { /* 후처리 실패해도 변경은 성공 */ }

      setSuccess(true)
      setTimeout(() => onClose(), 2000)
    } catch(e) {
      setError(e.message || '비밀번호 변경 실패')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        {success ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">🔐</div>
            <h3 className="text-lg font-bold text-gray-900">비밀번호 변경 완료!</h3>
            <p className="text-sm text-gray-600 mt-2">새 비밀번호로 로그인하세요</p>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">🔐 비밀번호 변경</h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">현재 비밀번호</label>
                <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-lg" autoComplete="current-password" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">새 비밀번호</label>
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                  placeholder="6자 이상"
                  className="w-full p-3 border border-gray-200 rounded-lg" autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">새 비밀번호 확인</label>
                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-lg" autoComplete="new-password" />
              </div>
              {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap">{error}</div>}
              <div className="flex gap-2 pt-2">
                <button onClick={onClose} disabled={loading} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">취소</button>
                <button onClick={submit} disabled={loading} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {loading ? '변경 중...' : '변경하기'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
