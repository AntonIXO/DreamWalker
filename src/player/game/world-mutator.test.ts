import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact, type DreamArtifact } from "../../shared/dream";
import { executeWorldAction } from "../../shared/world-action-engine";
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
});
