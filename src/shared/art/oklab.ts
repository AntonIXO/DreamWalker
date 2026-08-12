/**
 * Colour distance that matches how colours actually look.
 *
 * Needed because reducing the reference image to a dream palette has to decide which of
 * two violets to keep, and sRGB distance gets that wrong in exactly the region this
 * reference lives in — deep blues and violets are crowded together in RGB and far apart
 * to the eye. OKLab is the current standard answer and is about fifteen lines of maths.
 *
 * Björn Ottosson, "A perceptual color space for image processing" (2020).
 */

export interface Oklab {
  /** Perceptual lightness, 0..1. */
  L: number;
  a: number;
  b: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const pair = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

/** sRGB's transfer function. Skipping it is the usual reason palette maths looks wrong. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function toOklab({ r, g, b }: Rgb): Oklab {
  const lr = linearise(r);
  const lg = linearise(g);
  const lb = linearise(b);

  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** How colourful, regardless of hue or lightness. */
export function chroma({ a, b }: Oklab): number {
  return Math.hypot(a, b);
}

/** Hue angle in radians, -π..π. Meaningless for near-grey colours; check chroma first. */
export function hue({ a, b }: Oklab): number {
  return Math.atan2(b, a);
}

export function distance(x: Oklab, y: Oklab): number {
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

/** Nearest entry of a palette, by eye. The only sanctioned way to force a colour in. */
export function nearestIndex(target: Oklab, palette: readonly Oklab[]): number {
  let best = 0;
  let bestDistance = Infinity;
  palette.forEach((candidate, i) => {
    const d = distance(target, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}
