import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import { createWorld } from "../game/world";
import { snapshot } from "./remote";
import { localDirectorPlan } from "./director-local";
import { bindWorldMutator, staticPlayerPose } from "../game/world-mutator";
import { captureWorldAction, recordWorldAction } from "../../shared/world-mind";
import { executeWorldAction } from "../../shared/world-action-engine";
import type { WorldActionEnvelope } from "../../shared/world-action";
import type { WorldObjectState } from "../../shared/world-object";

function setup(roleId = "hudozhnik") {
  const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
  world.currentRoomId = "a";
  const figure = world.figures[0]!;
  figure.roomId = "a";
  figure.x = 8;
  figure.y = 5;
  const object: WorldObjectState = {
    ...structuredClone(world.objects[0]!),
    id: "outfit",
    name: "coat",
    location: { kind: "held", actor: { kind: "player" } },
    mobility: "carryable",
    affordances: ["wear", "removeWear"],
    body: null,
    profile: {
      kind: "garment",
      wear: { slot: "body", appearanceFigureId: roleId },
    },
    state: { wornBy: { kind: "player" } },
    clueId: null,
    holdsShardId: null,
    keyId: null,
  };
  world.objects.push(object);
  world.objectById.set(object.id, object);
  const player = { roomId: "a", x: 6, y: 5 };
  const context = () => ({
    runId: "local",
    cycleNumber: 1,
    world: snapshot(world, "upper-dynamic", null, { playerPose: player }),
    locale: "ru" as const,
  });
  const request = (
    intent: "gather" | "inspect" | "helpMove",
    objectId?: string,
  ) => {
    const mutator = bindWorldMutator(world, staticPlayerPose(player));
    const envelope: WorldActionEnvelope = {
      actor: { kind: "player" },
      source: "player",
      action: {
        type: "requestRole",
        intent,
        ...(objectId ? { objectId } : {}),
      },
    };
    const before = captureWorldAction(mutator, envelope);
    const result = executeWorldAction(mutator, envelope);
    expect(result.ok).toBe(true);
    recordWorldAction(world.worldMind, mutator, envelope, result, before, 1);
  };
  return { world, figure, player, context, request };
}

describe("local director composition", () => {
  test("training produces a real audience approach only for a witnessed accepted role request", () => {
    const test = setup();
    test.request("gather");
    const plan = localDirectorPlan(test.context(), ["requestRole: coat"]);
    const step = plan.situations[0]?.steps[0];
    expect(step?.effect.kind).toBe("npc");
    expect(step?.effect.kind === "npc" && step.effect.destination).toBeTruthy();
    expect(step?.guards).toContainEqual({
      kind: "acceptedRole",
      figureId: test.figure.id,
      roleId: "hudozhnik",
    });
    test.world.roleRecognition = {
      [test.figure.id]: [{ roleId: "hudozhnik", cycle: 1, eventSequence: 1 }],
    };
    const refusal = localDirectorPlan(test.context(), ["requestRole: coat"])
      .situations[0]?.steps[0]?.effect;
    expect(refusal?.kind === "npc" && refusal.actions).toEqual([]);
    expect(refusal?.kind === "npc" && refusal.destination).toBeUndefined();
  });

  test("an unheard request grants no automatic cooperation", () => {
    const test = setup();
    test.request("gather");
    test.world.worldMind.events[0]!.witnessIds = [];
    expect(
      localDirectorPlan(test.context(), ["requestRole"]).situations,
    ).toEqual([]);
  });

  test("idle work previews an actual container opening and does not toggle it closed again", () => {
    const test = setup();
    const container: WorldObjectState = {
      ...structuredClone(test.world.objects[0]!),
      id: "box",
      name: "box",
      location: { kind: "room", roomId: "a", x: 8, y: 4 },
      mobility: "fixed",
      affordances: ["open", "close"],
      body: null,
      profile: { kind: "furniture", container: "closed" },
      state: { open: false },
      tags: ["container"],
      keyId: null,
    };
    test.world.objects.push(container);
    test.world.objectById.set(container.id, container);
    const plan = localDirectorPlan(test.context(), ["idle"]);
    const effect = plan.situations[0]?.steps[0]?.effect;
    expect(effect?.kind === "npc" && effect.actions).toContainEqual({
      type: "open",
      targetId: "box",
    });
    // Planning itself is read-only.
    expect(container.state.open).toBe(false);
    container.state.open = true;
    expect(localDirectorPlan(test.context(), ["idle"]).situations).toEqual([]);
  });
});
