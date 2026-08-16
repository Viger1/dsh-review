/**
 * Review orchestration: run one finder per lens in parallel, then give every
 * finding its own verifier whose task is to refute it, and report only what
 * survives.
 *
 * The verify stage is the point of the plugin. A single pass of parallel
 * reviewers produces plausible-sounding findings faster than a human can
 * triage them; making each claim survive an independent attempt at refutation
 * is what turns that output into something worth reading.
 * @module dsh-review/review
 */

import { createLimiter } from './concurrency.js'
import { dedupeFindings, type LensFinding } from './dedupe.js'
import type { Lens } from './lenses.js'
import {
  asFindings,
  asVerdict,
  FINDINGS_SCHEMA,
  VERDICT_SCHEMA,
  type ConfirmedFinding,
  type Finding,
} from './schema.js'

/** Starts one child agent and resolves its structured result. */
export type RunChild = (spec: {
  /** Short display label for the child. */
  label: string
  /** The child's prompt. */
  prompt: string
  /** Object-rooted JSON Schema the child must satisfy. */
  schema: unknown
}) => Promise<unknown>

/** What one review covers and how hard it looks. */
export interface ReviewPlan {
  /** What the finders are told to review (a diff, a path, a description). */
  target: string
  /** Lenses to run, one finder each. */
  lenses: readonly Lens[]
  /** Independent verifiers per finding; a finding survives only if all confirm. */
  verifiersPerFinding: number
  /** Upper bound on findings carried into verification. */
  maxFindings: number
  /** Maximum child agents running at once across the whole review. */
  maxConcurrentChildren: number
  /**
   * Title similarity required to merge two findings on different lines of one
   * file. Findings anchored to the same line merge on any shared content.
   */
  dedupeThreshold: number
}

/** The outcome of one review. */
export interface ReviewOutcome {
  /** Findings that survived every verifier. */
  confirmed: ConfirmedFinding[]
  /** Titles of findings a verifier refuted, so the user can see what was filtered. */
  refuted: string[]
  /** How many findings the finders reported before deduplication. */
  found: number
  /** How many raw findings were merged into another as the same defect. */
  merged: number
  /** How many findings were dropped without verification by `maxFindings`. */
  dropped: number
  /** Lens keys whose finder failed to produce a usable result. */
  failedLenses: string[]
}

/**
 * Build the prompt for one finder.
 * @param lens - the perspective this finder runs under.
 * @param target - what to review.
 * @returns the finder prompt.
 */
export function finderPrompt(lens: Lens, target: string): string {
  return `You are reviewing code as part of an automated review. Your lens: ${lens.key}.\n\n`
    + `## What to review\n\n${target}\n\n`
    + `## Your lens\n\n${lens.instructions}\n\n`
    + '## Rules\n\n'
    + '- Read the actual code before claiming anything. Inspect the files, follow the calls, '
    + 'and check the contracts you rely on. A finding you cannot ground in code you read is noise.\n'
    + '- Report DEFECTS, not style preferences, naming opinions, or "consider extracting this".\n'
    + '- Every finding needs a concrete failure scenario: the inputs or state, and the wrong '
    + 'behavior they produce. If you cannot write one, you do not have a finding.\n'
    + '- Reporting nothing is a valid and useful result. Do not invent findings to look thorough.\n'
    + '- Another agent will independently try to REFUTE each finding you report, so a weak claim '
    + 'costs you rather than padding your output.'
}

/**
 * Build the prompt for one verifier.
 * @param finding - the claim to attack.
 * @param target - the same target description the finder was given.
 * @returns the verifier prompt.
 */
export function verifierPrompt(finding: Finding, target: string): string {
  return 'You are verifying one claimed defect from an automated code review. Your job is to '
    + 'REFUTE it, not to agree with it.\n\n'
    + `## Review target\n\n${target}\n\n`
    + '## The claim\n\n'
    + `File: ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}\n`
    + `Severity: ${finding.severity}\n`
    + `Title: ${finding.title}\n`
    + `Detail: ${finding.detail}\n`
    + `Claimed failure scenario: ${finding.failureScenario}\n`
    + (finding.suggestedFix === undefined ? '' : `Suggested fix: ${finding.suggestedFix}\n`)
    + '\n## Rules\n\n'
    + '- Read the real code the claim is about. Do not rule on the claim as written.\n'
    + '- Try to break it: is the cited code actually reachable, does the claimed input really '
    + 'occur, does something else already prevent the failure, did the finder misread a '
    + 'contract, is the behavior deliberate and documented?\n'
    + '- Reproduce it when you can — a script or a focused test settles it better than reasoning.\n'
    + '- Confirm ONLY if you tried to refute it and failed. Default to `confirmed: false` when '
    + 'the evidence is ambiguous or the defect would not change behavior for real inputs.'
}

/**
 * Run one review: finders in parallel, then verifiers per finding.
 *
 * Failures are contained per child: a finder that dies costs its lens, a
 * verifier that dies refutes its finding (unverified findings are never
 * reported), and neither aborts the review.
 * @param plan - what to review and how hard.
 * @param runChild - starts one child agent and resolves its structured result.
 * @returns the confirmed findings and what was filtered out.
 */
export async function runReview(plan: ReviewPlan, runChild: RunChild): Promise<ReviewOutcome> {
  // Every child start goes through one limiter, so a large budget queues
  // instead of firing hundreds of agents at once.
  const limit = createLimiter(plan.maxConcurrentChildren)
  const startChild: RunChild = spec => limit(() => runChild(spec))
  const failedLenses: string[] = []
  const perLens = await Promise.all(plan.lenses.map(async (lens) => {
    try {
      const result = await startChild({
        label: `find:${lens.key}`,
        prompt: finderPrompt(lens, plan.target),
        schema: FINDINGS_SCHEMA,
      })
      return asFindings(result).map(finding => ({ finding, lens: lens.key }))
    } catch {
      // One lens failing is a coverage gap, reported as such rather than
      // failing the whole review.
      failedLenses.push(lens.key)
      return []
    }
  }))

  const all: LensFinding[] = perLens.flat()
  // Independent lenses report one defect several ways; merging before
  // verification keeps the report one entry per defect and removes the
  // verifier calls the duplicates would each have cost.
  const groups = dedupeFindings(all, plan.dedupeThreshold)
  // Verify the worst first so a budget cut drops the least important claims.
  const rank = { critical: 0, major: 1, minor: 2 }
  const ordered = [...groups].sort((a, b) => rank[a.finding.severity] - rank[b.finding.severity])
  const selected = ordered.slice(0, plan.maxFindings)

  const confirmed: ConfirmedFinding[] = []
  const refuted: string[] = []
  await Promise.all(selected.map(async ({ finding, lenses }) => {
    const verdicts = await Promise.all(Array.from({ length: plan.verifiersPerFinding }, async (_unused, index) => {
      try {
        return asVerdict(await startChild({
          label: `verify:${finding.file}`,
          prompt: verifierPrompt(finding, plan.target)
            + (index === 0 ? '' : '\n\nOther verifiers are ruling on this claim independently; reach your own conclusion.'),
          schema: VERDICT_SCHEMA,
        }))
      } catch {
        return { confirmed: false, reasoning: 'verifier failed to run' }
      }
    }))
    if (verdicts.every(verdict => verdict.confirmed)) {
      confirmed.push({ ...finding, lens: lenses.join('+'), verification: verdicts[0].reasoning })
    } else {
      refuted.push(finding.title)
    }
  }))

  confirmed.sort((a, b) => rank[a.severity] - rank[b.severity])
  return {
    confirmed,
    refuted,
    found: all.length,
    merged: all.length - groups.length,
    dropped: ordered.length - selected.length,
    failedLenses,
  }
}

/**
 * Render a review outcome as the text the model reads.
 * @param outcome - the completed review.
 * @returns the model-facing report.
 */
export function renderOutcome(outcome: ReviewOutcome): string {
  const lines: string[] = []
  lines.push(
    outcome.confirmed.length === 0
      ? `No confirmed defects. ${outcome.found} finding(s) reported, none survived verification.`
      : `${outcome.confirmed.length} confirmed defect(s) out of ${outcome.found} reported`
        + `${outcome.merged > 0 ? ` (${outcome.merged} duplicate report(s) merged)` : ''}.`,
  )
  for (const finding of outcome.confirmed) {
    lines.push(
      '',
      `## [${finding.severity}] ${finding.title}`,
      `${finding.file}${finding.line === undefined ? '' : `:${finding.line}`} · lens: ${finding.lens}`,
      finding.detail,
      `Failure: ${finding.failureScenario}`,
      ...(finding.suggestedFix === undefined ? [] : [`Fix: ${finding.suggestedFix}`]),
    )
  }
  if (outcome.refuted.length > 0) {
    lines.push('', `Refuted by verification (do not act on these): ${outcome.refuted.join('; ')}`)
  }
  if (outcome.dropped > 0) {
    lines.push('', `${outcome.dropped} lower-severity finding(s) exceeded maxFindings and were not verified.`)
  }
  if (outcome.failedLenses.length > 0) {
    lines.push('', `Lenses that failed to run (coverage gap): ${outcome.failedLenses.join(', ')}.`)
  }
  return lines.join('\n')
}
