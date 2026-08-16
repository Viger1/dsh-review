/**
 * Bounded concurrency for child-agent starts. A review's peak fan-out is
 * `maxFindings × verifiersPerFinding` plus one child per lens; without a bound
 * every one of those starts fires before any settles, which a large budget
 * turns into a self-inflicted overload — and, because per-child failures are
 * contained by design, the overload arrives as a report claiming everything
 * was refuted rather than as a loud error.
 * @module dsh-review/concurrency
 */

/**
 * Wrap a task starter so at most `limit` wrapped tasks run at once. Queued
 * tasks start in call order as slots free.
 * @param limit - maximum simultaneous tasks; must be a positive integer.
 * @returns a function that runs a task under the shared limit.
 */
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`concurrency limit must be a positive integer, got ${limit}`)
  }
  let active = 0
  const waiting: (() => void)[] = []

  const release = (): void => {
    active -= 1
    const next = waiting.shift()
    if (next) next()
  }

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>(resolve => waiting.push(resolve))
    }
    active += 1
    try {
      return await task()
    } finally {
      release()
    }
  }
}
