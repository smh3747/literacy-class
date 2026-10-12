// 📚 step619: 우리 반 글 모음 — 클라이언트 공용 호출(학생·교사 화면이 같은 서버 API를 같은 방식으로 부른다).
//   accessToken은 현재 세션에서 꺼내 본문으로만 보낸다(supply-adopt 호출 관행).

async function call(supabase, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const accessToken = session?.access_token
  if (!accessToken) throw new Error('로그인이 필요해요')
  const res = await fetch('/api/peer-share', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, ...body }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new Error(data?.error || '글 모음을 불러오지 못했어요')
  return data
}

// 목록. 학생: { ok, enabled, locked?, showScore, items:[{key, nickname, essay, score?, mine}] }
//       교사: { ok, enabled, showScore, items:[{submissionId, userId, score, attempt, source}], autoIds, excludedAutoIds, addedIds }
export function fetchPeerShare(supabase, topicId) {
  return call(supabase, { topicId, action: 'list' })
}

// 교사: 글 하나를 보이게(show=true → 추가 또는 제외 해제) / 안 보이게(show=false → 제외 또는 추가 해제). 갱신된 교사 목록 반환.
export function setPeerShare(supabase, topicId, submissionId, show) {
  return call(supabase, { topicId, submissionId, action: show ? 'show' : 'hide' })
}

// step621: 학생 "🙋 선생님께 알리기" → create_notification 인자(순수). type은 CHECK 11종 고정이라 'message' 재사용(step530 관행).
//   본문 미포함, 학생은 번호만, 친구 글은 닉네임으로 식별(학생 응답에 작성자 id가 없어 링크는 주제 단위).
export function peerShareNotifyArgs({ teacherId, number, topicId, nickname }) {
  if (!teacherId || !topicId) return null
  const who = number ? `${number}번 학생` : '학생'
  return {
    p_recipient: teacherId,
    p_type: 'message',
    p_title: `📚 ${who}이 친구 글을 선생님께 알렸어요`,
    p_body: `'${String(nickname || '친구').trim()}' 친구 글이에요. 우리 반 글 모음에서 확인해 주세요.`,
    p_link: `/teacher/submissions?topic=${topicId}`,
  }
}
