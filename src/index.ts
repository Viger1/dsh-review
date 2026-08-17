/**
 * dsh-review — packaged multi-agent adversarial code review for DeepSeek
 * Harness. The `review` tool runs one finder per lens in parallel through the
 * subagent seam, then gives every finding its own verifier whose task is to
 * refute it, and reports only what survives. Named exports preserve loader
 * injection metadata.
 * @module dsh-review
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
// Type-only: merges `subagents` onto Context so the injected service resolves.
import type {} from '@deepseek-ai/dsh-subagent'
import { BUILT_IN_LENSES, selectLenses } from './lenses.js'
import { applyDepth, QUICK_LIMITS, renderOutcome, runReview, type ReviewDepth, type RunChild } from './review.js'

export const name = 'review'
export const inject = ['tools', 'subagents']

/** Deployment configuration; every tunable is a cordis.yml field. */
export interface Config {
  /** Subagent provider that runs finder and verifier children. */
  subagentProvider: string
  /** Lens keys to run; empty runs every built-in lens. */
  lenses: string[]
  /** Independent verifiers per finding; a finding survives only if all confirm. */
  verifiersPerFinding: number
  /** Upper bound on findings carried into verification. */
  maxFindings: number
  /**
   * Title similarity (0-1) required to merge two findings on different lines
   * of one file as the same defect. Lower merges more aggressively.
   */
  dedupeThreshold: number
  /** Delegation-depth cap for review children. */
  maxDepth: number
  /** Maximum child agents running at once across one review. */
  maxConcurrentChildren: number
  /** Register the bundled `adversarial-review` skill when the skill seam is composed. */
  registerSkill: boolean
}

/** Schemastery schema for {@link Config}. */
export const Config: z<Config> = z.object({
  subagentProvider: z.string().default('spawn'),
  lenses: z.array(z.string()).default([]),
  verifiersPerFinding: z.number().default(1),
  maxFindings: z.number().default(12),
  dedupeThreshold: z.number().default(0.5),
  maxDepth: z.number().default(2),
  maxConcurrentChildren: z.number().default(8),
  registerSkill: z.boolean().default(true),
})

/** The subagent seam surface this plugin consumes. */
interface SubagentsLike {
  start(name: string, request: {
    label: string
    prompt: { type: 'text'; text: string }[]
    parent: unknown
    signal: AbortSignal
    outputSchema?: unknown
    maxDepth?: number
  }): Promise<{ result: Promise<{ structured?: unknown; stopReason: string }>; dispose(): Promise<void> }>
  list(): string[]
}

/**
 * Register the `review` tool and (optionally) the bundled skill.
 * @param ctx - registrant context carrying the tool and subagent registries.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // Misconfiguration fails at load: an invalid value reaching the subagent
  // seam would surface as every lens failing, which reads like a clean review
  // that found nothing rather than a broken deployment.
  for (const field of ['verifiersPerFinding', 'maxFindings', 'maxConcurrentChildren'] as const) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1) {
      throw new Error(`dsh-review config ${field} must be a positive integer, got ${config[field]}`)
    }
  }
  if (!Number.isSafeInteger(config.maxDepth) || config.maxDepth < 0) {
    throw new Error(`dsh-review config maxDepth must be a non-negative integer, got ${config.maxDepth}`)
  }
  if (!(config.dedupeThreshold >= 0 && config.dedupeThreshold <= 1)) {
    throw new Error(`dsh-review config dedupeThreshold must be between 0 and 1, got ${config.dedupeThreshold}`)
  }
  // Fail loud at load on an unknown lens rather than at the first review.
  const lenses = selectLenses(config.lenses)

  if (config.registerSkill) {
    ctx.inject(['skills'], (skillCtx) => {
      skillCtx.skills.registerProvider(() => adversarialReviewProvider)
    })
  }

  ctx.tools.register(defineTool({
    name: 'review',
    description:
      'Review code with a panel of independent agents, then verify each finding '
      + 'adversarially: one finder per lens (correctness, lifecycle, contract, security) '
      + 'reports defects, and every finding gets its own verifier whose task is to refute '
      + 'it. Only findings that survive are reported, so the result is worth acting on '
      + 'rather than triaging. This is the most expensive tool in the session — every lens '
      + 'and every finding is another agent — so use `depth: quick` for a routine check on '
      + 'a small change and the default full depth for a pre-release audit or when the user '
      + 'asks for one. Describe the target precisely: a diff, a set of files, or a '
      + 'subsystem, plus what the change is meant to do, because the children read the '
      + 'repository themselves and cannot infer intent.',
    // The children have their own budgets; this bounds the whole fan-out.
    timeoutMs: 1_800_000,
    parameters: {
      target: {
        type: 'string',
        required: true,
        description:
          'What to review, stated for an agent that will open the files itself: paths, a '
          + 'commit range or `git diff` to run, plus any context that decides what "correct" '
          + 'means here (the change\'s intent, the contracts it must honor).',
      },
      lenses: {
        type: 'array',
        description: `Lens keys to run; omit for the deployment default. Available: ${BUILT_IN_LENSES.map(lens => lens.key).join(', ')}.`,
        items: { type: 'string' },
      },
      depth: {
        type: 'string',
        enum: ['quick', 'full'],
        description:
          `quick caps the run at ${QUICK_LIMITS.maxLenses} lenses, ${QUICK_LIMITS.maxFindings} verified findings, `
          + `and ${QUICK_LIMITS.verifiersPerFinding} verifier — roughly a third of the cost, for a routine check on a `
          + 'small change. full (the default) uses the deployment settings for a pre-release audit. Verification runs at '
          + 'both depths; a cheaper review looks at less rather than trusting more.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          confirmed: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                file: { type: 'string', required: true },
                line: { type: 'integer' },
                title: { type: 'string', required: true },
                detail: { type: 'string', required: true },
                failureScenario: { type: 'string', required: true },
                severity: { type: 'string', required: true, enum: ['critical', 'major', 'minor'] },
                suggestedFix: { type: 'string' },
                lens: { type: 'string', required: true },
                verification: { type: 'string', required: true },
              },
            },
          },
          refuted: { type: 'array', required: true, items: { type: 'string' } },
          found: { type: 'integer', required: true },
          merged: { type: 'integer', required: true },
          dropped: { type: 'integer', required: true },
          failedLenses: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value) }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('review requires an owning agent session to delegate from')
      const subagents = ctx.subagents as unknown as SubagentsLike
      if (subagents.list().includes(config.subagentProvider) === false) {
        throw new Error(
          `subagent provider ${JSON.stringify(config.subagentProvider)} is not composed; `
          + `available: ${subagents.list().join(', ') || 'none'}`,
        )
      }
      const runChild: RunChild = async ({ label, prompt, schema }) => {
        const run = await subagents.start(config.subagentProvider, {
          label,
          prompt: [{ type: 'text', text: prompt }],
          parent: exec.agent,
          signal: exec.signal,
          outputSchema: schema,
          maxDepth: config.maxDepth,
        })
        try {
          const result = await run.result
          if (result.stopReason !== 'completed') {
            throw new Error(`child ${label} ended with stopReason ${result.stopReason}`)
          }
          return result.structured
        } finally {
          await run.dispose()
        }
      }
      const requested = args.lenses === undefined || args.lenses.length === 0 ? lenses : selectLenses(args.lenses)
      const plan = applyDepth({
        target: args.target,
        lenses: requested,
        verifiersPerFinding: config.verifiersPerFinding,
        maxFindings: config.maxFindings,
        dedupeThreshold: config.dedupeThreshold,
        maxConcurrentChildren: config.maxConcurrentChildren,
      }, (args.depth ?? 'full') as ReviewDepth)
      return runReview(plan, runChild)
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Adversarial review',
      kind: 'search',
      rawInput: args.target,
    }),
  }))
}

const SKILL_BODY_URL = new URL('../skills/adversarial-review/SKILL.md', import.meta.url)
const SKILL_RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../skills/adversarial-review/', import.meta.url)),
} as const
const SKILL_INVOCATION = { modelInvocable: true, userInvocable: true } as const
const SKILL_DESCRIPTION =
  'Run the review tool before claiming non-trivial work is done: how to describe a target so '
  + 'the finders read the right code, how to choose lenses, and how to act on confirmed '
  + 'findings versus refuted ones.'

const SKILL_CANDIDATE: SkillCandidate = {
  name: 'adversarial-review',
  description: SKILL_DESCRIPTION,
  invocation: SKILL_INVOCATION,
  provider: 'dsh-review',
  source: 'bundled',
  resourceBase: SKILL_RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

/** Bundled skill provider serving the adversarial-review workflow. */
const adversarialReviewProvider: SkillProvider = {
  name: 'dsh-review',
  list: () => Promise.resolve([SKILL_CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: SKILL_CANDIDATE.name,
      description: SKILL_CANDIDATE.description,
      invocation: SKILL_CANDIDATE.invocation,
      provider: SKILL_CANDIDATE.provider,
      source: SKILL_CANDIDATE.source,
      resourceBase: SKILL_RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}
