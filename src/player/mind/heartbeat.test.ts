/**
 * Heartbeat viewport guard and sleeper-source apply.
 */

import { describe, expect, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import type {
  WorldActionEnvelope,
  WorldActionResult,
} from "../../shared/world-action";
import type { WorldMutator } from "../../shared/world-object";
import { applyPatch } from "../game/patch";
import { createWorld, type WorldState } from "../game/world";
import type { MapPatch } from "../../shared/map-patch";
import type { CycleExitResult } from "../../shared/ai";
import { Heartbeat } from "./heartbeat";
import { ObservationLog } from "./observation";
import type { DreamMind } from "./types";

function makeWorld(): WorldState {
  const artifact = validateDreamArtifact(
    JSON.parse(JSON.stringify(fixture)),
  ) as DreamArtifact;
  return createWorld(artifact);
}

function fakeMind(patches: MapPatch[]): DreamMind {
  return {
    name: "test",
    waiting: false,
    turn: async () => {
      throw new Error("unused");
    },
    examine: async () => {
      throw new Error("unused");
    },
    mutate: async (): Promise<CycleExitResult> => ({
      patches,
      sleeperSummary: "",
    }),
    judge: async () => {
      throw new Error("unused");
    },
    availableMemories: () => [],
    conversation: () => [],
    forgetFigures: () => undefined,
    abort: () => undefined,
  };
}

const CONFIG = { callBudgetPerCycle: 4, maxPatchesPerBeat: 8 };

describe("Heartbeat viewport guard", () => {
  test("background and debug share a budget but reserve the last call for cycle exit", async () => {
    const world = makeWorld();
    let calls = 0;
    const mind = fakeMind([]);
    mind.mutate = async () => {
      calls++;
      return { patches: [], sleeperSummary: "" };
    };
    const heartbeat = new Heartbeat(
      world,
      mind,
      new ObservationLog(),
      CONFIG,
      () => ({ roomId: "a", rect: { x: 0, y: 0, w: 1, h: 1 } }),
    );
    expect(heartbeat.trySpendBackgroundCall()).toBe(true);
    expect(heartbeat.trySpendBackgroundCall()).toBe(true);
    expect(heartbeat.trySpendBackgroundCall()).toBe(true);
    expect(heartbeat.trySpendBackgroundCall()).toBe(false);
    await heartbeat.force();
    expect(calls).toBe(0);
    await heartbeat.planCycleExit();
    expect(calls).toBe(1);
    expect(heartbeat.budgetRemaining).toBe(0);
  });
  test("a late forced beat cannot apply to a new cycle or unlock its pending beat", async () => {
    const world = makeWorld();
    const pending: Array<(value: CycleExitResult) => void> = [];
    const mind = fakeMind([]);
    mind.mutate = () => new Promise((resolve) => pending.push(resolve));
    const heartbeat = new Heartbeat(
      world,
      mind,
      new ObservationLog(),
      CONFIG,
      () => ({ roomId: "b", rect: { x: 0, y: 0, w: 2, h: 2 } }),
    );
    const first = heartbeat.force();
    heartbeat.resetCycle();
    const second = heartbeat.force();
    pending[0]!({
      patches: [{ kind: "sealDoor", doorId: "a-to-b", reason: "old cycle" }],
      sleeperSummary: "",
    });
    expect((await first).entries).toEqual([]);
    expect(world.doorById.get("a-to-b")!.type).toBe("keyLock");
    await heartbeat.force();
    expect(pending).toHaveLength(2);
    pending[1]!({ patches: [], sleeperSummary: "" });
    await second;
    expect(heartbeat.budgetRemaining).toBe(CONFIG.callBudgetPerCycle - 1);
  });

  test("force withholds a patch that patchTouches the visible viewport", async () => {
    const world = makeWorld();
    applyPatch(world, { kind: "sealDoor", doorId: "a-to-b", reason: "setup" });
    const heartbeat = new Heartbeat(
      world,
      fakeMind([{ kind: "openDoor", doorId: "a-to-b", reason: "beat" }]),
      new ObservationLog(),
      CONFIG,
      () => ({ roomId: "a", rect: { x: 4, y: 0, w: 6, h: 4 } }),
    );

    const outcome = await heartbeat.force();

    expect(outcome.entries[0]?.withheld).toBe("the player can see that");
    expect(world.doorById.get("a-to-b")!.type).toBe("sealed");
  });

  test("force applies a patch the player cannot see", async () => {
    const world = makeWorld();
    applyPatch(world, { kind: "sealDoor", doorId: "a-to-b", reason: "setup" });
    const heartbeat = new Heartbeat(
      world,
      fakeMind([{ kind: "openDoor", doorId: "a-to-b", reason: "beat" }]),
      new ObservationLog(),
      CONFIG,
      () => ({ roomId: "a", rect: { x: 0, y: 6, w: 2, h: 2 } }),
    );

    const outcome = await heartbeat.force();

    expect(outcome.entries[0]?.withheld).toBeUndefined();
    expect(outcome.entries[0]?.result.ok).toBe(true);
    expect(world.doorById.get("a-to-b")!.type).toBe("keyLock");
  });

  test("applyCyclePlan still ignores the viewport (nothing is visible yet)", () => {
    const world = makeWorld();
    applyPatch(world, { kind: "sealDoor", doorId: "a-to-b", reason: "setup" });
    const heartbeat = new Heartbeat(
      world,
      fakeMind([]),
      new ObservationLog(),
      CONFIG,
      () => ({ roomId: "a", rect: { x: 4, y: 0, w: 6, h: 4 } }),
    );

    const outcome = heartbeat.applyCyclePlan({
      patches: [{ kind: "openDoor", doorId: "a-to-b", reason: "exit" }],
      sleeperSummary: "",
    });

    expect(outcome.entries[0]?.withheld).toBeUndefined();
    expect(world.doorById.get("a-to-b")!.type).toBe("keyLock");
  });

  test("off-screen apply goes through execute as source sleeper", async () => {
    const world = makeWorld();
    applyPatch(world, { kind: "sealDoor", doorId: "a-to-b", reason: "setup" });
    const envelopes: WorldActionEnvelope[] = [];
    const execute = (
      _world: WorldMutator,
      envelope: WorldActionEnvelope,
    ): WorldActionResult => {
      envelopes.push(envelope);
      return {
        ok: true,
        refusal: null,
        affectedRooms: ["a"],
        affectedObjects: [],
        events: [],
      };
    };
    const heartbeat = new Heartbeat(
      world,
      fakeMind([{ kind: "openDoor", doorId: "a-to-b", reason: "beat" }]),
      new ObservationLog(),
      CONFIG,
      () => ({ roomId: "a", rect: { x: 0, y: 6, w: 2, h: 2 } }),
      execute,
    );

    const outcome = await heartbeat.force();

    expect(outcome.entries[0]?.result.ok).toBe(true);
    expect(envelopes[0]?.source).toBe("sleeper");
    expect(envelopes[0]?.actor).toEqual({ kind: "sleeper" });
    expect(envelopes[0]?.action).toEqual({ type: "open", targetId: "a-to-b" });
  });
});
