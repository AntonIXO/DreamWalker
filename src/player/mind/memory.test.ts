import { beforeEach, describe, expect, test } from "bun:test";

import { MindMemory } from "./memory";

const stored = new Map<string, string>();
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

describe("MindMemory", () => {
  beforeEach(() => stored.clear());

  test("persists knowledge while spent memories never return", () => {
    const memory = new MindMemory("test-dream");
    memory.setInitialMemories(["первый снег", "имя сестры", "стыд"]);
    const spent = memory.availableMemories()[0]!;
    expect(memory.spendMemory(spent.id)).toBe(true);
    memory.learnShard("shard1");
    memory.addTell(2, "figure1", "снова");
    memory.replaceSleeperSummary("Чужой помнит цикл.");

    const restored = new MindMemory("test-dream");
    expect(restored.availableMemories()).toHaveLength(2);
    expect(restored.memory(spent.id)).toBeNull();
    expect(restored.knownShardIds).toEqual(["shard1"]);
    expect(restored.sleeper).toEqual({
      summary: "Чужой помнит цикл.",
      tells: [{ cycle: 2, figureId: "figure1", quoted: "снова" }],
    });
  });

  test("episodic experience survives reload and cycle changes but not a new run", () => {
    const memory = new MindMemory("episode-save");
    memory.episodes.add({
      id: "bottle",
      cycle: 1,
      kind: "action",
      text: "Санитар забрал бутылку во дворе.",
      roomIds: ["courtyard"],
      entityIds: ["bottle"],
      observerIds: ["figure1", "player", "sleeper"],
    });
    memory.replaceSleeperSummary("Помнит бутылку.");
    const snapshot = memory.snapshot();
    const reloaded = new MindMemory("episode-save");
    expect(reloaded.episodes.forObserver("figure1", 1)).toHaveLength(1);
    expect(reloaded.episodes.forObserver("figure1", 2)).toEqual([]);
    expect(reloaded.episodes.forObserver("sleeper", 2)).toHaveLength(1);
    reloaded.restore(JSON.parse(JSON.stringify(snapshot)));
    expect(reloaded.runId).toBe(memory.runId);
    reloaded.newRun();
    expect(reloaded.runId).not.toBe(memory.runId);
    expect(reloaded.episodes.snapshot().episodes).toEqual([]);
    expect(reloaded.sleeper.summary).toBe("");
  });

  test("an older checkpoint without episodic state does not resurrect newer memories", () => {
    const memory = new MindMemory("old-checkpoint");
    const saved = memory.snapshot();
    delete saved.episodes;
    memory.episodes.add({
      id: "future",
      cycle: 1,
      kind: "dialogue",
      text: "future",
      roomIds: [],
      entityIds: [],
      observerIds: ["player"],
    });
    memory.restore(saved);
    expect(memory.episodes.snapshot().episodes).toEqual([]);
  });
});
