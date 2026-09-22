import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import type { WorldAction, WorldActionResult } from "../../shared/world-action";
import type { WorldObjectState } from "../../shared/world-object";
import { setLiveObjects } from "./object-collision";
import {
  findGridPath,
  NpcActionQueue,
  planNpcRoute,
  replayWorldActions,
} from "./npc-action-queue";
import { createWorld } from "./world";
import { bindWorldMutator, staticPlayerPose } from "./world-mutator";
import { executeWorldAction } from "../../shared/world-action-engine";

function tiny() {
  const artifact = validateDreamArtifact(
    JSON.parse(JSON.stringify(fixture)),
  ) as DreamArtifact;
  return createWorld(artifact);
}

function ok(): WorldActionResult {
  return {
    ok: true,
    refusal: null,
    affectedRooms: [],
    affectedObjects: [],
    events: [],
  };
}

function bottle(): WorldObjectState {
  return {
    id: "bottle",
    name: "бутылка",
    location: { kind: "room", roomId: "a", x: 5, y: 5 },
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
  };
}

describe("findGridPath", () => {
  test("walks around a crate in the tiny room", () => {
    const world = tiny();
    const path = findGridPath(world, "a", { x: 1, y: 4 }, { x: 5, y: 4 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 1, y: 4 });
    expect(path![path!.length - 1]).toEqual({ x: 5, y: 4 });
    expect(path!.some((step) => step.x === 3 && step.y === 4)).toBe(false);
  });
});

describe("NpcActionQueue", () => {
  test("a long intention walks to a real threshold, traverses it, then finishes in the destination room", () => {
    const world = tiny();
    const figure = world.figures[0]!;
    figure.roomId = "a";
    figure.x = 1;
    figure.y = 5;
    const actions = planNpcRoute(world, figure.id, { roomId: "b", x: 3, y: 5 });
    expect(actions?.some((action) => action.type === "traverseDoor")).toBe(
      true,
    );
    const queue = new NpcActionQueue();
    let success = false;
    queue.enqueue(figure.id, actions!, (result) => {
      success = result.ok;
    });
    const events: string[] = [];
    for (let i = 0; i < 300; i++)
      queue.tick(
        world,
        (envelope) => {
          const result = executeWorldAction(
            bindWorldMutator(world, staticPlayerPose(null)),
            envelope,
          );
          events.push(...result.events.map((event) => event.type));
          return result;
        },
        0.1,
      );
    expect(success).toBe(true);
    expect(figure.roomId).toBe("b");
    expect(figure.x).toBe(3);
    expect(figure.y).toBe(5);
    expect(events).toContain("door.traversed");
  });

  test("routing never borrows the player's key to unlock an NPC's path", () => {
    const world = tiny();
    const figure = world.figures[0]!;
    figure.roomId = "a";
    world.doorById.get("a--stair-up")!.type = "sealed";
    const key = bottle();
    key.keyId = "key1";
    key.location = { kind: "held", actor: { kind: "player" } };
    setLiveObjects(world, [key]);
    world.keysHeld.add("key1");
    expect(
      planNpcRoute(world, figure.id, { roomId: "b", x: 3, y: 5 }),
    ).toBeNull();
    key.location = { kind: "held", actor: { kind: "figure", id: figure.id } };
    expect(
      planNpcRoute(world, figure.id, { roomId: "b", x: 3, y: 5 }),
    ).not.toBeNull();
  });

  test("moveTo walks the figure, then take is executed", () => {
    const world = tiny();
    const figure = world.figures[0]!;
    figure.roomId = "a";
    figure.x = 1;
    figure.y = 5;
    setLiveObjects(world, [bottle()]);
    const executed: WorldAction["type"][] = [];
    const queue = new NpcActionQueue();
    queue.enqueue(figure.id, [
      { type: "moveTo", x: 5, y: 5 },
      { type: "take", objectId: "bottle" },
    ]);
    for (let i = 0; i < 40; i++) {
      queue.tick(world, (envelope) => {
        executed.push(envelope.action.type);
        expect(envelope.actor).toEqual({ kind: "figure", id: figure.id });
        return ok();
      });
    }
    // The goal names the bottle's occupied tile; the body stops beside it to take it.
    expect(Math.round(figure.x)).toBe(4);
    expect(Math.round(figure.y)).toBe(5);
    expect(executed).toEqual(["moveTo", "take"]);
    expect(queue.isBusy(figure.id)).toBe(false);
  });

  test("a refused action stops the rest of the queue", () => {
    const world = tiny();
    const figure = world.figures[0]!;
    figure.roomId = "a";
    figure.x = 5;
    figure.y = 5;
    const executed: WorldAction["type"][] = [];
    const queue = new NpcActionQueue();
    queue.enqueue(figure.id, [
      { type: "open", targetId: "box" },
      { type: "take", objectId: "bottle" },
    ]);
    queue.tick(world, (envelope) => {
      executed.push(envelope.action.type);
      return {
        ok: false,
        refusal: "закрыто",
        affectedRooms: [],
        affectedObjects: [],
        events: [],
      };
    });
    expect(executed).toEqual(["open"]);
    expect(queue.isBusy(figure.id)).toBe(false);
  });

  test("movement is paced by elapsed time and never jumps a tile in one frame", () => {
    const world = tiny();
    const figure = world.figures[0]!;
    figure.roomId = "a";
    figure.x = 1;
    figure.y = 5;
    const queue = new NpcActionQueue();
    queue.enqueue(figure.id, [{ type: "moveTo", x: 5, y: 5 }]);
    queue.tick(world, () => ok(), 1 / 60);
    expect(figure.x).toBeGreaterThan(1);
    expect(figure.x).toBeLessThan(1.1);
    expect(queue.isBusy(figure.id)).toBe(true);
    expect(queue.remaining(figure.id)).toHaveLength(1);
  });

  test("an actor removed mid-intention cannot execute the remaining physical command", () => {
    const world = tiny();
    const figure = world.figures[0]!;
    const queue = new NpcActionQueue();
    let completed = false;
    queue.enqueue(figure.id, [{ type: "open", targetId: "box" }], (result) => {
      completed = !result.ok;
    });
    world.figures.splice(world.figures.indexOf(figure), 1);
    let executed = false;
    queue.tick(world, () => {
      executed = true;
      return ok();
    });
    expect(executed).toBe(false);
    expect(completed).toBe(true);
    expect(queue.isBusy(figure.id)).toBe(false);
  });
});

describe("replayWorldActions", () => {
  test("runs in order and stops on the first refusal", () => {
    const executed: WorldAction["type"][] = [];
    const result = replayWorldActions(
      (envelope) => {
        executed.push(envelope.action.type);
        if (envelope.action.type === "take") {
          return {
            ok: false,
            refusal: "закрыто",
            affectedRooms: [],
            affectedObjects: [],
            events: [],
          };
        }
        return ok();
      },
      { kind: "figure", id: "kirill" },
      "npc",
      [
        { type: "moveTo", x: 1, y: 1 },
        { type: "take", objectId: "box" },
        { type: "open", targetId: "door" },
      ],
    );
    expect(executed).toEqual(["moveTo", "take"]);
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("закрыто");
    expect(result.executed).toBe(2);
  });

  test("stops remaining actions if execute throws", () => {
    const executed: WorldAction["type"][] = [];
    const result = replayWorldActions(
      (envelope) => {
        executed.push(envelope.action.type);
        if (envelope.action.type === "take") {
          throw new Error("sandbox/live mismatch");
        }
        return ok();
      },
      { kind: "figure", id: "kirill" },
      "npc",
      [
        { type: "drop", objectId: "box" },
        { type: "take", objectId: "box" },
        { type: "use", objectId: "box" },
      ],
    );
    expect(executed).toEqual(["drop", "take"]);
    expect(result.ok).toBe(false);
    expect(result.executed).toBe(1);
  });
});

test("queued approach animates before committing its single physical receipt", () => {
  const world = tiny();
  const figure = world.figures[0]!;
  figure.roomId = "a";
  figure.x = 1;
  figure.y = 5;
  const object = bottle();
  setLiveObjects(world, [object]);
  world.objectById.set(object.id, object);
  const queue = new NpcActionQueue();
  const executed: string[] = [];
  queue.enqueue(figure.id, [
    { type: "approach", objectId: "bottle" },
    { type: "take", objectId: "bottle" },
  ]);
  const execute = (envelope: Parameters<typeof executeWorldAction>[1]) => {
    executed.push(envelope.action.type);
    return executeWorldAction(
      bindWorldMutator(world, staticPlayerPose(null)),
      envelope,
    );
  };
  queue.tick(world, execute, 0.1);
  expect(Math.hypot(figure.x - 1, figure.y - 5)).toBeGreaterThan(0);
  expect(Math.hypot(figure.x - 1, figure.y - 5)).toBeLessThan(1);
  expect(executed).toHaveLength(0);
  for (let index = 0; index < 100; index++) queue.tick(world, execute, 0.1);
  expect(executed).toEqual(["approach", "take"]);
  expect(world.objectById.get("bottle")!.location).toEqual({
    kind: "held",
    actor: { kind: "figure", id: figure.id },
  });
});
