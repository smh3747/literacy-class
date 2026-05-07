import { useState, useEffect } from 'react'
import Link from 'next/link'
import { loadApiKey, saveApiKey, deleteApiKey } from '../lib/gemini'

export default function ApiKeyManager({ onChange }) {
  const [savedKey, setSavedKey] = useState('') // 실제 저장된 키
  const [inputKey, setInputKey] = useState('') // 입력창의 임시 값
  const [showInput, setShowInput] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    const k = loadApiKey()
    setSavedKey(k)
    onChange?.(k)
  }, [])

  const startEdit = () => {
    setInputKey('') // ★ 입력창 비우기 (이전 키 안 보이게)
    setShowInput(true)
  }

  const cancelEdit = () => {
    setInputKey('')
    setShowInput(false)
  }

  const save = () => {
    const key = inputKey.trim()
    if (!key) {
      alert('API 키를 입력해주세요')
      return
    }
    if (!key.startsWith('AIza')) {
      alert('Gemini API 키는 "AIza" 로 시작해요. 다시 확인해주세요.')
      return
    }
    saveApiKey(key)
    setSavedKey(key) // ★ 저장된 키 즉시 갱신
    setInputKey('')
    setShowInput(false)
    onChange?.(key)
    alert('API 키 저장 완료!')
  }

  const remove = () => {
    if (!confirm('정말 API 키를 삭제하시겠어요?\n\n공용 PC라면 반드시 삭제해주세요!')) return
    deleteApiKey()
    setSavedKey('')
    setInputKey('')
    setShowInput(false)
    onChange?.('')
  }

  const hasKey = !!savedKey
  const masked = savedKey ? savedKey.slice(0, 6) + '...' + savedKey.slice(-4) : ''

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="font-bold text-gray-900">🔑 Gemini API 키</h3>
          <p className="text-xs text-gray-500 mt-1">
            {hasKey ? '✅ 등록됨' : '⚠️ 미등록 (AI 기능 사용 불가)'}
          </p>
        </div>
        <Link href="/api-key-guide" target="_blank" className="text-xs text-primary hover:underline">
          발급 방법 →
        </Link>
      </div>

      {hasKey && !showInput ? (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <code className="flex-1 min-w-0 bg-gray-50 px-3 py-2 rounded text-xs text-gray-600 break-all">
            {showKey ? savedKey : masked}
          </code>
          <button onClick={() => setShowKey(!showKey)} className="text-xs px-2 py-2 border border-gray-200 rounded hover:bg-gray-50">
            {showKey ? '🙈' : '👁️'}
          </button>
          <button onClick={startEdit} className="text-xs px-3 py-2 border border-gray-200 rounded hover:bg-gray-50">
            변경
          </button>
          <button onClick={remove} className="text-xs px-3 py-2 border border-red-200 text-red-600 rounded hover:bg-red-50">
            삭제
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {hasKey && (
            <div className="text-xs text-blue-700 bg-blue-50 p-2 rounded">
              💡 새 API 키를 입력하면 기존 키가 교체됩니다
            </div>
          )}
          <input
            type="password"
            placeholder="AIza... 로 시작하는 새 키 붙여넣기"
            value={inputKey}
            onChange={e => setInputKey(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-lg text-sm font-mono"
            autoComplete="off"
          />
          <div className="flex gap-2">
            {hasKey && (
              <button onClick={cancelEdit} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">
                취소
              </button>
            )}
            <button onClick={save} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium">
              저장
            </button>
          </div>
          <p className="text-xs text-gray-500">
            💡 키는 본인 브라우저에만 저장됩니다 (서버 X). 공용 PC라면 사용 후 삭제!
          </p>
        </div>
      )}
    </div>
  )
}
