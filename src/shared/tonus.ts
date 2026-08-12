/**
 * Тонус — the hidden coordinate the dream is scored on.
 *
 * Two axes, taken from LSD: Dream Emulator's chart. `x` is Upper/Downer, `y` is
 * Dynamic/Static, both signed, both starting at zero. Every room entry, every object
 * touched and every rise in suspicion nudges it. The player is never shown a number
 * (§3 — no meters, ever); they see it as colour, glitch and the way a room sounds.
 *
 * The whole point is the overflow. LSD stored its chart position in a signed byte, so
 * the Gray Man's (−10, −10) could push the marker past −128 and it would reappear at
 * the *bright* end. Fans called it chart value conversion; it was an integer overflow
 * bug. In a dream it reads as revelation — the worst thing that can happen, at
 * sufficient depth, comes out the other side as sunlight, because the counter was
 * never built for that much grief.
 *
 * So it is reproduced exactly, and it is deliberately *not* available everywhere:
 * ordinary rooms clamp, and the counter sits pinned at the floor. Only a meta-space
 * lets it wrap. That is `rooms.md` Part II — «мета-пространство — единственное место,
 * где график может переполниться» — and it is what keeps the effect an event rather
 * than a wobble.
 *
 * Must stay free of DOM *and* node APIs.
 */

/** A signed byte, because that is the whole joke. */
export const TONUS_MIN = -128;
export const TONUS_MAX = 127;

export interface TonusDelta {
  /** Upper (+) / Downer (−). */
  x: number;
  /** Dynamic (+) / Static (−). */
  y: number;
}

export type Quadrant =
  "upper-dynamic" | "upper-static" | "downer-dynamic" | "downer-static";

/**
 * Wrap into a signed byte, the way the counter that inspired this one did.
 *
 * Modulo rather than `& 0xff` so that a delta far outside the byte still lands
 * somewhere defensible instead of falling off a 32-bit cliff.
 */
export function wrapInt8(value: number): number {
  const wrapped = (((Math.round(value) + 128) % 256) + 256) % 256;
  return wrapped - 128;
}

/** Pin to a signed byte. What every room that is not a meta-space does. */
export function clampInt8(value: number): number {
  return Math.max(TONUS_MIN, Math.min(TONUS_MAX, Math.round(value)));
}

/** Whether a raw sum has left the byte — i.e. whether wrapping would change anything. */
export function overflows(value: number): boolean {
  return value < TONUS_MIN || value > TONUS_MAX;
}

/**
 * Add a delta to a position.
 *
 * `allowOverflow` is the meta-space privilege. Everywhere else the value clamps, and
 * `overflowed` stays false however hard the player pushes — the pressure is stored,
 * not spent, and it goes off the next time they touch the wrong thing and fall
 * through the floor of the game.
 */
export function advanceTonus(
  current: TonusDelta,
  delta: TonusDelta,
  allowOverflow: boolean,
): { position: TonusDelta; overflowed: boolean } {
  const rawX = current.x + delta.x;
  const rawY = current.y + delta.y;
  const overflowed = allowOverflow && (overflows(rawX) || overflows(rawY));
  const settle = allowOverflow ? wrapInt8 : clampInt8;
  return { position: { x: settle(rawX), y: settle(rawY) }, overflowed };
}

/** Zero counts as the bright half of both axes. Nothing sits exactly on the line. */
export function quadrantOf(position: TonusDelta): Quadrant {
  const vertical = position.x >= 0 ? "upper" : "downer";
  const horizontal = position.y >= 0 ? "dynamic" : "static";
  return `${vertical}-${horizontal}` as Quadrant;
}

/** −1..1 per axis, for renderers that want a strength rather than a byte. */
export function normaliseTonus(position: TonusDelta): TonusDelta {
  return {
    x: position.x / (position.x < 0 ? -TONUS_MIN : TONUS_MAX),
    y: position.y / (position.y < 0 ? -TONUS_MIN : TONUS_MAX),
  };
}

/** Multiply a delta, for «второй визит хуже первого» (§4.3). */
export function scaleTonus(delta: TonusDelta, factor: number): TonusDelta {
  return { x: delta.x * factor, y: delta.y * factor };
}
