import { parseSnippetImport, renderSnippet, searchSnippets, type Snippet } from '../src/core/snippets'

describe('renderSnippet', () => {
  it('fills variables and reports missing ones', () => {
    const r = renderSnippet('Hi {first_name}, {score}/{points_possible} ({percent}). {unknown} {last_name}', { firstName: 'Ana', score: 8.5, pointsPossible: 10 })
    expect(r.text).toBe('Hi Ana, 8.5/10 (85%). {unknown} {last_name}')
    expect(r.missing).toEqual(['last_name'])
  })
})

describe('searchSnippets', () => {
  const s = (id: string, title: string, body: string, tags: string[] = [], uses = 0): Snippet => ({ id, title, body, folder: 'F', tags, uses })
  const list = [s('1', 'Cite sources', 'Use APA', ['citations']), s('2', 'Great work', 'Nice job citing', [], 5), s('3', 'Late', 'Late policy', ['late'])]
  it('ranks title matches over body matches', () => {
    expect(searchSnippets(list, 'cit').map(x => x.id)).toEqual(['1', '2'])
  })
  it('filters by #tag', () => {
    expect(searchSnippets(list, '#late').map(x => x.id)).toEqual(['3'])
  })
  it('sorts by use when there is no query', () => {
    expect(searchSnippets(list, '')[0]!.id).toBe('2')
  })
})

describe('parseSnippetImport', () => {
  it('keeps valid entries only', () => {
    const out = parseSnippetImport(JSON.stringify([{ title: 'A', body: 'Body' }, { body: '' }, 'x', { body: 'No title', tags: ['t', 3] }]))
    expect(out.map(x => x.title)).toEqual(['A', 'No title'])
    expect(out[1]!.tags).toEqual(['t'])
  })
})
