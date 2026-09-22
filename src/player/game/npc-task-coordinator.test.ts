import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import type {
  WorldActionEnvelope,
  WorldActionResult,
} from "../../shared/world-action";
import { NpcTaskCoordinator } from "./npc-task-coordinator";
import { createWorld } from "./world";

const success = (): WorldActionResult => ({
  ok: true,
  refusal: null,
  affectedRooms: [],
  affectedObjects: [],
  events: [],
});
function setup() {
  const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
  const figure = world.figures[0]!;
  figure.roomId = "a";
  figure.x = 1;
  figure.y = 5;
  const executed: WorldActionEnvelope[] = [];
  const coordinator = new NpcTaskCoordinator(world, (envelope) => {
    executed.push(structuredClone(envelope));
    return success();
  });
  return { world, figure, executed, coordinator };
}
const jev = { kind: "jev", id: "pick-up-bottle" } as const;
const director = { kind: "director", id: "scene:step" } as const;
const routine = { kind: "routine", id: "morning" } as const;
const take = { type: "take", objectId: "bottle" } as const;

describe("shared NPC task coordinator", () => {
  test("director preempts Jev, which preempts routine; foreign owners cannot cancel or save the suffix", () => {
    const { coordinator, figure, executed } = setup();
    const refusals: string[] = [];
    expect(
      coordinator.tryEnqueue(figure.id, routine, [take], {
        onComplete: (result) => refusals.push(result.refusal!),
      }),
    ).toBe(true);
    expect(
      coordinator.tryEnqueue(figure.id, jev, [take], {
        onComplete: (result) => refusals.push(result.refusal!),
      }),
    ).toBe(true);
    expect(coordinator.tryEnqueue(figure.id, routine, [take])).toBe(false);
    expect(coordinator.cancel(figure.id, routine)).toBe(false);
    expect(coordinator.remaining(figure.id, routine)).toBeNull();
    expect(coordinator.tryEnqueue(figure.id, director, [take])).toBe(true);
    expect(coordinator.remaining(figure.id, jev)).toBeNull();
    coordinator.tick(0.1);
    expect(refusals).toEqual(["preempted by jev", "preempted by director"]);
    expect(executed).toHaveLength(1);
  });

  test("a duplicated submission cannot restore an executed prefix", () => {
    const { coordinator, figure, executed } = setup();
    coordinator.tryEnqueue(figure.id, jev, [
      take,
      { type: "drop", objectId: "bottle" },
    ]);
    coordinator.tick(0.1);
    expect(coordinator.tryEnqueue(figure.id, jev, [take])).toBe(false);
    expect(coordinator.remaining(figure.id, jev)).toEqual([
      { type: "drop", objectId: "bottle" },
    ]);
    for (let index = 0; index < 10; index++) coordinator.tick(0.1);
    expect(executed.map((entry) => entry.action.type)).toEqual([
      "take",
      "drop",
    ]);
  });

  test("one cause spans movement and physical actions and guards stop the remaining suffix", () => {
    const { coordinator, figure, executed } = setup();
    const cause = { rootId: "player:1", taskId: jev.id };
    let valid = true;
    let refusal: string | null = null;
    coordinator.tryEnqueue(
      figure.id,
      jev,
      [{ type: "moveTo", roomId: "a", x: 2, y: 5 }, take],
      {
        cause,
        beforeAction: () => valid || "object changed",
        afterAction: () => {
          valid = false;
        },
        onComplete: (result) => {
          refusal = result.refusal;
        },
      },
    );
    coordinator.tick(0.1);
    expect(figure.x).toBeGreaterThan(1);
    expect(figure.x).toBeLessThan(2);
    for (let index = 0; index < 20; index++) coordinator.tick(0.1);
    expect(executed).toHaveLength(1);
    expect(executed[0]!.cause).toEqual(cause);
    expect<string | null>(refusal).toBe("object changed");
    expect(figure.walking).toBe(false);
  });

  test("a saved unexecuted suffix resumes without replay, and lifetime expiry performs no action", () => {
    const state = setup();
    state.coordinator.tryEnqueue(state.figure.id, jev, [
      take,
      { type: "drop", objectId: "bottle" },
    ]);
    state.coordinator.tick(0.1);
    const remaining = state.coordinator.remaining(state.figure.id, jev)!;
    const resumed = new NpcTaskCoordinator(state.world, (envelope) => {
      state.executed.push(envelope);
      return success();
    });
    resumed.tryEnqueue(state.figure.id, jev, remaining);
    resumed.tick(0.1);
    expect(state.executed.map((entry) => entry.action.type)).toEqual([
      "take",
      "drop",
    ]);
    let refusal: string | null = null;
    resumed.tryEnqueue(state.figure.id, director, [take], {
      lifetimeSeconds: 0.05,
      onComplete: (result) => {
        refusal = result.refusal;
      },
    });
    resumed.tick(0.1);
    expect<string | null>(refusal).toBe("expired");
    expect(state.executed).toHaveLength(2);
  });

  test("dialogue cancellation and director reset do not delete another owner's work", () => {
    const { coordinator, figure } = setup();
    coordinator.tryEnqueue(figure.id, jev, [take]);
    coordinator.cancelOwner("director");
    expect(coordinator.ownerOf(figure.id)).toEqual(jev);
    coordinator.cancelFigure(figure.id, "conversation began");
    expect(coordinator.busyFigureIds.size).toBe(0);
  });
});

test("synchronous action reactions cannot run a revoked owner's callback", () => {
  const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
  const figureId = world.figures[0]!.id;
  const callbacks: string[] = [];
  const coordinator = new NpcTaskCoordinator(world, () => {
    coordinator.tryEnqueue(figureId, director, [
      { type: "drop", objectId: "bottle" },
    ]);
    return success();
  });
  coordinator.tryEnqueue(figureId, jev, [take], {
    afterAction: () => callbacks.push("revoked action callback"),
    onComplete: () => callbacks.push("cancelled"),
  });
  coordinator.tick(0.1);
  expect(callbacks).toEqual(["cancelled"]);
  expect(coordinator.remaining(figureId, director)).toEqual([
    { type: "drop", objectId: "bottle" },
  ]);
});

test("shared execution keeps the Eye stationary and pinned figures within their authored room", () => {
  const state = setup();
  state.figure.id = "glaz";
  state.coordinator.tryEnqueue("glaz", jev, [
    { type: "occupy", objectId: "bench" },
  ]);
  state.coordinator.tick(0.1);
  expect(state.executed).toHaveLength(0);
  state.figure.id = "turyshev";
  state.coordinator.tryEnqueue("turyshev", jev, [
    { type: "traverseDoor", doorId: "a--stair-up" },
  ]);
  state.coordinator.tick(0.1);
  expect(state.executed).toHaveLength(0);
});
