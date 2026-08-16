/**
 * Structured-output schemas for finder and verifier children, plus the
 * narrowing that turns their `unknown` structured results into typed records.
 * The seam validates a child's output against the schema it was given, so the
 * narrowing here only has to reject a child that ended without one.
 * @module dsh-review/schema
 */

/** One defect a finder reported, before verification. */
export interface Finding {
  /** Repo-relative path the finding is in. */
  file: string
  /** 1-indexed line the finding anchors to, when the finder identified one. */
  line?: number
  /** One-sentence statement of the defect. */
  title: string
  /** Evidence and reasoning: what the code does and why that is wrong. */
  detail: string
  /** Concrete inputs or state that produce the wrong behavior. */
  failureScenario: string
  /** How bad it is if it fires. */
  severity: 'critical' | 'major' | 'minor'
  /** The change that would fix it, when the finder can name one. */
  suggestedFix?: string
}

/** A verifier's ruling on one finding. */
export interface Verdict {
  /** True only when the verifier could not refute the finding. */
  confirmed: boolean
  /** Why it survived, or what refutes it. */
  reasoning: string
}

/** A finding that survived verification, with the lens that found it. */
export interface ConfirmedFinding extends Finding {
  /** Lens key of the finder that reported it. */
  lens: string
  /** The verifier's reasoning for letting it through. */
  verification: string
}

/** Object-rooted JSON Schema a finder child must satisfy. */
export const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      description: 'Every defect found under this lens; an empty array when the code is sound.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'title', 'detail', 'failureScenario', 'severity'],
        properties: {
          file: { type: 'string', description: 'Repo-relative path.' },
          line: { type: 'integer', description: '1-indexed line the defect anchors to.' },
          title: { type: 'string', description: 'One sentence stating the defect.' },
          detail: { type: 'string', description: 'What the code does and why that is wrong, with evidence.' },
          failureScenario: { type: 'string', description: 'Concrete inputs or state producing the wrong behavior.' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          suggestedFix: { type: 'string', description: 'The change that would fix it.' },
        },
      },
    },
  },
} as const

/** Object-rooted JSON Schema a verifier child must satisfy. */
export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmed', 'reasoning'],
  properties: {
    confirmed: {
      type: 'boolean',
      description: 'True only if the defect could not be refuted after reading the real code.',
    },
    reasoning: {
      type: 'string',
      description: 'What refutes the finding, or why it survives; cite what was read.',
    },
  },
} as const

/**
 * Narrow a finder child's structured result.
 * @param value - the child's validated structured output.
 * @returns the findings, or an empty list when the child produced none.
 */
export function asFindings(value: unknown): Finding[] {
  if (typeof value !== 'object' || value === null) return []
  const findings = (value as { findings?: unknown }).findings
  return Array.isArray(findings) ? findings as Finding[] : []
}

/**
 * Narrow a verifier child's structured result. A child that produced no valid
 * structured verdict cannot confirm anything: an unverified finding is dropped
 * rather than reported, because the whole point of the stage is that only
 * survivors of a real refutation attempt reach the user.
 * @param value - the child's validated structured output.
 * @returns the verdict, or a refutation standing in for an absent one.
 */
export function asVerdict(value: unknown): Verdict {
  if (typeof value !== 'object' || value === null) {
    return { confirmed: false, reasoning: 'verifier produced no structured verdict' }
  }
  const record = value as { confirmed?: unknown; reasoning?: unknown }
  return {
    confirmed: record.confirmed === true,
    reasoning: typeof record.reasoning === 'string' ? record.reasoning : 'verifier gave no reasoning',
  }
}
