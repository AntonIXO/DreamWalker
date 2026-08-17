import { describe, expect, test } from "bun:test";

import { createWorld } from "../../../src/player/game/world";
import { sonArtifact } from "../pack";
import { lookAt } from "../looks";
import { npcFor, talkContext } from "./index";

function talk(figureId: string, utterance: string, cycle = 1) {
  const world = createWorld(sonArtifact());
  const ctx = talkContext(world, { figureId, utterance, cycle });
  expect(ctx).not.toBeNull();
  return { world, result: npcFor(figureId).talk(ctx!) };
}

describe("authored npcs", () => {
  test("the puppy never suspects and never takes payment", () => {
    const { result } = talk("shchenok", "Я пришёл за кошельком.");
    expect(result?.portraitState).toBe("neutral");
    expect(result?.reply.split(/\s+/).length).toBeLessThanOrEqual(6);
    expect(npcFor("shchenok").hideMemoryOffer).toBe(true);
  });

  test("the Eye yields the last word only for an admission", () => {
    const miss = talk("glaz", "Как дела?");
    expect(miss.result?.yieldedShardId).toBeNull();
    const hit = talk("glaz", "Я пришёл забрать сид-фразу.");
    expect(hit.result?.yieldedShardId).toBeTruthy();
    expect(hit.result?.portraitState).toBe("knows");
  });

  test("Кирилл pays for recognition and flinches at pity", () => {
    const pity = talk("kirill", "Тебе больно?");
    expect(pity.result?.tell).not.toBeNull();
    expect(pity.result?.yieldedShardId).toBeNull();
    const praise = talk("kirill", "Ты был прав, это ты придумал.");
    expect(praise.result?.yieldedShardId).toBeTruthy();
  });

  test("Турышев withholds the road from a rushed question", () => {
    const world = createWorld(sonArtifact());
    const rush = talkContext(world, {
      figureId: "turyshev",
      utterance: "Куда идти?",
      cycle: 1,
    })!;
    expect(npcFor("turyshev").talk(rush)?.journalEntry).toBeNull();
    for (const line of ["Ну ладно, сижу.", "Как дела, нормально?"]) {
      const ctx = talkContext(world, {
        figureId: "turyshev",
        utterance: line,
        cycle: 1,
      })!;
      npcFor("turyshev").talk(ctx);
    }
    const thirdIdle = talkContext(world, {
      figureId: "turyshev",
      utterance: "Погода ничего.",
      cycle: 1,
    })!;
    expect(npcFor("turyshev").talk(thirdIdle)?.journalEntry).toMatch(/дверь/);
  });

  test("the cabinet inscription is readable without a model", () => {
    expect(lookAt("nadpis")?.reply).toContain("маме");
  });
});
