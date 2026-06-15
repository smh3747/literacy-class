// 학교 자동완성 입력 — step163
//
// 학교명을 2글자 이상 입력하면 디바운스(300ms) 후 /api/school-search(NEIS 프록시)를
// 호출해 후보를 보여준다. 후보를 고르면 부모에게 { school, school_code, school_region }을
// 전달한다. NEIS 무응답/결과없음이면 자유 텍스트 직접 입력으로 우회한다(강제 금지).
//
// 부모는 value(학교명 문자열)와 onChange(payload)만 알면 된다.
//   - 직접 타이핑: onChange({ school: 입력값, school_code: null, school_region: null })
//   - 후보 선택:   onChange({ school: 공식명, school_code: 코드, school_region: 시도 })

import { useState, useEffect, useRef } from 'react'

export default function SchoolAutocomplete({ value, onChange, placeholder, onEnter, inputClassName }) {
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [noApi, setNoApi] = useState(false)
  const [highlight, setHighlight] = useState(-1)

  const boxRef = useRef(null)
  const justSelected = useRef(false) // 후보 선택 직후의 value 변경은 재검색하지 않음
  const firstRun = useRef(true)      // 최초 prefill된 value로는 자동 검색하지 않음
  const reqId = useRef(0)            // 경쟁 응답 무시용

  // 바깥 클릭 시 닫기
  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // 디바운스 검색
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      if ((value || '').trim()) return // 수정 화면 등 prefill 값으로는 자동 검색 안 함
    }
    if (justSelected.current) { justSelected.current = false; return }

    const q = (value || '').trim()
    if (q.length < 2) { setResults([]); setOpen(false); setLoading(false); return }

    setLoading(true)
    const id = ++reqId.current
    const t = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/school-search?q=${encodeURIComponent(q)}`)
        const data = await resp.json().catch(() => ({}))
        if (id !== reqId.current) return // 더 최신 요청이 진행 중이면 폐기
        setNoApi(data?.ok === false)
        setResults(Array.isArray(data?.schools) ? data.schools : [])
        setHighlight(-1)
        setOpen(true)
      } catch {
        if (id !== reqId.current) return
        setResults([]); setNoApi(true); setOpen(true)
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [value])

  const pick = (s) => {
    justSelected.current = true
    onChange({ school: s.name, school_code: s.code, school_region: s.region })
    setOpen(false)
    setResults([])
  }

  const handleType = (e) => {
    // 직접 타이핑하면 코드/지역은 초기화 (공식 선택과의 연결을 끊음)
    onChange({ school: e.target.value, school_code: null, school_region: null })
  }

  const handleKey = (e) => {
    if (open && results.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); return }
      if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); pick(results[highlight]); return }
      if (e.key === 'Escape') { setOpen(false); return }
    }
    if (e.key === 'Enter' && onEnter) onEnter(e)
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        type="text"
        value={value || ''}
        onChange={handleType}
        onKeyDown={handleKey}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        placeholder={placeholder || '학교명 2글자 이상 입력 (예: 하랑)'}
        className={inputClassName || 'w-full p-3 border border-gray-200 rounded-lg'}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
          {loading && <div className="px-3 py-2 text-xs text-gray-400">학교를 찾는 중...</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-500">
              {noApi
                ? '학교 검색을 잠시 쓸 수 없어요. 학교명을 직접 입력해주세요.'
                : '검색 결과가 없어요. 학교명을 직접 입력해도 돼요.'}
            </div>
          )}
          {!loading && results.map((s, i) => (
            <button
              type="button"
              key={s.code}
              onClick={() => pick(s)}
              onMouseEnter={() => setHighlight(i)}
              className={`block w-full text-left px-3 py-2 hover:bg-blue-50 ${i === highlight ? 'bg-blue-50' : ''}`}>
              <div className="text-sm font-medium text-gray-900">{s.name}</div>
              <div className="text-[11px] text-gray-500">{s.region}{s.address ? ` · ${s.address}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
