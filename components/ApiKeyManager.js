import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { saveApiKey as saveLocal, deleteApiKey as deleteLocal } from '../lib/gemini'

export default function ApiKeyManager({ classId, onChange, openSignal }) {
  const [savedKey, setSavedKey] = useState('')
  const [inputKey, setInputKey] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)  // 🆕 카드 열고 닫기 (키 등록되어 있으면 기본 닫힘)

  useEffect(() => {
    if (classId) loadKey()
    else setLoading(false)
  }, [classId])

  // 키 로드 후 — 미등록이면 자동으로 열어둠 (선생님이 바로 등록할 수 있게)
  useEffect(() => {
    if (!loading && !savedKey) setOpen(true)
  }, [loading, savedKey])

  // 🆕 외부(셋업 체크리스트)에서 열기 신호 받으면 펼침
  useEffect(() => {
    if (openSignal) setOpen(true)
  }, [openSignal])

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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 헤더 — 클릭하면 열고 닫힘 */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full p-5 flex items-center justify-between hover:bg-gray-50 transition text-left">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 flex items-center gap-2 flex-wrap">
            🔑 학급 Gemini API 키
            {hasKey ? (
              <span className="text-xs font-normal bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                ✅ 등록됨
              </span>
            ) : (
              <span className="text-xs font-normal bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                ⚠️ 미등록 — AI 채점 불가
              </span>
            )}
          </h3>
          {!open && (
            <p className="text-xs text-gray-500 mt-1">
              {hasKey ? '클릭하면 키 확인·변경·삭제' : '클릭하면 API 키 등록 (학생들이 AI 피드백 받으려면 필요)'}
            </p>
          )}
        </div>
        <span className="text-gray-400 text-sm ml-2 flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {/* 펼친 영역 */}
      {open && (
      <div className="px-5 pb-5">
      <div className="flex items-center justify-end mb-2">
        <Link href="/api-key-guide" target="_blank" className="text-xs text-primary hover:underline">
          발급 방법 →
        </Link>
      </div>

      {hasKey && !showInput ? (
        <div className="flex items-center gap-2 flex-wrap">
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
        <div className="space-y-2">
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
          <div className="text-xs space-y-1 bg-red-50 border border-red-200 p-3 rounded">
            <p className="font-semibold text-red-900">🚨 반드시 개인 Gmail 계정으로 발급한 키만 사용!</p>
            <p className="text-red-800">• 학교/회사/교육청 계정 키는 Google이 차단해서 작동 안 해요</p>
            <p className="text-red-800">• 키가 AIza로 시작 + 개인 @gmail.com 계정인지 확인</p>
          </div>
          <div className="text-xs text-gray-600 space-y-1 bg-yellow-50 border border-yellow-200 p-3 rounded">
            <p className="font-semibold">📌 학급 단위 저장 안내</p>
            <p>• 한 번 저장하면 학급의 모든 학생이 이 키로 AI를 사용해요</p>
            <p>• 학생들에게는 키가 보이지 않아요 (자동 처리)</p>
            <p>• 무료 한도는 학급 전체가 공유합니다 (계정마다 다름)</p>
          </div>
        </div>
      )}

      {hasKey && !showInput && (
        <>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
              ⚠️ 학생이 "한도 초과(429)" 오류를 받았나요?
            </summary>
            <div className="mt-2 bg-blue-50 border border-blue-200 rounded p-3 text-blue-900 space-y-1.5 leading-relaxed">
              <p className="font-semibold">💡 우선 확인할 점</p>
              <p>우리 앱은 한도 도달 시 <strong>자동으로 다른 모델로 전환</strong>되도록 만들어져 있어요. 일부 학생만 일시적으로 영향을 받았을 수 있어요.</p>

              <p className="pt-1.5 font-semibold">🩹 그래도 안 되면</p>
              <p>한국 시간 <strong>오후 5시</strong>에 자동으로 한도가 리셋돼요. 그 이후 다시 시도해주세요.</p>

              <p className="text-xs text-gray-600 pt-1.5">
                📌 학생 글은 자동 저장되니 안심하세요. 다음날 그대로 이어쓸 수 있어요.
              </p>
            </div>
          </details>

          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
              🔒 학생 개인정보 보호 안내 (꼭 읽어주세요)
            </summary>
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-3 text-amber-900 space-y-1.5 leading-relaxed">
              <p className="font-semibold">Google이 학생 글을 학습에 활용할 수 있어요</p>
              <p>무료 등급(Free Tier) API 키를 사용하면, Google의 정책에 따라 학생들이 작성한 글이 AI 모델 학습에 활용될 수 있어요.</p>

              <p className="pt-1.5 font-semibold">📌 학생들에게 지도해주세요</p>
              <p>학생 글에 다음 정보는 절대 쓰지 않도록 안내해주세요:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>본명, 주소, 전화번호, 이메일</li>
                <li>가족 구성원의 실명이나 직업</li>
                <li>비밀번호나 SNS 계정</li>
                <li>학교명, 학급 정보</li>
              </ul>
              <p className="text-xs text-amber-800 pt-1.5">
                ✅ 학생 글쓰기 화면에는 이 안내가 이미 자동 표시됩니다.
              </p>
            </div>
          </details>
        </>
      )}
      </div>
      )}
    </div>
  )
}
