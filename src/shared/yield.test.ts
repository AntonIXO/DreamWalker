import { describe, expect, test } from "bun:test";

import { clueIdForShard, mayYieldShard, POOL_ROOM_ID } from "./yield";

describe("mayYieldShard", () => {
  const none = new Map<string, number>();

  test("the Eye only pays if the sanitar says why he came", () => {
    expect(
      mayYieldShard({
        figureId: "glaz",
        utterance: "Как дела?",
        visitCounts: none,
      }),
    ).toBe(false);
    expect(
      mayYieldShard({
        figureId: "glaz",
        utterance: "Я пришёл забрать сид-фразу.",
        visitCounts: none,
      }),
    ).toBe(true);
  });

  test("Kirill pays for recognition, not for pity", () => {
    expect(
      mayYieldShard({
        figureId: "kirill",
        utterance: "Тебе больно?",
        visitCounts: none,
      }),
    ).toBe(false);
    expect(
      mayYieldShard({
        figureId: "kirill",
        utterance: "Ты был прав, это ты придумал.",
        visitCounts: none,
      }),
    ).toBe(true);
  });

  test("the artist is mute until the hall is left or named", () => {
    expect(
      mayYieldShard({
        figureId: "hudozhnik",
        utterance: "Что ты сказал?",
        visitCounts: none,
      }),
    ).toBe(false);
    expect(
      mayYieldShard({
        figureId: "hudozhnik",
        utterance: "Что ты сказал?",
        visitCounts: new Map([[POOL_ROOM_ID, 1]]),
      }),
    ).toBe(true);
  });

  test("shard ids map onto clue ids", () => {
    expect(clueIdForShard("shard3")).toBe("clue-3");
  });
});
