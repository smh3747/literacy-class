import { useEffect } from 'react'
import '../styles/globals.css'
import Footer from '../components/Footer'
import VersionChecker from '../components/VersionChecker'
import { purgeLegacyApiKey } from '../lib/gemini'

export default function App({ Component, pageProps }) {
  // 키 서버격리(step153~): 과거 버전이 localStorage에 남긴 API 키 1회성 제거
  useEffect(() => {
    purgeLegacyApiKey()
  }, [])

  return (
    <>
      <Component {...pageProps} />
      <Footer />
      {/* 🆕 새 버전 자동 감지 — 배포 나가면 사용자에게 새로고침 안내 */}
      <VersionChecker />
    </>
  )
}
