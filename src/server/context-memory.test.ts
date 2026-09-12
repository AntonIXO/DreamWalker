import { describe, expect, test } from "bun:test";

import type { MemoryEpisode } from "../shared/episodic-memory";
import { recallContext } from "./context-memory";
import type { retrieveMemories } from "./semantic-memory";

const retrieveRecent: typeof retrieveMemories = async (
  candidates,
  _query,
  options,
) => ({
  mode: "lexical",
  memories: candidates.slice(-(options?.limit ?? 6)),
});

function episode(
  id: string,
  kind: MemoryEpisode["kind"],
  text: string,
  sequence: number,
  extra: Partial<MemoryEpisode> = {},
): MemoryEpisode {
  return {
    id,
    kind,
    text,
    sequence,
    cycle: 1,
    roomIds: ["courtyard"],
    entityIds: ["bottle", "player"],
    observerIds: ["sleeper", "artist"],
    originId: id,
    ...extra,
  };
}

function speech(id: string, text: string, sequence: number) {
  return episode(
    id,
    "dialogue",
    `В месте «Пустой съезд» Санитар сказал: «${text.slice(0, 950)}». Это услышанная реплика; действия подтверждаются только квитанциями мира.`,
    sequence,
  );
}

function recall(
  episodes: MemoryEpisode[],
  recentLines: { text: string }[] = [],
  observerId = "artist",
  cycle = 1,
) {
  return recallContext(
    episodes,
    observerId,
    cycle,
    "Кто тебе рассказал про бутылку?",
    new AbortController().signal,
    { turyshev: "Тимофей Турышев" },
    recentLines,
    retrieveRecent,
  );
}

describe("memory context diversity", () => {
  test("a heard action survives repeated room snapshots and an already supplied transcript", async () => {
    // The live failure was one attributed bottle report buried under identical
    // post-reload snapshots and the conversation repeating its own prior claims.
    const report = episode(
      "report",
      "action",
      "Санитар взял бутылку во дворе. После действия бутылка у Санитара.",
      1,
      {
        originId: "world:1:1",
        subjectActorId: "player",
        provenance: {
          kind: "heard",
          originWitnessId: "turyshev",
          speakerId: "turyshev",
          hops: 1,
          acquiredRoomId: "path",
          acquiredCycle: 1,
        },
      },
    );
    const snapshots = Array.from({ length: 12 }, (_, i) =>
      episode(
        `snapshot-${i}`,
        "observation",
        "Художник находится на Пустом съезде. Здесь виден Санитар. Бутылка у Санитара.",
        i + 2,
      ),
    );
    const recent = Array.from({ length: 16 }, (_, i) => ({
      text: `Ты не видел сам, но кто рассказал про бутылку? Уточнение ${i}.`,
    }));
    const result = await recall(
      [
        report,
        ...snapshots,
        ...recent.map((line, i) => speech(`speech-${i}`, line.text, i + 20)),
      ],
      recent,
    );
    expect(result).toHaveLength(2);
    const remembered = result.find((entry) => entry.kind === "heard_report");
    expect(remembered?.originId).toBe("world:1:1");
    expect(remembered?.subjectActorId).toBe("player");
    expect(remembered?.source).toContain("Тимофей Турышев рассказал");
    expect(remembered?.provenance?.kind).toBe("heard");
    expect(result.some((entry) => entry.kind === "dialogue")).toBe(false);
    expect(result.filter((entry) => entry.kind === "observation")).toHaveLength(
      1,
    );
    expect(result[1]?.originId).toBe("snapshot-11");
  });

  test("repeated physical actions remain distinct even if their text is identical", async () => {
    const text = "Санитар положил бутылку на лавку.";
    const result = await recall(
      [
        episode("first", "action", text, 1),
        episode("second", "action", text, 2),
      ],
      [{ text }],
    );
    expect(result.map((entry) => entry.originId)).toEqual(["first", "second"]);
  });

  test("collapsing world snapshots keeps the union of witnesses and separates cycles", async () => {
    const text = "Бутылка лежит на лавке.";
    const result = await recall(
      [
        episode("old", "observation", text, 1, {
          observerIds: ["sleeper", "artist"],
        }),
        episode("new", "observation", text, 2, {
          observerIds: ["sleeper", "turyshev"],
        }),
        episode("cycle-two", "observation", text, 3, { cycle: 2 }),
      ],
      [],
      "sleeper",
      2,
    );
    expect(result.map((entry) => entry.originId)).toEqual(["new", "cycle-two"]);
    expect(result[0]?.observers).toEqual(["sleeper", "artist", "turyshev"]);
    expect(result.map((entry) => entry.cycle)).toEqual([1, 2]);
  });

  test("only the last sixteen supplied lines are excluded, using whole utterances", async () => {
    const recent = Array.from({ length: 17 }, (_, i) => ({
      text: `Реплика ${i}.`,
    }));
    const result = await recall(
      [
        ...recent.map((line, i) => speech(`line-${i}`, line.text, i + 1)),
        speech("quotation", "Он сказал «Реплика 16.», но я не поверил.", 20),
      ],
      recent,
    );
    expect(result.map((entry) => entry.originId)).toEqual([
      "line-0",
      "quotation",
    ]);
  });

  test("eligibility is applied before diversity, and the immediate lead-in cannot reintroduce private history", async () => {
    const result = await recall([
      episode("known", "action", "Санитар взял бутылку.", 1),
      episode("old-cycle", "action", "Санитар прятал ключ.", 2, { cycle: 0 }),
      episode("private", "action", "Турышев спрятал ключ.", 3, {
        observerIds: ["sleeper", "turyshev"],
      }),
    ]);
    expect(result.map((entry) => entry.originId)).toEqual(["known"]);
    expect(result[0]?.observers).toBeUndefined();
  });

  test("keeps six recalled and two latest episodes within the existing text budgets", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      episode(
        `action-${i}`,
        "action",
        `${i}: ${"Бутылка. ".repeat(150)}`,
        i + 1,
      ),
    );
    const retrieveOldest: typeof retrieveMemories = async (available) => ({
      mode: "semantic",
      memories: available.slice(0, 6),
    });
    const result = await recallContext(
      candidates,
      "artist",
      1,
      "бутылка",
      new AbortController().signal,
      {},
      [],
      retrieveOldest,
    );
    expect(result).toHaveLength(8);
    expect(result.every((entry) => entry.text.length <= 800)).toBe(true);
    expect(result.reduce((sum, entry) => sum + entry.text.length, 0)).toBe(
      6_400,
    );
    expect(result.slice(-2).map((entry) => entry.originId)).toEqual([
      "action-8",
      "action-9",
    ]);
  });
});
