// 관리자 빠른 엿보기 검색 API — step648 (관리자 전용, 읽기 전용)
//
// 입력: { accessToken, q }  — q는 "학교·반·번호 또는 선생님 이름"(공백으로 토큰 분리, 모든 토큰이 포함돼야 일치)
// 출력: { items: [{ kind:'teacher'|'student', id, label, url }] } 최대 20건(교사 먼저)
//   교사 url /teacher?as=<id>  · 학생 url /student?as=<id>  (step633 엿보기)
// 원칙: 검색어 2자 미만이면 빈 결과. 학생 실명은 반환하지 않음(번호·닉네임만). 교사 실명은 관리자 권한 범위.
//   후보는 서비스롤로 읽되 응답에는 표시 라벨·id·url만. admin-last-logins.js와 같은 인증 관행.

import { createClient } from '@supabase/supabase-js'

const MAX_ITEMS = 20
const MIN_LEN = 2
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
// PostgREST or() 필터에 넣는 토큰은 구분 문자(, ( ) . %)를 제거(문법 깨짐 방지). JS 쪽 토큰 대조는 원문 그대로.
const safeTok = (t) => t.replace(/[,().%*\\]/g, '')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { accessToken, q } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY가 없어요.' })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
  if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  const { data: me } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (!me || me.role !== 'admin') return res.status(403).json({ error: '관리자만 조회할 수 있어요' })

  const query = norm(q)
  if (query.length < MIN_LEN) return res.status(200).json({ items: [] })
  const tokens = query.split(' ').filter(Boolean)
  const matchAll = (hay) => { const h = norm(hay); return tokens.every(t => h.includes(t)) }

  try {
    const [{ data: teachers }, { data: classes }] = await Promise.all([
      admin.from('profiles').select('id, realname, school, role').in('role', ['teacher', 'admin']).is('deleted_at', null).limit(2000),
      admin.from('classes').select('id, name, grade, teacher_id').is('deleted_at', null).limit(2000),
    ])
    const tById = Object.fromEntries((teachers || []).map(t => [t.id, t]))
    const classesByTeacher = {}
    for (const c of classes || []) { (classesByTeacher[c.teacher_id] = classesByTeacher[c.teacher_id] || []).push(c) }
    const classLabel = (c) => [tById[c.teacher_id]?.school, c.name].filter(Boolean).join(' ')

    // 교사: 학교·담당 반 이름·실명으로 대조
    const teacherItems = (teachers || [])
      .filter(t => t.role === 'teacher' || t.role === 'admin')
      .filter(t => matchAll(`${t.school || ''} ${(classesByTeacher[t.id] || []).map(c => c.name).join(' ')} ${t.realname || ''}`))
      .map(t => ({
        kind: 'teacher', id: t.id,
        label: `${t.school || '학교 미상'} ${(classesByTeacher[t.id] || []).map(c => c.name).join('·') || ''} · ${t.realname || '이름 없음'} 선생님`.replace(/\s+·/, ' ·'),
        url: `/teacher?as=${t.id}`,
      }))
      .slice(0, MAX_ITEMS)

    // 학생: 라벨(학교 반)이 어느 토큰과라도 맞는 학급의 학생 + 번호/닉네임이 토큰과 맞는 학생 → JS에서 모든 토큰 대조
    const matchedClassIds = (classes || []).filter(c => tokens.some(t => norm(classLabel(c)).includes(t))).map(c => c.id).slice(0, 200)
    const orParts = []
    if (matchedClassIds.length > 0) orParts.push(`class_id.in.(${matchedClassIds.join(',')})`)
    for (const t of tokens.map(safeTok).filter(Boolean)) { orParts.push(`number.ilike.%${t}%`); orParts.push(`nickname.ilike.%${t}%`) }
    let studentItems = []
    if (orParts.length > 0 && teacherItems.length < MAX_ITEMS) {
      const { data: students } = await admin.from('profiles')
        .select('id, number, nickname, class_id')
        .eq('role', 'student').is('deleted_at', null)
        .or('is_hidden.is.null,is_hidden.eq.false')
        .or(orParts.join(','))
        .limit(400)
      const cById = Object.fromEntries((classes || []).map(c => [c.id, c]))
      studentItems = (students || [])
        .map(s => {
          const c = cById[s.class_id]
          const where = c ? classLabel(c) : '학급 미상'
          const numText = s.number ? `${s.number}번` : '번호 없음'
          return { s, where, numText, hay: `${where} ${numText} ${s.number || ''} ${s.nickname || ''}` }
        })
        .filter(x => matchAll(x.hay))
        .sort((a, b) => a.where.localeCompare(b.where, 'ko') || (parseInt(a.s.number) || 0) - (parseInt(b.s.number) || 0))
        .map(x => ({ kind: 'student', id: x.s.id, label: `${x.where} ${x.numText} · ${x.s.nickname || '닉네임 없음'}`, url: `/student?as=${x.s.id}` }))
    }

    const items = [...teacherItems, ...studentItems].slice(0, MAX_ITEMS)
    return res.status(200).json({ items, truncated: teacherItems.length + studentItems.length > MAX_ITEMS })
  } catch (e) {
    console.error('admin-peek-search 실패:', e?.message || e)
    return res.status(500).json({ error: '검색에 실패했어요' })
  }
}
