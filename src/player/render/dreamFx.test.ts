import { describe, expect, test } from "bun:test";

import { CALM } from "../game/pressure";
import { DREAM_FX_FRAGMENT, DREAM_FX_VERTEX } from "./dreamFx.frag";
import {
  BURST_SECONDS,
  PRESSURE_ATTACH,
  SURGE_SECONDS,
  burstTint,
  envelope,
  hexToRgb01,
  paletteSwatches,
  presetId,
  shouldAttach,
} from "./dreamFx";

describe("shader source", () => {
  test("declares the uniforms the controller writes", () => {
    for (const name of [
      "uTime",
      "uBurst",
      "uSurge",
      "uPreset",
      "uPressure",
      "uReduced",
      "uCream",
      "uLive",
      "uTint",
    ]) {
      expect(DREAM_FX_FRAGMENT).toContain(name);
    }
    expect(DREAM_FX_VERTEX).toContain("vTextureCoord");
    expect(DREAM_FX_FRAGMENT).toContain("finalColor");
  });
});

describe("presetId", () => {
  test("maps the authored four, and nothing else, onto shader ints", () => {
    expect(presetId("none")).toBe(0);
    expect(presetId("split")).toBe(1);
    expect(presetId("double-edge")).toBe(2);
    expect(presetId("wrong-palette")).toBe(3);
  });
});

describe("envelope", () => {
  test("is 1 at the start of a burst and 0 when it is over", () => {
    expect(envelope(BURST_SECONDS, BURST_SECONDS)).toBe(1);
    expect(envelope(0, BURST_SECONDS)).toBe(0);
    expect(envelope(BURST_SECONDS / 2, BURST_SECONDS)).toBeCloseTo(0.5);
  });

  test("overflow lasts longer than a burst", () => {
    expect(SURGE_SECONDS).toBeGreaterThan(BURST_SECONDS);
    expect(envelope(BURST_SECONDS, SURGE_SECONDS)).toBeLessThan(1);
    expect(envelope(SURGE_SECONDS, SURGE_SECONDS)).toBe(1);
  });
});

describe("hexToRgb01", () => {
  test("reads a dream palette swatch", () => {
    const rgb = hexToRgb01("#f3f6f6");
    expect(rgb[0]).toBeCloseTo(243 / 255);
    expect(rgb[1]).toBeCloseTo(246 / 255);
    expect(rgb[2]).toBeCloseTo(246 / 255);
  });

  test("falls back when the string is not a colour", () => {
    expect([...hexToRgb01("nope")]).toEqual([1, 1, 1]);
  });
});

describe("paletteSwatches", () => {
  test("takes cream from background and live from accent", () => {
    const { cream, live } = paletteSwatches({
      name: "test",
      colors: ["#000000", "#f3f6f6", "#a32a65"],
      roles: {
        background: 1,
        floor: 0,
        floorAlt: 0,
        floorShadow: 0,
        threshold: 0,
        wall: 0,
        wallFace: 0,
        wallEdge: 0,
        doorOpen: 0,
        doorLocked: 0,
        doorSealed: 0,
        accent: 2,
        prop: 0,
        figure: 0,
        player: 0,
        highlight: 1,
      },
    });
    expect([...cream]).toEqual([...hexToRgb01("#f3f6f6")]);
    expect([...live]).toEqual([...hexToRgb01("#a32a65")]);
  });
});

describe("burstTint", () => {
  const cream = new Float32Array([0.95, 0.96, 0.96]);
  const live = new Float32Array([0.64, 0.16, 0.4]);

  test("a calm dream flashes its own accent", () => {
    expect([...burstTint(CALM, cream, live)]).toEqual([...live]);
  });

  test("a dreadful one flashes the negative of its cream", () => {
    const tint = burstTint({ dread: 1, unrest: 0 }, cream, live);
    expect(tint[0]).toBeCloseTo(1 - cream[0]!);
    expect(tint[1]).toBeCloseTo(1 - cream[1]!);
    expect(tint[2]).toBeCloseTo(1 - cream[2]!);
  });

  test("and crosses continuously between them", () => {
    const half = burstTint({ dread: 0.5, unrest: 0 }, cream, live);
    expect(half[0]).toBeCloseTo((live[0]! + (1 - cream[0]!)) / 2);
  });

  test("unrest does not touch the colour", () => {
    expect([...burstTint({ dread: 0, unrest: 1 }, cream, live)]).toEqual([
      ...live,
    ]);
  });
});

describe("shouldAttach", () => {
  const origin = CALM;

  test("stays off in an ordinary room while nothing is wrong", () => {
    expect(
      shouldAttach({
        enabled: true,
        preset: "none",
        burst: 0,
        surge: 0,
        pressure: origin,
      }),
    ).toBe(false);
  });

  test("turns on for an authored preset, a burst, or a surge", () => {
    expect(
      shouldAttach({
        enabled: true,
        preset: "wrong-palette",
        burst: 0,
        surge: 0,
        pressure: origin,
      }),
    ).toBe(true);
    expect(
      shouldAttach({
        enabled: true,
        preset: "none",
        burst: 1,
        surge: 0,
        pressure: origin,
      }),
    ).toBe(true);
    expect(
      shouldAttach({
        enabled: true,
        preset: "none",
        burst: 0,
        surge: 1,
        pressure: origin,
      }),
    ).toBe(true);
  });

  test("turns on only once the dream is measurably going wrong", () => {
    const justUnder = { dread: PRESSURE_ATTACH - 0.05, unrest: 0 };
    const over = { dread: 0, unrest: PRESSURE_ATTACH };
    expect(
      shouldAttach({
        enabled: true,
        preset: "none",
        burst: 0,
        surge: 0,
        pressure: justUnder,
      }),
    ).toBe(false);
    // Either axis on its own is enough — a still room that has worked you out and a
    // calm one being rearranged are both worth grading.
    expect(
      shouldAttach({
        enabled: true,
        preset: "none",
        burst: 0,
        surge: 0,
        pressure: over,
      }),
    ).toBe(true);
  });

  test("never attaches while the lobby owns the stage", () => {
    expect(
      shouldAttach({
        enabled: false,
        preset: "wrong-palette",
        burst: 1,
        surge: 1,
        pressure: { dread: 1, unrest: 1 },
      }),
    ).toBe(false);
  });
});
