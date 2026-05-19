import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import NicknameChangeModal from '../../components/NicknameChangeModal'

export default function StudentsPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadStatus, setUploadStatus] = useState(null)
  const [parsedStudents, setParsedStudents] = useState([])
  const [uploading, setUploading] = useState(false)
  // 아이디 prefix (예: "hr" → hr5101)
  const [idPrefix, setIdPrefix] = useState('')
  const [defaultPrefix, setDefaultPrefix] = useState('') // 학교 초성 기본값
  // 인라인 편집 상태
  const [editingNumbers, setEditingNumbers] = useState({}) // {studentId: number}
  const [editingUsernames, setEditingUsernames] = useState({}) // {parsedIdx: username} - 미리보기에서 개별 수정
  const [editingExistingUsernames, setEditingExistingUsernames] = useState({}) // {studentId: username} - 기존 학생 아이디 인라인 수정
  const [editingRealnames, setEditingRealnames] = useState({}) // {studentId: realname} - 학생 이름 인라인 수정
  const [savingId, setSavingId] = useState(null)
  // 숨김 학생 보기 토글
  const [showHidden, setShowHidden] = useState(false)
  // 닉네임 변경 모달 (선생님이 학생 닉네임 변경)
  const [editingNicknameStudent, setEditingNicknameStudent] = useState(null)
  // 선택된 학생 ID들 (체크박스 - 일괄 비번 초기화용)
  const [selectedStudentIds, setSelectedStudentIds] = useState(new Set())

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(id, name, code)').eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    // 학교명에서 기본 prefix 계산 (예: "한국초등학교" → "hgc")
    if (profile.school) {
      try {
        const { toInitialAlpha } = await import('../../lib/usernameGen')
        const core = profile.school.replace('초등학교', '초').replace('중학교', '중').replace('고등학교', '고')
        const def = toInitialAlpha(core)
        setDefaultPrefix(def)
        setIdPrefix(def) // 기본값
      } catch(e) {}
    }

    await loadStudents(profile.classes?.id)
    setLoading(false)
  }

  const loadStudents = async (classId) => {
    if (!classId) return
    const { data } = await supabase.from('profiles').select('*').eq('class_id', classId).eq('role', 'student').order('username')
    setStudents(data || [])
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 자동 아이디 생성 (prefix 기반)
  // prefix가 있으면 그걸 사용, 비어있으면 학교 초성 사용
  const buildUsername = (prefix, grade, classNum, number) => {
    const p = (prefix || '').trim().toLowerCase() || 'sch'
    const g = String(grade || '0').trim()
    const c = String(classNum || '0').trim()
    const n = String(number || '0').trim().padStart(2, '0')
    return `${p}${g}${c}${n}`
  }

  // prefix가 바뀌면 미리보기 학생들의 username 재생성
  const updatePrefixAndRegenerate = (newPrefix) => {
    setIdPrefix(newPrefix)
    // 자동 생성 학생들만 username 갱신
    setParsedStudents(prev => prev.map(s => {
      if (s._auto && s._grade && s._class && s.number) {
        return {
          ...s,
          username: buildUsername(newPrefix, s._grade, s._class, s.number)
        }
      }
      return s
    }))
    // 개별 편집 중인 것들 초기화
    setEditingUsernames({})
  }

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (!user?.school || !user.school.trim()) {
      alert('학교명이 등록되지 않았어요!\n선생님 메인 화면 → "✏️ 내 정보 수정"에서 학교명을 먼저 입력해주세요.')
      e.target.value = ''
      return
    }

    const fileName = file.name.toLowerCase()
    const isPdf = fileName.endsWith('.pdf') || file.type === 'application/pdf'
    const isExcel = fileName.match(/\.(xlsx|xls)$/)

    if (!isPdf && !isExcel) {
      alert(
        '❌ 인식할 수 없는 파일 형식이에요.\n\n' +
        '✅ 엑셀 (.xlsx, .xls) - 권장\n' +
        '✅ PDF (.pdf) - 텍스트 PDF만 가능\n\n' +
        '나이스 → [기본학적관리] → [명렬표 출력] → [엑셀 내려받기]'
      )
      e.target.value = ''
      return
    }

    setUploadStatus('📄 파일을 분석하는 중...')

    // PDF 처리
    if (isPdf) {
      try {
        const { parsePdfStudentList } = await import('../../lib/pdfParser')
        const pdfStudents = await parsePdfStudentList(file)

        if (pdfStudents.length === 0) {
          setUploadStatus(null)
          alert(
            '❌ PDF에서 학생 명단을 인식하지 못했어요.\n\n' +
            '가능한 원인:\n' +
            '· 이미지로 된 PDF (스캔본)\n' +
            '· 표 형식이 일반적인 나이스 명렬표와 다름\n\n' +
            '✅ 해결 방법:\n' +
            '나이스 → [엑셀 내려받기] 초록색 버튼으로 엑셀 파일을 받아 올려주세요.'
          )
          e.target.value = ''
          return
        }

        const currentPrefix = idPrefix || defaultPrefix
        const parsed = pdfStudents.map(s => ({
          number: s.number,
          realname: s.name,
          username: buildUsername(currentPrefix, s.grade, s.classNum, s.number),
          _auto: true,
          _grade: s.grade,
          _class: s.classNum
        }))

        setParsedStudents(parsed)
        setEditingUsernames({})

        const sample = parsed[0]
        setUploadStatus(
          `📋 PDF에서 ${parsed.length}명 인식 완료!\n` +
          `🆔 아이디 자동 생성됨 (예: ${sample?.username})\n` +
          `⚠️ PDF는 인식 정확도가 100%는 아니에요. 아래 명단을 꼭 확인해주세요!\n` +
          `💡 인식 오류가 있으면 개별 수정 가능합니다.`
        )
        return
      } catch(err) {
        setUploadStatus(null)
        alert(
          '❌ PDF 처리 실패: ' + err.message + '\n\n' +
          '엑셀 파일로 다시 시도해주세요.'
        )
        e.target.value = ''
        return
      }
    }

    // 엑셀 처리 (기존 로직)
    const XLSX = (await import('xlsx')).default || (await import('xlsx'))

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

        // 헤더 찾기
        const header = rows[0] || []
        const gradeIdx = header.findIndex(h => String(h).trim() === '학년')
        const classIdx = header.findIndex(h => String(h).trim() === '반')
        const numIdx = header.findIndex(h => String(h).includes('번호'))
        const nameIdx = header.findIndex(h => String(h).includes('성명') || String(h).includes('이름'))
        const idIdx = header.findIndex(h => String(h).includes('아이디'))

        const isNiceFormat = gradeIdx !== -1 && classIdx !== -1 && numIdx !== -1 && nameIdx !== -1
        const isOldFormat = nameIdx !== -1 && idIdx !== -1

        if (!isNiceFormat && !isOldFormat) {
          alert(
            '엑셀 형식을 인식할 수 없어요.\n\n' +
            '✅ 권장: 나이스 명렬표 (학년 | 반 | 번호 | 성명)\n' +
            '✅ 또는: 성명 + 아이디 컬럼이 있는 엑셀'
          )
          return
        }

        const parsed = []
        const currentPrefix = idPrefix || defaultPrefix

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          if (!row) continue

          if (isNiceFormat) {
            const name = row[nameIdx] ? String(row[nameIdx]).trim() : ''
            const grade = row[gradeIdx]
            const classNum = row[classIdx]
            const number = row[numIdx]
            if (!name || !grade || !classNum || !number) continue

            const username = buildUsername(currentPrefix, grade, classNum, number)

            parsed.push({
              number: String(number).trim(),
              realname: name,
              username,
              _auto: true,
              _grade: String(grade),
              _class: String(classNum)
            })
          } else {
            if (!row[nameIdx] || !row[idIdx]) continue
            parsed.push({
              number: row[numIdx] ? String(row[numIdx]).trim() : '',
              realname: String(row[nameIdx]).trim(),
              username: String(row[idIdx]).trim().toLowerCase()
            })
          }
        }

        setParsedStudents(parsed)
        setEditingUsernames({})

        if (isNiceFormat) {
          const sample = parsed[0]
          setUploadStatus(
            `📋 나이스 명렬표 인식: ${parsed.length}명\n` +
            `🆔 아이디 자동 생성됨 (예: ${sample?.username})\n` +
            `💡 아이디 앞부분(prefix)을 바꾸면 모두 한꺼번에 변경돼요. 개별 수정도 가능합니다.`
          )
        } else {
          setUploadStatus(`📋 ${parsed.length}명의 학생이 감지되었어요.`)
        }
      } catch(err) {
        alert('엑셀 파일 읽기 실패: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const submitBulk = async () => {
    if (parsedStudents.length === 0) return

    // 최종 아이디 결정: editingUsernames에 값이 있으면 그걸, 없으면 username 사용
    const finalStudents = parsedStudents.map((s, idx) => ({
      number: s.number,
      realname: s.realname,
      username: ((editingUsernames[idx] !== undefined ? editingUsernames[idx] : s.username) || '').trim().toLowerCase()
    }))

    // 유효성 검사
    const invalid = finalStudents.filter(s => !s.username || !/^[a-z0-9_-]+$/i.test(s.username))
    if (invalid.length > 0) {
      alert(
        `❌ 아이디 형식이 잘못된 학생이 있어요:\n\n` +
        invalid.slice(0, 5).map(s => `- ${s.realname}: "${s.username}"`).join('\n') +
        (invalid.length > 5 ? `\n... 외 ${invalid.length - 5}명` : '') +
        `\n\n아이디는 영문/숫자/_/-만 사용 가능해요.`
      )
      return
    }

    // 중복 체크 (같은 배치 안에서)
    const seen = new Set()
    const dupes = []
    finalStudents.forEach(s => {
      if (seen.has(s.username)) dupes.push(s.username)
      seen.add(s.username)
    })
    if (dupes.length > 0) {
      alert(`❌ 중복된 아이디가 있어요:\n${[...new Set(dupes)].join(', ')}\n\n각각 다르게 수정해주세요.`)
      return
    }

    if (!confirm(`${finalStudents.length}명을 일괄 등록할게요.\n\n초기 비밀번호는 모두 "123456" 입니다.\n진행할까요?`)) return

    setUploading(true)
    try {
      const res = await fetch('/api/students-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ students: finalStudents, classId: classInfo.id })
      })
      const result = await res.json()

      // 실패 명단 친절하게 변환
      const friendlyError = (errStr) => {
        if (!errStr) return '알 수 없는 오류'
        if (errStr.includes('이미 가입')) return '이미 가입된 아이디 (다른 학급/학교 학생일 수 있음)'
        if (errStr.includes('Password should be at least')) {
          const m = errStr.match(/at least (\d+)/)
          return `비밀번호 ${m ? m[1] : 6}자 이상 필요 (Supabase 정책)`
        }
        if (errStr.includes('Unable to validate email')) return '아이디 형식 오류 (영문/숫자만)'
        if (errStr.includes('아이디/이름 누락')) return '엑셀에 아이디 또는 이름이 비어 있음'
        return errStr
      }

      let msg = `✅ 성공: ${result.success.length}명\n❌ 실패: ${result.failed.length}명`

      if (result.failed.length > 0) {
        // 동일 사유 그룹핑
        const errorGroups = {}
        result.failed.forEach(f => {
          const reason = friendlyError(f.error)
          if (!errorGroups[reason]) errorGroups[reason] = []
          errorGroups[reason].push(`${f.realname}(${f.username})`)
        })
        msg += '\n\n📋 실패 사유:\n'
        for (const [reason, list] of Object.entries(errorGroups)) {
          msg += `\n[${reason}]\n - ${list.join(', ')}\n`
        }

        // 가장 흔한 케이스 안내
        const allAlreadyJoined = result.failed.every(f => (f.error || '').includes('이미 가입'))
        if (allAlreadyJoined) {
          msg += '\n💡 이미 가입된 학생들은 그대로 로그인하면 돼요!\n비밀번호를 모르면 학생 관리에서 🔑로 초기화하세요.'
        }
      }

      alert(msg)

      // 🆕 학급 로그인 안내 자동 설정 (학생 일괄 등록과 동시에)
      // 첫 학생의 학년/반 정보로 안내용 접두사 생성 (예: hg + 5 + 1 → hg51)
      try {
        if (result.success.length > 0) {
          const firstAuto = finalStudents.find(s => s._auto && s._grade && s._class)
          if (firstAuto) {
            const p = (idPrefix || '').trim().toLowerCase() || 'sch'
            const g = String(firstAuto._grade).trim()
            const c = String(firstAuto._class).trim()
            const hintPrefix = `${p}${g}${c}` // 학생들이 보는 접두사
            await supabase.from('classes').update({
              login_hint_enabled: true,
              login_username_prefix: hintPrefix,
              login_default_password: '123456',
              login_number_digits: 2
            }).eq('id', classInfo.id)
            console.log('✅ 학급 로그인 안내 자동 저장됨:', hintPrefix)
          }
        }
      } catch (e) {
        console.warn('학급 안내 자동 저장 실패 (학생 등록은 성공):', e)
      }

      setParsedStudents([])
      setEditingUsernames({})
      setUploadStatus(null)
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('일괄 등록 실패: ' + e.message)
    }
    setUploading(false)
  }

  // 비밀번호 초기화 (공란 = 123456, 입력값 = 그 값으로)
  const resetPassword = async (studentId, username, realname) => {
    const input = prompt(
      `🔐 "${realname}" 학생의 비밀번호 초기화\n\n` +
      `새 비밀번호를 입력하세요.\n` +
      `※ 그대로 [확인] 누르면 "123456"으로 초기화됩니다.\n` +
      `※ 6자 이상 입력 가능`,
      ''
    )
    if (input === null) return // 취소 버튼

    let newPassword = input.trim()
    if (newPassword === '') {
      newPassword = '123456'
    } else if (newPassword.length < 6) {
      alert('비밀번호는 6자 이상이어야 해요')
      return
    }

    if (!confirm(
      `다음 학생의 비밀번호를 "${newPassword}"로 초기화할까요?\n\n` +
      `학생: ${realname} (${username})\n\n` +
      `학생에게 이 비밀번호를 알려주고 로그인 후 변경하라고 안내해주세요.`
    )) return

    setSavingId(studentId)
    try {
      // 현재 로그인 세션의 access token 가져오기
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('로그인 세션이 만료됐어요. 다시 로그인해주세요.')
        setSavingId(null)
        return
      }

      const res = await fetch('/api/reset-student-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          newPassword,
          accessToken: session.access_token
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '초기화 실패')

      alert(
        `✅ 비밀번호 초기화 완료!\n\n` +
        `학생: ${realname}\n` +
        `새 비밀번호: ${newPassword}\n\n` +
        `학생에게 이 비밀번호를 전달해주세요.`
      )
    } catch(e) {
      // 친절한 에러 메시지 변환
      let msg = e.message || '알 수 없는 오류'
      if (msg.includes('Service Role Key') || msg.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        msg = '⚠️ Vercel 환경변수 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았어요.\n관리자에게 문의하세요.'
      } else if (msg.includes('Password should be at least')) {
        const m = msg.match(/at least (\d+)/)
        msg = `비밀번호는 ${m ? m[1] : 6}자 이상이어야 해요.`
      } else if (msg.includes('User not found')) {
        msg = '해당 학생 계정을 찾을 수 없어요.'
      } else if (msg.includes('rate limit') || msg.includes('429')) {
        msg = '잠시 후 다시 시도해주세요. (요청 한도 초과)'
      }
      alert('실패: ' + msg)
    }
    setSavingId(null)
  }

  // 🔐 선택한 학생들 비밀번호 일괄 초기화
  const resetPasswordsBulk = async () => {
    const targetIds = [...selectedStudentIds].filter(id => {
      const s = students.find(x => x.id === id)
      return s && !s.is_hidden
    })
    if (targetIds.length === 0) return alert('선택된 학생이 없어요 (숨김 학생은 제외돼요)')

    const input = prompt(
      `🔐 선택한 ${targetIds.length}명의 비밀번호를 일괄 초기화합니다.\n\n` +
      `새 비밀번호를 입력하세요.\n` +
      `※ 그대로 [확인] 누르면 "123456"으로 초기화됩니다.\n` +
      `※ 6자 이상 입력 가능`,
      ''
    )
    if (input === null) return

    let newPassword = input.trim()
    if (newPassword === '') newPassword = '123456'
    else if (newPassword.length < 6) {
      alert('비밀번호는 6자 이상이어야 해요')
      return
    }

    if (!confirm(
      `${targetIds.length}명의 비밀번호를 모두 "${newPassword}"로 초기화할까요?\n\n` +
      `학생들에게 이 비밀번호를 알려주고 로그인 후 변경하라고 안내해주세요.`
    )) return

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      alert('로그인 세션이 만료됐어요. 다시 로그인해주세요.')
      return
    }

    let success = 0, failed = 0
    const failedNames = []
    for (const studentId of targetIds) {
      try {
        const res = await fetch('/api/reset-student-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, newPassword, accessToken: session.access_token })
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || '실패')
        }
        success++
      } catch(e) {
        failed++
        const s = students.find(x => x.id === studentId)
        if (s) failedNames.push(s.realname)
      }
    }

    alert(
      `✅ 성공: ${success}명\n` +
      (failed > 0 ? `❌ 실패: ${failed}명 (${failedNames.join(', ')})\n\n` : '') +
      `새 비밀번호: ${newPassword}\n\n` +
      `학생들에게 이 비밀번호를 전달해주세요.`
    )
    setSelectedStudentIds(new Set())
  }

  // 🆔 학생 아이디 수정 (인라인)
  const saveUsername = async (studentId, originalUsername) => {
    const newUsername = (editingExistingUsernames[studentId] || '').trim().toLowerCase()
    if (!newUsername || newUsername === originalUsername) {
      // 변경 없음
      setEditingExistingUsernames(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
      return
    }

    // 형식 검증
    if (!/^[a-z0-9_]{3,20}$/.test(newUsername)) {
      alert('아이디는 영문 소문자, 숫자, 밑줄(_)만 사용 가능하고 3~20자여야 해요')
      return
    }

    // 중복 확인 (같은 학급 또는 전체)
    const duplicate = students.find(s => s.id !== studentId && s.username === newUsername)
    if (duplicate) {
      alert(`이미 사용 중인 아이디예요: ${duplicate.realname}`)
      return
    }

    if (!confirm(
      `학생 아이디를 변경할까요?\n\n` +
      `이전: ${originalUsername}\n` +
      `새 아이디: ${newUsername}\n\n` +
      `학생에게 새 아이디를 꼭 알려주세요!`
    )) return

    setSavingId(studentId)
    try {
      // 1) auth email 변경 필요 (가짜 이메일 구조: username@literacy.local)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('로그인 세션 만료')

      const res = await fetch('/api/update-student-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, newUsername, accessToken: session.access_token })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '아이디 변경 실패')

      alert(`✅ 아이디가 변경되었어요!\n\n새 아이디: ${newUsername}`)
      setEditingExistingUsernames(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('아이디 변경 실패: ' + (e.message || e))
    }
    setSavingId(null)
  }

  // 🆔 학생 이름 수정 (인라인)
  const saveRealname = async (studentId, originalName) => {
    const newName = (editingRealnames[studentId] || '').trim()
    if (!newName || newName === originalName) {
      setEditingRealnames(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
      return
    }

    if (newName.length < 1 || newName.length > 20) {
      alert('이름은 1~20자 사이로 입력해주세요')
      return
    }

    if (!confirm(
      `학생 이름을 변경할까요?\n\n` +
      `이전: ${originalName}\n` +
      `새 이름: ${newName}`
    )) return

    setSavingId(studentId)
    try {
      const { error } = await supabase.from('profiles')
        .update({ realname: newName })
        .eq('id', studentId)
      if (error) throw error

      setEditingRealnames(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('이름 변경 실패: ' + (e.message || e))
    }
    setSavingId(null)
  }

  // 학생 체크박스 토글
  const toggleStudentSelect = (id) => {
    setSelectedStudentIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 번호 인라인 편집 저장
  const saveNumber = async (studentId) => {
    const newNumber = (editingNumbers[studentId] || '').trim()
    setSavingId(studentId)
    try {
      const { error } = await supabase.from('profiles')
        .update({ number: newNumber || null })
        .eq('id', studentId)
      if (error) throw error
      // 로컬 상태 업데이트
      setStudents(prev => prev.map(s =>
        s.id === studentId ? { ...s, number: newNumber || null } : s
      ))
      // 편집 상태 클리어
      setEditingNumbers(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSavingId(null)
  }

  // 동의서 회신 체크 토글
  const toggleConsent = async (studentId, currentValue) => {
    const newValue = !currentValue
    setSavingId(studentId)
    try {
      const { error } = await supabase.from('profiles').update({
        consent_received: newValue,
        consent_received_at: newValue ? new Date().toISOString() : null
      }).eq('id', studentId)
      if (error) throw error
      setStudents(prev => prev.map(s =>
        s.id === studentId
          ? { ...s, consent_received: newValue, consent_received_at: newValue ? new Date().toISOString() : null }
          : s
      ))
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSavingId(null)
  }

  // 학생 숨김/복원 토글
  const toggleHidden = async (studentId, studentName, currentValue) => {
    const newValue = !currentValue
    if (newValue) {
      // 숨김 처리
      const reason = prompt(
        `🙈 "${studentName}" 학생을 숨김 처리할까요?\n\n` +
        `숨김 처리하면:\n` +
        `- 통계/그래프/제출 현황에서 제외됩니다\n` +
        `- 학생 본인은 여전히 로그인 가능 (데이터 보존)\n` +
        `- 언제든지 복원 가능합니다\n\n` +
        `사유를 입력해주세요 (선택, 예: 전출, 휴학 등):`,
        '전출'
      )
      if (reason === null) return // 취소

      setSavingId(studentId)
      try {
        const { error } = await supabase.from('profiles').update({
          is_hidden: true,
          hidden_at: new Date().toISOString(),
          hidden_reason: (reason || '').trim() || null
        }).eq('id', studentId)
        if (error) throw error
        await loadStudents(classInfo.id)
      } catch(e) {
        alert('실패: ' + e.message)
      }
      setSavingId(null)
    } else {
      // 복원
      if (!confirm(`"${studentName}" 학생을 다시 활성화할까요?`)) return
      setSavingId(studentId)
      try {
        const { error } = await supabase.from('profiles').update({
          is_hidden: false,
          hidden_at: null,
          hidden_reason: null
        }).eq('id', studentId)
        if (error) throw error
        await loadStudents(classInfo.id)
      } catch(e) {
        alert('실패: ' + e.message)
      }
      setSavingId(null)
    }
  }

  // 동의서 일괄 처리 (체크 / 해제)
  const bulkToggleConsent = async (newValue) => {
    const targets = students.filter(s => !s.is_hidden && s.consent_received !== newValue)
    if (targets.length === 0) {
      alert(newValue ? '이미 모든 학생이 회신 처리되어 있어요' : '회신 처리된 학생이 없어요')
      return
    }
    const action = newValue ? '회신 완료로 일괄 처리' : '미회신으로 일괄 해제'
    if (!confirm(`${targets.length}명의 동의서를 "${action}"할까요?`)) return

    setSavingId('bulk-consent')
    try {
      const now = new Date().toISOString()
      let success = 0, failed = 0
      for (const s of targets) {
        try {
          const { error } = await supabase.from('profiles').update({
            consent_received: newValue,
            consent_received_at: newValue ? now : null
          }).eq('id', s.id)
          if (error) throw error
          success++
        } catch(e) { failed++ }
      }
      alert(`✅ 성공: ${success}명${failed > 0 ? `\n❌ 실패: ${failed}명` : ''}`)
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('실패: ' + e.message)
    }
    setSavingId(null)
  }

  // 모든 학생 번호 일괄 저장 (편집 중인 것들만)
  const saveAllNumbers = async () => {
    const ids = Object.keys(editingNumbers)
    if (ids.length === 0) return alert('변경된 번호가 없어요')
    if (!confirm(`${ids.length}명의 번호를 저장할까요?`)) return

    let success = 0, failed = 0
    for (const id of ids) {
      try {
        const num = (editingNumbers[id] || '').trim()
        const { error } = await supabase.from('profiles')
          .update({ number: num || null }).eq('id', id)
        if (error) throw error
        success++
      } catch(e) { failed++ }
    }
    alert(`✅ 성공: ${success}명${failed > 0 ? `\n❌ 실패: ${failed}명` : ''}`)
    setEditingNumbers({})
    await loadStudents(classInfo.id)
  }

  // 학생 명단 엑셀 다운로드 (담임용 출력)
  const downloadStudentList = async () => {
    if (!students.length) return alert('등록된 학생이 없어요')

    const includeHidden = confirm(
      `👥 학생 명단을 엑셀로 다운로드할까요?\n\n` +
      `[확인] 활성 + 숨김 학생 모두 다운로드\n` +
      `[취소] 활성 학생만 다운로드 (전출생 제외)`
    )

    const reason = prompt(
      `📝 다운로드 사유를 입력해주세요 (감사용 기록):\n\n` +
      `예: "학생들에게 아이디 안내", "백업용", "학기말 정리" 등\n\n` +
      `※ 학생 개인정보가 포함된 파일이니 안전하게 관리해주세요.\n` +
      `※ 다운로드 후 사용 끝나면 즉시 파일을 삭제해주세요.`,
      ''
    )
    if (reason === null) return

    setSavingId('download')
    try {
      const XLSX = (await import('xlsx')).default || (await import('xlsx'))

      const targets = includeHidden ? [...students] : students.filter(s => !s.is_hidden)
      // 정렬: 활성 먼저, 번호순
      targets.sort((a, b) => {
        if (a.is_hidden !== b.is_hidden) return a.is_hidden ? 1 : -1
        const na = parseInt(a.number) || 999
        const nb = parseInt(b.number) || 999
        if (na !== nb) return na - nb
        return (a.realname || '').localeCompare(b.realname || '')
      })

      // 시트1: 학생 명단
      const sheet1Data = targets.map(s => ({
        '번호': s.number || '',
        '이름': s.realname || '',
        '아이디': s.username || '',
        '초기 비밀번호': '123456',
        '닉네임': s.nickname || '',
        '동의서 회신': s.consent_received ? '✓' : '',
        '상태': s.is_hidden ? `숨김${s.hidden_reason ? ' (' + s.hidden_reason + ')' : ''}` : '활성'
      }))
      const ws1 = XLSX.utils.json_to_sheet(sheet1Data)
      ws1['!cols'] = [
        { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 18 }
      ]

      // 시트2: 메타 정보
      const now = new Date()
      const dateStr = now.toLocaleString('ko-KR')
      const meta = [
        ['항목', '값'],
        ['다운로드 일시', dateStr],
        ['다운로드 사유', reason.trim() || '(미입력)'],
        ['학교', user?.school || '-'],
        ['학급', classInfo?.name || '-'],
        ['담임', user?.realname || '-'],
        ['전체 학생 수', String(targets.length)],
        ['활성 학생', String(targets.filter(s => !s.is_hidden).length)],
        ['숨김 학생', String(targets.filter(s => s.is_hidden).length)],
        ['', ''],
        ['※ 주의', '본 파일은 학생 개인정보를 포함합니다.'],
        ['', '안전하게 관리하시고, 사용 후 즉시 삭제해주세요.'],
        ['', '초기 비밀번호는 모든 학생이 동일하게 "123456"입니다.'],
        ['', '학생이 비밀번호를 변경한 경우 위 값과 다를 수 있습니다.']
      ]
      const ws2 = XLSX.utils.aoa_to_sheet(meta)
      ws2['!cols'] = [{ wch: 18 }, { wch: 50 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws1, '학생 명단')
      XLSX.utils.book_append_sheet(wb, ws2, '메타 정보')

      const fileName = `학생명단_${classInfo?.name || ''}_${now.toISOString().slice(0,10)}.xlsx`
      XLSX.writeFile(wb, fileName)
    } catch(e) {
      alert('다운로드 실패: ' + e.message)
    }
    setSavingId(null)
  }

  // 닉네임 없는 학생에게 일괄 부여
  const assignMissingNicknames = async () => {
    const targets = students.filter(s => !s.nickname && !s.is_hidden)
    if (targets.length === 0) {
      alert('모든 학생이 이미 닉네임을 가지고 있어요!')
      return
    }
    if (!confirm(
      `🎭 닉네임 없는 학생 ${targets.length}명에게 닉네임을 부여할까요?\n\n` +
      `예: "용감한 코끼리", "푸른 토끼" 등\n` +
      `학급 내 중복 없이 자동 생성됩니다.`
    )) return

    setSavingId('bulk-nickname')
    try {
      const { generateUniqueNickname } = await import('../../lib/nickname')
      // 현재 사용 중인 닉네임 수집
      const used = students.map(s => s.nickname).filter(Boolean)

      let success = 0, failed = 0
      for (const s of targets) {
        try {
          const nickname = generateUniqueNickname(used)
          used.push(nickname)
          const { error } = await supabase.from('profiles')
            .update({ nickname }).eq('id', s.id)
          if (error) throw error
          success++
        } catch(e) {
          failed++
        }
      }
      alert(`✅ 닉네임 부여 완료!\n성공: ${success}명${failed > 0 ? `\n❌ 실패: ${failed}명` : ''}`)
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('실패: ' + e.message)
    }
    setSavingId(null)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>학생 관리 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">학생 관리</h1>
          </div>

          {/* 학급 정보 */}
          {classInfo && (
            <div className="bg-primary-light border border-primary rounded-2xl p-4">
              <div className="text-sm text-primary-dark">
                <strong>{classInfo.name}</strong> · 학생 가입 코드: <span className="font-mono font-bold tracking-widest">{classInfo.code}</span>
              </div>
            </div>
          )}

          {/* 일괄 등록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold mb-2">📋 학급명렬표 일괄 등록</h3>
            <p className="text-sm text-gray-600 mb-3">
              <strong>나이스에서 다운받은 학급명렬표 엑셀(.xlsx)</strong>을 그대로 올리면 돼요.
              아이디는 자동으로 만들어지고, 초기 비밀번호는 모두 <strong>123456</strong>입니다.
            </p>

            {/* 나이스 다운로드 경로 안내 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-xs text-blue-900">
              <p className="font-bold mb-2">📍 나이스에서 명렬표 받는 방법</p>
              <ol className="list-decimal pl-5 space-y-1 leading-relaxed">
                <li>나이스 접속 → <strong>[기본학적관리]</strong> 메뉴</li>
                <li><strong>[명렬표 출력]</strong> 클릭</li>
                <li><strong>[조회]</strong> 클릭하여 우리 반 학생 목록 표시</li>
                <li>오른쪽 위 <strong className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded">[엑셀 내려받기]</strong> 초록색 버튼 클릭 (권장)</li>
                <li>다운로드된 파일을 아래에 업로드</li>
              </ol>
              <div className="mt-2 bg-white rounded p-2 space-y-1">
                <p>✅ <strong>엑셀 (.xlsx)</strong> - 가장 정확, 권장</p>
                <p>✅ <strong>PDF (.pdf)</strong> - 텍스트 PDF만 가능 (인식 후 결과 확인 필수)</p>
                <p className="text-red-700">❌ <strong>이미지 PDF (스캔본)</strong> - 인식 불가</p>
              </div>
            </div>

            {!user?.school && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm p-3 rounded-lg mb-3">
                ⚠️ 학교명이 등록되지 않았어요!<br/>
                메인 화면 → "✏️ 내 정보 수정"에서 학교명을 먼저 입력해주세요.
              </div>
            )}
            <div className="space-y-3">
              <label className="block">
                <span className="sr-only">엑셀 또는 PDF 파일 선택</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.pdf"
                  onChange={handleFile}
                  disabled={!user?.school}
                  className="w-full text-sm border border-gray-200 rounded-lg p-2 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-primary file:text-white disabled:opacity-50"
                />
              </label>
              {uploadStatus && (
                <div className="text-sm bg-blue-50 text-blue-900 p-3 rounded-lg whitespace-pre-line">{uploadStatus}</div>
              )}
              {parsedStudents.length > 0 && (
                <>
                  {/* prefix 일괄 변경 (자동 생성된 학생이 있을 때만) */}
                  {parsedStudents.some(s => s._auto) && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <label className="block text-sm font-medium text-blue-900 mb-1">
                        🆔 아이디 앞부분 (prefix) - 일괄 변경
                      </label>
                      <div className="flex gap-2 items-center flex-wrap">
                        <input
                          type="text"
                          value={idPrefix}
                          onChange={e => updatePrefixAndRegenerate(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                          placeholder="예: hr, abc, gildong"
                          className="flex-1 min-w-[120px] px-3 py-2 border border-blue-200 rounded text-sm font-mono"
                          maxLength="10"
                        />
                        {defaultPrefix && idPrefix !== defaultPrefix && (
                          <button
                            onClick={() => updatePrefixAndRegenerate(defaultPrefix)}
                            className="text-xs px-2 py-2 border border-blue-200 text-blue-700 rounded hover:bg-blue-100">
                            ↻ 기본값 ({defaultPrefix})
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-blue-700 mt-2">
                        💡 prefix를 바꾸면 모든 학생 아이디가 자동 변경돼요.
                        형식: <code className="font-mono bg-white px-1">[prefix][학년][반][번호 2자리]</code>
                        {parsedStudents[0]?._auto && (
                          <span> (예: <code className="font-mono bg-white px-1">{parsedStudents[0]?.username}</code>)</span>
                        )}
                      </p>
                    </div>
                  )}

                  <div className="bg-gray-50 rounded-lg p-3 max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left border-b">
                        <th className="py-1 px-2 w-14">번호</th>
                        <th className="py-1 px-2 w-24">이름</th>
                        <th className="py-1 px-2">아이디 (개별 수정 가능)</th>
                      </tr></thead>
                      <tbody>
                        {parsedStudents.map((s, i) => {
                          const editValue = editingUsernames[i] !== undefined ? editingUsernames[i] : s.username
                          const isEdited = editingUsernames[i] !== undefined && editingUsernames[i] !== s.username
                          return (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="py-1 px-2">{s.number}</td>
                              <td className="py-1 px-2">{s.realname}</td>
                              <td className="py-1 px-2">
                                <input
                                  type="text"
                                  value={editValue}
                                  onChange={e => setEditingUsernames(prev => ({
                                    ...prev,
                                    [i]: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')
                                  }))}
                                  className={`w-full px-2 py-1 text-xs font-mono border rounded ${
                                    isEdited ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                                  }`}
                                  maxLength="30"
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={submitBulk} disabled={uploading}
                    className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                    {uploading ? '등록 중...' : `📥 ${parsedStudents.length}명 일괄 등록`}
                  </button>
                </>
              )}
              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer hover:text-gray-700">📖 명렬표 형식 안내</summary>
                <div className="mt-2 p-3 bg-gray-50 rounded space-y-2">
                  <div>
                    <p className="font-semibold text-gray-700">✅ 권장: 나이스 학급명렬표</p>
                    <code className="block mt-1 font-mono text-[11px]">학년 | 반 | 번호 | 성명 | 비고</code>
                    <p className="mt-1">→ 아이디는 자동 생성: <strong>[학교초성][학년][반][번호]</strong></p>
                    <p>예: 한국초등학교 5학년 1반 1번 → <code className="font-mono">hgc5101</code></p>
                    <p className="mt-1 text-amber-700">학생들에게 본인 아이디 알려주는 것 잊지 마세요!</p>
                  </div>
                  <div className="pt-2 border-t border-gray-200">
                    <p className="font-semibold text-gray-700">✅ 또는: 아이디 직접 지정</p>
                    <code className="block mt-1 font-mono text-[11px]">학년 | 반 | 번호 | 성명 | 아이디 | 비고</code>
                    <p className="mt-1">아이디 컬럼이 있으면 그 값을 그대로 사용합니다.</p>
                  </div>
                </div>
              </details>
            </div>
          </div>

          {/* 등록된 학생 목록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-bold">
                👥 등록된 학생
                {(() => {
                  const active = students.filter(s => !s.is_hidden).length
                  const hidden = students.filter(s => s.is_hidden).length
                  const noNickname = students.filter(s => !s.is_hidden && !s.nickname).length
                  return (
                    <span className="ml-1">
                      ({active}명{hidden > 0 && <span className="text-gray-400"> · 숨김 {hidden}명</span>}
                      {noNickname > 0 && <span className="text-amber-600 ml-1">· 닉네임 없음 {noNickname}</span>})
                    </span>
                  )
                })()}
                {students.filter(s => !s.is_hidden).length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    동의서 회신 {students.filter(s => !s.is_hidden && s.consent_received).length}/{students.filter(s => !s.is_hidden).length}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {students.filter(s => !s.is_hidden).length > 0 && (
                  <>
                    <button onClick={downloadStudentList}
                      disabled={savingId === 'download'}
                      className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded-full disabled:opacity-50">
                      {savingId === 'download' ? '⏳' : '📥 명단 엑셀'}
                    </button>
                    {(() => {
                      const active = students.filter(s => !s.is_hidden)
                      const notYet = active.filter(s => !s.consent_received).length
                      const allReceived = notYet === 0 && active.length > 0
                      if (allReceived) {
                        return (
                          <button onClick={() => bulkToggleConsent(false)}
                            disabled={savingId === 'bulk-consent'}
                            className="text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-1 rounded-full disabled:opacity-50"
                            title="모든 학생 동의서를 미회신으로 되돌리기">
                            {savingId === 'bulk-consent' ? '⏳' : '↻ 동의서 일괄 해제'}
                          </button>
                        )
                      }
                      return (
                        <button onClick={() => bulkToggleConsent(true)}
                          disabled={savingId === 'bulk-consent'}
                          className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded-full disabled:opacity-50"
                          title="미회신 학생들을 일괄 회신 처리">
                          {savingId === 'bulk-consent' ? '⏳' : `✓ 동의서 일괄 체크 (미회신 ${notYet}명)`}
                        </button>
                      )
                    })()}
                  </>
                )}
                {students.filter(s => !s.is_hidden && !s.nickname).length > 0 && (
                  <button onClick={assignMissingNicknames}
                    disabled={savingId === 'bulk-nickname'}
                    className="text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 px-3 py-1 rounded-full disabled:opacity-50">
                    {savingId === 'bulk-nickname' ? '⏳ 부여 중...' : `🎭 닉네임 일괄 부여 (${students.filter(s => !s.is_hidden && !s.nickname).length}명)`}
                  </button>
                )}
                {students.some(s => s.is_hidden) && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={showHidden}
                      onChange={e => setShowHidden(e.target.checked)}
                      className="w-3.5 h-3.5" />
                    <span>숨김 학생 보기</span>
                  </label>
                )}
                {Object.keys(editingNumbers).length > 0 && (
                  <button onClick={saveAllNumbers}
                    className="text-xs bg-primary text-white px-3 py-1 rounded-full">
                    💾 변경된 번호 {Object.keys(editingNumbers).length}건 일괄 저장
                  </button>
                )}
              </div>
            </div>

            {students.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">아직 등록된 학생이 없어요</p>
            ) : (() => {
              const visibleStudents = [...students]
                .filter(s => showHidden || !s.is_hidden)
                .sort((a, b) => {
                  if (a.is_hidden !== b.is_hidden) return a.is_hidden ? 1 : -1
                  const na = parseInt(a.number) || 999
                  const nb = parseInt(b.number) || 999
                  if (na !== nb) return na - nb
                  return (a.username || '').localeCompare(b.username || '')
                })
              const selectableStudents = visibleStudents.filter(s => !s.is_hidden)
              const allSelected = selectableStudents.length > 0 &&
                selectableStudents.every(s => selectedStudentIds.has(s.id))
              const selectAll = () => setSelectedStudentIds(new Set(selectableStudents.map(s => s.id)))
              const clearSelection = () => setSelectedStudentIds(new Set())
              return (
              <>
                <p className="text-xs text-gray-500 mb-2">
                  💡 번호/이름/아이디 칸 클릭해서 수정 · 동의서 ✓ · 🔑 비번 초기화 · 🙈 전출생 숨김
                </p>

                {/* 선택 도구 */}
                {selectedStudentIds.size > 0 && (
                  <div className="bg-blue-50 border border-blue-300 rounded-lg p-3 mb-3 flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-blue-900">
                      ☑️ {selectedStudentIds.size}명 선택됨
                    </span>
                    <div className="flex gap-1.5 flex-wrap ml-auto">
                      <button onClick={resetPasswordsBulk}
                        className="text-xs bg-amber-500 text-white px-3 py-1 rounded hover:bg-amber-600 font-medium">
                        🔑 비밀번호 일괄 초기화
                      </button>
                      <button onClick={clearSelection}
                        className="text-xs text-gray-600 hover:text-gray-800 px-2">
                        ✕ 선택 해제
                      </button>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="py-2 px-1 w-8">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={() => allSelected ? clearSelection() : selectAll()}
                            className="w-4 h-4 cursor-pointer"
                            title="전체 선택"
                          />
                        </th>
                        <th className="py-2 px-2 w-16">번호</th>
                        <th className="py-2 px-2">이름</th>
                        <th className="py-2 px-2 hidden sm:table-cell">아이디</th>
                        <th className="py-2 px-2 text-center w-16">동의서</th>
                        <th className="py-2 px-2 text-center w-12">비번</th>
                        <th className="py-2 px-2 text-center w-12">숨김</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStudents.map(s => {
                        const currentNumber = editingNumbers[s.id] !== undefined
                          ? editingNumbers[s.id]
                          : (s.number || '')
                        const isDirtyNum = editingNumbers[s.id] !== undefined && editingNumbers[s.id] !== (s.number || '')

                        const currentUsername = editingExistingUsernames[s.id] !== undefined
                          ? editingExistingUsernames[s.id]
                          : (s.username || '')
                        const isDirtyUsername = editingExistingUsernames[s.id] !== undefined &&
                          editingExistingUsernames[s.id] !== (s.username || '')

                        const currentRealname = editingRealnames[s.id] !== undefined
                          ? editingRealnames[s.id]
                          : (s.realname || '')
                        const isDirtyName = editingRealnames[s.id] !== undefined &&
                          editingRealnames[s.id] !== (s.realname || '')

                        return (
                          <tr key={s.id}
                            className={`border-b border-gray-100 hover:bg-gray-50 ${
                              s.is_hidden ? 'opacity-50 bg-gray-50' :
                              selectedStudentIds.has(s.id) ? 'bg-blue-50' : ''
                            }`}>
                            <td className="py-2 px-1">
                              {!s.is_hidden && (
                                <input
                                  type="checkbox"
                                  checked={selectedStudentIds.has(s.id)}
                                  onChange={() => toggleStudentSelect(s.id)}
                                  className="w-4 h-4 cursor-pointer"
                                />
                              )}
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={currentNumber}
                                onChange={e => setEditingNumbers(prev => ({ ...prev, [s.id]: e.target.value }))}
                                onBlur={() => { if (isDirtyNum) saveNumber(s.id) }}
                                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                                placeholder="-"
                                className={`w-14 p-1 text-center text-sm border rounded font-mono ${
                                  isDirtyNum ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                                }`}
                                disabled={savingId === s.id || s.is_hidden}
                              />
                            </td>
                            <td className="py-2 px-2 font-medium">
                              <input
                                type="text"
                                value={currentRealname}
                                onChange={e => setEditingRealnames(prev => ({ ...prev, [s.id]: e.target.value }))}
                                onBlur={() => { if (isDirtyName) saveRealname(s.id, s.realname) }}
                                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                                className={`w-full max-w-[120px] p-1 text-sm border rounded ${
                                  isDirtyName ? 'border-amber-400 bg-amber-50' : 'border-transparent hover:border-gray-200 bg-transparent'
                                }`}
                                disabled={savingId === s.id || s.is_hidden}
                                title="클릭해서 이름 수정"
                              />
                              {s.nickname ? (
                                <div className="text-[10px] text-purple-600 mt-0.5 flex items-center gap-1 flex-wrap">
                                  <span>🎭 {s.nickname}</span>
                                  <button
                                    onClick={() => setEditingNicknameStudent(s)}
                                    disabled={s.is_hidden}
                                    className="text-purple-500 hover:text-purple-900 underline disabled:opacity-40"
                                    title="닉네임 변경"
                                  >
                                    변경
                                  </button>
                                </div>
                              ) : (
                                !s.is_hidden && (
                                  <button
                                    onClick={() => setEditingNicknameStudent(s)}
                                    className="text-[10px] text-purple-500 hover:text-purple-900 underline mt-0.5"
                                  >
                                    🎭 닉네임 직접 부여
                                  </button>
                                )
                              )}
                              {s.is_hidden && s.hidden_reason && (
                                <div className="text-xs text-gray-400 mt-0.5">({s.hidden_reason})</div>
                              )}
                            </td>
                            <td className="py-2 px-2 text-xs hidden sm:table-cell">
                              <input
                                type="text"
                                value={currentUsername}
                                onChange={e => setEditingExistingUsernames(prev => ({ ...prev, [s.id]: e.target.value.toLowerCase() }))}
                                onBlur={() => { if (isDirtyUsername) saveUsername(s.id, s.username) }}
                                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                                className={`w-full max-w-[140px] p-1 text-xs border rounded font-mono ${
                                  isDirtyUsername ? 'border-amber-400 bg-amber-50' : 'border-transparent hover:border-gray-200 bg-transparent'
                                }`}
                                disabled={savingId === s.id || s.is_hidden}
                                title="클릭해서 아이디 수정"
                              />
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => toggleConsent(s.id, s.consent_received)}
                                disabled={savingId === s.id || s.is_hidden}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded ${
                                  s.consent_received
                                    ? 'bg-green-100 text-green-700 border border-green-300'
                                    : 'bg-gray-100 text-gray-400 border border-gray-200 hover:bg-gray-200'
                                } disabled:opacity-40`}
                                title={s.consent_received ? '동의서 회신됨' : '동의서 미회신'}
                              >
                                {s.consent_received ? '✓' : '·'}
                              </button>
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => resetPassword(s.id, s.username, s.realname)}
                                disabled={savingId === s.id || s.is_hidden}
                                className="inline-flex items-center justify-center w-7 h-7 rounded text-sm text-gray-400 hover:bg-amber-100 hover:text-amber-700 disabled:opacity-40"
                                title="비밀번호 초기화 (학생이 비번 잊었을 때)"
                              >
                                🔑
                              </button>
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => toggleHidden(s.id, s.realname, s.is_hidden)}
                                disabled={savingId === s.id}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded text-sm ${
                                  s.is_hidden
                                    ? 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'
                                    : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                                }`}
                                title={s.is_hidden ? '숨김 해제 (활성화)' : '숨김 처리 (전출생 등)'}
                              >
                                {s.is_hidden ? '↻' : '🙈'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
              )
            })()}
          </div>
        </main>
        {editingNicknameStudent && (
          <NicknameChangeModal
            targetUserId={editingNicknameStudent.id}
            currentNickname={editingNicknameStudent.nickname}
            classId={classInfo?.id}
            displayName={editingNicknameStudent.realname}
            onClose={() => setEditingNicknameStudent(null)}
            onSuccess={() => loadStudents(classInfo.id)}
          />
        )}
      </div>
    </>
  )
}
