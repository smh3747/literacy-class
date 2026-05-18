// 닉네임 변경 모달
// 학생 본인 또는 선생님이 학생 닉네임을 변경할 때 사용
//
// props:
//   - targetUserId: 변경할 사용자의 id (없으면 현재 로그인 사용자)
//   - currentNickname: 현재 닉네임
//   - classId: 학급 ID (중복 검사용)
//   - displayName: 모달 제목에 표시할 이름 (예: 학생 이름)
//   - onClose: 닫기 콜백
//   - onSuccess: 성공 시 콜백 (새 닉네임 전달)

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { generateUniqueNickname } from '../lib/nickname'

export default function NicknameChangeModal({
  targetUserId, currentNickname, classId, displayName,
  onClose, onSuccess
}) {
  const [nickname, setNickname] = useState(currentNickname || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [usedNicknames, setUsedNicknames] = useState([])
  const [generating, setGenerating] = useState(false)

  // 학급 내 다른 학생들의 닉네임 미리 가져오기 (중복 검사용)
  useEffect(() => {
    if (!classId) return
    ;(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, nickname').eq('class_id', classId).eq('role', 'student')
      const used = (data || [])
        .filter(p => p.id !== targetUserId && p.nickname)
        .map(p => p.nickname)
      setUsedNicknames(used)
    })()
  }, [classId, targetUserId])

  // 랜덤 닉네임 생성
  const tryRandom = () => {
    setGenerating(true)
    try {
      const nick = generateUniqueNickname(usedNicknames)
      setNickname(nick)
      setError('')
    } catch(e) {}
    setGenerating(false)
  }

  // 저장
  const save = async () => {
    const trimmed = nickname.trim()
    if (!trimmed) {
      setError('닉네임을 입력해주세요')
      return
    }
    if (trimmed.length < 2) {
      setError('닉네임은 2자 이상이어야 해요')
      return
    }
    if (trimmed.length > 30) {
      setError('닉네임은 30자 이하로 해주세요')
      return
    }
    // 부적절한 문자 (이모지는 허용하되, 줄바꿈 등은 차단)
    if (/[\n\r\t]/.test(trimmed)) {
      setError('줄바꿈이나 탭은 사용할 수 없어요')
      return
    }
    // 중복 검사 (자기 자신 제외)
    if (usedNicknames.includes(trimmed)) {
      setError('이미 같은 반 친구가 쓰고 있는 닉네임이에요. 다른 걸로 해주세요!')
      return
    }
    // 같은 닉네임이면 그냥 닫기
    if (trimmed === currentNickname) {
      onClose()
      return
    }

    setSaving(true)
    try {
      const { error: err } = await supabase.from('profiles')
        .update({ nickname: trimmed })
        .eq('id', targetUserId)
      if (err) throw err
      if (onSuccess) onSuccess(trimmed)
      onClose()
    } catch(e) {
      setError('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">🎭 닉네임 변경</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        {displayName && (
          <p className="text-sm text-gray-600 mb-3">대상: <strong>{displayName}</strong></p>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900 leading-relaxed">
          <p className="font-bold mb-1">💡 닉네임 안내</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>친구들에게 본명 대신 보여지는 별명이에요</li>
            <li>같은 반 친구와 같은 닉네임은 쓸 수 없어요</li>
            <li>나쁜 말, 욕설은 쓰지 말아주세요</li>
            <li>2~30자 이내로 적어주세요</li>
          </ul>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">새 닉네임</label>
            <input
              type="text"
              value={nickname}
              onChange={e => { setNickname(e.target.value); setError('') }}
              placeholder="예: 푸른 토끼, 별빛 고양이"
              maxLength={30}
              className="w-full p-3 border border-gray-200 rounded-lg text-sm"
              autoFocus
            />
            <div className="flex justify-between items-center mt-1">
              <button onClick={tryRandom} disabled={generating}
                className="text-xs text-purple-600 hover:text-purple-900 underline">
                🎲 랜덤 추천
              </button>
              <span className="text-xs text-gray-400">{nickname.length}/30</span>
            </div>
          </div>

          {currentNickname && (
            <p className="text-xs text-gray-500">
              현재: <span className="font-medium">{currentNickname}</span>
            </p>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose}
            className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200">
            취소
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark disabled:opacity-50">
            {saving ? '저장 중...' : '변경하기'}
          </button>
        </div>
      </div>
    </div>
  )
}
