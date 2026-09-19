import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import type { RoomHotspot, RoomProp } from "../../shared/room";
import { migrateWorldObjects } from "./object-migration";
import { sonArtifact } from "../../../dreams/son/pack";
import { createWorld } from "./world";
import { bindWorldMutator, staticPlayerPose } from "./world-mutator";
import { executeWorldAction } from "../../shared/world-action-engine";

function prop(partial: Partial<RoomProp> & Pick<RoomProp, "id">): RoomProp {
  return {
    x: 1,
    y: 1,
    w: 1,
    h: 1,
    solid: true,
    role: null,
    image: null,
    ...partial,
  };
}

function hotspot(
  partial: Partial<RoomHotspot> & Pick<RoomHotspot, "id">,
): RoomHotspot {
  return {
    kind: "look",
    x: 1,
    y: 1,
    reach: 1.4,
    prompt: partial.id,
    refusal: null,
    clueId: null,
    propId: null,
    action: null,
    once: false,
    dwellMs: null,
    ...partial,
  };
}

describe("migrateWorldObjects", () => {
  test("pairs hotspot.propId with that RoomProp into one object", () => {
    const objects = migrateWorldObjects([
      {
        id: "kitchen",
        props: [prop({ id: "stove", x: 3, y: 4, w: 2, h: 2 })],
        hotspots: [
          hotspot({
            id: "stove-look",
            prompt: "плита",
            propId: "stove",
            x: 4,
            y: 6,
          }),
        ],
      },
    ]);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.id).toBe("stove");
    expect(objects[0]?.name).toBe("плита");
    expect(objects[0]?.mobility).toBe("fixed");
    expect(objects[0]?.affordances).toEqual(["examine"]);
    expect(objects[0]?.body).toEqual({ w: 2, h: 2, solid: true });
    expect(objects[0]?.location).toEqual({
      kind: "room",
      roomId: "kitchen",
      x: 3,
      y: 4,
    });
  });

  test("clue hotspots become carryable and keep clueId", () => {
    const objects = migrateWorldObjects([
      {
        id: "a",
        props: [],
        hotspots: [
          hotspot({
            id: "shelf",
            kind: "clue",
            prompt: "надпись",
            clueId: "clue-1",
            x: 9,
            y: 4,
          }),
        ],
      },
    ]);
    expect(objects[0]?.mobility).toBe("carryable");
    expect(objects[0]?.clueId).toBe("clue-1");
    expect(objects[0]?.affordances).toContain("take");
  });

  test("ui hotspots become fixed fixtures with uiAction", () => {
    const objects = migrateWorldObjects([
      {
        id: "lobby",
        props: [],
        hotspots: [
          hotspot({
            id: "panel",
            kind: "ui",
            action: "settings",
            prompt: "настройки",
          }),
        ],
      },
    ]);
    expect(objects[0]?.hotspotKind).toBe("ui");
    expect(objects[0]?.uiAction).toBe("settings");
    expect(objects[0]?.mobility).toBe("fixed");
    expect(objects[0]?.body).toBeNull();
  });

  test("unpaired props become fixed fixtures with the rect body", () => {
    const objects = migrateWorldObjects([
      {
        id: "a",
        props: [prop({ id: "a-crate", x: 3, y: 4, solid: true })],
        hotspots: [],
      },
    ]);
    expect(objects[0]?.id).toBe("a-crate");
    expect(objects[0]?.mobility).toBe("fixed");
    expect(objects[0]?.affordances).toEqual(["examine"]);
    expect(objects[0]?.body).toEqual({ w: 1, h: 1, solid: true });
  });

  test("free interests become carryable and keep shard/clue/seed", () => {
    const objects = migrateWorldObjects(
      [],
      [
        {
          id: "glint",
          roomId: "a",
          name: "блеск",
          x: 4.2,
          y: 5.1,
          solid: true,
          clueId: "clue-2",
          holdsShardId: "shard1",
          sensorySeed: "metal",
        },
      ],
    );
    expect(objects[0]?.id).toBe("glint");
    expect(objects[0]?.mobility).toBe("carryable");
    expect(objects[0]?.body).toEqual({ w: 1, h: 1, solid: true });
    expect(objects[0]?.clueId).toBe("clue-2");
    expect(objects[0]?.holdsShardId).toBe("shard1");
    expect(objects[0]?.sensorySeed).toBe("metal");
  });

  test("authored refusal stays on the object and blocks take", () => {
    const objects = migrateWorldObjects([
      {
        id: "school",
        props: [prop({ id: "pear" })],
        hotspots: [
          hotspot({
            id: "pear-look",
            kind: "clue",
            propId: "pear",
            clueId: "clue-1",
            refusal: "достать её нельзя, это проверено",
            prompt: "груша за стеклом",
          }),
        ],
      },
    ]);
    expect(objects[0]?.interaction?.refusal).toBe(
      "достать её нельзя, это проверено",
    );
    expect(objects[0]?.mobility).toBe("fixed");
    expect(objects[0]?.affordances).not.toContain("take");
  });

  test("tiny-dream fixture migrates crate, rope, and shelf", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const objects = migrateWorldObjects(artifact.rooms);
    const ids = objects.map((entry) => entry.id).sort();
    expect(ids).toContain("a-crate");
    expect(ids).toContain("rope");
    expect(ids).toContain("shelf");
    expect(objects.find((entry) => entry.id === "shelf")?.clueId).toBe(
      "clue-1",
    );
    expect(objects.find((entry) => entry.id === "shelf")?.mobility).toBe(
      "carryable",
    );
  });

  test("physical profiles decide portability independently of once and drawing size", () => {
    const objects = migrateWorldObjects([
      {
        id: "yard",
        props: [
          prop({ id: "bottle", w: 2, h: 2, profile: { kind: "portable" } }),
          prop({ id: "intercom", w: 1, h: 1, profile: { kind: "mechanism" } }),
          prop({
            id: "urn",
            w: 1,
            h: 1,
            profile: { kind: "furniture", mobility: "fixed" },
          }),
        ],
        hotspots: [
          hotspot({
            id: "bottle-look",
            propId: "bottle",
            once: false,
            prompt: "бутылка",
          }),
          hotspot({
            id: "intercom-look",
            propId: "intercom",
            prompt: "домофон",
          }),
          hotspot({
            id: "urn-look",
            propId: "urn",
            prompt: "урна",
          }),
        ],
      },
    ]);
    expect(objects.find((entry) => entry.id === "bottle")?.mobility).toBe(
      "carryable",
    );
    expect(objects.find((entry) => entry.id === "intercom")?.mobility).toBe(
      "fixed",
    );
    expect(objects.find((entry) => entry.id === "urn")?.mobility).toBe("fixed");
  });
});

describe("authored containers", () => {
  test("explicit open and closed container metadata reaches paired and standalone props", () => {
    const objects = migrateWorldObjects([
      {
        id: "yard",
        props: [
          prop({ id: "urn", container: "open" }),
          prop({ id: "box", container: "closed" }),
        ],
        hotspots: [hotspot({ id: "urn-look", propId: "urn" })],
      },
    ]);
    expect(objects[0]?.tags).toContain("container");
    expect(objects[0]?.state.open).toBe(true);
    expect(objects[1]?.tags).toContain("container");
    expect(objects[1]?.state.open).toBe(false);
    for (const object of objects) {
      expect(object.affordances).toContain("open");
      expect(object.affordances).toContain("close");
      expect(object.mobility).toBe("fixed");
      expect(object.affordances).not.toContain("take");
    }
  });

  test("invalid container metadata fails artifact validation", () => {
    const artifact = structuredClone(fixture);
    Object.assign(artifact.rooms[0]!.props[0]!, { container: "bottomless" });
    expect(() => validateDreamArtifact(artifact)).toThrow(/container/);
  });

  test("the actual courtyard urn accepts and returns the carried bottle", () => {
    const world = createWorld(sonArtifact());
    const urn = world.objectById.get("urna-nabitaia-akkuratno")!;
    const bottle = world.objectById.get(
      "butylka-riadom-s-turyshevym-ne-pervaia",
    )!;
    expect(urn.tags).toContain("container");
    expect(urn.state.open).toBe(true);
    expect(urn.mobility).toBe("movable");
    bottle.location = { kind: "held", actor: { kind: "player" } };
    const mutator = bindWorldMutator(
      world,
      staticPlayerPose({
        roomId: "19-dvor-i-oranzhevye-lavochki",
        x: 11,
        y: 6,
      }),
    );
    expect(
      executeWorldAction(mutator, {
        actor: { kind: "player" },
        source: "player",
        action: { type: "put", objectId: bottle.id, intoObjectId: urn.id },
      }).ok,
    ).toBe(true);
    expect(world.objectById.get(bottle.id)?.location).toEqual({
      kind: "inside",
      objectId: urn.id,
    });
    expect(
      executeWorldAction(mutator, {
        actor: { kind: "player" },
        source: "player",
        action: { type: "take", objectId: bottle.id },
      }).ok,
    ).toBe(true);
    expect(bottle.location).toEqual({
      kind: "held",
      actor: { kind: "player" },
    });
  });
});
