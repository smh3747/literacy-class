import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

export default function QrCodeModal({ classCode, className, onClose }) {
  const canvasRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!classCode) return
    // 가입 URL 생성: 사이트 origin + /student/login?code=XXX&mode=signup
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const signupUrl = `${origin}/student/login?code=${classCode}&mode=signup`
    setUrl(signupUrl)

    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, signupUrl, {
        width: 256,
        margin: 2,
        color: { dark: '#1f2937', light: '#ffffff' }
      })
    }
  }, [classCode])

  const downloadQr = () => {
    if (!canvasRef.current) return
    const link = document.createElement('a')
    link.download = `학급_${classCode}_QR.png`
    link.href = canvasRef.current.toDataURL()
    link.click()
  }

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch(e) {}
  }

  const printQr = () => {
    if (!canvasRef.current) return
    const dataUrl = canvasRef.current.toDataURL()
    const win = window.open('', '_blank')
    win.document.write(`
      <html>
        <head><title>${className || classCode} QR</title></head>
        <body style="margin: 0; padding: 40px; text-align: center; font-family: sans-serif;">
          <h1 style="font-size: 28px;">${className || '우리 학급'}</h1>
          <p style="font-size: 16px; color: #555;">아래 QR을 카메라로 찍거나 코드를 입력하세요</p>
          <img src="${dataUrl}" style="max-width: 400px; margin: 20px auto;" />
          <div style="font-size: 32px; font-family: monospace; letter-spacing: 8px; font-weight: bold;">${classCode}</div>
          <p style="font-size: 14px; color: #888; margin-top: 30px;">${url}</p>
        </body>
      </html>
    `)
    win.document.close()
    setTimeout(() => win.print(), 500)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">📱 학급 가입 QR코드</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 flex flex-col items-center">
          <canvas ref={canvasRef} className="rounded-lg" />
          <div className="mt-3 text-center">
            <div className="text-2xl font-mono font-bold tracking-widest">{classCode}</div>
            <p className="text-xs text-gray-600 mt-2">학생들이 QR을 찍으면 학급 코드가 자동 입력돼요</p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex gap-2">
            <button onClick={downloadQr}
              className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark">
              💾 이미지 다운로드
            </button>
            <button onClick={printQr}
              className="flex-1 py-2 border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary-light">
              🖨️ 인쇄용 보기
            </button>
          </div>
          <button onClick={copyUrl}
            className="w-full py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">
            {copied ? '✅ 복사됨!' : '🔗 가입 링크 복사'}
          </button>
        </div>

        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
          <p className="font-semibold mb-1">💡 사용 방법</p>
          <p>1. 이미지로 다운로드해서 학급 채팅방/안내장에 공유</p>
          <p>2. 또는 인쇄용 보기로 출력해서 교실에 부착</p>
          <p>3. 학생이 QR 스캔 → 학급 코드 자동 입력된 가입 화면</p>
        </div>
      </div>
    </div>
  )
}
