/**
 * Reading a dream's look off a picture.
 *
 * The Lord draws (or commissions) one image and the whole world is derived from it. This
 * is §7.1's constraint-on-the-input taken to its conclusion: rather than asking a Lord to
 * pick sixteen hex codes, ask them for a picture they like and measure it.
 *
 * The measurement method is decided by what the reference actually is. Pixel art is
 * already palettised — the patient reference has forty-six unique colours and not one
 * anti-aliased pixel — so the honest reduction is an **exact histogram**, and the usual
 * quantisers are wrong here: median cut and k-means both invent centroid colours by
 * averaging, and an averaged violet is a colour the artist never used. Where clustering is
 * needed to get from forty-six down to sixteen, each cluster is represented by its
 * **medoid** — a real pixel from the source — never its mean.
 *
 * Node-only (`node:zlib`), so this stays under `tools/`. The browser never decodes a PNG;
 * it receives the finished palette in the artifact.
 */

import { inflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";

import {
  chroma,
  distance,
  hue,
  parseHex,
  toHex,
  toOklab,
  type Oklab,
  type Rgb,
} from "../../../src/shared/art/oklab";
import type { StyleProfile } from "../../../src/shared/art/style";

// ---------------------------------------------------------------------------
// PNG decode — the mirror of `png.ts`
// ---------------------------------------------------------------------------

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel. */
  data: Uint8Array;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Paeth, from the PNG spec. The one filter that is not obvious by inspection. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(buffer: Buffer): DecodedImage {
  if (buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("not a PNG");
  }

  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") plte = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;

    offset += 12 + length;
  }

  if (depth !== 8) {
    throw new Error(
      `reference PNG is ${depth}-bit; only 8 bits per channel are supported`,
    );
  }
  if (interlace !== 0)
    throw new Error("interlaced reference PNGs are not read");

  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

  const stride = width * channels;
  const bpp = channels;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * height);

  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read++]!;
    const line = raw.subarray(read, read + stride);
    read += stride;

    const current = out.subarray(y * stride, (y + 1) * stride);
    const previous =
      y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? current[i - bpp]! : 0;
      const b = previous[i]!;
      const c = i >= bpp ? previous[i - bpp]! : 0;
      const value = line[i]!;
      switch (filter) {
        case 0:
          current[i] = value;
          break;
        case 1:
          current[i] = (value + a) & 0xff;
          break;
        case 2:
          current[i] = (value + b) & 0xff;
          break;
        case 3:
          current[i] = (value + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          current[i] = (value + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
    }
  }

  // Everything becomes RGBA, so the callers below only ever deal with one layout.
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const source = i * channels;
    const target = i * 4;
    switch (colorType) {
      case 0: // greyscale
        data[target] = data[target + 1] = data[target + 2] = out[source]!;
        data[target + 3] = 255;
        break;
      case 4: // greyscale + alpha
        data[target] = data[target + 1] = data[target + 2] = out[source]!;
        data[target + 3] = out[source + 1]!;
        break;
      case 2: // truecolour
        data[target] = out[source]!;
        data[target + 1] = out[source + 1]!;
        data[target + 2] = out[source + 2]!;
        data[target + 3] = 255;
        break;
      case 6: // truecolour + alpha
        data.set(out.subarray(source, source + 4), target);
        break;
      case 3: {
        // indexed
        if (!plte) throw new Error("indexed PNG without a palette");
        const entry = out[source]! * 3;
        data[target] = plte[entry]!;
        data[target + 1] = plte[entry + 1]!;
        data[target + 2] = plte[entry + 2]!;
        data[target + 3] = trns?.[out[source]!] ?? 255;
        break;
      }
    }
  }

  return { width, height, data };
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

export interface Swatch {
  hex: string;
  rgb: Rgb;
  lab: Oklab;
  /** How many opaque pixels of the source are exactly this colour. */
  count: number;
  /** How many of those sit on a silhouette edge. Finds the outline colour. */
  edgeCount: number;
}

const OPAQUE = 128;

/**
 * Every distinct opaque colour, most-used first, with the edge tally that later decides
 * which one is the outline.
 */
export function histogram(image: DecodedImage): Swatch[] {
  const counts = new Map<number, { count: number; edge: number }>();
  const { width, height, data } = image;

  const opaqueAt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return data[(y * width + x) * 4 + 3]! >= OPAQUE;
  };
  const keyAt = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaqueAt(x, y)) continue;
      const key = keyAt(x, y);

      // "Edge" means the colour borders something visibly different or borders nothing at
      // all. A one-pixel outline is by definition the colour that does this most.
      let edge = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!opaqueAt(x + dx, y + dy)) {
          edge = true;
          break;
        }
        const neighbour = keyAt(x + dx, y + dy);
        if (neighbour !== key) {
          const a = toOklab(unpack(key));
          const b = toOklab(unpack(neighbour));
          if (Math.abs(a.L - b.L) > 0.25) {
            edge = true;
            break;
          }
        }
      }

      const entry = counts.get(key) ?? { count: 0, edge: 0 };
      entry.count++;
      if (edge) entry.edge++;
      counts.set(key, entry);
    }
  }

  return [...counts.entries()]
    .map(([key, { count, edge }]) => {
      const rgb = unpack(key);
      return {
        hex: toHex(rgb),
        rgb,
        lab: toOklab(rgb),
        count,
        edgeCount: edge,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function unpack(key: number): Rgb {
  return { r: (key >> 16) & 0xff, g: (key >> 8) & 0xff, b: key & 0xff };
}

// ---------------------------------------------------------------------------
// Reduction
// ---------------------------------------------------------------------------

/**
 * Reduce to `size` colours, keeping only colours that literally occur in the source.
 *
 * Farthest-point selection in OKLab, seeded with the three that carry the most meaning:
 * the commonest colour (the ground everything sits on), the darkest heavy-edge colour (the
 * outline — losing it makes every generated tile look mushy), and the most chromatic one
 * (§7's "one live colour"). After that, take whichever remaining colour is furthest from
 * everything already chosen, so the palette spans the image rather than clustering in
 * whatever hue happens to be commonest.
 */
export function reduce(swatches: Swatch[], size: number): Swatch[] {
  if (swatches.length <= size) return [...swatches];

  const chosen: Swatch[] = [];
  const take = (swatch: Swatch | undefined): void => {
    if (swatch && !chosen.includes(swatch)) chosen.push(swatch);
  };

  take(swatches[0]);
  take(outlineSwatch(swatches));
  take([...swatches].sort((a, b) => chroma(b.lab) - chroma(a.lab))[0]);

  while (chosen.length < size) {
    let best: Swatch | undefined;
    let bestScore = -Infinity;
    for (const swatch of swatches) {
      if (chosen.includes(swatch)) continue;
      const nearest = Math.min(
        ...chosen.map((c) => distance(swatch.lab, c.lab)),
      );
      // Weighted by usage, so a colour covering a tenth of the image beats an equally
      // isolated one that appears four times. Log, because raw counts span four orders of
      // magnitude and would otherwise drown the distance term entirely.
      const score = nearest * Math.log10(10 + swatch.count);
      if (score > bestScore) {
        bestScore = score;
        best = swatch;
      }
    }
    if (!best) break;
    chosen.push(best);
  }

  // Dark to light. A palette you can read down the ramp is one a Lord can hand-edit.
  return chosen.sort((a, b) => a.lab.L - b.lab.L);
}

/** The colour doing the most outlining: mostly-edge pixels, dark, and used a lot. */
function outlineSwatch(swatches: Swatch[]): Swatch | undefined {
  return [...swatches]
    .filter((s) => s.count > 0)
    .sort((a, b) => {
      const score = (s: Swatch): number =>
        (s.edgeCount / s.count) * Math.log10(10 + s.count) * (1 - s.lab.L);
      return score(b) - score(a);
    })[0];
}

// ---------------------------------------------------------------------------
// Style measurement
// ---------------------------------------------------------------------------

/** How many hue families to split the chromatic colours into. */
const HUE_FAMILIES = 4;
/** Below this OKLab chroma a colour is grey and belongs to no hue family. */
const GREY = 0.04;

/**
 * Measures the rules a generator has to follow to look like it came from the same hand.
 * Everything here is read off the reference; nothing is a taste judgement.
 */
export function measureStyle(
  image: DecodedImage,
  palette: readonly string[],
  swatches: Swatch[],
): StyleProfile {
  const labs = palette.map((hex) => toOklab(parseHex(hex)));

  const outline = outlineSwatch(swatches);
  const outlineIndex = outline
    ? nearestPaletteIndex(outline.lab, labs)
    : labs.reduce((lo, l, i, all) => (l.L < all[lo]!.L ? i : lo), 0);

  const groundIndex = labs.reduce(
    (hi, l, i, all) => (l.L > all[hi]!.L ? i : hi),
    0,
  );
  const accentIndex = labs.reduce(
    (hi, l, i, all) => (chroma(l) > chroma(all[hi]!) ? i : hi),
    0,
  );

  // Hue families: split the chromatic colours by hue angle, then order each family by
  // lightness. That ordering *is* the shading ramp — how this artist gets from a shadow to
  // a highlight without leaving the hue.
  const ramps: Record<string, number[]> = {};
  const greys: number[] = [];
  labs.forEach((lab, index) => {
    if (chroma(lab) < GREY) {
      greys.push(index);
      return;
    }
    // atan2 gives -π..π; shift to 0..1 before bucketing so the wrap lands inside a family
    // rather than splitting one down the middle.
    const turn = (hue(lab) + Math.PI) / (2 * Math.PI);
    const family = `hue${Math.min(HUE_FAMILIES - 1, Math.floor(turn * HUE_FAMILIES))}`;
    (ramps[family] ??= []).push(index);
  });
  if (greys.length > 0) ramps.neutral = greys;
  for (const ramp of Object.values(ramps)) {
    ramp.sort((a, b) => labs[a]!.L - labs[b]!.L);
  }

  const depths = Object.values(ramps).map((r) => r.length);

  return {
    outlineIndex,
    outlineWidth: 1,
    groundIndex,
    accentIndex,
    ramps,
    ditherDensity: measureDither(image),
    shadingSteps: depths.length
      ? Math.max(
          2,
          Math.round(depths.reduce((a, b) => a + b, 0) / depths.length),
        )
      : 2,
  };
}

function nearestPaletteIndex(target: Oklab, palette: readonly Oklab[]): number {
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

/**
 * Fraction of interior pixels sitting in a checkerboard with a neighbour of similar
 * lightness — which is what dithering is, and what distinguishes it from an edge.
 *
 * A near-zero result is a real answer, not a broken detector: plenty of good pixel art
 * shades in flat bands and never dithers at all. The patient reference measures 0.0001,
 * and generated tiles for that dream should therefore be flat too. Do not "fix" this by
 * putting a floor under it — that would impose a texture the reference does not have,
 * which is precisely the seam §7.1 exists to avoid.
 */
function measureDither(image: DecodedImage): number {
  const { width, height, data } = image;
  let checked = 0;
  let dithered = 0;

  const at = (x: number, y: number): Oklab | null => {
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const i = (y * width + x) * 4;
    if (data[i + 3]! < OPAQUE) return null;
    return toOklab({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! });
  };

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const here = at(x, y);
      const right = at(x + 1, y);
      const down = at(x, y + 1);
      const diagonal = at(x + 1, y + 1);
      if (!here || !right || !down || !diagonal) continue;
      checked++;

      // The signature of a dither: opposite corners equal, adjacent ones different but
      // close in lightness. A hard edge fails the closeness test; flat colour fails the
      // difference test.
      const sameDiagonal = distance(here, diagonal) < 0.001;
      const sameOther = distance(right, down) < 0.001;
      const differs = distance(here, right) > 0.001;
      const close = Math.abs(here.L - right.L) < 0.2;
      if (sameDiagonal && sameOther && differs && close) dithered++;
    }
  }

  return checked === 0 ? 0 : dithered / checked;
}

// ---------------------------------------------------------------------------
// The whole job
// ---------------------------------------------------------------------------

export interface ReferenceArt {
  path: string;
  width: number;
  height: number;
  /** Distinct opaque colours in the source, before reduction. */
  sourceColors: number;
  /** The dream palette, `#rrggbb`, dark to light. Every entry occurs in the source. */
  colors: string[];
  style: StyleProfile;
}

export async function readReference(
  path: string,
  size: number,
): Promise<ReferenceArt> {
  const image = decodePng(await readFile(path));
  const swatches = histogram(image);
  if (swatches.length === 0) {
    throw new Error(`${path} has no opaque pixels to take a palette from`);
  }

  const chosen = reduce(swatches, size);
  const colors = chosen.map((s) => s.hex);

  return {
    path,
    width: image.width,
    height: image.height,
    sourceColors: swatches.length,
    colors,
    style: measureStyle(image, colors, swatches),
  };
}
