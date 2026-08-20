import { describe, expect, test } from "bun:test";

import { SKY_FRAGMENT, SKY_VERTEX } from "./sky.frag";
import { skyLook } from "./sky";
import { routeOpensOntoSky } from "./roomScene";

describe("shader source", () => {
  test("declares the uniforms the controller writes", () => {
    for (const name of [
      "uTime",
      "uCover",
      "uReduced",
      "uRain",
      "uStars",
      "uSunSize",
      "uZenith",
      "uHorizon",
      "uCloud",
      "uSun",
    ]) {
      expect(SKY_FRAGMENT).toContain(name);
    }
    expect(SKY_VERTEX).toContain("vTextureCoord");
    expect(SKY_FRAGMENT).toContain("finalColor");
  });
});

describe("skyLook", () => {
  test("night is darker than a clear day", () => {
    const night = skyLook(0);
    const day = skyLook(1);
    expect(night.zenith[0]!).toBeLessThan(day.zenith[0]!);
    expect(night.stars).toBeGreaterThan(day.stars);
    expect(day.sunSize).toBeGreaterThan(night.sunSize);
  });

  test("rain peaks in the middle, not at either end", () => {
    expect(skyLook(0.4).rain).toBeGreaterThan(skyLook(0).rain);
    expect(skyLook(0.4).rain).toBeGreaterThan(skyLook(1).rain);
  });
});

describe("routeOpensOntoSky", () => {
  test("a street does not paint its ground", () => {
    expect(routeOpensOntoSky(["route"], "path")).toBe(true);
    expect(routeOpensOntoSky(["route"], "grass")).toBe(true);
  });

  test("a place keeps its floor", () => {
    expect(routeOpensOntoSky([], "path")).toBe(false);
    expect(routeOpensOntoSky(["meta"], "floor")).toBe(false);
  });

  test("only roadside trees stay, so the bulk of a street is sky", () => {
    const room = {
      width: 5,
      height: 3,
      cells: ["ttttt", "tpppt", "ttttt"],
    };
    expect(routeOpensOntoSky(["route"], "tree", room, 0, 0)).toBe(true);
    expect(routeOpensOntoSky(["route"], "tree", room, 2, 0)).toBe(false);
    expect(routeOpensOntoSky(["route"], "tree", room, 0, 1)).toBe(false);
  });
});
