// step676: ⓘ 설명 풍선 — 마우스를 올리거나, 누르거나(터치 화면), 키보드로 초점을 주면 보인다.
//   기존 title 속성은 터치 화면에서 안 뜨고 마우스에서도 늦게 떠서 "설명이 안 보인다"는 문제가 있었다.
//   표가 overflow-hidden 상자 안에 있어 잘리지 않도록 화면 기준(fixed) 위치로 띄운다.
import { useState, useRef, useEffect, useCallback } from 'react'

const BOX_W = 240
const GAP = 6

export default function InfoTip({ text, label = '설명 보기' }) {
  const [pos, setPos] = useState(null)   // null이면 닫힘
  const btnRef = useRef(null)
  const pinnedRef = useRef(false)        // 눌러서 연 것(마우스가 떠나도 유지)

  const place = useCallback(() => {
    const el = btnRef.current
    if (!el || typeof window === 'undefined') return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    const left = Math.max(8, Math.min(r.left + r.width / 2 - BOX_W / 2, vw - BOX_W - 8))
    const below = r.bottom + 120 < vh   // 아래 공간이 모자라면 위로
    setPos(below ? { left, top: r.bottom + GAP } : { left, bottom: vh - r.top + GAP })
  }, [])
  const close = useCallback(() => { pinnedRef.current = false; setPos(null) }, [])

  useEffect(() => {
    if (!pos) return
    const onDown = (e) => { if (btnRef.current && !btnRef.current.contains(e.target)) close() }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pos, close])

  if (!text) return null
  return (
    <>
      <button type="button" ref={btnRef} aria-label={label} aria-expanded={!!pos}
        className="inline-flex items-center justify-center align-middle w-5 h-5 -my-1 text-gray-400 hover:text-gray-700 cursor-help select-none font-normal"
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') place() }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !pinnedRef.current) setPos(null) }}
        onFocus={place}
        onBlur={() => { if (!pinnedRef.current) setPos(null) }}
        onClick={(e) => {
          e.stopPropagation()
          if (pinnedRef.current) { close(); return }
          pinnedRef.current = true
          place()
        }}>
        ⓘ
      </button>
      {pos && (
        <span role="tooltip"
          style={{ position: 'fixed', width: BOX_W, zIndex: 1000, ...pos }}
          className="block bg-gray-800 text-white text-xs leading-relaxed font-normal text-left whitespace-normal break-keep rounded-lg px-3 py-2 shadow-lg pointer-events-none">
          {text}
        </span>
      )}
    </>
  )
}
