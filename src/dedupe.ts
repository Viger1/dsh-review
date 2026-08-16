/**
 * Cross-lens deduplication. Independent lenses routinely report the same
 * defect from different angles — a loop bound reported as both a correctness
 * error and a contract violation. Merging them before verification is what
 * keeps the report one entry per real defect, and it removes the verifier
 * calls the duplicates would each have cost.
 * @module dsh-review/dedupe
 */

import type { Finding } from './schema.js'

/** One defect, with every lens that reported it. */
export interface Grouped {
  /** The representative finding: the most severe, most specific report. */
  finding: Finding
  /** Lens keys that reported this defect, in first-seen order. */
  lenses: string[]
  /** How many raw findings were merged into this group. */
  mergedCount: number
}

/** A finding tagged with the lens that produced it. */
export interface LensFinding {
  finding: Finding
  lens: string
}

const SEVERITY_RANK = { critical: 0, major: 1, minor: 2 } as const

/** Words too common in defect titles to signal that two reports match. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'in', 'on', 'to', 'of', 'and', 'or', 'for', 'with',
  'that', 'this', 'it', 'its', 'be', 'can', 'may', 'when', 'without', 'not',
  'error', 'bug', 'issue', 'problem', 'incorrect', 'invalid', 'missing',
])

/**
 * Normalize a title into comparable content words.
 * @param title - the finding title.
 * @returns lowercase content words.
 */
function tokens(title: string): Set<string> {
  const words = title.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  return new Set(words.filter(word => word.length > 2 && !STOP_WORDS.has(word)))
}

/**
 * Jaccard similarity of two token sets.
 * @param a - first token set.
 * @param b - second token set.
 * @returns overlap ratio in [0, 1]; 0 when either side is empty.
 */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return shared / (a.size + b.size - shared)
}

/**
 * Whether two findings describe the same defect.
 *
 * Same file is required — a defect is located, and two files are two defects
 * even when they read alike. Within a file, an exact line match is treated as
 * the same defect when the titles share any content at all, because two lenses
 * anchoring to the same line are almost always describing one thing; findings
 * further apart need substantially overlapping titles.
 * @param a - one finding.
 * @param b - the other.
 * @param titleThreshold - similarity required when lines do not coincide.
 * @returns true when they should be merged.
 */
export function isSameDefect(a: Finding, b: Finding, titleThreshold: number): boolean {
  if (a.file !== b.file) return false
  const overlap = similarity(tokens(a.title), tokens(b.title))
  if (a.line !== undefined && b.line !== undefined && a.line === b.line) return overlap > 0
  // Some shared content is required whatever the threshold: at 0 a bare
  // `overlap >= titleThreshold` would merge every finding in a file, silently
  // discarding distinct defects as duplicates.
  return overlap > 0 && overlap >= titleThreshold
}

/**
 * Pick the report that should represent a group: the most severe, then the one
 * with the most specific evidence (a line number, then the longest failure
 * scenario), so merging never discards the sharpest description.
 * @param a - the current representative.
 * @param b - the candidate.
 * @returns the better representative.
 */
function betterRepresentative(a: Finding, b: Finding): Finding {
  if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
    return SEVERITY_RANK[a.severity] < SEVERITY_RANK[b.severity] ? a : b
  }
  if ((a.line === undefined) !== (b.line === undefined)) return a.line === undefined ? b : a
  return b.failureScenario.length > a.failureScenario.length ? b : a
}

/**
 * Merge findings that describe the same defect across lenses.
 * @param findings - every finding reported, tagged with its lens.
 * @param titleThreshold - title similarity required to merge findings on
 *   different lines of one file.
 * @returns one group per distinct defect, in first-seen order.
 */
export function dedupeFindings(findings: readonly LensFinding[], titleThreshold: number): Grouped[] {
  const groups: Grouped[] = []
  for (const { finding, lens } of findings) {
    const match = groups.find(group => isSameDefect(group.finding, finding, titleThreshold))
    if (match) {
      match.finding = betterRepresentative(match.finding, finding)
      if (!match.lenses.includes(lens)) match.lenses.push(lens)
      match.mergedCount += 1
    } else {
      groups.push({ finding, lenses: [lens], mergedCount: 1 })
    }
  }
  return groups
}
