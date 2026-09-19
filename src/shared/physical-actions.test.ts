import { describe, expect, test } from "bun:test";
import { compilePhysicalProfile, type PhysicalProfile } from "./object-profile";
import {
  availableActions,
  cloneWorldMutator,
  createWorldMutator,
  executeWorldAction,
  planApproach,
} from "./world-action-engine";
import {
  actorIsConcealed,
  getActorEquipment,
  getActorOccupancy,
  type WorldObjectState,
} from "./world-object";
import type { WorldAction } from "./world-action";
import { SnapshotSandbox, worldActionFromTool } from "./world-sandbox";
import {
  captureWorldAction,
  createWorldMind,
  recordWorldAction,
  worldMindForFigure,
} from "./world-mind";
import type { WorldSnapshot } from "./ai";

const actor = { kind: "player" } as const;
function item(
  id: string,
  profile: PhysicalProfile,
  overrides: Partial<WorldObjectState> = {},
): WorldObjectState {
  return {
    id,
    name: id,
    profile,
    ...compilePhysicalProfile(profile),
    location: { kind: "room", roomId: "a", x: 5, y: 5 },
    body: { w: 1, h: 1, solid: true },
    visual: { role: null, image: null },
    interaction: { reach: 1.5, prompt: id, refusal: null },
    clueId: null,
    holdsShardId: null,
    sensorySeed: null,
    once: false,
    dwellMs: null,
    keyId: null,
    hotspotKind: "look",
    uiAction: null,
    ...overrides,
  };
}
function setup(
  objects: WorldObjectState[],
  walls: Array<[number, number]> = [],
) {
  const world = createWorldMutator({
    objects,
    playerPose: { roomId: "a", x: 4, y: 5 },
    figurePoses: [["witness", { roomId: "a", x: 3, y: 5 }]],
    isWalkableTile: (_room, x, y) =>
      x >= 0 &&
      y >= 0 &&
      x < 16 &&
      y < 16 &&
      !walls.some(([wx, wy]) => wx === x && wy === y),
  });
  return {
    world,
    run: (action: WorldAction) =>
      executeWorldAction(world, { actor, source: "player", action }),
  };
}

describe("semantic physical actions", () => {
  test("bag can be taken and worn with its contents without a once flag", () => {
    const bag = item("bag", { kind: "bag" });
    const apple = item(
      "apple",
      { kind: "portable" },
      { location: { kind: "inside", objectId: "bag" } },
    );
    const { world, run } = setup([bag, apple]);
    expect(run({ type: "take", objectId: "bag" }).ok).toBe(true);
    expect(run({ type: "wear", objectId: "bag" }).ok).toBe(true);
    expect(apple.location).toEqual({ kind: "inside", objectId: "bag" });
    expect(
      getActorEquipment(world.objects, actor).map((value) => value.id),
    ).toEqual(["bag"]);
    expect(run({ type: "drop", objectId: "bag" }).refusal).toBe(
      "remove the worn object first",
    );
    expect(run({ type: "removeWear", objectId: "bag" }).ok).toBe(true);
    expect(run({ type: "drop", objectId: "bag" }).ok).toBe(true);
  });

  test("backpack and role clothing coexist, competing body clothes refuse atomically", () => {
    const bag = item(
      "bag",
      { kind: "bag" },
      { location: { kind: "held", actor } },
    );
    const suit = item(
      "suit",
      {
        kind: "garment",
        wear: { slot: "body", appearanceFigureId: "hudozhnik" },
      },
      { location: { kind: "held", actor } },
    );
    const other = item(
      "other",
      { kind: "garment" },
      { location: { kind: "held", actor } },
    );
    const { world, run } = setup([bag, suit, other]);
    expect(run({ type: "wear", objectId: "bag" }).ok).toBe(true);
    expect(run({ type: "wear", objectId: "suit" }).ok).toBe(true);
    const revision = world.revision;
    expect(run({ type: "wear", objectId: "other" }).refusal).toBe(
      "wear slot occupied",
    );
    expect(world.revision).toBe(revision);
    expect(other.state.wornBy).toBeUndefined();
    const request = run({ type: "requestRole", intent: "gather" });
    expect(request.events).toEqual([
      {
        type: "actor.requested",
        actor,
        intent: "gather",
        objectId: null,
        roleId: "hudozhnik",
      },
    ]);
    expect(run({ type: "requestRole", intent: "inspect" }).ok).toBe(false);
  });

  test("open coffin supports actual occupancy and a safe exit from a closed lid", () => {
    const coffin = item(
      "coffin",
      { kind: "furniture", container: "closed", occupancy: { pose: "lying" } },
      { body: { w: 2, h: 3, solid: true } },
    );
    const { world, run } = setup([coffin]);
    expect(run({ type: "occupy", objectId: "coffin" }).refusal).toBe(
      "container is closed",
    );
    expect(run({ type: "open", targetId: "coffin" }).ok).toBe(true);
    expect(run({ type: "occupy", objectId: "coffin" }).ok).toBe(true);
    expect(world.getPlayerPose()).toEqual({ roomId: "a", x: 6, y: 6.5 });
    expect(getActorOccupancy(world.objects, actor)?.id).toBe("coffin");
    expect(run({ type: "moveTo", x: 2, y: 2 }).ok).toBe(false);
    expect(run({ type: "moveObject", objectId: "coffin", x: 7, y: 5 }).ok).toBe(
      false,
    );
    expect(run({ type: "close", targetId: "coffin" }).ok).toBe(true);
    expect(actorIsConcealed(world.objects, actor)).toBe(true);
    expect(run({ type: "leave" }).ok).toBe(true);
    expect(coffin.state.open).toBe(true);
    expect(world.getPlayerPose()).toEqual({ roomId: "a", x: 4, y: 5 });
    expect(getActorOccupancy(world.objects, actor)).toBeNull();
  });

  test("an actual attachment can be detached before taking an object", () => {
    const bag = item("bag", {
      kind: "bag",
      attachment: { toObjectId: "hook", detachable: true },
    });
    const { run } = setup([bag]);
    expect(run({ type: "take", objectId: "bag" }).refusal).toBe(
      "detach the object first",
    );
    expect(run({ type: "detach", objectId: "bag" }).ok).toBe(true);
    expect(run({ type: "take", objectId: "bag" }).ok).toBe(true);
    expect(run({ type: "detach", objectId: "bag" }).ok).toBe(false);
  });

  test("an occupied object's return point cannot be covered and scripts cannot remove its body", () => {
    const coffin = item("coffin", {
      kind: "furniture",
      occupancy: { pose: "lying" },
    });
    const table = item(
      "table",
      { kind: "furniture" },
      { location: { kind: "room", roomId: "a", x: 4, y: 4 } },
    );
    const { world, run } = setup([coffin, table]);
    expect(run({ type: "occupy", objectId: "coffin" }).ok).toBe(true);
    expect(run({ type: "moveObject", objectId: "table", x: 4, y: 5 }).ok).toBe(
      false,
    );
    expect(
      executeWorldAction(world, {
        actor: { kind: "script", id: "test" },
        source: "script",
        action: { type: "take", objectId: "coffin" },
      }).ok,
    ).toBe(false);
    expect(run({ type: "leave" }).ok).toBe(true);
  });

  test("moving furniture updates its real body and refuses a wall across the path", () => {
    const table = item("table", { kind: "furniture" });
    const { world, run } = setup([table]);
    expect(run({ type: "moveObject", objectId: "table", x: 6, y: 5 }).ok).toBe(
      true,
    );
    expect(world.canWalk("a", 5, 5)).toBe(true);
    expect(world.canWalk("a", 6, 5)).toBe(false);
    const blocked = setup(
      [item("table", { kind: "furniture" })],
      Array.from({ length: 16 }, (_, y) => [6, y] as [number, number]),
    );
    expect(
      blocked.run({ type: "moveObject", objectId: "table", x: 7, y: 5 })
        .refusal,
    ).toBe("no path");
    expect(blocked.world.objectById.get("table")?.location).toEqual({
      kind: "room",
      roomId: "a",
      x: 5,
      y: 5,
    });
  });

  test("NPC furniture movement cannot cover the player or sweep through a blocked corridor", () => {
    for (const destination of [6, 7]) {
      const table = item("table", { kind: "furniture" });
      const world = createWorldMutator({
        objects: [table],
        playerPose: { roomId: "a", x: 6, y: 5 },
        figurePoses: [["worker", { roomId: "a", x: 4, y: 5 }]],
        isWalkableTile: (_room, x, y) => x >= 0 && x < 16 && y === 5,
      });
      const result = executeWorldAction(world, {
        actor: { kind: "figure", id: "worker" },
        source: "npc",
        action: { type: "moveObject", objectId: "table", x: destination, y: 5 },
      });
      expect(result.refusal).toBe(
        destination === 6 ? "actor blocks destination" : "no path",
      );
      expect(table.location).toEqual({ kind: "room", roomId: "a", x: 5, y: 5 });
      expect(world.revision).toBe(0);
    }
  });

  test("dropping and emptying solid contents never traps a standing actor", () => {
    const bag = item(
      "bag",
      { kind: "bag", container: "open" },
      {
        location: { kind: "held", actor },
      },
    );
    const apple = item(
      "apple",
      { kind: "portable" },
      {
        location: { kind: "inside", objectId: "bag" },
      },
    );
    const { world, run } = setup([bag, apple]);
    expect(run({ type: "empty", objectId: "bag" }).ok).toBe(true);
    expect(world.canWalk("a", 4, 5)).toBe(true);
    expect(world.canWalk("a", 3, 5)).toBe(true);
    expect(run({ type: "drop", objectId: "bag", x: 4, y: 5 }).ok).toBe(false);
    expect(run({ type: "drop", objectId: "bag" }).ok).toBe(true);
    expect(world.canWalk("a", 4, 5)).toBe(true);
    expect(world.canWalk("a", 3, 5)).toBe(true);
  });

  test("furniture respects the fractional player footprint at the room's tile size in live and preview", () => {
    for (const tileSize of [16, 32]) {
      const table = item("table", { kind: "furniture" });
      const world = createWorldMutator({
        objects: [table],
        playerPose: { roomId: "a", x: 7.15, y: 5.5 },
        figurePoses: [["worker", { roomId: "a", x: 4, y: 5 }]],
        roomTileSize: () => tileSize,
        isWalkableTile: (_room, x, y) => x >= 0 && x < 16 && y >= 0 && y < 16,
      });
      const snapshot = {
        objects: world.objects,
        player: world.getPlayerPose(),
        figures: [{ id: "worker", roomId: "a", x: 4, y: 5 }],
        doors: [],
        worldRevision: world.revision,
        geometry: {
          a: {
            width: 16,
            height: 16,
            tileSize,
            cells: Array(16).fill(".".repeat(16)),
          },
        },
      } as unknown as WorldSnapshot;
      const sandbox = SnapshotSandbox.fromSnapshot(snapshot);
      for (const target of [
        world,
        cloneWorldMutator(world),
        sandbox,
        sandbox.clone(),
      ]) {
        const result = executeWorldAction(target, {
          actor: { kind: "figure", id: "worker" },
          source: "npc",
          action: { type: "moveObject", objectId: "table", x: 6, y: 5 },
        });
        expect(result.ok).toBe(tileSize === 32);
        if (tileSize === 16)
          expect(result.refusal).toBe("actor blocks destination");
      }
    }
  });

  test("empty resolves all contents to real nearby floor positions", () => {
    const bag = item(
      "bag",
      { kind: "bag", container: "open" },
      { location: { kind: "held", actor } },
    );
    const apple = item(
      "apple",
      { kind: "portable" },
      { location: { kind: "inside", objectId: "bag" } },
    );
    const bottle = item(
      "bottle",
      { kind: "portable" },
      { location: { kind: "inside", objectId: "bag" } },
    );
    const { world, run } = setup([bag, apple, bottle]);
    expect(run({ type: "empty", objectId: "bag" }).ok).toBe(true);
    expect(apple.location.kind).toBe("room");
    expect(bottle.location.kind).toBe("room");
    expect(apple.location).not.toEqual(bottle.location);
    expect(world.objectById.get("bag")?.location).toEqual({
      kind: "held",
      actor,
    });
  });

  test("bounded approach finds a walkable adjacent place, never another room", () => {
    const bag = item(
      "bag",
      { kind: "bag" },
      { location: { kind: "room", roomId: "a", x: 9, y: 5 } },
    );
    const { world, run } = setup([bag]);
    const plan = planApproach(world, actor, "bag");
    expect(plan.refusal).toBeNull();
    expect(plan.path.length).toBeGreaterThan(0);
    expect(plan.path.length).toBeLessThanOrEqual(8);
    const options = availableActions(world, actor, {
      kind: "object",
      id: "bag",
    });
    expect(
      options.find((option) => option.action.type === "take")?.refusal,
    ).toBe("out of reach");
    expect(
      options.find((option) => option.action.type === "approach")?.refusal,
    ).toBeNull();
    expect(run({ type: "approach", objectId: "bag" }).ok).toBe(true);
    expect(
      availableActions(world, actor, { kind: "object", id: "bag" }).find(
        (option) => option.action.type === "take",
      )?.refusal,
    ).toBeNull();
    expect(run({ type: "take", objectId: "bag" }).ok).toBe(true);
    bag.location = { kind: "room", roomId: "b", x: 1, y: 1 };
    expect(run({ type: "approach", objectId: "bag" }).refusal).toBe(
      "different room",
    );
  });

  test("approach is not offered for a path narrower than the player body", () => {
    const bag = item(
      "bag",
      { kind: "bag" },
      {
        location: { kind: "room", roomId: "a", x: 8, y: 5 },
      },
    );
    const world = createWorldMutator({
      objects: [bag],
      playerPose: { roomId: "a", x: 4, y: 5 },
      isWalkableTile: (_room, x, y) => x >= 0 && x < 16 && y === 5,
    });
    expect(
      availableActions(world, actor, { kind: "object", id: "bag" }).some(
        (option) => option.action.type === "approach",
      ),
    ).toBe(false);
  });

  test("profile refinement only upgrades unprofiled objects and cannot invent an anchor or role", () => {
    const legacy = item("legacy", { kind: "structure" });
    delete legacy.profile;
    const { run } = setup([legacy]);
    expect(
      run({
        type: "refineProfile",
        objectId: "legacy",
        profile: {
          kind: "bag",
          attachment: { toObjectId: "wall", detachable: false },
        },
      }).ok,
    ).toBe(false);
    expect(
      run({
        type: "refineProfile",
        objectId: "legacy",
        profile: { kind: "bag" },
      }).ok,
    ).toBe(true);
    expect(run({ type: "take", objectId: "legacy" }).ok).toBe(true);
    expect(
      run({
        type: "refineProfile",
        objectId: "legacy",
        profile: { kind: "structure" },
      }).ok,
    ).toBe(false);
  });

  test("physical state clones and snapshot conversion do not alias the live actor", () => {
    const coffin = item("coffin", {
      kind: "furniture",
      occupancy: { pose: "lying" },
    });
    const bag = item(
      "bag",
      { kind: "bag" },
      { location: { kind: "held", actor } },
    );
    const { world, run } = setup([coffin, bag]);
    expect(run({ type: "wear", objectId: "bag" }).ok).toBe(true);
    expect(run({ type: "occupy", objectId: "coffin" }).ok).toBe(true);
    const clone = cloneWorldMutator(world);
    clone.objectById.get("coffin")!.state.occupancy!.returnPose.x = 15;
    expect(coffin.state.occupancy?.returnPose.x).toBe(4);
    const snapshot = {
      objects: world.objects,
      player: world.getPlayerPose(),
      figures: [],
      doors: [],
      worldRevision: world.revision,
      geometry: {
        a: {
          width: 16,
          height: 16,
          cells: Array.from({ length: 16 }, () => ".".repeat(16)),
        },
      },
    } as unknown as WorldSnapshot;
    const sandbox = SnapshotSandbox.fromSnapshot(snapshot);
    expect(sandbox.objectById.get("bag")?.profile?.kind).toBe("bag");
    expect(
      executeWorldAction(sandbox, {
        actor,
        source: "player",
        action: { type: "leave" },
      }).ok,
    ).toBe(true);
    expect(coffin.state.occupancy).not.toBeNull();
    expect(
      sandbox.toSnapshotExtras().objects.find((value) => value.id === "coffin")
        ?.state.occupancy,
    ).toBeNull();
  });

  test("closed occupancy conceals the actor and carried things from new witnesses", () => {
    const coffin = item("coffin", {
      kind: "furniture",
      container: "open",
      occupancy: { pose: "lying" },
    });
    const bag = item(
      "bag",
      { kind: "bag" },
      { location: { kind: "held", actor } },
    );
    const { world, run } = setup([coffin, bag]);
    run({ type: "occupy", objectId: "coffin" });
    run({ type: "close", targetId: "coffin" });
    const envelope = {
      actor,
      source: "player" as const,
      action: { type: "wear" as const, objectId: "bag" },
    };
    const before = captureWorldAction(world, envelope);
    const result = executeWorldAction(world, envelope);
    const mind = createWorldMind();
    recordWorldAction(mind, world, envelope, result, before, 1);
    expect(worldMindForFigure(mind, "witness")).toHaveLength(0);
  });

  test("tools bind new physical verbs and expose only relevant equipment actions", () => {
    expect(worldActionFromTool("remove_wear", { objectId: "bag" })).toEqual({
      type: "removeWear",
      objectId: "bag",
    });
    expect(worldActionFromTool("leave", {})).toEqual({ type: "leave" });
    const bag = item(
      "bag",
      { kind: "bag" },
      { location: { kind: "held", actor } },
    );
    const { world, run } = setup([bag]);
    expect(
      availableActions(world, actor, { kind: "object", id: "bag" }).some(
        (option) => option.action.type === "wear",
      ),
    ).toBe(true);
    run({ type: "wear", objectId: "bag" });
    const options = availableActions(world, actor, {
      kind: "object",
      id: "bag",
    });
    expect(options.some((option) => option.action.type === "wear")).toBe(false);
    expect(options.some((option) => option.action.type === "removeWear")).toBe(
      true,
    );
  });
});
