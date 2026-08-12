/**
 * The walk-sheet slicer, against a real Retro Diffusion output.
 *
 * `__fixtures__/walk-kirill-48.png` is an actual `rd_animation__four_angle_walking`
 * response (48px, `frames_duration: 4`, `return_spritesheet: true`), kept so this can be
 * a regression test rather than a $0.07 one. Every assertion below was verified by
 * eye against the sheet before it was written down — in particular the direction order,
 * which is documented nowhere and which rows 1 and 3 settle only when you notice they
 * are mirror images with the eye on opposite sides.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodePng } from "./reference";
import {
  anchorReport,
  guessDirections,
  pickTwoFrames,
  readWalkSheet,
} from "./walkSheet";

const load = (name: string) =>
  decodePng(readFileSync(join(import.meta.dir, "__fixtures__", name)));

/** Two independently generated sheets of the same character, from two styles. */
const sheetImage = load("walk-kirill-48.png");
const idleImage = load("walkidle-kirill-48.png");

describe("readWalkSheet", () => {
  test("a real four-angle walk is a 4x4 grid of 48px frames", () => {
    const sheet = readWalkSheet(sheetImage, 48);
    expect(sheet.rows).toBe(4);
    expect(sheet.cols).toBe(4);
    expect(sheet.frameW).toBe(48);
    expect(sheet.frames[0]![0]!.width).toBe(48);
  });

  test("refuses a sheet that is not a whole number of frames", () => {
    expect(() => readWalkSheet(sheetImage, 50)).toThrow(/whole number/);
  });
});

describe("guessDirections", () => {
  const sheet = readWalkSheet(sheetImage, 48);

  test("measures the order RD ships, without being told it", () => {
    // Verified by eye: row 0 is the back of a head, row 2 is a face, and rows 1 and 3
    // are mirrors with the face turned right and left respectively. That is RD's
    // undocumented "up, right, down, left" — but it is measured here, not assumed, so a
    // future model that reorders its output fails this test instead of the game.
    expect(guessDirections(sheet).order).toEqual(["n", "e", "s", "w"]);
  });

  test("reads a second style the same way", () => {
    // rd_animation__four_angle_walking_idle, same character and seed. This is the sheet
    // that killed the darkest-pixel heuristic: it used to come back n,w,s,e and would
    // have mirrored every profile in the game.
    expect(guessDirections(readWalkSheet(idleImage, 48)).order).toEqual([
      "n",
      "e",
      "s",
      "w",
    ]);
  });

  test("reports low confidence on a sheet whose profiles barely differ", () => {
    // The two profile rows are near-mirrors, so the separation is genuinely weak. A low
    // score here is the detector being honest, and it is what `--dirs` exists to override.
    const guess = guessDirections(sheet);
    expect(guess.confidence).toBeGreaterThan(0);
    expect(guess.confidence).toBeLessThan(0.6);
  });
});

describe("pickTwoFrames", () => {
  test("finds two contact poses that actually differ", () => {
    const sheet = readWalkSheet(sheetImage, 48);
    for (const row of sheet.frames) {
      const pick = pickTwoFrames(row);
      // §7.2 — a walk is two frames. Below about a fifth they read as a stutter.
      expect(pick.difference).toBeGreaterThan(0.2);
      expect(pick.indices[0]).not.toBe(pick.indices[1]);
    }
  });
});

describe("anchorReport", () => {
  test("the feet land where walkerView anchors them", () => {
    const sheet = readWalkSheet(sheetImage, 48);
    for (const row of sheet.frames) {
      const anchor = anchorReport(row[0]!);
      // `WalkerSprite` anchors at {0.5, 0.9}, i.e. 4.8px above the bottom of a 48px
      // frame. RD puts the feet 4–5px up, so the existing anchor is already right and
      // the sprite will stand on the tile line rather than float above it.
      expect(anchor.bottomGap).toBeGreaterThanOrEqual(2);
      expect(anchor.bottomGap).toBeLessThanOrEqual(8);
      expect(Math.abs(anchor.centroidOffset)).toBeLessThan(3);
    }
  });
});

describe("the sheet is ingestible at all", () => {
  test("comes back transparent, not on a background block", () => {
    const sheet = readWalkSheet(sheetImage, 48);
    const frame = sheet.frames[0]![0]!;
    let border = 0;
    let clear = 0;
    for (let x = 0; x < frame.width; x++) {
      for (const y of [0, frame.height - 1]) {
        border++;
        if ((frame.data[(y * frame.width + x) * 4 + 3] ?? 0) < 128) clear++;
      }
    }
    expect(clear / border).toBeGreaterThan(0.9);
  });
});
