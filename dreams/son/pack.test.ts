import { describe, expect, test } from "bun:test";

import { sonArtifact, sonPack } from "./pack";
import { createWorld } from "../../src/player/game/world";
import { fallbackPopulation } from "../../src/shared/population";

describe("son pack", () => {
  const artifact = sonArtifact();

  test("validates and keeps the courtyard spawn", () => {
    expect(artifact.slug).toBe("son");
    expect(artifact.spawn.roomId).toBe("19-dvor-i-oranzhevye-lavochki");
    expect(artifact.figures).toHaveLength(artifact.content.characters.length);
    expect(
      artifact.rooms.some((room) => room.id === "m11-zamok-po-vremeni"),
    ).toBe(true);
    expect(sonPack.scripts.length).toBeGreaterThan(0);
  });

  test("every meta-space has an inbound rift", () => {
    const rifts = artifact.rooms.flatMap((room) =>
      room.doors.filter((door) => door.threshold === "rift"),
    );
    for (const meta of artifact.rooms.filter((room) => room.kind === "meta")) {
      expect(rifts.some((door) => door.toRoomId === meta.id)).toBe(true);
    }
  });

  test("no hotspot teleports", () => {
    for (const room of artifact.rooms) {
      for (const hotspot of room.hotspots) {
        expect("link" in hotspot).toBe(false);
      }
    }
  });

  test("population can deal the larger roster", () => {
    const world = createWorld(artifact);
    const population = fallbackPopulation(artifact, { shuffle: false });
    expect(population.figures.map((figure) => figure.id).sort()).toEqual(
      world.baseFigures.map((figure) => figure.id).sort(),
    );
  });
});
