import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateDreamArtifact, type DreamArtifact } from "./dream";
import { fallbackPopulation } from "./population";

const artifact = validateDreamArtifact(
  JSON.parse(
    readFileSync(join(process.cwd(), "dreams/son/dream.json"), "utf8"),
  ) as unknown,
) as DreamArtifact;

describe("fallback population", () => {
  test("deals every authored figure and keeps the gatekeeper on the bench", () => {
    const a = fallbackPopulation(artifact, { shuffle: true, seed: "a" });
    const b = fallbackPopulation(artifact, { shuffle: true, seed: "b" });
    expect(a.figures).toHaveLength(artifact.figures.length);
    expect(new Set(a.figures.map((figure) => figure.id)).size).toBe(
      artifact.figures.length,
    );
    expect(
      a.figures.find((figure) => figure.id === "turyshev")?.homeRoomId,
    ).toBe(artifact.spawn.roomId);
    expect(a.figures.find((figure) => figure.id === "glaz")?.homeRoomId).toBe(
      artifact.finaleRoomId,
    );
    const moved = a.figures.filter((figure) => {
      const other = b.figures.find((candidate) => candidate.id === figure.id);
      return other && other.homeRoomId !== figure.homeRoomId;
    });
    expect(moved.length).toBeGreaterThan(0);
  });
  test("the same run deals the same dream twice — a reload is not a reroll", () => {
    const first = fallbackPopulation(artifact, {
      shuffle: true,
      seed: "run-7",
    });
    const again = fallbackPopulation(artifact, {
      shuffle: true,
      seed: "run-7",
    });
    expect(again.figures.map((figure) => figure.homeRoomId)).toEqual(
      first.figures.map((figure) => figure.homeRoomId),
    );
  });

  test("a dry wallet puts the crypto-bro on the platform — `endings.md` (б)", () => {
    const home = (seed: string, dryWallet: boolean): string | undefined =>
      fallbackPopulation(artifact, {
        shuffle: true,
        seed,
        dryWallet,
      }).figures.find((figure) => figure.id === "kripto-bro")?.homeRoomId;
    const seeds = Array.from({ length: 20 }, (_, i) => `run-${i}`);
    // Dry pins him to the platform every time: he is the one who already took it.
    expect(seeds.every((seed) => home(seed, true)?.includes("metro"))).toBe(
      true,
    );
    // A full wallet leaves him to the deal, so he is not always there.
    expect(seeds.some((seed) => !home(seed, false)?.includes("metro"))).toBe(
      true,
    );
  });
});
