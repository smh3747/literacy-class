import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

export default function QrCodeModal({ classCode, className, onClose }) {
  const canvasRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!classCode) return
    // 가입/로그인 통합 URL: /student/login?code=XXX
    // - 학급 코드 자동 입력
    // - 이미 가입한 학생은 로그인, 처음이면 가입 탭으로 전환 가능
    //
    // ⚠️ origin 결정 우선순위:
    // 1. NEXT_PUBLIC_SITE_URL (Vercel 환경변수로 설정한 정식 도메인)
    // 2. window.location.origin (선생님이 보고 있는 페이지의 origin)
    //
    // Preview 배포에서 QR 만들면 Vercel 로그인이 뜨므로,
    // Production URL을 환경변수로 고정하는 것을 권장.
    let origin = ''
    if (process.env.NEXT_PUBLIC_SITE_URL) {
      origin = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
    } else if (typeof window !== 'undefined') {
      origin = window.location.origin
    }
    const loginUrl = `${origin}/student/login?code=${classCode}`
    setUrl(loginUrl)

    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, loginUrl, {
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
          <h3 className="text-lg font-bold">📱 학급 QR코드</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 flex flex-col items-center">
          <canvas ref={canvasRef} className="rounded-lg" />
          <div className="mt-3 text-center w-full">
            <div className="text-2xl font-mono font-bold tracking-widest">{classCode}</div>
            <p className="text-xs text-gray-600 mt-2">학생들이 QR을 찍으면 로그인 화면으로 이동해요</p>
            {url && (
              <p className="text-[10px] text-gray-400 mt-1 break-all px-2">{url}</p>
            )}
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
            {copied ? '✅ 복사됨!' : '🔗 링크 복사'}
          </button>
        </div>

        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
          <p className="font-semibold mb-1">💡 사용 방법</p>
          <p>• 이미지 다운로드 → 단톡방/안내장에 공유, 또는 출력해서 교실에 부착</p>
          <p>• 학생이 QR 스캔 → 학급 코드가 자동 입력된 로그인 화면</p>
          <p>• 처음 학생은 "가입" 탭으로, 기존 학생은 그대로 로그인</p>
        </div>

        {/* Preview URL 경고 (선생님이 잘못된 URL로 QR 만들었을 때) */}
        {url && /vercel\.app/.test(url) && /-git-|-[a-z0-9]{8,}\./i.test(url) && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-900">
            <p className="font-bold mb-1">⚠️ 주의: Preview URL이에요!</p>
            <p>지금 QR이 가리키는 URL이 Vercel Preview 배포인 것 같아요.</p>
            <p className="mt-1">학생들이 스캔하면 Vercel 인증 화면이 떠서 접속 불가능해요.</p>
            <p className="mt-1 font-semibold">→ 정식 사이트 주소(literacy-class.vercel.app 등)로 다시 접속해서 QR을 만들어주세요.</p>
          </div>
        )}
      </div>
    </div>
  )
}
