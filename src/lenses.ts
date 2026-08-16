/**
 * Review lenses: the distinct perspectives finder agents run under. Separate
 * lenses exist so findings come from genuinely different reading strategies
 * rather than N copies of one reviewer agreeing with itself.
 * @module dsh-review/lenses
 */

/** One finder perspective. */
export interface Lens {
  /** Stable identifier, also the label shown while the finder runs. */
  key: string
  /** One line describing what this lens looks for, shown in the plan. */
  summary: string
  /** Instructions appended to the finder prompt. */
  instructions: string
}

/** The built-in lenses, in the order they are launched. */
export const BUILT_IN_LENSES: readonly Lens[] = [
  {
    key: 'correctness',
    summary: 'Logic that produces a wrong result for real inputs',
    instructions:
      'Hunt defects that make the code compute or return something wrong for inputs it '
      + 'will actually receive: off-by-one and boundary handling, wrong operator or '
      + 'comparison, inverted condition, mishandled empty/absent value, incorrect state '
      + 'transition, a diff that changes behavior its callers depend on. For every finding, '
      + 'name concrete inputs or state and the wrong output they produce.',
  },
  {
    key: 'lifecycle',
    summary: 'Resource, concurrency, and teardown faults',
    instructions:
      'Hunt defects in lifecycle and concurrency: resources acquired without a release path, '
      + 'cleanup that cannot run on the error path, races between concurrent entries into the '
      + 'same state, check-then-act gaps, cancellation that leaves work running, listeners or '
      + 'timers that outlive their owner, disposal that cannot reach quiescence. Describe the '
      + 'interleaving or failure path that triggers each one.',
  },
  {
    key: 'contract',
    summary: 'Violations of the API contracts this code depends on',
    instructions:
      'Read the contracts this code consumes — library and framework documentation, type '
      + 'declarations, sibling call sites in the same repository — and find where the code '
      + 'violates them: an option that does not mean what the call assumes, a declared '
      + 'guarantee the implementation does not actually provide, a return value handled as '
      + 'the wrong shape, an assumption about ordering or timing the contract never made. '
      + 'Cite the authoritative source for each contract you invoke.',
  },
  {
    key: 'security',
    summary: 'Trust-boundary and input-handling weaknesses',
    instructions:
      'Hunt weaknesses at trust boundaries: input that reaches a filesystem path, command, '
      + 'query, or URL without adequate containment; a check that a realistic input shape '
      + 'bypasses; secrets or credentials that reach logs, model context, or disk; a '
      + 'permission decision enforced somewhere a caller can go around. Prefer defects an '
      + 'ordinary user or a hostile page could actually trigger over theoretical ones, and '
      + 'say which.',
  },
]

/**
 * Select lenses by key, preserving the built-in order.
 * @param keys - requested lens keys; empty selects every built-in lens.
 * @returns the selected lenses.
 * @throws when a key names no built-in lens.
 */
export function selectLenses(keys: readonly string[]): readonly Lens[] {
  if (keys.length === 0) return BUILT_IN_LENSES
  const known = new Map(BUILT_IN_LENSES.map(lens => [lens.key, lens]))
  const unknown = keys.filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new Error(
      `unknown review lens ${unknown.map(key => JSON.stringify(key)).join(', ')}; `
      + `available: ${BUILT_IN_LENSES.map(lens => lens.key).join(', ')}`,
    )
  }
  return BUILT_IN_LENSES.filter(lens => keys.includes(lens.key))
}
