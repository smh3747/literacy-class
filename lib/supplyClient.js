// 🌏 step611: 전국 챌린지 클라이언트 공용 호출 — 교사 홈·주제 관리가 같은 서버 API를 같은 방식으로 부른다.
//   accessToken은 현재 세션에서 꺼내 본문으로만 보낸다(기존 supply-adopt 호출 관행).

async function tokenOf(supabase) {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

// 오늘 발행분 등록(/api/supply-adopt). force=true는 교사 원클릭(토글 무관), false는 토글 ON 학급의 lazy 등록.
//   반환: { ok, adopted: [{id, title}], reason? }. 실패는 throw(호출부가 alert 여부 결정).
export async function adoptTodaySupply(supabase, { force = false } = {}) {
  const accessToken = await tokenOf(supabase)
  if (!accessToken) throw new Error('로그인이 필요해요')
  const res = await fetch('/api/supply-adopt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(force ? { accessToken, force: true } : { accessToken }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.error || '등록에 실패했어요')
  return data
}

// 발행된 전국 주제 목록(/api/supply-list). 실패하면 throw.
export async function fetchSupplyList(supabase) {
  const accessToken = await tokenOf(supabase)
  if (!accessToken) throw new Error('로그인이 필요해요')
  const res = await fetch('/api/supply-list', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.error || '전국 주제를 불러오지 못했어요')
  return Array.isArray(data.items) ? data.items : []
}

// 공유 추천 로그 → 원 주제의 설명·평가 기준·최소 글자 수(/api/topic-source).
//   원 주제가 없으면(삭제·미등록) null. 그 밖의 실패는 throw.
export async function fetchTopicSource(supabase, logId) {
  const accessToken = await tokenOf(supabase)
  if (!accessToken) throw new Error('로그인이 필요해요')
  const res = await fetch('/api/topic-source', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, logId }),
  })
  if (res.status === 404) return null
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.error || '원 주제를 불러오지 못했어요')
  return data.source || null
}
