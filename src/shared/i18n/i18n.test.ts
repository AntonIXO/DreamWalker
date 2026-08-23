import { describe, expect, it } from "bun:test";
import { en } from "./catalogs/en";
import { ru } from "./catalogs/ru";
import {
  getLocale,
  onLocaleChange,
  resolveLocalizedText,
  setLocale,
  t,
  type TranslationKey,
} from "./index";

function collectKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      keys.push(...collectKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe("i18n core", () => {
  it("has exact parity between Russian and English translation catalogs", () => {
    const ruKeys = collectKeys(ru).sort();
    const enKeys = collectKeys(en).sort();
    expect(ruKeys).toEqual(enKeys);
    expect(ruKeys.length).toBeGreaterThan(50);
  });

  it("interpolates parameters in translation strings", () => {
    expect(t("hud.cycle", { n: 3 }, "ru")).toBe("цикл 3");
    expect(t("hud.cycle", { n: 3 }, "en")).toBe("cycle 3");
    expect(t("interact.talk_to", { name: "Кирилл" }, "ru")).toBe(
      "заговорить с Кирилл",
    );
    expect(t("interact.talk_to", { name: "Kirill" }, "en")).toBe(
      "talk to Kirill",
    );
  });

  it("resolves LocalizedText correctly", () => {
    expect(resolveLocalizedText("Plain text", "en")).toBe("Plain text");
    expect(resolveLocalizedText({ ru: "Привет", en: "Hello" }, "en")).toBe(
      "Hello",
    );
    expect(resolveLocalizedText({ ru: "Привет", en: "Hello" }, "ru")).toBe(
      "Привет",
    );
    expect(resolveLocalizedText({ ru: "Только русский" }, "en")).toBe(
      "Только русский",
    );
  });

  it("switches locale and notifies listeners", () => {
    const events: string[] = [];
    const unsubscribe = onLocaleChange((locale) => events.push(locale));

    setLocale("en");
    expect(getLocale()).toBe("en");
    expect(t("verbs.label.talk" as TranslationKey)).toBe("talk");

    setLocale("ru");
    expect(getLocale()).toBe("ru");
    expect(t("verbs.label.talk" as TranslationKey)).toBe("заговорить");

    unsubscribe();
    setLocale("en");
    expect(events).toEqual(["en", "ru"]);
    setLocale("ru"); // reset to default
  });
});
