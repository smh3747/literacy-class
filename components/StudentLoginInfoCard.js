// ============================================
// 학생 로그인 안내 카드 (선생님 메인 화면용)
// ============================================
// 와이프 피드백: 학생이 로그인할 때 "선생님 아이디 뭐예요?" 안 물어보게
// 선생님 메인에 항상 노출 + 한 번에 카톡/문자에 붙여넣을 수 있는 복사 기능
// ============================================
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ensureLoginHint } from '../lib/loginHint'

export default function StudentLoginInfoCard({ classInfo, students, isImpersonating }) {
  const [copied, setCopied] = useState(false)
  const [hint, setHint] = useState({
    prefix: classInfo?.login_username_prefix || '',
    password: classInfo?.login_default_password || '123456',
    enabled: !!classInfo?.login_hint_enabled
  })

  // 학급 정보 바뀌면 동기화
  useEffect(() => {
    setHint({
      prefix: classInfo?.login_username_prefix || '',
      password: classInfo?.login_default_password || '123456',
      enabled: !!classInfo?.login_hint_enabled
    })
  }, [classInfo?.login_username_prefix, classInfo?.login_default_password, classInfo?.login_hint_enabled])

  if (!classInfo) return null

  // 학생 가입/로그인 링크 (production URL 기준 — 환경변수에서 가져옴)
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const loginUrl = `${baseUrl}/student/login?code=${classInfo.code}`

  // 예시 아이디: hint.prefix가 있으면 거기에 번호 붙여서
  // 없으면 등록된 학생 중 첫 명의 실제 아이디
  let sampleUsername = ''
  if (hint.prefix) {
    // 끝이 숫자로 끝나면 +1 → 다음 번호 예시 (예: hg51 → hg5101)
    sampleUsername = `${hint.prefix}01`
  } else if (students && students.length > 0) {
    sampleUsername = students[0].username || ''
  }

  // 카톡/문자 붙여넣기용 안내문
  const buildAnnouncementText = () => {
    const lines = [
      `📚 문해력 수업 학생 로그인 안내`,
      ``,
      `1️⃣ 아래 링크 또는 QR로 접속`,
      `${loginUrl}`,
      ``,
      `2️⃣ 학급 가입 코드 입력 (자동 입력됨)`,
      `${classInfo.code}`,
      ``,
    ]
    if (sampleUsername) {
      lines.push(`3️⃣ 자기 아이디로 로그인`)
      lines.push(`아이디 예시: ${sampleUsername}`)
      lines.push(`(앞 글자 ${hint.prefix || '???'} + 자기 번호)`)
      lines.push(`기본 비밀번호: ${hint.password || '123456'}`)
    } else {
      lines.push(`3️⃣ 선생님이 알려주신 아이디로 로그인`)
      lines.push(`기본 비밀번호: ${hint.password || '123456'}`)
    }
    lines.push(``)
    lines.push(`궁금하면 선생님께 알려주세요.`)
    return lines.join('\n')
  }

  const copyAnnouncement = async () => {
    try {
      await navigator.clipboard.writeText(buildAnnouncementText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      // 클립보드 권한 없으면 fallback
      alert('복사 실패 — 직접 선택해서 복사하세요')
    }
  }

  const fillAutomatically = async () => {
    if (isImpersonating) return
    if (!students || students.length < 2) {
      alert('학생이 2명 이상 등록되어야 자동 설정이 가능해요')
      return
    }
    const usernames = students.map(s => s.username).filter(Boolean)
    const result = await ensureLoginHint(classInfo.id, { existingUsernames: usernames })
    if (result.success) {
      setHint({ prefix: result.prefix, password: '123456', enabled: true })
      alert(`✅ 자동 설정 완료\n아이디 앞 글자: ${result.prefix}`)
    } else {
      alert('자동 설정 실패. 학생 아이디들이 공통 접두사를 갖고 있지 않아요.\n학급 설정에서 직접 입력해주세요.')
    }
  }

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
        <div>
          <h3 className="font-bold text-blue-900 flex items-center gap-2">
            📋 학생 로그인 안내
            <span className="text-xs font-normal bg-white text-blue-700 px-2 py-0.5 rounded-full">
              카톡으로 한 번에 보내기
            </span>
          </h3>
          <p className="text-xs text-blue-800 mt-1">
            아래 내용을 학급 단톡방이나 학부모께 그대로 전달하면 학생들이 스스로 로그인해요.
          </p>
        </div>
      </div>

      {/* 미리보기 박스 (학생들이 받게 될 안내문) */}
      <div className="bg-white rounded-xl p-4 border border-blue-200 mb-3">
        <div className="space-y-2 text-sm">
          {/* 1단계: 링크 */}
          <div className="flex items-start gap-2">
            <span className="text-blue-600 font-bold flex-shrink-0">1.</span>
            <div className="flex-1 min-w-0">
              <div className="text-gray-700">아래 링크로 접속</div>
              <div className="font-mono text-xs bg-gray-50 px-2 py-1 rounded mt-1 break-all">
                {loginUrl}
              </div>
            </div>
          </div>

          {/* 2단계: 코드 (링크에 포함돼 있어도 안내) */}
          <div className="flex items-start gap-2">
            <span className="text-blue-600 font-bold flex-shrink-0">2.</span>
            <div className="flex-1">
              <div className="text-gray-700">학급 가입 코드 (링크 클릭하면 자동 입력)</div>
              <div className="font-mono font-bold text-base tracking-widest text-blue-900 mt-0.5">
                {classInfo.code}
              </div>
            </div>
          </div>

          {/* 3단계: 아이디·비번 안내 */}
          <div className="flex items-start gap-2">
            <span className="text-blue-600 font-bold flex-shrink-0">3.</span>
            <div className="flex-1">
              {hint.enabled && hint.prefix ? (
                <>
                  <div className="text-gray-700">자기 아이디로 로그인</div>
                  <div className="text-xs text-gray-600 mt-1">
                    아이디 예시: <span className="font-mono font-bold text-blue-900">{sampleUsername}</span>
                  </div>
                  <div className="text-xs text-gray-600">
                    (앞 글자 <span className="font-mono font-semibold">{hint.prefix}</span> + 자기 번호)
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    기본 비밀번호: <span className="font-mono font-semibold">{hint.password || '123456'}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-amber-700 font-medium">
                    ⚠️ 아직 아이디 안내가 설정되지 않았어요
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    학생을 등록하면 자동 설정되거나, 아래 버튼을 누르세요.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 버튼들 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={copyAnnouncement}
          disabled={!hint.enabled || !hint.prefix}
          className={`flex-1 min-w-[180px] py-2.5 px-4 rounded-lg font-semibold text-sm transition ${
            copied
              ? 'bg-green-500 text-white'
              : hint.enabled && hint.prefix
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}>
          {copied ? '✅ 복사됨!' : '📋 안내문 통째로 복사'}
        </button>

        {(!hint.enabled || !hint.prefix) && !isImpersonating && (
          <button
            onClick={fillAutomatically}
            className="py-2.5 px-4 rounded-lg font-semibold text-sm bg-white border-2 border-blue-300 text-blue-700 hover:bg-blue-50">
            🪄 자동 설정 시도
          </button>
        )}
      </div>

      {students && students.length === 0 && (
        <p className="text-xs text-gray-600 mt-2">
          💡 먼저 학생을 등록하세요. 등록과 동시에 안내가 자동 설정됩니다.
        </p>
      )}
    </div>
  )
}
