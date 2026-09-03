import { describe, expect, test } from "bun:test";

import { DEFAULT_MIND_SETTINGS } from "../mind/settings";
import { liveEntryBody } from "./entry";

describe("liveEntryBody", () => {
  test("a connected mind is invited in, in both languages", () => {
    expect(liveEntryBody(true, DEFAULT_MIND_SETTINGS, "ru")).toContain(
      "Связь с моделью стабильна",
    );
    expect(
      liveEntryBody(true, DEFAULT_MIND_SETTINGS, "ru").includes("\n\n"),
    ).toBe(false);
    expect(liveEntryBody(true, DEFAULT_MIND_SETTINGS, "en")).toContain(
      "Full-depth",
    );
  });

  test("without a model the live dive is refused and the reason is named", () => {
    const ru = liveEntryBody(false, DEFAULT_MIND_SETTINGS, "ru");
    expect(ru).toContain("Полезли");
    expect(ru).toContain("не подключена");
    expect(ru).toContain("сценарный");
    const en = liveEntryBody(false, DEFAULT_MIND_SETTINGS, "en");
    expect(en).toContain("Dive-in is unavailable");
    expect(en).toContain("scripted dream");
  });
});
