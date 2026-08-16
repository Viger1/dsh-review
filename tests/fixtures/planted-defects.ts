/**
 * Acceptance fixture: a module with three planted defects, used to check that
 * a real review run finds them. Not part of the plugin runtime.
 *
 * Planted:
 *   1. `total` — loop bound `<=` reads one past the end (throws on every input).
 *   2. `couponDiscount` — unknown codes return `undefined`, poisoning arithmetic.
 *   3. `loadCart` — unvalidated `userId` interpolated into a filesystem path.
 */

/** One cart line. */
export interface Item { price: number; qty: number }

/** Sum the cart with a percentage discount applied. */
export function total(items: Item[], discountPercent: number): number {
  let sum = 0
  for (let i = 0; i <= items.length; i++) {
    sum += items[i].price * items[i].qty
  }
  return sum * (1 - discountPercent / 100)
}

/** Apply a coupon code, returning the discount percentage. */
export function couponDiscount(code: string): number {
  const codes: Record<string, number> = { SAVE10: 10, SAVE20: 20 }
  return codes[code.toUpperCase()]
}

/** Read a user's saved cart from disk. */
export async function loadCart(userId: string): Promise<string> {
  const fs = await import('node:fs/promises')
  return fs.readFile(`/var/carts/${userId}.json`, 'utf8')
}
