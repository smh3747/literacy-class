// ============================================
// 학생 로그인 안내 카드 (통합 버전)
// ============================================
// 와이프 피드백: 학생이 "선생님 아이디 뭐예요?" 안 물어보게
// + 카드가 너무 커서 접기 가능하게
// + ClassSettings의 "학생 로그인 안내"와 통합 (한 곳에서 모든 설정)
// ============================================
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { ensureLoginHint } from '../lib/loginHint'
import QrCodeModal from './QrCodeModal'

const STORAGE_KEY = 'lc-login-info-card-open'

export default function StudentLoginInfoCard({ classInfo, students, isImpersonating, onUpdate, openSignal }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editPrefix, setEditPrefix] = useState('')
  const [editPassword, setEditPassword] = useState('123456')
  const [saving, setSaving] = useState(false)
  // 🆕 QR 통합 (큰 모달은 별도 컴포넌트)
  const [showQrModal, setShowQrModal] = useState(false)
  const qrCanvasRef = useRef(null)

  const loginHintEnabled = !!classInfo?.login_hint_enabled
  const prefix = classInfo?.login_username_prefix || ''
  const password = classInfo?.login_default_password || '123456'

  // 🆕 외부(셋업 체크리스트)에서 열기 신호 받으면 펼침
  useEffect(() => {
    if (openSignal) setOpen(true)
  }, [openSignal])

  // 학급별 접기 상태 복원
  useEffect(() => {
    if (typeof window === 'undefined' || !classInfo?.id) return
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}-${classInfo.id}`)
      // 기본: 안내가 비어있으면 펼침 (선생님이 행동해야 함), 채워졌으면 접힘
      if (saved === null) {
        setOpen(!loginHintEnabled || !prefix)
      } else {
        setOpen(saved === '1')
      }
    } catch(e) {}
  }, [classInfo?.id, loginHintEnabled, prefix])

  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    if (typeof window !== 'undefined' && classInfo?.id) {
      try {
        localStorage.setItem(`${STORAGE_KEY}-${classInfo.id}`, next ? '1' : '0')
      } catch(e) {}
    }
  }

  if (!classInfo) return null

  // QrCodeModal과 같은 origin 결정 로직
  let origin = ''
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SITE_URL) {
    origin = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  } else if (typeof window !== 'undefined') {
    origin = window.location.origin
  }
  const loginUrl = `${origin}/student/login?code=${classInfo.code}`
  const formatNum = (n) => String(n).padStart(2, '0')

  // 🆕 카드 펼쳐졌을 때만 미니 QR 그리기
  useEffect(() => {
    if (!open || editing) return
    if (!qrCanvasRef.current || !loginUrl) return
    QRCode.toCanvas(qrCanvasRef.current, loginUrl, {
      width: 120,
      margin: 1,
      color: { dark: '#1f2937', light: '#ffffff' }
    }).catch(() => {})
  }, [open, editing, loginUrl])

  const buildAnnouncementText = () => {
    const lines = [
      `📚 문해력 수업 학생 로그인 안내`,
      ``,
      `1️⃣ 아래 링크 또는 QR로 접속`,
      loginUrl,
      ``,
      `2️⃣ 학급 가입 코드 (링크 클릭하면 자동 입력)`,
      classInfo.code,
      ``,
    ]
    if (prefix) {
      lines.push(`3️⃣ 자기 아이디로 로그인`)
      lines.push(`아이디 = "${prefix}" + 자기 번호 (두 자리)`)
      lines.push(`예) 1번 → ${prefix}01, 12번 → ${prefix}12`)
      lines.push(`기본 비밀번호: ${password}`)
    } else {
      lines.push(`3️⃣ 선생님이 알려준 아이디로 로그인`)
      lines.push(`기본 비밀번호: ${password}`)
    }
    lines.push(``)
    lines.push(`궁금하면 선생님께 물어보세요.`)
    return lines.join('\n')
  }

  const copyAnnouncement = async () => {
    try {
      await navigator.clipboard.writeText(buildAnnouncementText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      alert('복사 실패 — 직접 선택해서 복사하세요')
    }
  }

  const fillAutomatically = async () => {
    if (isImpersonating) return
    if (!students || students.length < 2) {
      alert('학생이 2명 이상 등록되어야 자동 설정이 가능해요.\n학생 관리에서 먼저 등록해주세요.')
      return
    }
    const usernames = students.map(s => s.username).filter(Boolean)
    const result = await ensureLoginHint(classInfo.id, { existingUsernames: usernames })
    if (result.success) {
      if (onUpdate) await onUpdate()
      alert(`✅ 자동 설정 완료\n아이디 앞 글자: ${result.prefix}`)
    } else {
      alert('자동 설정 실패. 학생 아이디들이 공통 접두사를 갖고 있지 않아요.\n"직접 입력"으로 설정해주세요.')
    }
  }

  const saveHint = async () => {
    if (isImpersonating) return
    if (!editPrefix.trim()) return alert('접두사를 입력해주세요 (예: hr51)')
    if (!editPassword.trim()) return alert('비밀번호를 입력해주세요')
    setSaving(true)
    try {
      const { error } = await supabase.from('classes').update({
        login_hint_enabled: true,
        login_username_prefix: editPrefix.trim().toLowerCase(),
        login_default_password: editPassword.trim()
      }).eq('id', classInfo.id)
      if (error) throw error
      if (onUpdate) await onUpdate()
      setEditing(false)
    } catch (e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  const disableHint = async () => {
    if (isImpersonating) return
    if (!confirm('학생 로그인 안내를 끌까요?\n\n학생들이 로그인 화면에서 안내를 못 보게 됩니다.')) return
    setSaving(true)
    try {
      const { error } = await supabase.from('classes').update({
        login_hint_enabled: false,
        login_username_prefix: null,
        login_default_password: null
      }).eq('id', classInfo.id)
      if (error) throw error
      if (onUpdate) await onUpdate()
    } catch (e) {
      alert('실패: ' + e.message)
    }
    setSaving(false)
  }

  const startEdit = () => {
    setEditPrefix(prefix || '')
    setEditPassword(password || '123456')
    setEditing(true)
  }

  const sampleUsername = prefix ? `${prefix}${formatNum(1)}` : (students?.[0]?.username || '')

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl overflow-hidden">
      {/* 헤더 (항상 표시) */}
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-blue-100/30 transition">
        <div className="flex-1 text-left min-w-0">
          <div className="font-bold text-blue-900 flex items-center gap-2 flex-wrap">
            📋 학생 로그인 안내
            {loginHintEnabled && prefix ? (
              <span className="text-xs font-normal bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                ✅ 자동 안내 사용 중 · 아이디 {prefix}OO
              </span>
            ) : (
              <span className="text-xs font-normal bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                ⚠️ 아이디 안내 미설정
              </span>
            )}
          </div>
          {!open && (
            <p className="text-xs text-blue-700/80 mt-0.5">
              {loginHintEnabled && prefix
                ? `클릭하면 학생 안내문 복사·수정·QR 출력 가능`
                : `학생들이 "내 아이디 뭐예요?" 안 묻게 하려면 클릭해서 아이디 접두사를 설정해주세요`}
            </p>
          )}
        </div>
        <span className="text-blue-600 text-sm ml-2">{open ? '▲' : '▼'}</span>
      </button>

      {/* 펼친 영역 */}
      {open && (
        <div className="px-5 pb-5 space-y-3">
          {!editing && (
            <>
              <div className="bg-white rounded-xl p-4 border border-blue-200">
                <div className="space-y-2 text-sm">
                  <div className="flex flex-col sm:flex-row items-start gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <span className="text-blue-600 font-bold flex-shrink-0">1.</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-700">아래 링크 또는 QR로 접속</div>
                        <div className="font-mono text-xs bg-gray-50 px-2 py-1 rounded mt-1 break-all">
                          {loginUrl}
                        </div>
                      </div>
                    </div>
                    {/* 🆕 미니 QR + 크게 보기 */}
                    <div className="flex-shrink-0 flex flex-col items-center gap-1 mx-auto sm:mx-0">
                      <button
                        type="button"
                        onClick={() => setShowQrModal(true)}
                        className="bg-white border border-gray-200 rounded-lg p-2 hover:border-blue-400 hover:shadow-md transition"
                        title="QR 코드 크게 보기 / 다운로드 / 인쇄">
                        <canvas ref={qrCanvasRef} className="block" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowQrModal(true)}
                        className="text-xs text-blue-700 hover:bg-blue-50 px-2 py-0.5 rounded">
                        🔍 크게·인쇄
                      </button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold flex-shrink-0">2.</span>
                    <div className="flex-1">
                      <div className="text-gray-700">학급 가입 코드 (링크 클릭하면 자동 입력)</div>
                      <div className="font-mono font-bold text-base tracking-widest text-blue-900 mt-0.5">
                        {classInfo.code}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold flex-shrink-0">3.</span>
                    <div className="flex-1">
                      {loginHintEnabled && prefix ? (
                        <>
                          <div className="text-gray-700">자기 아이디로 로그인</div>
                          <div className="text-xs text-gray-600 mt-1">
                            아이디 = <span className="font-mono font-semibold">{prefix}</span> + 자기 번호 (두 자리)
                          </div>
                          <div className="text-xs text-gray-600 pl-4 mt-0.5">
                            예) 1번 → <span className="font-mono font-bold">{prefix}{formatNum(1)}</span>,
                            {' '}12번 → <span className="font-mono font-bold">{prefix}{formatNum(12)}</span>
                          </div>
                          <div className="text-xs text-gray-600 mt-0.5">
                            기본 비밀번호: <span className="font-mono font-semibold">{password}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-amber-700 font-medium">
                            ⚠️ 아이디 안내가 비어있어요
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            아래 "자동 설정" 또는 "직접 입력"으로 설정하세요.
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={copyAnnouncement}
                  disabled={!loginHintEnabled || !prefix}
                  className={`flex-1 min-w-[180px] py-2.5 px-4 rounded-lg font-semibold text-sm transition ${
                    copied
                      ? 'bg-green-500 text-white'
                      : loginHintEnabled && prefix
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}>
                  {copied ? '✅ 복사됨!' : '📋 안내문 통째로 복사'}
                </button>

                {!isImpersonating && (
                  <>
                    {(!loginHintEnabled || !prefix) && (
                      <button
                        onClick={fillAutomatically}
                        className="py-2.5 px-4 rounded-lg font-semibold text-sm bg-white border-2 border-blue-300 text-blue-700 hover:bg-blue-50">
                        🪄 자동 설정
                      </button>
                    )}
                    <button
                      onClick={startEdit}
                      className="py-2.5 px-3 rounded-lg font-medium text-sm bg-white border border-gray-300 text-gray-700 hover:bg-gray-50">
                      ✏️ 직접 입력
                    </button>
                    {loginHintEnabled && prefix && (
                      <button
                        onClick={disableHint}
                        disabled={saving}
                        className="py-2.5 px-3 rounded-lg font-medium text-sm bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        🔕 안내 끄기
                      </button>
                    )}
                  </>
                )}
              </div>

              {students && students.length === 0 && (
                <p className="text-xs text-gray-600">
                  💡 먼저 학생을 등록하세요. 등록과 동시에 안내가 자동 설정됩니다.
                </p>
              )}
            </>
          )}

          {/* 수정 모드 */}
          {editing && (
            <div className="bg-white rounded-xl p-4 border border-blue-200 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  아이디 접두사 <span className="text-gray-400">(예: hr51)</span>
                </label>
                <input
                  type="text"
                  value={editPrefix}
                  onChange={e => setEditPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                  placeholder="hr51"
                  maxLength="10"
                  className="w-full p-2 border border-gray-200 rounded text-sm font-mono"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-0.5">
                  학생 아이디 = 접두사 + 두 자리 번호 (예: {editPrefix || 'hr51'}01, {editPrefix || 'hr51'}02)
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  초기 비밀번호
                </label>
                <input
                  type="text"
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  placeholder="123456"
                  maxLength="20"
                  className="w-full p-2 border border-gray-200 rounded text-sm font-mono"
                />
              </div>

              {editPrefix && (
                <div className="bg-blue-50 border border-blue-200 rounded p-2">
                  <p className="text-xs font-semibold text-blue-900 mb-1">📱 저장 후 학생에게 이렇게 보여요:</p>
                  <div className="text-xs text-blue-800 space-y-0.5">
                    <div>🆔 아이디: <span className="font-mono bg-white px-1 rounded">{editPrefix}</span> + 본인 번호 (두 자리)</div>
                    <div className="pl-4 text-blue-700">
                      예) 1번 → <span className="font-mono bg-white px-1 rounded">{editPrefix + formatNum(1)}</span>,
                      {' '}12번 → <span className="font-mono bg-white px-1 rounded">{editPrefix + formatNum(12)}</span>
                    </div>
                    <div>🔑 비밀번호: <span className="font-mono bg-white px-1 rounded">{editPassword || '123456'}</span></div>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={saveHint}
                  disabled={saving}
                  className="flex-1 py-2 px-3 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  💾 저장
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="py-2 px-3 rounded bg-gray-100 text-gray-700 text-sm hover:bg-gray-200 disabled:opacity-50">
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 🆕 QR 모달 (크게 보기 / 다운로드 / 인쇄) */}
      {showQrModal && (
        <QrCodeModal
          classCode={classInfo.code}
          className={classInfo.name}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </div>
  )
}
