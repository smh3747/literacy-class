import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { students, classId } = req.body
  if (!Array.isArray(students) || !classId) return res.status(400).json({ error: '잘못된 요청' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const supabase = createClient(supabaseUrl, supabaseAnonKey)

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

      // profile 추가 (number 컬럼이 DB에 있으면 저장됨, 없으면 무시)
      const profileData = {
        id: data.user.id,
        username: s.username,
        realname: s.realname,
        role: 'student',
        class_id: classId
      }
      // number가 있으면 추가 (문자열로 저장 - "01", "10" 등 보존)
      if (s.number !== undefined && s.number !== null && s.number !== '') {
        profileData.number = String(s.number).trim()
      }

      const { error: profErr } = await supabase.from('profiles').insert(profileData)

      if (profErr) {
        results.failed.push({ ...s, error: 'profile: ' + profErr.message })
      } else {
        results.success.push({ ...s })
      }
    } catch(e) {
      results.failed.push({ ...s, error: e.message })
    }
  }

  return res.status(200).json(results)
}
