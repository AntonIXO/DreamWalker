import { describe, expect, test } from "bun:test";

import { endingChrome } from "./finale";

describe("endingChrome", () => {
  test("no ending leaves the walk-away button alive", () => {
    for (const kind of [
      "match",
      "empty",
      "unfinished",
      "resonance",
      "void",
      "walk-away",
      "locked",
    ] as const) {
      expect(endingChrome(kind).leaveHidden).toBe(true);
    }
  });

  test("only the void hides the close control", () => {
    expect(endingChrome("match").closeHidden).toBe(false);
    expect(endingChrome("void").closeHidden).toBe(true);
  });
});
