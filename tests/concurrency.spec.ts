import { describe, expect, it } from 'vitest'
import { createLimiter } from '../src/concurrency.js'

/** A task whose settlement the test controls. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('createLimiter', () => {
  it('rejects a limit that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => createLimiter(bad)).toThrow(/positive integer/)
    }
  })

  it('never runs more than the limit at once', async () => {
    const limit = createLimiter(2)
    let active = 0
    let peak = 0
    const gate = deferred()
    const tasks = Array.from({ length: 10 }, () => limit(async () => {
      active += 1
      peak = Math.max(peak, active)
      await gate.promise
      active -= 1
    }))
    // Give every queued task a chance to start before releasing them.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(peak).toBe(2)
    gate.resolve()
    await Promise.all(tasks)
    expect(peak).toBe(2)
    expect(active).toBe(0)
  })

  it('starts a queued task as soon as a slot frees', async () => {
    const limit = createLimiter(1)
    const first = deferred()
    const order: string[] = []
    const a = limit(async () => { order.push('a-start'); await first.promise; order.push('a-end') })
    const b = limit(async () => { order.push('b-start') })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(order).toEqual(['a-start'])
    first.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['a-start', 'a-end', 'b-start'])
  })

  it('frees the slot when a task rejects, so a failure cannot deadlock the queue', async () => {
    const limit = createLimiter(1)
    await expect(limit(() => Promise.reject(new Error('child died')))).rejects.toThrow('child died')
    await expect(limit(() => Promise.resolve('after'))).resolves.toBe('after')
  })

  it('returns each task value to its own caller', async () => {
    const limit = createLimiter(3)
    const values = await Promise.all([1, 2, 3, 4, 5].map(n => limit(() => Promise.resolve(n * 10))))
    expect(values).toEqual([10, 20, 30, 40, 50])
  })
})
