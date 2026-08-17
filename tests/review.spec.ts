import { describe, expect, it } from 'vitest'
import { BUILT_IN_LENSES, selectLenses } from '../src/lenses.js'
import { applyDepth, finderPrompt, QUICK_LIMITS, renderOutcome, runReview, verifierPrompt, type RunChild } from '../src/review.js'
import { asFindings, asVerdict, type Finding } from '../src/schema.js'

const lens = BUILT_IN_LENSES[0]
const plan = { target: 'src/a.ts', lenses: [lens], verifiersPerFinding: 1, maxFindings: 12, dedupeThreshold: 0.5, maxConcurrentChildren: 8 }

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: 'src/a.ts',
    title: 'off-by-one in the loop bound',
    detail: 'The loop uses <= over a zero-based index.',
    failureScenario: 'A 3-element array reads index 3 and returns undefined.',
    severity: 'major',
    ...overrides,
  }
}

/**
 * A child runner driven by scripted responses, keyed by label prefix.
 */
function scripted(responses: {
  find?: (label: string) => unknown
  verify?: (prompt: string) => unknown
}): { run: RunChild; calls: { label: string; prompt: string }[] } {
  const calls: { label: string; prompt: string }[] = []
  const run: RunChild = ({ label, prompt }) => {
    calls.push({ label, prompt })
    if (label.startsWith('find:')) {
      const value = responses.find?.(label) ?? { findings: [] }
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
    }
    const value = responses.verify?.(prompt) ?? { confirmed: true, reasoning: 'could not refute' }
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
  }
  return { run, calls }
}

describe('runReview', () => {
  it('reports a finding that survives verification', async () => {
    const { run } = scripted({ find: () => ({ findings: [finding()] }) })
    const outcome = await runReview(plan, run)
    expect(outcome.confirmed).toHaveLength(1)
    expect(outcome.confirmed[0]).toMatchObject({ title: finding().title, lens: lens.key })
    expect(outcome.confirmed[0].verification).toBe('could not refute')
    expect(outcome.refuted).toEqual([])
    expect(outcome.found).toBe(1)
  })

  it('drops a finding the verifier refutes', async () => {
    const { run } = scripted({
      find: () => ({ findings: [finding()] }),
      verify: () => ({ confirmed: false, reasoning: 'the loop bound is exclusive; misread' }),
    })
    const outcome = await runReview(plan, run)
    expect(outcome.confirmed).toEqual([])
    expect(outcome.refuted).toEqual([finding().title])
    expect(outcome.found).toBe(1)
  })

  it('requires every verifier to confirm', async () => {
    let call = 0
    const { run } = scripted({
      find: () => ({ findings: [finding()] }),
      verify: () => (++call === 2 ? { confirmed: false, reasoning: 'refuted' } : { confirmed: true, reasoning: 'ok' }),
    })
    const outcome = await runReview({ ...plan, verifiersPerFinding: 3 }, run)
    expect(outcome.confirmed).toEqual([])
    expect(outcome.refuted).toHaveLength(1)
  })

  it('drops a finding whose verifier failed rather than reporting it unverified', async () => {
    const { run } = scripted({
      find: () => ({ findings: [finding()] }),
      verify: () => new Error('child crashed'),
    })
    const outcome = await runReview(plan, run)
    expect(outcome.confirmed).toEqual([])
    expect(outcome.refuted).toHaveLength(1)
  })

  it('records a failed lens as a coverage gap without failing the review', async () => {
    const [first, second] = BUILT_IN_LENSES
    const { run } = scripted({
      find: label => label === `find:${first.key}` ? new Error('finder died') : { findings: [finding()] },
    })
    const outcome = await runReview({ ...plan, lenses: [first, second] }, run)
    expect(outcome.failedLenses).toEqual([first.key])
    expect(outcome.confirmed).toHaveLength(1)
  })

  it('runs one finder per lens', async () => {
    const { run, calls } = scripted({ find: label => ({ findings: [finding({ title: `only ${label}` })] }) })
    await runReview({ ...plan, lenses: BUILT_IN_LENSES }, run)
    expect(calls.filter(c => c.label.startsWith('find:'))).toHaveLength(BUILT_IN_LENSES.length)
  })

  // Every lens reporting the same two defects must cost two verifications,
  // not one per lens per defect: deduplication is what makes the fan-out
  // affordable and the report one entry per defect.
  it('verifies each distinct defect once however many lenses reported it', async () => {
    const { run, calls } = scripted({ find: () => ({ findings: [finding(), finding({ title: 'coupon lookup returns undefined' })] }) })
    const outcome = await runReview({ ...plan, lenses: BUILT_IN_LENSES, verifiersPerFinding: 2 }, run)
    expect(outcome.found).toBe(BUILT_IN_LENSES.length * 2)
    expect(outcome.merged).toBe(BUILT_IN_LENSES.length * 2 - 2)
    expect(outcome.confirmed).toHaveLength(2)
    expect(calls.filter(c => c.label.startsWith('verify:'))).toHaveLength(2 * 2)
  })

  it('attributes a merged defect to every lens that reported it', async () => {
    const { run } = scripted({ find: () => ({ findings: [finding()] }) })
    const outcome = await runReview({ ...plan, lenses: BUILT_IN_LENSES }, run)
    expect(outcome.confirmed[0].lens).toBe(BUILT_IN_LENSES.map(l => l.key).join('+'))
  })

  it('verifies the most severe findings first and reports what the budget dropped', async () => {
    const { run, calls } = scripted({
      find: () => ({
        findings: [
          finding({ title: 'minor one', severity: 'minor' }),
          finding({ title: 'critical one', severity: 'critical' }),
          finding({ title: 'major one', severity: 'major' }),
        ],
      }),
    })
    const outcome = await runReview({ ...plan, maxFindings: 2 }, run)
    expect(outcome.found).toBe(3)
    expect(outcome.dropped).toBe(1)
    expect(outcome.confirmed.map(f => f.title)).toEqual(['critical one', 'major one'])
    expect(calls.filter(c => c.label.startsWith('verify:'))).toHaveLength(2)
  })

  it('sorts confirmed findings by severity', async () => {
    const { run } = scripted({
      find: () => ({
        findings: [
          finding({ title: 'minor', severity: 'minor' }),
          finding({ title: 'critical', severity: 'critical' }),
        ],
      }),
    })
    const outcome = await runReview(plan, run)
    expect(outcome.confirmed.map(f => f.severity)).toEqual(['critical', 'minor'])
  })

  it('reports a clean review plainly', async () => {
    const { run } = scripted({})
    const outcome = await runReview(plan, run)
    expect(outcome).toMatchObject({ confirmed: [], refuted: [], found: 0, merged: 0, dropped: 0, failedLenses: [] })
    expect(renderOutcome(outcome)).toMatch(/No confirmed defects/)
  })
})

describe('concurrency bound', () => {
  it('never exceeds maxConcurrentChildren across finders and verifiers', async () => {
    let active = 0
    let peak = 0
    const run: RunChild = async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 0))
      active -= 1
      return { findings: [finding()] }
    }
    await runReview({ ...plan, lenses: BUILT_IN_LENSES, verifiersPerFinding: 3, maxConcurrentChildren: 2 }, run)
    expect(peak).toBeLessThanOrEqual(2)
  })
})

describe('prompts', () => {
  it('gives the finder its lens, the target, and the refutation warning', () => {
    const prompt = finderPrompt(lens, 'src/a.ts and src/b.ts')
    expect(prompt).toContain(lens.instructions)
    expect(prompt).toContain('src/a.ts and src/b.ts')
    expect(prompt).toMatch(/REFUTE/)
    expect(prompt).toMatch(/Reporting nothing is a valid/)
  })

  it('tells the verifier to attack the claim and default to refuting', () => {
    const prompt = verifierPrompt(finding({ line: 42, suggestedFix: 'use <' }), 'src/a.ts')
    expect(prompt).toMatch(/REFUTE it, not to agree/)
    expect(prompt).toContain('src/a.ts:42')
    expect(prompt).toContain('use <')
    expect(prompt).toMatch(/Default to `confirmed: false`/)
  })
})

describe('renderOutcome', () => {
  it('renders findings with location, failure, and fix, and lists refuted titles', () => {
    const text = renderOutcome({
      confirmed: [{ ...finding({ line: 7, suggestedFix: 'use <' }), lens: 'correctness', verification: 'reproduced' }],
      refuted: ['a refuted claim'],
      found: 2,
      merged: 0,
      dropped: 3,
      failedLenses: ['security'],
    })
    expect(text).toMatch(/1 confirmed defect\(s\) out of 2 reported/)
    expect(text).toContain('src/a.ts:7')
    expect(text).toContain('Failure: ')
    expect(text).toContain('Fix: use <')
    expect(text).toMatch(/Refuted by verification \(do not act on these\): a refuted claim/)
    expect(text).toMatch(/3 lower-severity finding\(s\)/)
    expect(text).toMatch(/Lenses that failed to run \(coverage gap\): security/)
  })
})

describe('selectLenses', () => {
  it('defaults to every built-in lens', () => {
    expect(selectLenses([])).toEqual(BUILT_IN_LENSES)
  })

  it('selects a subset in built-in order', () => {
    const keys = [BUILT_IN_LENSES[2].key, BUILT_IN_LENSES[0].key]
    expect(selectLenses(keys).map(l => l.key)).toEqual([BUILT_IN_LENSES[0].key, BUILT_IN_LENSES[2].key])
  })

  it('fails loud on an unknown lens and names the available ones', () => {
    expect(() => selectLenses(['typos'])).toThrow(/unknown review lens "typos"/)
    expect(() => selectLenses(['typos'])).toThrow(/available: correctness/)
  })
})

describe('structured-output narrowing', () => {
  it('treats a missing or malformed finder result as no findings', () => {
    expect(asFindings(undefined)).toEqual([])
    expect(asFindings({})).toEqual([])
    expect(asFindings({ findings: 'nope' })).toEqual([])
  })

  it('refutes when a verifier produced no usable verdict', () => {
    expect(asVerdict(undefined).confirmed).toBe(false)
    expect(asVerdict({ confirmed: 'yes' }).confirmed).toBe(false)
    expect(asVerdict({ confirmed: true, reasoning: 'ok' })).toEqual({ confirmed: true, reasoning: 'ok' })
  })
})

describe('depth', () => {
  const full = { ...plan, lenses: BUILT_IN_LENSES, maxFindings: 12, verifiersPerFinding: 3 }

  it('leaves a full review exactly as configured', () => {
    expect(applyDepth(full, 'full')).toEqual(full)
  })

  it('caps a quick review to fewer lenses, findings, and verifiers', () => {
    const quick = applyDepth(full, 'quick')
    expect(quick.lenses).toHaveLength(QUICK_LIMITS.maxLenses)
    expect(quick.lenses).toEqual(BUILT_IN_LENSES.slice(0, QUICK_LIMITS.maxLenses))
    expect(quick.maxFindings).toBe(QUICK_LIMITS.maxFindings)
    expect(quick.verifiersPerFinding).toBe(QUICK_LIMITS.verifiersPerFinding)
  })

  it('never raises a deployment that is already cheaper than quick', () => {
    const lean = { ...plan, lenses: [lens], maxFindings: 2, verifiersPerFinding: 1 }
    const quick = applyDepth(lean, 'quick')
    expect(quick.lenses).toHaveLength(1)
    expect(quick.maxFindings).toBe(2)
    expect(quick.verifiersPerFinding).toBe(1)
  })

  // Verification is the plugin's reason to exist; a cheaper review looks at
  // less rather than reporting claims nobody tried to refute.
  it('still verifies at quick depth', async () => {
    const { run, calls } = scripted({
      find: () => ({ findings: [finding()] }),
      verify: () => ({ confirmed: false, reasoning: 'refuted' }),
    })
    const outcome = await runReview(applyDepth(full, 'quick'), run)
    expect(calls.filter(c => c.label.startsWith('verify:')).length).toBeGreaterThan(0)
    expect(outcome.confirmed).toEqual([])
    expect(outcome.refuted).toHaveLength(1)
  })

  it('costs materially less than a full run on the same findings', async () => {
    const findings = () => ({ findings: [finding(), finding({ title: 'coupon lookup returns undefined' })] })
    const fullRun = scripted({ find: findings })
    const quickRun = scripted({ find: findings })
    await runReview(full, fullRun.run)
    await runReview(applyDepth(full, 'quick'), quickRun.run)
    expect(quickRun.calls.length).toBeLessThan(fullRun.calls.length / 2)
  })
})
