import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { saveApiKey as saveLocal, deleteApiKey as deleteLocal } from '../lib/gemini'

export default function ApiKeyManager({ classId, onChange }) {
  const [savedKey, setSavedKey] = useState('')
  const [inputKey, setInputKey] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (classId) loadKey()
    else setLoading(false)
  }, [classId])

  const loadKey = async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from('classes').select('api_key').eq('id', classId).maybeSingle()
      const k = data?.api_key || ''
      setSavedKey(k)
      // 로컬에도 저장 (학생들이 쓸 때를 위해)
      if (k) saveLocal(k)
      else deleteLocal()
      onChange?.(k)
    } catch(e) {
      console.error('API 키 로드 실패:', e)
    }
    setLoading(false)
  }

  const startEdit = () => {
    setInputKey('')
    setShowInput(true)
  }

  const cancelEdit = () => {
    setInputKey('')
    setShowInput(false)
  }

  const save = async () => {
    const key = inputKey.trim()
    if (!key) return alert('API 키를 입력해주세요')
    if (!key.startsWith('AIza')) {
      return alert('Gemini API 키는 "AIza" 로 시작해요. 다시 확인해주세요.')
    }

    try {
      const { error } = await supabase.from('classes').update({ api_key: key }).eq('id', classId)
      if (error) throw error
      
      setSavedKey(key)
      saveLocal(key) // 로컬에도
      setInputKey('')
      setShowInput(false)
      onChange?.(key)
      alert('API 키 저장 완료!\n학급의 모든 학생이 이 키를 사용합니다.')
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
  }

  const remove = async () => {
    if (!confirm('정말 API 키를 삭제하시겠어요?\n\n삭제하면 학생들이 AI 피드백을 받을 수 없어요!')) return
    try {
      const { error } = await supabase.from('classes').update({ api_key: null }).eq('id', classId)
      if (error) throw error
      
      setSavedKey('')
      deleteLocal()
      setInputKey('')
      setShowInput(false)
      onChange?.('')
    } catch(e) {
      alert('삭제 실패: ' + e.message)
    }
  }

  const hasKey = !!savedKey
  const masked = savedKey ? savedKey.slice(0, 6) + '...' + savedKey.slice(-4) : ''

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="text-sm text-gray-500">API 키 정보 로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="font-bold text-gray-900">🔑 학급 Gemini API 키</h3>
          <p className="text-xs text-gray-500 mt-1">
            {hasKey ? '✅ 등록됨 (학급 모든 학생이 사용)' : '⚠️ 미등록 (학생들이 AI 피드백 못 받음)'}
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
            placeholder="AIza... 로 시작하는 키 붙여넣기"
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
          <div className="text-xs text-gray-600 space-y-1 bg-yellow-50 border border-yellow-200 p-3 rounded">
            <p className="font-semibold">⚠️ 학급 단위 저장 안내</p>
            <p>• 한 번 저장하면 학급의 모든 학생이 이 키로 AI를 사용해요</p>
            <p>• 학생들에게는 키가 보이지 않아요 (자동 처리)</p>
            <p>• 무료 한도(분당 30회)는 학급 전체가 공유합니다</p>
          </div>
        </div>
      )}
    </div>
  )
}
