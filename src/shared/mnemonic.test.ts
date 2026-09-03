import { describe, expect, test } from "bun:test";

import { isWellFormedPhrase, normalisePhraseWords } from "./mnemonic";

describe("isWellFormedPhrase", () => {
  test("the well-known abandon/about phrase is twelve English BIP-39 words", () => {
    const words = [...Array(11).fill("abandon"), "about"];
    expect(isWellFormedPhrase(words)).toBe(true);
    expect(
      isWellFormedPhrase(words.map((word) => ` ${word.toUpperCase()} `)),
    ).toBe(true);
  });

  test("eleven words, junk, and a valid phrase with a swapped last word are not", () => {
    expect(isWellFormedPhrase([...Array(11).fill("abandon")])).toBe(false);
    expect(isWellFormedPhrase(Array(12).fill("qwerty"))).toBe(false);
    expect(isWellFormedPhrase([...Array(11).fill("abandon"), "yellow"])).toBe(
      false,
    );
  });

  test("normalisePhraseWords is what the judges hash", () => {
    expect(normalisePhraseWords(["  Abandon ", "ABOUT"]).join(" ")).toBe(
      "abandon about",
    );
  });
});
