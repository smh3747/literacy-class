// step430: 👁 보기 토글이 달린 비밀번호 입력 — 기존 input과 동일 props(className 포함)를 그대로 받는 래퍼.
// 표시 계층만 담당(값·핸들러·검증은 호출부 소유). forwardRef로 기존 fieldRefs 패턴 유지.
import { useState, forwardRef } from 'react'

const PasswordInput = forwardRef(function PasswordInput({ className = '', ...rest }, ref) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input ref={ref} type={show ? 'text' : 'password'} className={`${className} pr-10`} {...rest} />
      <button type="button" onClick={() => setShow(s => !s)} aria-label="비밀번호 표시" tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition">
        {show ? '🙈' : '👁'}
      </button>
    </div>
  )
})

export default PasswordInput
