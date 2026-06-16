import { useEffect } from 'react'
import { useRouter } from 'next/router'
import '../styles/globals.css'
import Footer from '../components/Footer'
import VersionChecker from '../components/VersionChecker'
import { purgeLegacyApiKey } from '../lib/gemini'
import { logError } from '../lib/errorLog'
import { Analytics } from '@vercel/analytics/react'

export default function App({ Component, pageProps }) {
  const router = useRouter()

  // 키 서버격리(step153~): 과거 버전이 localStorage에 남긴 API 키 1회성 제거
  useEffect(() => {
    purgeLegacyApiKey()
  }, [])

  // 전역 에러 수집(step155): 잡히지 않은 JS 에러 / Promise 거부를 error_logs에 기록
  useEffect(() => {
    if (typeof window === 'undefined') return

    // 🆕 확장프로그램(메타마스크 등) 노이즈 필터 — js_error 경로에만 적용.
    // 보수적 원칙: 우리 앱 진짜 에러(504/ai_call/api_error 등)는 절대 거르지 않음. (미탐 > 오탐)
    const APP_MARKERS = ['status 5', '파싱 실패', 'TIMEOUT', 'ai_call', 'Gemini', '응답']
    const EXTENSION_ORIGINS = [
      'chrome-extension://', 'moz-extension://', 'safari-web-extension://',
      'safari-extension://', 'ms-browser-extension://',
    ]
    const NOISE_PHRASES = [
      'Failed to connect to MetaMask',
      'Cannot redefine property: ethereum',
      'Cannot set property ethereum',
    ]
    const isExtensionNoise = (msg, source) => {
      const m = msg || ''
      // 1) 우리 앱 표지가 있으면 출처 불문 무조건 보존 (오탐 방지)
      if (APP_MARKERS.some(w => m.includes(w))) return false
      // 2) 출처(filename/stack)가 확장프로그램 origin이면 노이즈로 판단
      const s = source || ''
      if (EXTENSION_ORIGINS.some(o => s.includes(o))) return true
      // 3) 알려진 전체 문구면 노이즈 (단어 단독 매칭 금지 — 전체 문구만)
      if (NOISE_PHRASES.some(p => m.includes(p))) return true
      return false
    }

    const onError = (event) => {
      const msg = event?.error?.message || event?.message || '알 수 없는 오류'
      const source = event?.filename || event?.error?.stack || ''
      if (isExtensionNoise(msg, source)) return
      logError({
        page: router.pathname,
        errorType: 'js_error',
        message: msg,
        context: event?.filename ? { filename: String(event.filename).slice(0, 200), lineno: event.lineno } : null,
      })
    }
    const onRejection = (event) => {
      const reason = event?.reason
      const msg = (reason && (reason.message || String(reason))) || 'unhandledrejection'
      const source = (reason && reason.stack) || ''
      if (isExtensionNoise(msg, source)) return
      logError({ page: router.pathname, errorType: 'js_error', message: msg })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [router.pathname])

  return (
    <>
      <Component {...pageProps} />
      <Footer />
      {/* 🆕 새 버전 자동 감지 — 배포 나가면 사용자에게 새로고침 안내 */}
      <VersionChecker />
      <Analytics />
    </>
  )
}
