import { describe, expect, test } from "bun:test";

import {
  clampExhaustion,
  clampPortraitByExhaustion,
  exhaustionBand,
  KURT_THRESHOLD,
  MEMORY_EXHAUSTION,
  metaInjectionChance,
} from "./exhaustion";

describe("exhaustion", () => {
  test("three memories fill most of the axis", () => {
    expect(clampExhaustion(MEMORY_EXHAUSTION * 3)).toBeCloseTo(0.75);
    expect(exhaustionBand(0.75)).toBe("high");
    expect(KURT_THRESHOLD).toBeLessThanOrEqual(0.75);
  });

  test("high exhaustion refuses a jump to knows", () => {
    expect(clampPortraitByExhaustion(0.8, "knows", "neutral")).toBe(
      "interested",
    );
    expect(clampPortraitByExhaustion(0.5, "knows", "neutral")).toBe("wary");
    expect(clampPortraitByExhaustion(0.1, "knows", "neutral")).toBe("knows");
  });

  test("a ratchet never walks a face back", () => {
    expect(clampPortraitByExhaustion(0.9, "neutral", "wary")).toBe("wary");
  });

  test("meta injection rises with the axis", () => {
    expect(metaInjectionChance(0)).toBe(0);
    expect(metaInjectionChance(1)).toBeGreaterThan(metaInjectionChance(0.4));
  });
});
