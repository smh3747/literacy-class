// step632: 전국 소개 상태 조회(교사 화면) — peerShareClient 관행(세션 토큰을 본문으로)
export async function fetchShowcaseStatus(supabase, topicId) {
  const { data: { session } } = await supabase.auth.getSession()
  const accessToken = session?.access_token
  if (!accessToken) throw new Error('로그인이 필요해요')
  const res = await fetch('/api/showcase-status', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, topicId }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.error || '전국 소개 상태를 불러오지 못했어요')
  return data   // { ok, challenge, items, counts }
}
