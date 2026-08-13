import { describe, expect, test } from "bun:test";

import { TONUS_MAX, TONUS_MIN } from "../../shared/tonus";
import { DREAM_FX_FRAGMENT, DREAM_FX_VERTEX } from "./dreamFx.frag";
import {
  BURST_SECONDS,
  OVERFLOW_SECONDS,
  TONUS_ATTACH,
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
      "uOverflow",
      "uPreset",
      "uTonus",
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
    expect(OVERFLOW_SECONDS).toBeGreaterThan(BURST_SECONDS);
    expect(envelope(BURST_SECONDS, OVERFLOW_SECONDS)).toBeLessThan(1);
    expect(envelope(OVERFLOW_SECONDS, OVERFLOW_SECONDS)).toBe(1);
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

  test("upper-dynamic is the live colour — a bright link", () => {
    expect([...burstTint({ x: 8, y: 4 }, cream, live)]).toEqual([...live]);
  });

  test("downer-dynamic is the complement, the way overflow reads as the other side", () => {
    const tint = burstTint({ x: -8, y: 4 }, cream, live);
    expect(tint[0]).toBeCloseTo(1 - live[0]!);
    expect(tint[1]).toBeCloseTo(1 - live[1]!);
    expect(tint[2]).toBeCloseTo(1 - live[2]!);
  });

  test("static halves mix toward cream or its inverse", () => {
    const upper = burstTint({ x: 4, y: -2 }, cream, live);
    expect(upper[0]).toBeGreaterThan(live[0]!);
    const downer = burstTint({ x: -4, y: -2 }, cream, live);
    expect(downer[0]).toBeLessThan(0.5);
  });
});

describe("shouldAttach", () => {
  const origin = { x: 0, y: 0 };

  test("stays off in an ordinary room at the origin", () => {
    expect(
      shouldAttach({
        enabled: true,
        preset: "none",
        burst: 0,
        overflow: 0,
        tonus: origin,
      }),
    ).toBe(false);
  });

  test("turns on for an authored preset, a burst, or an overflow", () => {
    expect(
      shouldAttach({
        enabled: true,
        preset: "wrong-palette",
        burst: 0,
        overflow: 0,
        tonus: origin,
      }),
    ).toBe(true);
    expect(
      shouldAttach({
        enabled: true,
        preset: "none",
        burst: 1,
        overflow: 0,
        tonus: origin,
      }),
    ).toBe(true);
    expect(
      shouldAttach({
        enabled: true,
        preset: "none",
        burst: 0,
        overflow: 1,
        tonus: origin,
      }),
    ).toBe(true);
  });

  test("turns on only once the marker is far from the origin", () => {
    const justUnder = {
      x: Math.floor((TONUS_ATTACH - 0.05) * TONUS_MAX),
      y: 0,
    };
    const over = { x: TONUS_MIN, y: 0 };
    expect(
      shouldAttach({
        enabled: true,
        preset: "none",
        burst: 0,
        overflow: 0,
        tonus: justUnder,
      }),
    ).toBe(false);
    expect(
      shouldAttach({
        enabled: true,
        preset: "none",
        burst: 0,
        overflow: 0,
        tonus: over,
      }),
    ).toBe(true);
  });

  test("never attaches while the lobby owns the stage", () => {
    expect(
      shouldAttach({
        enabled: false,
        preset: "wrong-palette",
        burst: 1,
        overflow: 1,
        tonus: { x: TONUS_MIN, y: TONUS_MIN },
      }),
    ).toBe(false);
  });
});
