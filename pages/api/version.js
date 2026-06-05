// 🆕 현재 배포된 빌드 ID 반환 — 클라이언트 자동 최신화 감지용
// 클라이언트의 NEXT_PUBLIC_BUILD_ID(번들에 박힌 값)와 비교해서
// 다르면 새 버전이 배포된 것

export default function handler(req, res) {
  // 캐시 절대 금지 — 항상 서버의 현재 빌드 ID
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.status(200).json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID || 'unknown' })
}
