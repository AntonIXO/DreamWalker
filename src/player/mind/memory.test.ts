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
});
