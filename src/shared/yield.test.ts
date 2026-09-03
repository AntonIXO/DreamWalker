import { describe, expect, test } from "bun:test";

import {
  clueIdForShard,
  figureHookPrompt,
  mayYieldShard,
  shardPrice,
  POOL_ROOM_ID,
} from "./yield";

describe("mayYieldShard", () => {
  const none = new Map<string, number>();

  test("the puppy opens on the same admission as the Eye", () => {
    expect(
      mayYieldShard({
        figureId: "shchenok",
        utterance: "Как тебя зовут?",
        visitCounts: none,
      }),
    ).toBe(false);
    expect(
      mayYieldShard({
        figureId: "shchenok",
        utterance: "Я пришёл забрать кошелёк.",
        visitCounts: none,
      }),
    ).toBe(true);
  });

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

describe("pressure satisfies a gate, it does not go round it", () => {
  const visits = new Map<string, number>();

  test("papa and the artist open under it", () => {
    for (const figureId of ["papa", "hudozhnik"]) {
      expect(
        mayYieldShard({ figureId, utterance: "…", visitCounts: visits }),
      ).toBe(false);
      expect(
        mayYieldShard({
          figureId,
          utterance: "…",
          visitCounts: visits,
          leveraged: true,
        }),
      ).toBe(true);
    }
  });

  test("the Eye and Кирилл never do — their souls say it is the wrong currency", () => {
    for (const figureId of ["glaz", "kirill"]) {
      expect(
        mayYieldShard({
          figureId,
          utterance: "…",
          visitCounts: visits,
          leveraged: true,
        }),
      ).toBe(false);
    }
  });
});

describe("figureHookPrompt", () => {
  test("pins the artist's price and hint so the model is not guessing the object", () => {
    const ru = figureHookPrompt("hudozhnik", "холст с чужим смехом");
    expect(ru).toContain("ЗАЦЕПКА");
    expect(ru).toContain("холст с чужим смехом");
    expect(ru).toContain(shardPrice("hudozhnik", "ru"));
    const en = figureHookPrompt(
      "hudozhnik",
      "a canvas of someone else's laugh",
      "en",
    );
    expect(en).toContain("HOOK");
    expect(en).toContain(shardPrice("hudozhnik", "en"));
    expect(figureHookPrompt("turyshev", "whatever")).toBeNull();
  });
});

describe("the gates speak both languages", () => {
  const none = new Map<string, number>();
  const opens = (figureId: string, utterance: string): boolean =>
    mayYieldShard({ figureId, utterance, visitCounts: none });

  test("the Eye hears an admission in English too", () => {
    expect(opens("glaz", "How is the weather?")).toBe(false);
    expect(opens("glaz", "I came here to take the seed phrase.")).toBe(true);
  });

  test("Кирилл is recognised in English too", () => {
    expect(opens("kirill", "Move aside.")).toBe(false);
    expect(opens("kirill", "You were right about the mods.")).toBe(true);
  });

  test("папа is asked for advice in English too", () => {
    expect(opens("papa", "Nice bench.")).toBe(false);
    expect(opens("papa", "What should I do about the leg?")).toBe(true);
  });

  test("the artist hears the hall named in English too", () => {
    expect(opens("hudozhnik", "Good evening.")).toBe(false);
    expect(opens("hudozhnik", "I could only hear the laughter.")).toBe(true);
  });

  test("the artist opens after the pool, whatever was said", () => {
    expect(
      mayYieldShard({
        figureId: "hudozhnik",
        utterance: "Ничего особенного.",
        visitCounts: new Map([[POOL_ROOM_ID, 1]]),
      }),
    ).toBe(true);
  });
});

describe("shardPrice", () => {
  test("names a price for each of the four figures that carry a word", () => {
    for (const id of ["glaz", "kirill", "papa", "hudozhnik"]) {
      expect(shardPrice(id)).toBeTruthy();
      expect(shardPrice(id, "en")).toBeTruthy();
    }
  });

  test("a figure with no price gets none", () => {
    expect(shardPrice("mama")).toBeNull();
  });
});
