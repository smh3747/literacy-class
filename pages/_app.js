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

    const onError = (event) => {
      const msg = event?.error?.message || event?.message || '알 수 없는 오류'
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
