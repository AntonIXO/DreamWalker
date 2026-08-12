/**
 * The dream's art direction, as numbers.
 *
 * §7.1 fixes the palette at the level of the dream and says slop is what you get when
 * every asset comes from its own universe. A palette alone does not get you there: two
 * tiles can use the same sixteen colours and still look like they were made by different
 * people, because what actually reads as "one hand" is the smaller stuff — how thick an
 * outline is, how much dithering there is, how many steps a surface is shaded in.
 *
 * So the reference image is measured for those too, and this is the result. It is carried
 * in the artifact, which means the browser has it: a tile minted at runtime obeys the same
 * measurements as one baked by the Lord, which is the whole reason runtime generation can
 * be allowed at all.
 *
 * Shared, so: no DOM, no node.
 */

/** A run of palette indices from darkest to lightest. The unit of shading. */
export type Ramp = number[];

export interface StyleProfile {
  /** Palette index every silhouette is stroked with. */
  outlineIndex: number;
  /** In pixels. Effectively always 1 for this style; measured rather than assumed. */
  outlineWidth: number;
  /** The lightest, emptiest colour. Ground for tiles that are mostly nothing. */
  groundIndex: number;
  /** Highest-chroma colour in the palette. Used sparingly, for the thing that matters. */
  accentIndex: number;
  /**
   * Hue family -> its ramp. Names are generated (`hue0`, `hue1`, …) because the families
   * come out of clustering the reference and have no meaning worth naming.
   */
  ramps: Record<string, Ramp>;
  /** Fraction of interior pixels that participate in a two-colour checker in the source. */
  ditherDensity: number;
  /** Typical ramp length, so a generator knows how many steps a surface gets. */
  shadingSteps: number;
}

/**
 * Fallback for dreams built before the reference pipeline existed, and for the built-in
 * palettes. Deliberately dull: one flat ramp and no dithering reads as "unstyled", which
 * is honest, rather than as some other artist's hand.
 */
export function defaultStyle(paletteSize: number): StyleProfile {
  const last = Math.max(0, paletteSize - 1);
  return {
    outlineIndex: 0,
    outlineWidth: 1,
    groundIndex: Math.min(1, last),
    accentIndex: last,
    ramps: { hue0: Array.from({ length: paletteSize }, (_, i) => i) },
    ditherDensity: 0,
    shadingSteps: Math.min(3, paletteSize),
  };
}

/**
 * Every ramp worth shading with, longest first.
 *
 * A one-colour "ramp" is a flat colour, not a ramp, and handing one to a generator that
 * asked for shading produces a tile that reads as unfinished next to its neighbours. They
 * are dropped unless there is nothing else.
 */
export function rampsByDepth(style: StyleProfile): Ramp[] {
  const all = Object.values(style.ramps).filter((ramp) => ramp.length > 0);
  const shadeable = all.filter((ramp) => ramp.length >= 2);
  return (shadeable.length > 0 ? shadeable : all).sort(
    (a, b) => b.length - a.length,
  );
}

/**
 * The nth shading family, wrapping.
 *
 * Indexed rather than hashed on purpose. Hashing a material's name looked neat and was
 * wrong: two materials that meet on screen would collide onto one family perfectly often,
 * and a world where grass, sand and the treeline are all the same tan is unreadable no
 * matter how faithful its palette is. Callers assign indices deliberately so that things
 * which touch each other differ; see `MATERIALS` in `terrain.ts`.
 */
export function rampAt(style: StyleProfile, index: number): Ramp {
  const ramps = rampsByDepth(style);
  if (ramps.length === 0) return [style.groundIndex];
  const wrapped = ((index % ramps.length) + ramps.length) % ramps.length;
  return ramps[wrapped]!;
}

/** A step along a ramp, clamped. `0` is darkest, `1` lightest. */
export function shade(ramp: Ramp, t: number): number {
  if (ramp.length === 0) return 0;
  const index = Math.round(t * (ramp.length - 1));
  return ramp[Math.max(0, Math.min(ramp.length - 1, index))]!;
}

/**
 * Whether this pixel takes the darker of two adjacent ramp steps.
 *
 * An ordered 4x4 Bayer matrix rather than noise: dithering in pixel art is a *pattern*,
 * and a random one reads as dirt. The density measured off the reference decides how much
 * of the matrix is used, so a source that barely dithers produces tiles that barely do.
 */
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function dithers(style: StyleProfile, x: number, y: number): boolean {
  if (style.ditherDensity <= 0) return false;
  const threshold = BAYER_4[y & 3]![x & 3]! / 16;
  return threshold < style.ditherDensity;
}
