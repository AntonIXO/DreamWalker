/**
 * Turning a Retro Diffusion walk sheet into frames the game can use.
 *
 * `rd_animation__four_angle_walking` returns 48×48 frames in a grid — four directions by
 * four frames, 192×192 with `return_spritesheet: true`. Two things about that grid are
 * *not* documented anywhere: which row is which direction, and which order the rows come
 * in. The RD docs say "up, right, down, left"; the repo uses `s, n, e, w`. Trusting
 * either would produce a character who walks north while facing the camera, and the bug
 * would look like an animation problem rather than an indexing one.
 *
 * So the order is measured from the pixels. Three cheap tests, in order of confidence:
 *
 *   1. **Mirror symmetry** splits the four rows into the two that face the camera or away
 *      (near-symmetric) and the two profiles (not). No assumptions at all.
 *   2. **Head detail** separates front from back within the symmetric pair: a face has
 *      eyes and more colours than the back of a head. This is the same distinction
 *      `silhouettes.ts` draws by hand for the placeholder sprites.
 *   3. **Skin position** separates left from right: in a profile the face protrudes
 *      toward the direction of travel, so the warm bright pixels sit ahead of the head's
 *      own centre. (A darkest-pixel test was tried first and mirrored a walk+idle sheet,
 *      where the darkest pixel is hood shadow on the far side of the head.)
 *
 * Everything here is pure and offline, so it costs nothing to run and can be unit-tested
 * against a fixture instead of against the API.
 */

import type { DecodedImage } from "./reference";
import { DIRECTIONS, type Direction } from "./silhouettes";

export interface WalkSheet {
  cols: number;
  rows: number;
  frameW: number;
  frameH: number;
  /** `frames[row][col]`. */
  frames: DecodedImage[][];
}

export interface DirectionGuess {
  order: Direction[];
  /** 0..1. Below ~0.5 the sheet is odd and a human should look at it. */
  confidence: number;
  evidence: Record<string, number>;
}

function cut(
  image: DecodedImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
): DecodedImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * image.width + x0) * 4;
    data.set(image.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

/**
 * Slice a sheet into a grid.
 *
 * `cols` and `rows` are derived from the returned image rather than assumed, because a
 * style that changes its layout should produce a loud failure here and not a silently
 * wrong sprite.
 */
export function readWalkSheet(image: DecodedImage, frameSize = 48): WalkSheet {
  if (image.width % frameSize !== 0 || image.height % frameSize !== 0) {
    throw new Error(
      `walk sheet is ${image.width}x${image.height}, not a whole number of ${frameSize}px frames`,
    );
  }
  const cols = image.width / frameSize;
  const rows = image.height / frameSize;
  if (rows < 4 || cols < 2) {
    throw new Error(
      `expected at least 4 rows and 2 columns of ${frameSize}px frames, got ${rows}x${cols}`,
    );
  }
  const frames: DecodedImage[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: DecodedImage[] = [];
    for (let col = 0; col < cols; col++) {
      line.push(
        cut(image, col * frameSize, row * frameSize, frameSize, frameSize),
      );
    }
    frames.push(line);
  }
  return { cols, rows, frameW: frameSize, frameH: frameSize, frames };
}

function opaque(image: DecodedImage, x: number, y: number): boolean {
  return (image.data[(y * image.width + x) * 4 + 3] ?? 0) > 128;
}

/** Fraction of opaque pixels that differ from the horizontally mirrored image. */
function mirrorDifference(frame: DecodedImage): number {
  let counted = 0;
  let different = 0;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const mirrored = frame.width - 1 - x;
      const a = opaque(frame, x, y);
      const b = opaque(frame, mirrored, y);
      if (!a && !b) continue;
      counted++;
      if (a !== b) {
        different++;
        continue;
      }
      if (!a) continue;
      const i = (y * frame.width + x) * 4;
      const j = (y * frame.width + mirrored) * 4;
      const delta =
        Math.abs((frame.data[i] ?? 0) - (frame.data[j] ?? 0)) +
        Math.abs((frame.data[i + 1] ?? 0) - (frame.data[j + 1] ?? 0)) +
        Math.abs((frame.data[i + 2] ?? 0) - (frame.data[j + 2] ?? 0));
      if (delta > 60) different++;
    }
  }
  return counted === 0 ? 1 : different / counted;
}

/** Distinct colours in the top band, where a face is and the back of a head is not. */
function headDetail(frame: DecodedImage): number {
  const band = Math.max(1, Math.round(frame.height * 0.4));
  const seen = new Set<number>();
  for (let y = 0; y < band; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (!opaque(frame, x, y)) continue;
      const i = (y * frame.width + x) * 4;
      seen.add(
        ((frame.data[i] ?? 0) << 16) |
          ((frame.data[i + 1] ?? 0) << 8) |
          (frame.data[i + 2] ?? 0),
      );
    }
  }
  return seen.size;
}

/**
 * How far the face sits from the centre of the head, in pixels. Positive is east.
 *
 * The first version of this looked for the *darkest* pixel in the head band, on the
 * theory that it would be an eye. It was right on a walking sheet and wrong on a walk+idle
 * sheet of the same character, where the darkest pixel is hood shadow on the far side of
 * the head — which would have mirrored every profile frame in the game.
 *
 * Skin is the better cue and it is the one that survives: in a profile the face
 * protrudes toward the direction of travel, so the mean x of warm bright pixels sits
 * ahead of the head's own centre. Verified against two independently generated sheets,
 * both of which it reads correctly.
 */
function skinBias(frame: DecodedImage): number {
  const band = Math.max(1, Math.round(frame.height * 0.45));
  const headXs: number[] = [];
  const skinXs: number[] = [];
  for (let y = 0; y < band; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (!opaque(frame, x, y)) continue;
      headXs.push(x);
      const i = (y * frame.width + x) * 4;
      const r = frame.data[i] ?? 0;
      const g = frame.data[i + 1] ?? 0;
      const b = frame.data[i + 2] ?? 0;
      // Bright and warmer than it is cool: skin under this palette, not hood or hair.
      if (r > 200 && g > 180 && b > 140 && r - b > 25) skinXs.push(x);
    }
  }
  if (headXs.length === 0 || skinXs.length === 0) return 0;
  const centre = (Math.min(...headXs) + Math.max(...headXs)) / 2;
  return skinXs.reduce((a, b) => a + b, 0) / skinXs.length - centre;
}

/**
 * Work out which row is which direction.
 *
 * Returns the order in the repo's own vocabulary, so the caller can name frames
 * `figure_<id>_<dir>_<frame>` without a translation table.
 */
export function guessDirections(sheet: WalkSheet): DirectionGuess {
  const first = sheet.frames.map((row) => row[0]!);
  const symmetry = first.map(mirrorDifference);

  // The two least-mirrored rows face toward or away; the other two are profiles.
  const bySymmetry = symmetry
    .map((value, index) => ({ index, value }))
    .sort((a, b) => a.value - b.value);
  const facing = [bySymmetry[0]!.index, bySymmetry[1]!.index];
  const profile = [bySymmetry[2]!.index, bySymmetry[3]!.index];

  const detail = first.map(headDetail);
  // More colours in the head band is a face; fewer is the back of one.
  const [south, north] =
    detail[facing[0]!]! >= detail[facing[1]!]!
      ? [facing[0]!, facing[1]!]
      : [facing[1]!, facing[0]!];

  const bias = first.map(skinBias);
  const [east, west] =
    bias[profile[0]!]! >= bias[profile[1]!]!
      ? [profile[0]!, profile[1]!]
      : [profile[1]!, profile[0]!];

  const order: Direction[] = new Array(sheet.rows).fill("s");
  order[south] = "s";
  order[north] = "n";
  order[east] = "e";
  order[west] = "w";

  // Confidence is how cleanly each test separated its pair. A sheet that scores low is
  // not wrong, it is unproven — print it and let a human say.
  const symmetryGap = bySymmetry[2]!.value - bySymmetry[1]!.value;
  const detailGap =
    Math.abs(detail[south]! - detail[north]!) /
    Math.max(1, Math.max(detail[south]!, detail[north]!));
  // Bias is in pixels now; a couple of pixels of separation is already decisive.
  const biasGap = Math.min(1, Math.abs(bias[east]! - bias[west]!) / 3);
  const confidence = Math.min(
    1,
    (Math.min(1, symmetryGap * 4) + detailGap + biasGap) / 3,
  );

  return {
    order: order.filter((_, i) => i < sheet.rows) as Direction[],
    confidence,
    evidence: {
      symmetryGap,
      detailGap,
      biasGap,
      ...Object.fromEntries(symmetry.map((v, i) => [`mirror${i}`, v])),
    },
  };
}

/**
 * Reduce a row to the repo's two walk frames.
 *
 * §7.2 — a walk is two frames and that is the style. The pair chosen is the one that
 * differs most, which is the two contact poses; a pair that barely differs would read as
 * a stutter rather than a stride, so it is worth knowing about.
 */
export function pickTwoFrames(row: readonly DecodedImage[]): {
  indices: [number, number];
  difference: number;
} {
  let best: [number, number] = [0, Math.min(1, row.length - 1)];
  let bestDifference = -1;
  for (let a = 0; a < row.length; a++) {
    for (let b = a + 1; b < row.length; b++) {
      const difference = frameDifference(row[a]!, row[b]!);
      if (difference > bestDifference) {
        bestDifference = difference;
        best = [a, b];
      }
    }
  }
  return { indices: best, difference: bestDifference };
}

function frameDifference(a: DecodedImage, b: DecodedImage): number {
  let counted = 0;
  let different = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const alphaA = (a.data[i + 3] ?? 0) > 128;
    const alphaB = (b.data[i + 3] ?? 0) > 128;
    if (!alphaA && !alphaB) continue;
    counted++;
    if (alphaA !== alphaB) {
      different++;
      continue;
    }
    const delta =
      Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)) +
      Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)) +
      Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0));
    if (delta > 60) different++;
  }
  return counted === 0 ? 0 : different / counted;
}

/**
 * Where the feet sit, which is the single most visible ingestion failure.
 *
 * `walkerView` anchors a sprite at its feet so that sorting by Y is depth. A frame with
 * empty rows under the character floats; one whose weight is off-centre slides sideways
 * as it walks.
 */
export function anchorReport(frame: DecodedImage): {
  bottomGap: number;
  centroidOffset: number;
} {
  let lowest = -1;
  let sumX = 0;
  let count = 0;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (!opaque(frame, x, y)) continue;
      lowest = y;
      sumX += x;
      count++;
    }
  }
  if (count === 0) return { bottomGap: frame.height, centroidOffset: 0 };
  return {
    bottomGap: frame.height - 1 - lowest,
    centroidOffset: sumX / count - (frame.width - 1) / 2,
  };
}

export { DIRECTIONS };
