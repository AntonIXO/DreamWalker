import { describe, expect, test } from "bun:test";

import { DEFAULT_MIND_SETTINGS, describeMind } from "./settings";

describe("describeMind", () => {
  test("names the missing model in the player's language", () => {
    expect(describeMind(DEFAULT_MIND_SETTINGS, "ru")).toContain("сценарный");
    expect(describeMind(DEFAULT_MIND_SETTINGS, "en")).toContain(
      "scripted dream",
    );
  });
});
