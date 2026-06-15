import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import SchoolAutocomplete from './SchoolAutocomplete'

export default function ProfileEditModal({ user, onClose, onUpdate }) {
  const [realname, setRealname] = useState('')
  const [school, setSchool] = useState('')
  const [schoolCode, setSchoolCode] = useState('')      // step163: 표준학교코드
  const [schoolRegion, setSchoolRegion] = useState('')  // step163: 시도교육청명
  const [classNameInput, setClassNameInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (user) {
      setRealname(user.realname || '')
      setSchool(user.school || '')
      setSchoolCode(user.school_code || '')
      setSchoolRegion(user.school_region || '')
    }
    loadClassName()
  }, [user])

  const loadClassName = async () => {
    if (!user?.class_id) return
    const { data } = await supabase.from('classes').select('name').eq('id', user.class_id).maybeSingle()
    if (data) setClassNameInput(data.name || '')
  }

  const submit = async () => {
    setError('')
    if (!realname.trim()) return setError('이름을 입력해주세요')
    if (!school.trim()) return setError('학교명을 입력해주세요')
    if (!classNameInput.trim()) return setError('학급 이름을 입력해주세요')

    setLoading(true)
    try {
      // profiles 업데이트
      const { error: pErr } = await supabase.from('profiles').update({
        realname: realname.trim(),
        school: school.trim(),
        school_code: schoolCode || null,
        school_region: schoolRegion || null
      }).eq('id', user.id)
      if (pErr) throw pErr

      // classes 이름 + 학교코드 업데이트 (학교별 그룹화/학생 상속 정합성)
      if (user.class_id) {
        const { error: cErr } = await supabase.from('classes').update({
          name: classNameInput.trim(),
          school: school.trim(),
          school_code: schoolCode || null
        }).eq('id', user.class_id)
        if (cErr) throw cErr
      }

      setSuccess(true)
      onUpdate?.()
      setTimeout(() => onClose(), 1500)
    } catch(e) {
      setError(e.message || '저장 실패')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
        {success ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">✅</div>
            <h3 className="text-lg font-bold">정보 수정 완료!</h3>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">✏️ 내 정보 수정</h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">이름</label>
                <input type="text" value={realname} onChange={e => setRealname(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">학교명</label>
                <SchoolAutocomplete
                  value={school}
                  onChange={({ school: s, school_code, school_region }) => {
                    setSchool(s); setSchoolCode(school_code || ''); setSchoolRegion(school_region || '')
                  }}
                  placeholder="학교명 입력 후 목록에서 선택"
                />
                <p className="text-xs text-gray-500 mt-1">
                  💡 목록에서 고르면 아이디·비밀번호 찾기가 정확해져요. 안 나오면 직접 입력해도 돼요.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">학급 이름</label>
                <input type="text" value={classNameInput} onChange={e => setClassNameInput(e.target.value)}
                  placeholder="예: 5학년 1반"
                  className="w-full p-3 border border-gray-200 rounded-lg" />
              </div>
              <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                💡 아이디는 변경할 수 없어요 (보안상)
              </div>
              {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
              <div className="flex gap-2 pt-2">
                <button onClick={onClose} disabled={loading} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">취소</button>
                <button onClick={submit} disabled={loading} className="flex-1 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {loading ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
