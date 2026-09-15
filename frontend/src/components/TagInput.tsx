import { useState, type KeyboardEvent } from 'react'
import { CloseIcon } from './Icons'

export default function TagInput({
  value,
  onChange,
  disabled,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  disabled?: boolean
}) {
  const [text, setText] = useState('')

  function commit() {
    const next = text
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (next.length) onChange([...new Set([...value, ...next])])
    setText('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className={`tag-input${disabled ? ' is-disabled' : ''}`}>
      {value.map((tag) => (
        <span key={tag} className="tag-chip">
          #{tag}
          <button
            type="button"
            aria-label={`${tag} 태그 제거`}
            disabled={disabled}
            onClick={() => onChange(value.filter((item) => item !== tag))}
          >
            <CloseIcon size={12} />
          </button>
        </span>
      ))}
      <input
        aria-label="태그"
        value={text}
        disabled={disabled}
        placeholder={value.length ? '' : '태그 입력 후 Enter'}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        maxLength={80}
      />
    </div>
  )
}
