import { useEffect, useState } from 'react'

export interface GraderLocation {
  assignmentId: string | null
  studentId: string | null
  anonymousId: string | null
}

export function readLocation(href: string): GraderLocation {
  const url = new URL(href)
  return {
    assignmentId: url.searchParams.get('assignment_id'),
    studentId: url.searchParams.get('student_id'),
    anonymousId: url.searchParams.get('anonymous_id'),
  }
}

/**
 * SpeedGrader switches students with history.pushState, which fires no event a
 * content script can hear, so the URL is polled. It is cheap and survives
 * Instructure rewriting the page.
 */
export function useSpeedGraderLocation(): GraderLocation {
  const [loc, setLoc] = useState(() => readLocation(location.href))
  useEffect(() => {
    let last = location.href
    const t = setInterval(() => {
      if (location.href !== last) {
        last = location.href
        setLoc(readLocation(last))
      }
    }, 400)
    return () => clearInterval(t)
  }, [])
  return loc
}
