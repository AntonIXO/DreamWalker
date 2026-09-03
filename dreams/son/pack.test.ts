import { describe, expect, test } from "bun:test";

import { sonArtifact, sonPack } from "./pack";
import { allRooms, authoredRooms } from "./rooms/catalog";
import { applyStreetMap } from "./rooms/map";
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

  test("every meta-space has an inbound door", () => {
    for (const meta of artifact.rooms.filter((room) => room.kind === "meta")) {
      expect(
        artifact.rooms.some((room) =>
          room.doors.some((door) => door.toRoomId === meta.id),
        ),
      ).toBe(true);
    }
  });

  test("no hotspot teleports", () => {
    for (const room of artifact.rooms) {
      for (const hotspot of room.hotspots) {
        expect("link" in hotspot).toBe(false);
      }
    }
  });

  test("m5–m12 and their scripts ship with the pack", () => {
    expect(
      artifact.rooms.some((room) => room.id === "m6-krugi-vokrug-pruda"),
    ).toBe(true);
    expect(artifact.rooms.some((room) => room.id === "m9-shkaf")).toBe(true);
    expect(
      artifact.rooms.some((room) => room.id === "m10-zamorozhennaia-morkovka"),
    ).toBe(true);
    expect(
      sonPack.scripts.some((script) => script.id === "exhaustion-rifts"),
    ).toBe(true);
    expect(sonPack.scripts.some((script) => script.id === "m9-wardrobe")).toBe(
      true,
    );
    expect(sonPack.scripts.some((script) => script.id === "m10-carrot")).toBe(
      true,
    );
  });

  test("the street map of the authored catalogue is what the pack ships", () => {
    const fromPack = sonArtifact()
      .rooms.map((room) => room.id)
      .sort();
    const fromMap = applyStreetMap(authoredRooms())
      .map((room) => room.id)
      .sort();
    expect(fromMap).toEqual(fromPack);
    expect(
      allRooms()
        .map((room) => room.id)
        .sort(),
    ).toEqual(fromPack);
    expect(authoredRooms().some((room) => room.id === "m12-nedoliudi")).toBe(
      true,
    );
  });

  test("population can deal the larger roster", () => {
    const world = createWorld(artifact);
    const population = fallbackPopulation(artifact, { shuffle: false });
    expect(population.figures.map((figure) => figure.id).sort()).toEqual(
      world.baseFigures.map((figure) => figure.id).sort(),
    );
  });
});
