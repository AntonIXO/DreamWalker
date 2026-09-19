import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { decodePng } from "./reference";
import { readWalkSheet } from "./walkSheet";
import manifest from "../../../dreams/son/content/assets/sprites/manifest.json";

test("shipped sanitar keeps its upper body and feet registered across the cycle", async () => {
  const sheet = readWalkSheet(
    decodePng(await readFile("assets/figures/sanitar/sheet.png")),
  );
  for (const row of sheet.frames) {
    const centres = row.map((frame) => {
      let sum = 0;
      let count = 0;
      let bottom = -1;
      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 48; x++) {
          if (frame.data[(y * 48 + x) * 4 + 3]! <= 128) continue;
          bottom = y;
          if (y < 19) {
            sum += x;
            count++;
          }
        }
      }
      expect(bottom).toBe(44);
      expect(count).toBeGreaterThan(50);
      return sum / count;
    });
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(0.5);
  }
});

test("shipped NPC direction metadata matches the visually reviewed rows", () => {
  for (const [id, ref] of Object.entries(manifest)) {
    expect(ref.dirs).toEqual(
      id === "shchenok" ? ["n", "e", "s", "w"] : ["s", "e", "n", "w"],
    );
  }
});
