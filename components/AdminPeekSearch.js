// 관리자 빠른 엿보기 검색 — step648
//
// "학교·반·번호 또는 선생님 이름"을 2자 이상 입력하면 300ms 디바운스 뒤 /api/admin-peek-search(관리자 전용)를
// 호출해 후보(교사: 학교·반·이름 / 학생: 학교·반·번호·닉네임)를 보여주고, 고르면 새 탭으로 엿보기(step633)를 연다.
// SchoolAutocomplete(step163)의 입력·디바운스·경쟁 응답 폐기·키보드 이동 관행을 그대로 따른다.

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

export default function AdminPeekSearch({ className }) {
  const [value, setValue] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [highlight, setHighlight] = useState(-1)
  const boxRef = useRef(null)
  const reqId = useRef(0)

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    const q = value.trim()
    if (q.length < 2) { setResults([]); setOpen(false); setLoading(false); setError(null); return }
    setLoading(true)
    const id = ++reqId.current
    const t = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const resp = await fetch('/api/admin-peek-search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: session?.access_token, q }),
        })
        const data = await resp.json().catch(() => ({}))
        if (id !== reqId.current) return
        if (!resp.ok) { setError(data?.error || '검색에 실패했어요'); setResults([]); setOpen(true); return }
        setError(null)
        setResults(Array.isArray(data?.items) ? data.items : [])
        setHighlight(-1)
        setOpen(true)
      } catch {
        if (id !== reqId.current) return
        setError('검색에 실패했어요'); setResults([]); setOpen(true)
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [value])

  const pick = (item) => {
    if (!item?.url) return
    window.open(item.url, '_blank', 'noopener')
    setOpen(false)
  }

  const handleKey = (e) => {
    if (open && results.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); return }
      if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); pick(results[highlight]); return }
    }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className={`relative ${className || ''}`} ref={boxRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        placeholder="🔍 학교·반·번호 또는 선생님 이름"
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        autoComplete="off"
        aria-label="빠른 엿보기 검색"
      />
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-auto">
          {loading && <div className="px-3 py-2 text-sm text-gray-400">찾는 중...</div>}
          {!loading && error && <div className="px-3 py-2 text-sm text-red-600">{error}</div>}
          {!loading && !error && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">일치하는 학급·학생이 없어요</div>
          )}
          {!loading && !error && results.map((item, i) => (
            <button
              type="button"
              key={`${item.kind}-${item.id}`}
              onClick={() => pick(item)}
              onMouseEnter={() => setHighlight(i)}
              title={item.kind === 'teacher' ? '선생님 화면 엿보기(새 탭, 읽기 전용)' : '학생 화면 엿보기(새 탭, 읽기 전용)'}
              className={`block w-full text-left px-3 py-2 hover:bg-blue-50 ${i === highlight ? 'bg-blue-50' : ''}`}>
              <span className={`text-[10px] px-1.5 py-0.5 rounded mr-2 ${item.kind === 'teacher' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                {item.kind === 'teacher' ? '선생님' : '학생'}
              </span>
              <span className="text-sm text-gray-900">{item.label}</span>
              <span className="text-xs text-gray-400 ml-2">👁 새 탭</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
