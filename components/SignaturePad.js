// 서명 캔버스 (네이티브, 라이브러리 0) — 부모 동의 등에서 재사용.
// pages/consent/[classCode].js 인라인 정의에서 추출한 컴포넌트.
// Pointer Events로 마우스·터치·펜 통합, touch-action:none으로 스크롤 차단,
// devicePixelRatio 스케일로 선명하게. 획이 있을 때만 onChange(dataURL), 지우면 onChange('').
// initialValue(dataURL) 주면 초기화 직후 그 서명을 그려 넣는다 (스텝 왕복 시 서명 유지용).
import { useEffect, useRef } from 'react'

export default function SignaturePad({ onChange, initialValue }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const hasDrawn = useRef(false)
  const last = useRef({ x: 0, y: 0 })

  // 캔버스 초기화 (클라이언트에서만)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1f2937'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)  // 흰 배경(투명 PNG 방지)

    // 이전 서명 복원 (스텝 왕복 시) — 흰 배경 위에 그려 넣고 '그린 상태'로 표시
    if (initialValue) {
      const img = new window.Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height)
        hasDrawn.current = true
      }
      img.src = initialValue
    }
  }, [])

  const posOf = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const start = (e) => {
    e.preventDefault()
    drawing.current = true
    last.current = posOf(e)
    try { canvasRef.current.setPointerCapture?.(e.pointerId) } catch {}
  }
  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = posOf(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    hasDrawn.current = true
  }
  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    if (hasDrawn.current) onChange(canvasRef.current.toDataURL('image/png'))
  }
  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    hasDrawn.current = false
    onChange('')
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full border border-gray-300 rounded-lg bg-white"
        style={{ height: 160, touchAction: 'none', maxWidth: 600 }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      <div className="flex justify-between items-center mt-1">
        <span className="text-[11px] text-gray-400">위 칸에 보호자 서명을 해주세요</span>
        <button type="button" onClick={clear} className="text-xs text-gray-500 hover:text-gray-700 underline">지우기</button>
      </div>
    </div>
  )
}
