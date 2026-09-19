import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import { compilePhysicalProfile } from "../../shared/object-profile";
import { WALK_SPEED } from "../../shared/roomWalk";
import type {
  WorldAction,
  WorldActionEnvelope,
} from "../../shared/world-action";
import { executeWorldAction } from "../../shared/world-action-engine";
import type { ActorPose, WorldObjectState } from "../../shared/world-object";
import { PlayerActionRunner } from "./player-action-runner";
import { createWorld } from "./world";
import { bindWorldMutator } from "./world-mutator";

const PLAYER = { kind: "player" } as const;
const envelopes = (...actions: WorldAction[]): WorldActionEnvelope[] =>
  actions.map((action) => ({ actor: PLAYER, source: "player", action }));

function setup() {
  const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
  const room = world.roomById.get("a")!;
  room.props = [];
  world.interests = [];
  world.figures = [];
  const bag: WorldObjectState = {
    id: "bag",
    name: "bag",
    profile: { kind: "bag" },
    ...compilePhysicalProfile({ kind: "bag" }),
    location: { kind: "room", roomId: "a", x: 8, y: 4 },
    body: { w: 1, h: 1, solid: true },
    visual: { image: null, role: "prop" },
    interaction: { reach: 1.5, prompt: "bag", refusal: null },
    clueId: null,
    holdsShardId: null,
    sensorySeed: null,
    once: false,
    dwellMs: null,
    keyId: null,
    hotspotKind: "look",
    uiAction: null,
  };
  world.objects = [bag];
  world.objectById = new Map([[bag.id, bag]]);
  let pose: ActorPose = { roomId: "a", x: 2.5, y: 4.5 };
  let moving = false;
  let travelled = 0;
  const positions: ActorPose[] = [];
  const receipts: WorldActionEnvelope[] = [];
  const runner = new PlayerActionRunner(world, {
    playerPose: () => ({ ...pose }),
    move: (next, walks, distance) => {
      pose = { ...next };
      moving = walks;
      travelled += distance;
      positions.push({ ...pose });
    },
    execute: (envelope) => {
      receipts.push(envelope);
      return executeWorldAction(
        bindWorldMutator(world, {
          get: () => pose,
          set: (next) => {
            pose = { ...next };
          },
        }),
        envelope,
      );
    },
    revision: () => world.revision,
  });
  return {
    runner,
    world,
    room,
    bag,
    receipts,
    positions,
    get pose() {
      return pose;
    },
    set pose(next: ActorPose) {
      pose = next;
    },
    get moving() {
      return moving;
    },
    get travelled() {
      return travelled;
    },
  };
}

function finish(runner: PlayerActionRunner) {
  for (let tick = 0; tick < 300 && runner.waiting; tick++) runner.tick(1 / 60);
  expect(runner.waiting).toBe(false);
}

describe("player action runner", () => {
  test("walks at normal speed before committing approach, take and wear", async () => {
    const scene = setup();
    const start = { ...scene.pose };
    const completion = scene.runner.run(
      envelopes(
        { type: "approach", objectId: "bag" },
        { type: "take", objectId: "bag" },
        { type: "wear", objectId: "bag" },
      ),
    );
    expect(scene.runner.waiting).toBe(true);
    expect(scene.receipts).toHaveLength(0);
    expect(scene.pose).toEqual(start);
    scene.runner.tick(0.1);
    expect(scene.moving).toBe(true);
    expect(scene.travelled).toBeCloseTo(WALK_SPEED * 0.1, 5);
    expect(
      Math.hypot(scene.pose.x - start.x, scene.pose.y - start.y),
    ).toBeLessThan(0.4);
    expect(scene.receipts).toHaveLength(0);
    finish(scene.runner);
    const outcome = await completion;
    expect(outcome.ok).toBe(true);
    expect(outcome.executed).toBe(3);
    expect(outcome.execution.map((receipt) => receipt.action.type)).toEqual([
      "approach",
      "take",
      "wear",
    ]);
    expect(scene.world.revision).toBe(3);
    expect(scene.bag.state.wornBy).toEqual(PLAYER);
    expect(scene.moving).toBe(false);
    expect(scene.positions.length).toBeGreaterThan(20);
  });

  test("validates the whole envelope list before applying a valid prefix", async () => {
    const scene = setup();
    scene.bag.location = { kind: "held", actor: PLAYER };
    for (const invalid of [
      {
        actor: { kind: "figure", id: "npc" },
        source: "npc",
        action: { type: "take", objectId: "bag" },
      },
      {
        actor: PLAYER,
        source: "player",
        action: { type: "moveTo", x: 5, y: 5 },
      },
    ] as WorldActionEnvelope[]) {
      const result = await scene.runner.run([
        ...envelopes({ type: "wear", objectId: "bag" }),
        invalid,
      ]);
      expect(result.ok).toBe(false);
      expect(result.executed).toBe(0);
    }
    expect(scene.receipts).toHaveLength(0);
    expect(scene.bag.state.wornBy).toBeUndefined();
  });

  test("cancel rejects with AbortError, keeps the last position and never executes suffix", async () => {
    const scene = setup();
    const completion = scene.runner.run(
      envelopes(
        { type: "approach", objectId: "bag" },
        { type: "take", objectId: "bag" },
      ),
    );
    scene.runner.tick(0.1);
    const last = { ...scene.pose };
    scene.runner.cancel();
    await expect(completion).rejects.toMatchObject({ name: "AbortError" });
    scene.runner.tick(1);
    expect(scene.pose).toEqual(last);
    expect(scene.receipts).toHaveLength(0);
    expect(scene.moving).toBe(false);
    expect(scene.runner.waiting).toBe(false);
  });

  test("invalidated panel or cycle context cancels during movement", async () => {
    const scene = setup();
    let valid = true;
    const completion = scene.runner.run(
      envelopes(
        { type: "approach", objectId: "bag" },
        { type: "take", objectId: "bag" },
      ),
      () => valid,
    );
    scene.runner.tick(0.1);
    valid = false;
    scene.runner.tick(0.1);
    await expect(completion).rejects.toMatchObject({ name: "AbortError" });
    expect(scene.receipts).toHaveLength(0);
  });

  test("new solids stop the actual body before the obstacle and drop the suffix", async () => {
    const scene = setup();
    const completion = scene.runner.run(
      envelopes(
        { type: "approach", objectId: "bag" },
        { type: "take", objectId: "bag" },
      ),
    );
    scene.runner.tick(0.1);
    const blocker: WorldObjectState = {
      ...structuredClone(scene.bag),
      id: "blocker",
      location: { kind: "room", roomId: "a", x: 4, y: 2 },
      body: { w: 1, h: 5, solid: true },
    };
    scene.world.objects.push(blocker);
    scene.world.objectById.set(blocker.id, blocker);
    finish(scene.runner);
    const result = await completion;
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("path became blocked");
    expect(result.execution).toHaveLength(1);
    expect(scene.pose.x).toBeLessThan(4);
    expect(scene.bag.location.kind).toBe("room");
    expect(scene.receipts).toHaveLength(0);
  });

  test("a target moved away or a changed player room cannot be followed by a jump", async () => {
    for (const changed of ["target", "room"] as const) {
      const scene = setup();
      const completion = scene.runner.run(
        envelopes(
          { type: "approach", objectId: "bag" },
          { type: "take", objectId: "bag" },
        ),
      );
      scene.runner.tick(0.1);
      if (changed === "target")
        scene.bag.location = { kind: "room", roomId: "a", x: 9, y: 5 };
      else {
        scene.world.currentRoomId = "b";
        scene.pose = { roomId: "b", x: 2, y: 3 };
      }
      const last = { ...scene.pose };
      scene.runner.tick(0.1);
      expect((await completion).ok).toBe(false);
      expect(scene.pose).toEqual(last);
      expect(scene.receipts).toHaveLength(0);
    }
  });

  test("a failed suffix reports the executed prefix and stops later commands", async () => {
    const scene = setup();
    scene.bag.location = { kind: "held", actor: PLAYER };
    const result = await scene.runner.run(
      envelopes(
        { type: "wear", objectId: "bag" },
        { type: "drop", objectId: "bag" },
        { type: "removeWear", objectId: "bag" },
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.executed).toBe(2);
    expect(result.execution.map((receipt) => receipt.ok)).toEqual([
      true,
      false,
    ]);
    expect(scene.bag.state.wornBy).toEqual(PLAYER);
    expect(scene.receipts).toHaveLength(2);
  });

  test("empty plans and already-near approaches finish without a tick or fractional snap", async () => {
    const scene = setup();
    expect(await scene.runner.run([])).toEqual({
      ok: true,
      executed: 0,
      refusal: null,
      execution: [],
    });
    scene.pose = { roomId: "a", x: 7.2, y: 4.5 };
    const start = { ...scene.pose };
    const result = await scene.runner.run(
      envelopes({ type: "approach", objectId: "bag" }),
    );
    expect(result.ok).toBe(true);
    expect(scene.pose).toEqual(start);
    expect(scene.travelled).toBe(0);
    expect(scene.runner.waiting).toBe(false);
  });

  test("a suspended tab cannot consume a whole approach in one long frame", async () => {
    const scene = setup();
    const completion = scene.runner.run(
      envelopes({ type: "approach", objectId: "bag" }),
    );
    scene.runner.tick(60);
    expect(scene.runner.waiting).toBe(true);
    expect(scene.travelled).toBeCloseTo(WALK_SPEED * 0.1, 5);
    finish(scene.runner);
    expect((await completion).ok).toBe(true);
  });
});
