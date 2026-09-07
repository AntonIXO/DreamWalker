import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import type { WorldAction, WorldActionResult } from "../../shared/world-action";
import type { WorldObjectState } from "../../shared/world-object";
import { setLiveObjects } from "./object-collision";
import {
  findGridPath,
  NpcActionQueue,
  replayWorldActions,
} from "./npc-action-queue";
import { createWorld } from "./world";

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
    expect(Math.round(figure.x)).toBe(5);
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
