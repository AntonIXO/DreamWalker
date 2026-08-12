/**
 * Seeded randomness, shared by the Lord's generators and the player's runtime.
 *
 * On the authoring side a seed is a reroll knob. At runtime it is something narrower:
 * the heartbeat needs to make arbitrary-looking choices that are still reproducible
 * within a cycle, so that re-entering a room shows the same dream and not a new one.
 */

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** Uniform pick. Throws on an empty list, which is always a caller bug. */
  pick<T>(items: readonly T[]): T;
  /** Uniform pick, or null when there is nothing to pick from. */
  maybePick<T>(items: readonly T[]): T | null;
  /** Fisher-Yates, returns a new array. */
  shuffle<T>(items: readonly T[]): T[];
  chance(probability: number): boolean;
  readonly seed: number;
}

/** FNV-1a, so a human-typed seed lands somewhere unpredictable. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, and good enough that choices do not visibly repeat. */
export function makeRng(seed: number | string): Rng {
  const numericSeed = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  let state = numericSeed;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) throw new Error(`int(${min}, ${max}): empty range`);
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    seed: numericSeed,
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("pick() from an empty list");
      return items[int(0, items.length - 1)]!;
    },
    maybePick<T>(items: readonly T[]): T | null {
      return items.length === 0 ? null : items[int(0, items.length - 1)]!;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    chance(probability: number): boolean {
      return next() < probability;
    },
  };
}
