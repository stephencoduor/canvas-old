// Keyboard grading flow for the new SpeedGrader. This is the only part of the
// toolkit that touches Canvas's own controls, so every selector lives here,
// each with fallbacks, and failures are silent: the panel keeps working even
// when Instructure changes the page.

const GRADE_INPUT_SELECTORS = [
  '[data-testid="grade-input"]',
  'input[data-testid*="grade" i]',
  '#grading-box-extended',
  'input[aria-label*="grade" i]:not([type=hidden])',
]

const NEXT_BUTTON_SELECTORS = ['[data-testid="next-student-button"]', 'button[aria-label*="next student" i]', '#next-student-button', 'button[title*="next" i]']

function first<T extends Element>(selectors: string[]): T | null {
  for (const s of selectors) {
    try {
      const el = document.querySelector<T>(s)
      if (el) return el
    } catch {
      // invalid selector in an old browser; try the next
    }
  }
  return null
}

function focusGrade(): void {
  const input = first<HTMLInputElement>(GRADE_INPUT_SELECTORS)
  if (input && document.activeElement !== input) {
    input.focus()
    input.select?.()
  }
}

/** Installs the flow and returns a cleanup function. */
export function installKeyboardFlow(): () => void {
  let last = location.href
  const watch = setInterval(() => {
    if (location.href !== last) {
      last = location.href
      // Give SpeedGrader a moment to render the next student.
      setTimeout(focusGrade, 600)
    }
  }, 400)
  setTimeout(focusGrade, 800)

  const onKey = (e: KeyboardEvent) => {
    if (e.altKey && e.key === 'Enter') {
      const input = first<HTMLInputElement>(GRADE_INPUT_SELECTORS)
      // Blurring commits the grade the same way tabbing out does.
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      input?.blur()
      setTimeout(() => first<HTMLButtonElement>(NEXT_BUTTON_SELECTORS)?.click(), 300)
      e.preventDefault()
    }
  }
  window.addEventListener('keydown', onKey, true)
  return () => {
    clearInterval(watch)
    window.removeEventListener('keydown', onKey, true)
  }
}
