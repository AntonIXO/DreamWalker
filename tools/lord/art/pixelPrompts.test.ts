import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  PIXEL_PROMPTS_PATH,
  parsePixelPrompts,
  roomBackdropPrompt,
  clueObjectPrompt,
} from "./pixelPrompts";

const book = parsePixelPrompts(readFileSync(PIXEL_PROMPTS_PATH, "utf8"));

describe("parsePixelPrompts", () => {
  test("reads the master style, seam, tone and the four portrait states", () => {
    expect(book.style).toContain("1998 PlayStation dream emulator");
    expect(book.seam).toContain(
      "seam between materials is deliberately visible",
    );
    expect(book.tone).toContain("mundane banal object");
    expect(book.states[3]).toContain("pupils slightly too small");
  });

  test("finds every numbered place and every meta-space", () => {
    for (let n = 1; n <= 25; n++) {
      expect(book.rooms.has(String(n).padStart(2, "0"))).toBe(true);
    }
    expect(book.rooms.get("19")?.body).toContain("orange bench");
    expect(book.rooms.get("m1")?.meta).toBe(true);
    expect(book.rooms.get("m4")?.body).toContain("hand reaching upward");
  });

  test("maps figure headings onto character ids", () => {
    expect(book.figures.get("kirill")?.body).toContain("oversized hoodie");
    expect(book.figures.get("glaz")?.seam).toBe(true);
    expect(book.figures.get("turyshev")?.body).toContain("orange bench");
  });
});

describe("compose", () => {
  test("a place backdrop uses the authored room card and keeps the camera last", () => {
    const prompt = roomBackdropPrompt("19-dvor-i-oranzhevye-lavochki");
    expect(prompt).toContain("orange bench slats");
    expect(prompt.endsWith("no perspective")).toBe(true);
    expect(prompt).not.toContain("wireframe grafted");
  });

  test("a meta-space keeps the seam rule", () => {
    const prompt = roomBackdropPrompt("m1-korni");
    expect(prompt).toContain("nerve tissue");
    expect(prompt).toContain("wireframe grafted");
  });

  test("a clue object names the noun without writing it as text on the image", () => {
    const prompt = clueObjectPrompt("boat");
    expect(prompt).toContain("boat");
    expect(prompt).toContain("turquoise seam");
    expect(prompt).toContain(book.style.slice(0, 20));
  });
});
