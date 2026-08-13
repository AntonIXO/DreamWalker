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
});
