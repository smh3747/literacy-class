import { useState, useEffect } from 'react'
import Link from 'next/link'
import { loadApiKey, saveApiKey, deleteApiKey } from '../lib/gemini'

export default function ApiKeyManager({ onChange }) {
  const [apiKey, setApiKey] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [hasKey, setHasKey] = useState(false)

  useEffect(() => {
    const k = loadApiKey()
    setApiKey(k)
    setHasKey(!!k)
    onChange?.(k)
  }, [])

  const save = () => {
    if (!apiKey.trim().startsWith('AIza')) {
      alert('Gemini API 키는 "AIza" 로 시작해요. 다시 확인해주세요.')
      return
    }
    saveApiKey(apiKey.trim())
    setHasKey(true)
    setShowInput(false)
    onChange?.(apiKey.trim())
    alert('API 키 저장 완료!')
  }

  const remove = () => {
    if (!confirm('정말 API 키를 삭제하시겠어요?\n\n공용 PC라면 반드시 삭제해주세요!')) return
    deleteApiKey()
    setApiKey('')
    setHasKey(false)
    onChange?.('')
  }

  const masked = apiKey ? apiKey.slice(0, 6) + '...' + apiKey.slice(-4) : ''

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
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 bg-gray-50 px-3 py-2 rounded text-xs text-gray-600">
            {showKey ? apiKey : masked}
          </code>
          <button onClick={() => setShowKey(!showKey)} className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50">
            {showKey ? '🙈' : '👁️'}
          </button>
          <button onClick={() => setShowInput(true)} className="text-xs px-3 py-2 border border-gray-200 rounded hover:bg-gray-50">
            변경
          </button>
          <button onClick={remove} className="text-xs px-3 py-2 border border-red-200 text-red-600 rounded hover:bg-red-50">
            삭제
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <input
            type="password"
            placeholder="AIza... 로 시작하는 키 붙여넣기"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-lg text-sm font-mono"
          />
          <div className="flex gap-2">
            {showInput && (
              <button onClick={() => { setShowInput(false); setApiKey(loadApiKey()); }} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">
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
