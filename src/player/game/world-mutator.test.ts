import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { sonArtifact } from "../../../dreams/son/pack";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import {
  cloneWorldMutator,
  executeWorldAction,
} from "../../shared/world-action-engine";
import { sandboxFromSnapshot } from "../../shared/world-sandbox";
import { snapshot } from "../mind/remote";
import { createWorld, rebuildObjectIndex } from "./world";
import { bindWorldMutator, staticPlayerPose } from "./world-mutator";

describe("live world mutator", () => {
  function setup() {
    const world = createWorld(
      validateDreamArtifact(structuredClone(fixture)) as DreamArtifact,
    );
    const mutator = bindWorldMutator(world, staticPlayerPose(null));
    return { world, mutator, figure: world.figures[0]! };
  }

  test("an agent cannot keep acting from a cached pose after its figure is removed", () => {
    const { world, mutator, figure } = setup();
    expect(mutator.getFigurePose(figure.id)).not.toBeNull();
    world.figures.length = 0;
    expect(mutator.getFigurePose(figure.id)).toBeNull();
    expect(
      executeWorldAction(mutator, {
        actor: { kind: "figure", id: figure.id },
        source: "npc",
        action: { type: "moveTo", x: 7, y: 4 },
      }).ok,
    ).toBe(false);
  });

  test("an agent move cancels the previous ambient walking target", () => {
    const { mutator, figure } = setup();
    figure.targetX = 7;
    figure.targetY = 4;
    figure.walking = true;
    mutator.setFigurePose(figure.id, { roomId: "b", x: 2, y: 3 });
    expect(figure.targetX).toBeNull();
    expect(figure.targetY).toBeNull();
    expect(figure.walking).toBe(false);
  });

  test("a bound mutator observes a newly installed object catalog", () => {
    const { world, mutator } = setup();
    world.objects = world.objects.map((object) => structuredClone(object));
    rebuildObjectIndex(world);
    expect(mutator.objects).toBe(world.objects);
    expect(mutator.objects[0]!).toBe(
      mutator.objectById.get(world.objects[0]!.id)!,
    );
  });

  test("authored courtyard exits preserve fractional arrivals in live, clone and sandbox", () => {
    const roomId = "19-dvor-i-oranzhevye-lavochki";
    for (const [suffix, x, y] of [
      ["n-path-1-1-s", 8, 2],
      ["s-path-1-2-s", 10, 9],
      ["w-path-0-2-e", 1, 6],
      ["e-path-1-2-e", 18, 6],
    ] as const) {
      const world = createWorld(sonArtifact());
      const live = bindWorldMutator(world, staticPlayerPose(null));
      live.setFigurePose("turyshev", { roomId, x, y });
      const doorId = `${roomId}--${suffix}`;
      const door = live.getDoor(doorId)!;
      expect(Number.isInteger(door.toX) && Number.isInteger(door.toY)).toBe(
        false,
      );
      const adapters = [
        live,
        cloneWorldMutator(live),
        sandboxFromSnapshot(snapshot(world)),
      ];
      for (const adapter of adapters) {
        const result = executeWorldAction(adapter, {
          actor: { kind: "figure", id: "turyshev" },
          source: "npc",
          action: { type: "traverseDoor", doorId },
        });
        expect(result.ok).toBe(true);
        expect(adapter.getFigurePose("turyshev")).toEqual({
          roomId: door.toRoomId,
          x: door.toX,
          y: door.toY,
        });
      }
    }
  });

  test("fractional grid lookup preserves wall and actual-point object collision", () => {
    const { world, mutator } = setup();
    const crate = world.objectById.get("b-crate")!;
    crate.body!.w = 0.25;
    const adapters = [
      mutator,
      cloneWorldMutator(mutator),
      sandboxFromSnapshot(snapshot(world)),
    ];
    for (const adapter of adapters) {
      expect(adapter.canWalk("b", 6.5, 6.5)).toBe(true);
      expect(adapter.canWalk("b", 0, 4)).toBe(false);
      expect(adapter.canWalk("b", 0.5, 4.5)).toBe(false);
      expect(adapter.canWalk("b", -0.1, 4)).toBe(false);
      expect(adapter.canWalk("b", 3, 4)).toBe(false);
      expect(adapter.canWalk("b", 3.1, 4.5)).toBe(false);
      // Flooring this collision point would falsely place it inside the narrow body.
      expect(adapter.canWalk("b", 3.5, 4.5)).toBe(true);
    }
  });
});
