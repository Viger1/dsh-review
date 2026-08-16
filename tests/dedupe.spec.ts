import { describe, expect, it } from 'vitest'
import { dedupeFindings, isSameDefect, type LensFinding } from '../src/dedupe.js'
import type { Finding } from '../src/schema.js'

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: 'src/cart.ts',
    line: 7,
    title: 'loop bound uses <= and reads past the array end',
    detail: 'detail',
    failureScenario: 'scenario',
    severity: 'major',
    ...overrides,
  }
}

function tagged(list: { f: Partial<Finding>; lens: string }[]): LensFinding[] {
  return list.map(({ f, lens }) => ({ finding: finding(f), lens }))
}

describe('isSameDefect', () => {
  it('never merges findings in different files', () => {
    expect(isSameDefect(finding(), finding({ file: 'src/other.ts' }), 0.5)).toBe(false)
  })

  it('merges different phrasings anchored to the same line', () => {
    const a = finding({ title: 'loop reads past the array end' })
    const b = finding({ title: 'off-by-one: loop iterates length + 1 times' })
    expect(isSameDefect(a, b, 0.5)).toBe(true)
  })

  it('does not merge same-line findings with nothing in common', () => {
    const a = finding({ title: 'loop reads past the array end' })
    const b = finding({ title: 'discount percentage applied before tax' })
    expect(isSameDefect(a, b, 0.5)).toBe(false)
  })

  it('merges findings on different lines only when titles substantially overlap', () => {
    const a = finding({ line: 7, title: 'unvalidated userId concatenated into a filesystem path' })
    const near = finding({ line: 22, title: 'userId concatenated into filesystem path without validation' })
    const other = finding({ line: 16, title: 'coupon lookup returns undefined for unknown codes' })
    expect(isSameDefect(a, near, 0.5)).toBe(true)
    expect(isSameDefect(a, other, 0.5)).toBe(false)
  })

  it('ignores boilerplate words when comparing titles', () => {
    const a = finding({ line: undefined, title: 'the error is invalid in this function' })
    const b = finding({ line: undefined, title: 'an incorrect problem with the missing issue' })
    // Nothing but stop words in common — must not merge.
    expect(isSameDefect(a, b, 0.5)).toBe(false)
  })
})

describe('dedupeFindings', () => {
  it('merges one defect reported by several lenses and records them all', () => {
    const groups = dedupeFindings(tagged([
      { f: { title: 'loop bound uses <= and reads past the array end' }, lens: 'correctness' },
      { f: { title: 'loop iterates one time too many past the array end' }, lens: 'contract' },
      { f: { title: 'array access past the end throws on every input' }, lens: 'security' },
    ]), 0.5)
    expect(groups).toHaveLength(1)
    expect(groups[0].lenses).toEqual(['correctness', 'contract', 'security'])
    expect(groups[0].mergedCount).toBe(3)
  })

  it('keeps genuinely distinct defects apart', () => {
    const groups = dedupeFindings(tagged([
      { f: { line: 7, title: 'loop bound reads past the array end' }, lens: 'correctness' },
      { f: { line: 16, title: 'coupon lookup returns undefined for unknown codes' }, lens: 'correctness' },
      { f: { line: 22, title: 'unvalidated userId allows path traversal' }, lens: 'security' },
    ]), 0.5)
    expect(groups).toHaveLength(3)
    expect(groups.every(group => group.mergedCount === 1)).toBe(true)
  })

  it('promotes the most severe report to represent the group', () => {
    const groups = dedupeFindings(tagged([
      { f: { title: 'path traversal via userId', severity: 'minor' }, lens: 'correctness' },
      { f: { title: 'userId enables path traversal', severity: 'critical' }, lens: 'security' },
    ]), 0.5)
    expect(groups).toHaveLength(1)
    expect(groups[0].finding.severity).toBe('critical')
  })

  it('prefers a report carrying a line number at equal severity', () => {
    const groups = dedupeFindings(tagged([
      { f: { line: undefined, title: 'path traversal via userId' }, lens: 'correctness' },
      { f: { line: 22, title: 'userId enables path traversal' }, lens: 'security' },
    ]), 0.5)
    expect(groups[0].finding.line).toBe(22)
  })

  it('prefers the more detailed failure scenario at equal severity and specificity', () => {
    const groups = dedupeFindings(tagged([
      { f: { title: 'path traversal via userId', failureScenario: 'bad input' }, lens: 'correctness' },
      { f: { title: 'userId enables path traversal', failureScenario: "loadCart('../secret') reads /var/secret.json" }, lens: 'security' },
    ]), 0.5)
    expect(groups[0].finding.failureScenario).toMatch(/\.\.\/secret/)
  })

  it('does not double-count a lens that reported the same defect twice', () => {
    const groups = dedupeFindings(tagged([
      { f: { title: 'loop reads past the array end' }, lens: 'correctness' },
      { f: { title: 'loop iterates past the array end' }, lens: 'correctness' },
    ]), 0.5)
    expect(groups[0].lenses).toEqual(['correctness'])
    expect(groups[0].mergedCount).toBe(2)
  })

  it('returns an empty list for no findings', () => {
    expect(dedupeFindings([], 0.5)).toEqual([])
  })

  it('merges nothing at a threshold of 1 unless the line matches', () => {
    const groups = dedupeFindings(tagged([
      { f: { line: 7, title: 'loop reads past the end' }, lens: 'correctness' },
      { f: { line: 9, title: 'loop reads past the end of the array' }, lens: 'contract' },
    ]), 1)
    expect(groups).toHaveLength(2)
  })
})
