import { describe, expect, test } from "bun:test";
import { sonArtifact } from "../../../dreams/son/pack";
import { executeWorldAction } from "../../shared/world-action-engine";
import { cellAt } from "../../shared/roomGrid";
import { applyPatch } from "./patch";
import { uncoveredPassagePatches } from "./secret-passages";
import { canPassDoor, createWorld, doorAtTile, resetWorld } from "./world";
import { bindWorldMutator, staticPlayerPose } from "./world-mutator";
import { restoreWorld, snapshotWorld } from "./save";

const ROOM = "10-komnata-s-grobami";
const DOOR = `${ROOM}--secret-tkan-s-kodami`;

describe("prepared secret passages", () => {
  test("a real take reveals a physical threshold; text and admin proposals cannot", () => {
    const world = createWorld(sonArtifact());
    world.currentRoomId = ROOM;
    const room = world.roomById.get(ROOM)!;
    const door = world.doorById.get(DOOR)!;
    const actor = staticPlayerPose({ roomId: ROOM, x: 4, y: 9.2 });
    const mutator = bindWorldMutator(world, actor);
    expect(canPassDoor(world, door)).toBe(false);
    expect(doorAtTile(room, door.x, door.y)).toBeNull();
    expect(mutator.getDoor(DOOR)).toBeNull();
    expect(
      applyPatch(world, {
        kind: "revealDoor",
        doorId: DOOR,
        reason: "the model says it appeared",
      }).ok,
    ).toBe(false);
    expect(uncoveredPassagePatches(world)).toEqual([]);

    const result = executeWorldAction(mutator, {
      actor: { kind: "player" },
      source: "player",
      action: { type: "take", objectId: "tkan-s-kodami" },
    });
    expect(result.ok).toBe(true);
    const patches = uncoveredPassagePatches(world);
    expect(patches).toHaveLength(1);
    expect(applyPatch(world, patches[0]!).ok).toBe(true);
    expect(canPassDoor(world, door)).toBe(true);
    expect(doorAtTile(room, door.x, door.y)?.id).toBe(DOOR);
    expect(cellAt(room, door.x, door.y)).toBe("threshold");
    expect(uncoveredPassagePatches(world)).toEqual([]);

    const resumed = createWorld(sonArtifact());
    restoreWorld(resumed, structuredClone(snapshotWorld(world)));
    expect(resumed.doorById.get(DOOR)!.hidden).toBe(false);
    expect(resumed.objectById.get("tkan-s-kodami")!.location.kind).toBe("held");
    resetWorld(resumed);
    expect(resumed.doorById.get(DOOR)!.hidden).toBe(true);
    expect(resumed.objectById.get("tkan-s-kodami")!.location.kind).toBe("room");
  });

  test("moving a cover slightly cannot reveal a still-blocked threshold", () => {
    const world = createWorld(sonArtifact());
    const cover = world.objectById.get("tkan-s-kodami")!;
    if (cover.location.kind !== "room") throw new Error("unexpected cover");
    cover.location.x += 0.25;
    expect(uncoveredPassagePatches(world)).toHaveLength(0);
  });
});
