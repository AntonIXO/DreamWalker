import { describe, expect, test } from "bun:test";
import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import { createWorld, rebuildObjectIndex } from "../game/world";
import { ScriptedMind } from "./scripted";
import { MindMemory } from "./memory";
import type { ActorPose } from "../../shared/world-object";

function setup(pose?: () => ActorPose | null) {
  const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
  const memory = new MindMemory("offline-object-test");
  const mind = new ScriptedMind(world, memory, pose);
  const shelf = world.objectById.get("shelf")!;
  const examine = () =>
    mind.examine({
      objectId: shelf.id,
      roomId: world.currentRoomId,
      hotspotId: null,
      interestId: null,
      x: 9,
      y: 4,
    });
  return { world, memory, mind, shelf, examine };
}

describe("offline physical object examination", () => {
  test("a carried clue keeps its identity after leaving its authored room", async () => {
    const { world, shelf, examine } = setup();
    shelf.location = { kind: "held", actor: { kind: "player" } };
    world.currentRoomId = "b";
    const result = await examine();
    expect(result.clueObservedId).toBe("clue-1");
    expect(result.reply).toContain(
      world.artifact.content.clues.find((clue) => clue.id === "clue-1")!
        .sensorySeed,
    );
  });

  test("describes current inscription and physical changes instead of generic old-room prose", async () => {
    const { shelf, examine } = setup();
    shelf.location = { kind: "held", actor: { kind: "player" } };
    shelf.state = {
      inscription: "новая пометка",
      wet: true,
      dirty: true,
      broken: true,
    };
    const result = await examine();
    expect(result.reply).toContain("новая пометка");
    expect(result.reply).toContain("мокр");
    expect(result.reply).toContain("гряз");
    expect(result.reply).toContain("поврежд");
    expect(result.clueObservedId).toBe("clue-1");
  });

  test("closed held containers hide contents until opened", async () => {
    const { world, shelf, examine } = setup();
    const bag = structuredClone(shelf);
    bag.id = "bag";
    bag.clueId = null;
    bag.location = { kind: "held", actor: { kind: "player" } };
    bag.state = { open: false };
    world.objects.push(bag);
    shelf.location = { kind: "inside", objectId: bag.id };
    rebuildObjectIndex(world);
    expect((await examine()).clueObservedId).toBeNull();
    bag.state.open = true;
    expect((await examine()).clueObservedId).toBe("clue-1");
  });

  test("unknown player pose cannot turn target coordinates into permission to inspect a floor clue", async () => {
    const { examine } = setup();
    expect((await examine()).clueObservedId).toBeNull();
    const { examine: fromFarAway } = setup(() => ({ roomId: "a", x: 1, y: 1 }));
    expect((await fromFarAway()).clueObservedId).toBeNull();
    const { examine: fromNearby } = setup(() => ({ roomId: "a", x: 8, y: 4 }));
    expect((await fromNearby()).clueObservedId).toBe("clue-1");
  });

  test("refusal and another holder do not reveal a clue or current inscription", async () => {
    const { shelf, examine } = setup();
    shelf.location = { kind: "held", actor: { kind: "figure", id: "figure1" } };
    shelf.state.inscription = "скрытый текст";
    expect((await examine()).reply).not.toContain("скрытый текст");
    shelf.location = { kind: "held", actor: { kind: "player" } };
    shelf.interaction = {
      reach: 1.4,
      prompt: shelf.name,
      refusal: "Не трогать.",
    };
    const refused = await examine();
    expect(refused.reply).toBe("Не трогать.");
    expect(refused.clueObservedId).toBeNull();
  });

  test("only the object's current valid unlearned shard binding can be yielded", async () => {
    const { shelf, memory, examine } = setup();
    shelf.location = { kind: "held", actor: { kind: "player" } };
    shelf.holdsShardId = "shard1";
    expect((await examine()).yieldedShardId).toBe("shard1");
    memory.learnShard("shard1");
    expect((await examine()).yieldedShardId).toBeNull();
    shelf.holdsShardId = "invented-shard";
    expect((await examine()).yieldedShardId).toBeNull();
  });
});
