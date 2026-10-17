import { classifyLink, extractLinks, matchTool, rewriteLink } from '../src/core/audit/links'

const ORIGIN = 'https://school.instructure.com'

describe('extractLinks', () => {
  it('reads href and src with their text', () => {
    const html = `<p><a href="/courses/1/files/22/download?wrap=1">Syllabus &amp; rules</a>
      <img src='https://school.instructure.com/courses/1/files/23/preview'>
      <a href="#top">top</a><a href="mailto:x@y.z">mail</a>
      <iframe src="/courses/1/external_tools/retrieve?display=borderless&amp;url=https%3A%2F%2Fassignments.google.com%2Flti"></iframe></p>`
    const links = extractLinks(html)
    expect(links.map(l => l.url)).toEqual([
      '/courses/1/files/22/download?wrap=1',
      'https://school.instructure.com/courses/1/files/23/preview',
      '/courses/1/external_tools/retrieve?display=borderless&url=https%3A%2F%2Fassignments.google.com%2Flti',
    ])
    expect(links[0]!.text).toBe('Syllabus & rules')
  })
})

describe('classifyLink', () => {
  it('recognises course content, files, tools and external links', () => {
    expect(classifyLink('/courses/9/pages/week-1', ORIGIN)).toMatchObject({ kind: 'course-content', courseId: '9', contentType: 'pages', contentId: 'week-1' })
    expect(classifyLink('/courses/9/wiki/week-1', ORIGIN)).toMatchObject({ contentType: 'pages' })
    expect(classifyLink(`${ORIGIN}/courses/9/files/5/download`, ORIGIN)).toEqual({ kind: 'file', courseId: '9', fileId: '5' })
    expect(classifyLink('/api/v1/courses/9/assignments/3', ORIGIN)).toMatchObject({ kind: 'course-content', contentType: 'assignments', contentId: '3' })
    expect(classifyLink('/users/4/files/77', ORIGIN)).toEqual({ kind: 'file', courseId: null, fileId: '77' })
    expect(classifyLink('/courses/9/external_tools/retrieve?url=https%3A%2F%2Fx.onedrive.com', ORIGIN)).toEqual({ kind: 'lti-launch', url: 'https://x.onedrive.com' })
    expect(classifyLink('https://example.com/a', ORIGIN)).toEqual({ kind: 'external', host: 'example.com' })
    expect(classifyLink('/courses/9', ORIGIN)).toMatchObject({ kind: 'course-content', contentType: 'course' })
  })
})

describe('matchTool', () => {
  it('flags Google and Microsoft as breaking after copy', () => {
    expect(matchTool('https://assignments.google.com/lti/a')!.severity).toBe('error')
    expect(matchTool('https://lti.office365.com/x')!.vendor).toBe('Microsoft')
    expect(matchTool('https://example.com')).toBeNull()
  })
})

describe('rewriteLink', () => {
  it('rewrites absolute and relative links but not longer ids', () => {
    const html = `<a href="/courses/1/files/12/download">a</a><a href="https://s.instructure.com/courses/1/files/12">b</a><a href="/courses/1/files/123">c</a>`
    const out = rewriteLink(html, '/courses/1/files/12', '/courses/2/files/99')
    expect(out).toBe(`<a href="/courses/2/files/99/download">a</a><a href="/courses/2/files/99">b</a><a href="/courses/1/files/123">c</a>`)
  })
})
