import { describe, expect, test } from "bun:test";

import { Sprite, Texture } from "pixi.js";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { createWorld } from "../game/world";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import type { AtlasTextures } from "./atlasTextures";
import type { WorldObjectState } from "../../shared/world-object";
import { ActorLayer, liveObjectPlacements } from "./walkerView";

function bottle(overrides: Partial<WorldObjectState> = {}): WorldObjectState {
  return {
    id: "bottle",
    name: "бутылка",
    location: { kind: "room", roomId: "a", x: 5, y: 3 },
    mobility: "carryable",
    affordances: ["take"],
    body: { w: 1, h: 1, solid: true },
    visual: { role: null, image: "bottle.png" },
    interaction: null,
    state: {},
    tags: [],
    clueId: null,
    holdsShardId: null,
    sensorySeed: null,
    once: false,
    dwellMs: null,
    keyId: null,
    hotspotKind: null,
    uiAction: null,
    ...overrides,
  };
}

describe("liveObjectPlacements", () => {
  test("a floor bottle is on the live layer", () => {
    const list = liveObjectPlacements([bottle()], new Map());
    expect(list).toEqual([
      {
        id: "bottle",
        roomId: "a",
        x: 5,
        y: 3,
        held: false,
        image: "bottle.png",
        role: null,
        clueId: null,
      },
    ]);
  });

  test("a taken bottle follows the holder instead of staying on the floor", () => {
    const list = liveObjectPlacements(
      [bottle({ location: { kind: "held", actor: { kind: "player" } } })],
      new Map([["player", { roomId: "b", x: 2, y: 2 }]]),
    );
    expect(list).toEqual([
      {
        id: "bottle",
        roomId: "b",
        x: 2,
        y: 2,
        held: true,
        image: "bottle.png",
        role: null,
        clueId: null,
      },
    ]);
  });

  test("fixed furniture stays off the live layer", () => {
    const list = liveObjectPlacements(
      [bottle({ id: "crate", mobility: "fixed" })],
      new Map(),
    );
    expect(list).toEqual([]);
  });
});

describe("live object sprites", () => {
  const texture = (label: string) =>
    new Texture({ source: Texture.EMPTY.source, label });
  const atlas = (roles = new Map<string, Texture[]>()) =>
    ({ roles, frames: new Map() }) as AtlasTextures;
  const spriteOf = (layer: ActorLayer, id = "bottle") =>
    layer.root.children.find((child) => child.label === `live-object:${id}`) as
      Sprite | undefined;

  test("a migrated clue retains its clue art on the floor and in a holder's room", () => {
    const clueArt = texture("clue");
    const layer = new ActorLayer(atlas(), new Map([["clue-1", clueArt]]));
    const object = bottle({
      clueId: "clue-1",
      visual: { image: null, role: null },
    });
    layer.syncLiveObjects(liveObjectPlacements([object], new Map()), 16);
    expect(spriteOf(layer)?.texture).toBe(clueArt);
    object.location = { kind: "held", actor: { kind: "player" } };
    layer.syncLiveObjects(
      liveObjectPlacements(
        [object],
        new Map([["player", { roomId: "b", x: 2, y: 3 }]]),
      ),
      16,
    );
    expect(spriteOf(layer)?.texture).toBe(clueArt);
    expect(spriteOf(layer)?.x).toBeCloseTo(2 * 16 + 8 + 16 * 0.15);
    layer.destroy();
  });

  test("an authored object carried into another room keeps its original PNG", () => {
    const world = createWorld(
      validateDreamArtifact(structuredClone(fixture)) as DreamArtifact,
    );
    const prop = world.artifact.rooms[0]!.props[0]!;
    prop.image = "crate.png";
    const propArt = texture("crate");
    const layer = new ActorLayer(
      atlas(),
      new Map(),
      new Map(),
      new Map([[`a:${prop.id}`, propArt]]),
    );
    const object = bottle({
      id: prop.id,
      visual: { image: prop.image, role: null },
      location: { kind: "held", actor: { kind: "player" } },
    });
    layer.syncLiveObjects(
      liveObjectPlacements(
        [object],
        new Map([["player", { roomId: "b", x: 2, y: 3 }]]),
      ),
      16,
      world,
    );
    expect(spriteOf(layer, prop.id)?.texture).toBe(propArt);
    layer.destroy();
  });

  test("an object without a PNG uses its atlas role and disappears when removed", () => {
    const roleArt = texture("role");
    const layer = new ActorLayer(atlas(new Map([["prop", [roleArt]]])));
    const object = bottle({ visual: { image: null, role: "prop" } });
    layer.syncLiveObjects(liveObjectPlacements([object], new Map()), 16);
    expect(spriteOf(layer)?.texture).toBe(roleArt);
    object.location = { kind: "removed" };
    layer.syncLiveObjects(liveObjectPlacements([object], new Map()), 16);
    expect(spriteOf(layer)).toBeUndefined();
    layer.destroy();
  });
});
