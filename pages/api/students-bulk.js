import { createClient } from '@supabase/supabase-js'
import { generateUniqueNickname } from '../../lib/nickname'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { students, classId } = req.body
  if (!Array.isArray(students) || !classId) return res.status(400).json({ error: '잘못된 요청' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  // 학급 내 기존 닉네임 한 번에 조회 (중복 방지)
  let usedNicknames = []
  try {
    const { data: existing } = await supabase.from('profiles')
      .select('nickname').eq('class_id', classId).eq('role', 'student')
    usedNicknames = (existing || []).map(p => p.nickname).filter(Boolean)
  } catch(e) { /* nickname 컬럼 없으면 무시 */ }

  const results = { success: [], failed: [] }

  for (const s of students) {
    try {
      if (!s.username || !s.realname) {
        results.failed.push({ ...s, error: '아이디/이름 누락' })
        continue
      }

      const email = `${s.username}@writing.class`
      const password = '1234' // 초기 비밀번호

      // 가입
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) {
        if (error.message.includes('already')) {
          results.failed.push({ ...s, error: '이미 가입된 아이디' })
        } else {
          results.failed.push({ ...s, error: error.message })
        }
        continue
      }

      // 새 닉네임 생성 (이번 배치에서 중복 안 되게)
      let nickname = null
      try {
        nickname = generateUniqueNickname(usedNicknames)
        usedNicknames.push(nickname) // 다음 학생 위해 추가
      } catch(e) {}

      // profile 추가
      const profileData = {
        id: data.user.id,
        username: s.username,
        realname: s.realname,
        role: 'student',
        class_id: classId
      }
      if (s.number !== undefined && s.number !== null && s.number !== '') {
        profileData.number = String(s.number).trim()
      }
      if (nickname) profileData.nickname = nickname

      const { error: profErr } = await supabase.from('profiles').insert(profileData)

      if (profErr) {
        results.failed.push({ ...s, error: 'profile: ' + profErr.message })
      } else {
        results.success.push({ ...s, nickname })
      }
    } catch(e) {
      results.failed.push({ ...s, error: e.message })
    }
  }

  return res.status(200).json(results)
}
