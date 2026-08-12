/**
 * The generators' randomness.
 *
 * The implementation is shared with the player runtime (`src/shared/rng.ts`) so a
 * sequence means the same thing on both sides. Only the seed-word helper is
 * authoring-specific: a Lord rerolling a layout needs something they can read off the
 * screen and type back in.
 */

export { hashSeed, makeRng, type Rng } from "../../src/shared/rng";

const SYLLABLES = [
  "mor",
  "vel",
  "ash",
  "tun",
  "sil",
  "kra",
  "ondi",
  "esk",
  "tal",
  "vor",
  "nim",
  "sar",
  "dol",
  "yth",
  "rev",
  "asp",
];

/** A short, pronounceable seed the Lord can write down and retype. */
export function randomSeedWord(): string {
  const count = 2 + Math.floor(Math.random() * 2);
  let out = "";
  for (let i = 0; i < count; i++) {
    out += SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
  }
  return out;
}
