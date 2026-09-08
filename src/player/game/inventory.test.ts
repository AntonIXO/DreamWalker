import { describe, expect, test } from "bun:test";
import type { WorldObjectState } from "../../shared/world-object";
import { createWorldMutator } from "../../shared/world-action-engine";
import { carriedInventoryObjects, nearbyInventoryObjects } from "./inventory";

function item(
  id: string,
  location: WorldObjectState["location"],
  open?: boolean,
): WorldObjectState {
  return {
    id,
    name: id,
    location,
    mobility: "carryable",
    affordances: ["examine", "take", "drop", "put", "give"],
    body: null,
    visual: { role: "prop", image: null },
    interaction: null,
    state: open === undefined ? {} : { open },
    tags: [],
    clueId: null,
    holdsShardId: null,
    sensorySeed: null,
    once: false,
    dwellMs: null,
    keyId: null,
    hotspotKind: null,
    uiAction: null,
  };
}

describe("carried inventory", () => {
  test("lists player-held roots and only contents reachable through open ancestors", () => {
    const bag = item("bag", { kind: "held", actor: { kind: "player" } }, true);
    const pouch = item("pouch", { kind: "inside", objectId: "bag" }, false);
    const coin = item("coin", { kind: "inside", objectId: "bag" });
    const hiddenKey = item("key", { kind: "inside", objectId: "pouch" });
    const npcItem = item("npc-item", {
      kind: "held",
      actor: { kind: "figure", id: "npc" },
    });
    const floor = item("floor", { kind: "room", roomId: "a", x: 1, y: 1 });
    const removed = item("removed", { kind: "removed" });
    const objects = [coin, hiddenKey, npcItem, bag, pouch, floor, removed];
    expect(
      carriedInventoryObjects(objects).map(({ object, containerId, depth }) => [
        object.id,
        containerId,
        depth,
      ]),
    ).toEqual([
      ["bag", null, 0],
      ["coin", "bag", 1],
      ["pouch", "bag", 1],
    ]);
    pouch.state.open = true;
    expect(
      carriedInventoryObjects(objects).map(({ object }) => object.id),
    ).toEqual(["bag", "coin", "pouch", "key"]);
    bag.state.open = false;
    expect(
      carriedInventoryObjects(objects).map(({ object }) => object.id),
    ).toEqual(["bag"]);
  });

  test("follows live ownership and keeps the actual object identity", () => {
    const cup = item("cup", { kind: "held", actor: { kind: "player" } });
    expect(carriedInventoryObjects([cup])[0]!.object).toBe(cup);
    cup.location = { kind: "held", actor: { kind: "figure", id: "npc" } };
    expect(carriedInventoryObjects([cup])).toEqual([]);
  });

  test("orphaned and circular containment never invents player ownership", () => {
    expect(
      carriedInventoryObjects([
        item("a", { kind: "inside", objectId: "b" }, true),
        item("b", { kind: "inside", objectId: "a" }, true),
        item("orphan", { kind: "inside", objectId: "missing" }),
      ]),
    ).toEqual([]);
  });
});

describe("nearby inventory", () => {
  test("limits floor roots by room, distance, walls and ownership", () => {
    const world = createWorldMutator({
      objects: [
        item("near", { kind: "room", roomId: "a", x: 2, y: 2 }),
        item("wall-hidden", { kind: "room", roomId: "a", x: 5, y: 2 }),
        item("far", { kind: "room", roomId: "a", x: 1, y: 15 }),
        item("elsewhere", { kind: "room", roomId: "b", x: 1, y: 2 }),
        item("owned", { kind: "held", actor: { kind: "player" } }),
        item("npc-owned", {
          kind: "held",
          actor: { kind: "figure", id: "npc" },
        }),
        item("removed", { kind: "removed" }),
      ],
      playerPose: { roomId: "a", x: 1, y: 2 },
      isWalkableTile: (_room, x, y) =>
        x >= 0 && x < 30 && y >= 0 && y < 30 && x !== 4,
    });
    expect(
      nearbyInventoryObjects(world).map(({ object }) => object.id),
    ).toEqual(["near"]);
    expect(nearbyInventoryObjects(world)[0]!.object).toBe(world.objects[0]!);
  });

  test("shows nested contents only through each open visible floor container", () => {
    const box = item("box", { kind: "room", roomId: "a", x: 2, y: 2 }, true);
    const pouch = item("pouch", { kind: "inside", objectId: "box" }, false);
    const cup = item("cup", { kind: "inside", objectId: "pouch" });
    const otherBag = item(
      "npc-bag",
      { kind: "held", actor: { kind: "figure", id: "npc" } },
      true,
    );
    const otherCup = item("npc-cup", { kind: "inside", objectId: "npc-bag" });
    const world = createWorldMutator({
      objects: [box, pouch, cup, otherBag, otherCup],
      playerPose: { roomId: "a", x: 1, y: 2 },
      isWalkableTile: () => true,
    });
    expect(
      nearbyInventoryObjects(world).map(({ object, containerId, depth }) => [
        object.id,
        containerId,
        depth,
      ]),
    ).toEqual([
      ["box", null, 0],
      ["pouch", "box", 1],
    ]);
    pouch.state.open = true;
    expect(
      nearbyInventoryObjects(world).map(({ object }) => object.id),
    ).toEqual(["box", "pouch", "cup"]);
    box.state.open = false;
    expect(
      nearbyInventoryObjects(world).map(({ object }) => object.id),
    ).toEqual(["box"]);
  });

  test("missing player pose and cyclic orphan contents produce no nearby objects", () => {
    const objects = [
      item("a", { kind: "inside", objectId: "b" }, true),
      item("b", { kind: "inside", objectId: "a" }, true),
    ];
    const world = createWorldMutator({ objects, isWalkableTile: () => true });
    expect(nearbyInventoryObjects(world)).toEqual([]);
    world.setPlayerPose({ roomId: "a", x: 0, y: 0 });
    expect(nearbyInventoryObjects(world)).toEqual([]);
  });
});
