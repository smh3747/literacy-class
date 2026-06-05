import '../styles/globals.css'
import Footer from '../components/Footer'
import VersionChecker from '../components/VersionChecker'

export default function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <Footer />
      {/* 🆕 새 버전 자동 감지 — 배포 나가면 사용자에게 새로고침 안내 */}
      <VersionChecker />
    </>
  )
}
