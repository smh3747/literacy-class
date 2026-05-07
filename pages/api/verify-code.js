export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { code, role } = req.body

  const ADMIN_CODE = process.env.ADMIN_SECRET_CODE
  const TEACHER_CODE = process.env.TEACHER_SECRET_CODE

  if (role === 'admin') {
    if (code !== ADMIN_CODE) return res.status(403).json({ error: '관리자 코드가 틀렸어요' })
  } else if (role === 'teacher') {
    if (code !== TEACHER_CODE) return res.status(403).json({ error: '교사 가입 코드가 틀렸어요' })
  } else {
    return res.status(400).json({ error: '잘못된 요청이에요' })
  }

  return res.status(200).json({ ok: true })
}
