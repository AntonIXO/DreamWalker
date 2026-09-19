import { describe, expect, test } from "bun:test";
import { sonArtifact } from "./pack";
import { allRooms } from "./rooms/catalog";
import { createWorld } from "../../src/player/game/world";
import { validateDreamArtifact } from "../../src/shared/dream";
import { rectsOverlap } from "../../src/shared/rect";
import { executeWorldAction } from "../../src/shared/world-action-engine";
import {
  bindWorldMutator,
  staticPlayerPose,
} from "../../src/player/game/world-mutator";

describe("authored physical catalogue", () => {
  test("every prop and free object hotspot has an explicit physical profile", () => {
    for (const room of allRooms()) {
      for (const prop of room.props) expect(prop.profile).toBeDefined();
      for (const hotspot of room.hotspots) {
        if (
          hotspot.propId ||
          hotspot.kind === "figure" ||
          hotspot.kind === "ui"
        )
          continue;
        expect(hotspot.profile).toBeDefined();
      }
    }
  });

  test("both backpacks are portable wearable containers with real contained objects", () => {
    const world = createWorld(sonArtifact());
    for (const id of ["riukzak", "riukzak-s-fruktami-i-vodkoi"]) {
      const bag = world.objectById.get(id)!;
      expect(bag.mobility).toBe("carryable");
      expect(bag.affordances).toContain("wear");
      expect(bag.affordances).toContain("empty");
      expect(
        world.objects.some(
          (object) =>
            object.location.kind === "inside" &&
            object.location.objectId === id,
        ),
      ).toBe(true);
    }
    expect(world.objectById.get("riukzak-vodka")!.location).toEqual({
      kind: "inside",
      objectId: "riukzak-s-fruktami-i-vodkoi",
    });
  });

  test("occupancy and role garments refer to existing authored things", () => {
    const world = createWorld(sonArtifact());
    for (const id of ["grob", "groby"])
      expect(world.objectById.get(id)!.affordances).toContain("occupy");
    for (const id of ["hudozhnik", "lysyi", "ded-slava"]) {
      expect(
        world.objectById.get(`outfit-${id}`)!.profile?.wear?.appearanceFigureId,
      ).toBe(id);
    }
    for (const id of [
      "otec-na-kraiu",
      "voda-v-chashe-basseina-slishkom-nepodviz",
    ]) {
      expect(world.objectById.get(id)!.affordances).not.toContain("take");
    }
  });

  test("prepared thresholds are concealed by specific movable covers, not street exits", () => {
    const rooms = allRooms();
    const hidden = rooms.flatMap((room) =>
      room.doors.filter((door) => door.hidden).map((door) => ({ room, door })),
    );
    expect(hidden.length).toBe(4);
    for (const { room, door } of hidden) {
      const cover = room.props.find(
        (prop) => prop.id === door.revealBy?.objectId,
      )!;
      expect(rectsOverlap(cover, door)).toBe(true);
      expect(
        cover.profile?.kind === "portable" ||
          cover.profile?.kind === "furniture",
      ).toBe(true);
      expect(
        room.doors.some((other) => !other.hidden && rectsOverlap(other, door)),
      ).toBe(false);
    }
  });

  test("invalid semantic relationships cannot ship", () => {
    const invalid = structuredClone(sonArtifact());
    invalid.rooms.find(
      (room) => room.id === "m3-sklad-ostavlennogo",
    )!.props[0]!.profile!.wear!.appearanceFigureId = "invented-person";
    expect(() => validateDreamArtifact(invalid)).toThrow(
      "no figure invented-person",
    );
    const cycle = structuredClone(sonArtifact());
    const room = cycle.rooms.find(
      (entry) => entry.id === "06-kanava-garazhi-podvorotni",
    )!;
    room.props.find((prop) => prop.id === "riukzak")!.inside =
      "riukzak-folded-cloth";
    room.props.find(
      (prop) => prop.id === "riukzak-folded-cloth",
    )!.profile!.container = "open";
    expect(() => validateDreamArtifact(cycle)).toThrow("container cycle");
  });

  test("glass cases can be opened and their ordinary portable contents taken", () => {
    for (const [roomId, itemId, caseId] of [
      ["02-shkola-kabinet-russkogo", "grusha-za-steklom", "school-pear-case"],
      [
        "09-hakaton-tretii-po-schetu",
        "rozovyi-gashish-v-vitrine",
        "hackathon-glass-case",
      ],
    ]) {
      const world = createWorld(sonArtifact());
      const container = world.objectById.get(caseId!)!;
      if (container.location.kind !== "room")
        throw new Error("case must be in room");
      const pose = staticPlayerPose({
        roomId: roomId!,
        x: container.location.x + 1,
        y: container.location.y + 2.2,
      });
      const mutator = bindWorldMutator(world, pose);
      const take = () =>
        executeWorldAction(mutator, {
          actor: { kind: "player" },
          source: "player",
          action: { type: "take", objectId: itemId! },
        });
      expect(take().refusal).toBe("container is closed");
      expect(
        executeWorldAction(mutator, {
          actor: { kind: "player" },
          source: "player",
          action: { type: "open", targetId: caseId! },
        }).ok,
      ).toBe(true);
      expect(take().ok).toBe(true);
      expect(world.objectById.get(itemId!)!.location.kind).toBe("held");
    }
  });

  test("mounted objects detach and leave no solid invisible anchor", () => {
    for (const [roomId, itemId, mountId] of [
      [
        "05-shesterochka",
        "ballonchik-na-poiase-ohrannika",
        "guard-belt-anchor",
      ],
      ["22-kreiser", "scena-mikrofon", "cruiser-microphone-stand"],
    ]) {
      const world = createWorld(sonArtifact());
      const item = world.objectById.get(itemId!)!;
      if (item.location.kind !== "room")
        throw new Error("mounted item must be in room");
      const origin = { ...item.location };
      const mutator = bindWorldMutator(
        world,
        staticPlayerPose({
          roomId: roomId!,
          x: origin.x + 1,
          y: origin.y + 2.2,
        }),
      );
      const action = (type: "detach" | "take") =>
        executeWorldAction(mutator, {
          actor: { kind: "player" },
          source: "player",
          action: { type, objectId: itemId! },
        });
      expect(action("take").refusal).toBe("detach the object first");
      expect(action("detach").ok).toBe(true);
      expect(action("take").ok).toBe(true);
      expect(world.objectById.get(mountId!)!.body?.solid).toBe(false);
      expect(mutator.canWalk(roomId!, origin.x + 0.5, origin.y + 0.5)).toBe(
        true,
      );
    }
  });
});
