import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { type DreamArtifact, validateDreamArtifact } from "../../shared/dream";
import { executeWorldAction } from "../../shared/world-action-engine";
import type { WorldActionEnvelope } from "../../shared/world-action";
import type { FigureFate } from "../../shared/verbs";
import { NpcRoutines } from "./npc-routines";
import { NpcTaskCoordinator } from "./npc-task-coordinator";
import { createWorld, type WorldState } from "./world";
import { bindWorldMutator, staticPlayerPose } from "./world-mutator";

function setup(options: { dryWallet?: boolean | (() => boolean) } = {}) {
  const world = createWorld(
    validateDreamArtifact(structuredClone(fixture)) as DreamArtifact,
  );
  const figure = world.figures[0]!;
  figure.roomId = "a";
  figure.x = 1;
  figure.y = 5;
  figure.agenda = [
    { phase: "middle", roomId: "b", activity: "перебирает бумаги" },
    { phase: "late", roomId: "a", activity: "заканчивает смену" },
  ];
  const actions: WorldActionEnvelope[] = [];
  const coordinator = coordinatorFor(world, actions);
  const routines = new NpcRoutines(world, coordinator, options);
  return { world, figure, actions, coordinator, routines };
}

function coordinatorFor(world: WorldState, actions: WorldActionEnvelope[]) {
  return new NpcTaskCoordinator(world, (envelope) => {
    actions.push(structuredClone(envelope));
    return executeWorldAction(
      bindWorldMutator(world, staticPlayerPose(null)),
      envelope,
    );
  });
}

function advance(
  routines: NpcRoutines,
  coordinator: NpcTaskCoordinator,
  ticks = 300,
) {
  for (let index = 0; index < ticks; index++) {
    routines.tick(0.5, null, 0.1);
    coordinator.tick(0.1);
  }
}

describe("local NPC routines", () => {
  test("an offscreen agenda walks to a threshold before traversing and never repeats the finished job", () => {
    const { world, figure, actions, coordinator, routines } = setup();
    world.currentRoomId = "m1";
    advance(routines, coordinator, 1);
    expect(figure.roomId).toBe("a");
    expect(Math.hypot(figure.x - 1, figure.y - 5)).toBeCloseTo(0.3);
    expect(coordinator.ownerOf(figure.id)?.kind).toBe("routine");
    advance(routines, coordinator);
    expect(figure.roomId).toBe("b");
    expect({ x: figure.x, y: figure.y }).toEqual({ x: 8, y: 4 });
    expect(figure.activity).toBe("перебирает бумаги");
    expect(actions.map((entry) => entry.action.type)).toEqual([
      "moveTo",
      "traverseDoor",
      "moveTo",
    ]);
    expect(new Set(actions.map((entry) => entry.cause?.rootId)).size).toBe(1);
    advance(routines, coordinator, 600);
    expect(actions).toHaveLength(3);
    expect(routines.snapshot().pending).toEqual([]);
  });

  test("a blocked schedule wakes on a door dependency, without polling from ordinary revisions", () => {
    const { world, figure, actions, coordinator, routines } = setup();
    const stair = world.doorById.get("a--stair-up")!;
    stair.type = "sealed";
    advance(routines, coordinator, 1);
    const blocked = routines.snapshot();
    expect(blocked.pending[0]?.blockedOn).toBeTruthy();
    for (let index = 0; index < 120; index++) {
      world.revision++;
      routines.tick(0.5);
      coordinator.tick(0.1);
    }
    expect(routines.snapshot().pending[0]?.blockedOn).toEqual(
      blocked.pending[0]?.blockedOn,
    );
    expect(actions).toEqual([]);
    expect(figure.roomId).toBe("a");
    stair.type = "open";
    advance(routines, coordinator);
    expect(figure.roomId).toBe("b");
    expect(actions.some((entry) => entry.action.type === "traverseDoor")).toBe(
      true,
    );
  });

  test("higher-priority jobs and dialogue keep ownership until they finish", () => {
    const { figure, coordinator, routines } = setup();
    const owner = { kind: "jev", id: "chosen" } as const;
    expect(
      coordinator.tryEnqueue(figure.id, owner, [
        { type: "moveTo", x: 2, y: 5, roomId: "a" },
      ]),
    ).toBe(true);
    for (let index = 0; index < 60; index++) routines.tick(0.5);
    expect(coordinator.ownerOf(figure.id)).toEqual(owner);
    expect(figure.agendaPhase).toBe("early");
    coordinator.cancel(figure.id, owner);
    routines.tick(0.5, figure.id);
    expect(coordinator.isBusy(figure.id)).toBe(false);
    routines.tick(0.5);
    expect(coordinator.ownerOf(figure.id)?.kind).toBe("routine");
  });

  test.each(["turyshev", "glaz", "shchenok", "raisa", "kripto-bro"])(
    "%s cannot leave its pinned room because of an agenda",
    (id) => {
      const { figure, coordinator, routines } = setup({
        dryWallet: () => true,
      });
      figure.id = id;
      advance(routines, coordinator);
      expect(figure.roomId).toBe("a");
      expect(coordinator.isBusy(id)).toBe(false);
    },
  );

  test("a funded wallet does not pin the crypto figure", () => {
    const { figure, coordinator, routines } = setup({ dryWallet: () => false });
    figure.id = "kripto-bro";
    advance(routines, coordinator);
    expect(figure.roomId).toBe("b");
  });

  test.each(["dead", "gone", "broken", "led"] as const)(
    "a figure with fate %s cannot start an agenda",
    (fate: FigureFate) => {
      const { world, figure, coordinator, routines } = setup();
      world.fates.set(figure.id, {
        figureId: figure.id,
        fate,
        cycle: 1,
        roomId: "a",
        by: "talk",
        remains: null,
        quoted: null,
      });
      advance(routines, coordinator);
      expect(figure.roomId).toBe("a");
      expect(coordinator.isBusy(figure.id)).toBe(false);
    },
  );

  test("a restored partial routine rebuilds from the current room without repeating the crossed doorway", () => {
    const { world, figure, actions, coordinator, routines } = setup();
    for (let index = 0; index < 300 && figure.roomId !== "b"; index++)
      advance(routines, coordinator, 1);
    expect(figure.roomId).toBe("b");
    expect(coordinator.isBusy(figure.id)).toBe(true);
    const saved = routines.snapshot();
    routines.clear();
    const restoredCoordinator = coordinatorFor(world, actions);
    const restored = new NpcRoutines(world, restoredCoordinator);
    restored.restore(saved);
    advance(restored, restoredCoordinator);
    expect({ x: figure.x, y: figure.y }).toEqual({ x: 8, y: 4 });
    expect(
      actions.filter((entry) => entry.action.type === "traverseDoor"),
    ).toHaveLength(1);
    expect(figure.activity).toBe("перебирает бумаги");
    expect(restored.snapshot().pending).toEqual([]);
  });

  test("restoring a blocked routine preserves its deadline and expiry does not restart it", () => {
    const { world, figure, actions, coordinator, routines } = setup();
    const stair = world.doorById.get("a--stair-up")!;
    stair.type = "sealed";
    advance(routines, coordinator, 1780);
    const saved = routines.snapshot();
    expect(saved.pending[0]!.remainingSeconds).toBeLessThan(3);
    routines.clear();
    const restoredCoordinator = coordinatorFor(world, actions);
    const restored = new NpcRoutines(world, restoredCoordinator);
    restored.restore(saved);
    stair.type = "open";
    advance(restored, restoredCoordinator, 30);
    expect(restored.snapshot().pending).toEqual([]);
    expect(restoredCoordinator.isBusy(figure.id)).toBe(false);
    expect(figure.roomId).toBe("a");
    const count = actions.length;
    advance(restored, restoredCoordinator, 600);
    expect(actions).toHaveLength(count);
  });
});
