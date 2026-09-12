import { describe, expect, test } from "bun:test";

import {
  SemanticMemoryRetriever,
  type MemoryEmbedder,
} from "./semantic-memory";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function candidate(id: string, text: string, sequence = 1) {
  return { id, text, sequence, roomId: "courtyard" };
}

const simpleEmbedder: MemoryEmbedder = async (texts) =>
  texts.map((text) => (text.includes("bottle") ? [1, 0] : [0, 1]));

describe("semantic memory retrieval", () => {
  test("retrieves an older paraphrase and preserves supplied episode metadata", async () => {
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => async (texts) =>
        texts.map((text) =>
          text === "Где моя бутылка?" || text.includes("забрал")
            ? [1, 0]
            : [0, 1],
        ),
    });
    await retriever.warmup();
    const remembered = candidate("old", "Санитар забрал стеклянный сосуд.", 1);
    const recent = candidate("recent", "Санитар вошёл в гостиницу.", 50);
    expect(
      await retriever.retrieve([recent, remembered], "Где моя бутылка?", {
        limit: 1,
      }),
    ).toEqual({ mode: "semantic", memories: [remembered] });
  });

  test("returns lexical matches immediately while a shared model load is pending", async () => {
    const load = deferred<MemoryEmbedder>();
    let loads = 0;
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: () => {
        loads++;
        return load.promise;
      },
    });
    const episode = candidate("b", "bottle taken", 1);
    const result = await retriever.retrieve(
      [candidate("new", "walked away", 2), episode],
      "bottle",
      { limit: 1 },
    );
    expect(result).toEqual({ mode: "lexical", memories: [episode] });
    await retriever.retrieve([episode], "bottle");
    expect(loads).toBe(1);
    expect(retriever.status).toBe("loading");
    load.resolve(simpleEmbedder);
    expect(await retriever.warmup()).toBe(true);
  });

  test("searches the whole run archive when 320 newer events have no shared query language", async () => {
    const indexed: string[] = [];
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => async (texts) => {
        indexed.push(...texts);
        return texts.map((text) =>
          text === "Who took my bottle?" || text.includes("бутылку")
            ? [1, 0]
            : [0, 1],
        );
      },
    });
    await retriever.warmup();
    const oldest = candidate("old", "Санитар забрал мою бутылку.", 0);
    const recent = Array.from({ length: 320 }, (_, i) =>
      candidate(String(i), `Художник вошёл в комнату ${i}.`, i + 1),
    );
    const result = await retriever.retrieve(
      [oldest, ...recent],
      "Who took my bottle?",
      { limit: 1 },
    );
    expect(result.mode).toBe("semantic");
    expect(result.memories).toEqual([oldest]);
    expect(indexed).toContain(oldest.text);
    expect(indexed).toHaveLength(322);
  });

  test("cached vectors cannot reveal episodes absent from the eligible candidates", async () => {
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => simpleEmbedder,
    });
    await retriever.warmup();
    const hidden = candidate("private", "bottle hidden upstairs");
    await retriever.retrieve([hidden], "bottle");
    const visible = candidate("visible", "went to the courtyard");
    const result = await retriever.retrieve([visible], "bottle");
    expect(result.mode).toBe("semantic");
    expect(result.memories).toEqual([visible]);
  });

  test("uses text identity across runs, so reused ids never reuse stale content", async () => {
    const seen: string[] = [];
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => async (texts) => {
        seen.push(...texts);
        return simpleEmbedder(texts);
      },
    });
    await retriever.warmup();
    await retriever.retrieve([candidate("same-id", "bottle taken")], "bottle");
    await retriever.retrieve(
      [candidate("same-id", "bottle returned")],
      "bottle",
    );
    expect(seen).toContain("bottle returned");
  });

  test("load errors fall back without rejecting or retrying on every request", async () => {
    let attempts = 0;
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => {
        attempts++;
        throw new Error("offline");
      },
    });
    expect(await retriever.warmup()).toBe(false);
    const result = await retriever.retrieve(
      [candidate("b", "bottle")],
      "bottle",
    );
    expect(result.mode).toBe("lexical");
    expect(retriever.status).toBe("unavailable");
    expect(attempts).toBe(1);
  });

  test("slow inference returns at the deadline and completes its bounded batch later", async () => {
    const inference = deferred<readonly number[][]>();
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => () => inference.promise,
    });
    await retriever.warmup();
    const episode = candidate("b", "bottle taken");
    const result = await retriever.retrieve([episode], "bottle", {
      timeoutMs: 5,
    });
    expect(result.mode).toBe("lexical");
    inference.resolve([
      [1, 0],
      [1, 0],
    ]);
    const ready = await retriever.retrieve([episode], "bottle");
    expect(ready.mode).toBe("semantic");
  });

  test("abort ends the retrieval wait while another caller can use the same inference", async () => {
    const inference = deferred<readonly number[][]>();
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => () => inference.promise,
    });
    await retriever.warmup();
    const controller = new AbortController();
    const episode = candidate("b", "bottle taken");
    const request = retriever.retrieve([episode], "bottle", {
      signal: controller.signal,
      timeoutMs: 2_000,
    });
    controller.abort();
    expect((await request).mode).toBe("lexical");
    inference.resolve([
      [1, 0],
      [1, 0],
    ]);
    expect((await retriever.retrieve([episode], "bottle")).mode).toBe(
      "semantic",
    );
  });

  test("a new unindexed episode does not turn off existing semantic recall", async () => {
    const pending = deferred<readonly number[][]>();
    let batches = 0;
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => async (texts) => {
        batches++;
        return batches === 1 ? texts.map(() => [1, 0]) : pending.promise;
      },
    });
    await retriever.warmup();
    const old = candidate("old", "Санитар забрал мою бутылку.");
    await retriever.retrieve([old], "Who took my bottle?");
    const result = await retriever.retrieve(
      [old, candidate("new", "Художник вошёл в гостиницу.", 2)],
      "Who took my bottle?",
      { limit: 1, timeoutMs: 5 },
    );
    expect(result).toEqual({ mode: "semantic", memories: [old] });
    pending.resolve([[0, 1]]);
  });

  test("bounds batch size and candidate work, then evicts vectors by LRU", async () => {
    const batches: string[][] = [];
    const retriever = new SemanticMemoryRetriever({
      maxCandidates: 2,
      maxCacheEntries: 3,
      batchSize: 2,
      loadEmbedder: async () => async (texts) => {
        batches.push(texts);
        return simpleEmbedder(texts);
      },
    });
    await retriever.warmup();
    const candidates = Array.from({ length: 100 }, (_, i) =>
      candidate(String(i), `episode ${i}`, i),
    );
    await retriever.retrieve(candidates, "bottle");
    expect(batches.flat()).toHaveLength(3);
    expect(batches.every((batch) => batch.length <= 2)).toBe(true);
    await retriever.retrieve(
      [candidate("other", "different episode")],
      "bottle",
    );
    const afterEviction = batches.flat().length;
    await retriever.retrieve(candidates, "bottle");
    expect(batches.flat().length).toBeGreaterThan(afterEviction);
  });

  test("serializes concurrent NPC requests and replaces pending work instead of growing a queue", async () => {
    const first = deferred<void>();
    const latest = deferred<void>();
    const batches: string[][] = [];
    let running = 0;
    let peak = 0;
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => async (texts) => {
        running++;
        peak = Math.max(peak, running);
        batches.push(texts);
        if (batches.length === 1) await first.promise;
        running--;
        if (texts.includes("question 19")) latest.resolve();
        return simpleEmbedder(texts);
      },
    });
    await retriever.warmup();
    await retriever.retrieve([candidate("first", "first episode")], "first", {
      timeoutMs: 0,
    });
    for (let i = 0; i < 20; i++) {
      await retriever.retrieve(
        [candidate(String(i), `episode ${i}`)],
        `question ${i}`,
        { timeoutMs: 0 },
      );
    }
    first.resolve();
    await latest.promise;
    expect(peak).toBe(1);
    expect(batches).toHaveLength(2);
    expect(batches.flat()).not.toContain("question 18");
  });

  test("rejects malformed embeddings and keeps gameplay available", async () => {
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => async (texts) => texts.map(() => [NaN, 1]),
    });
    await retriever.warmup();
    const result = await retriever.retrieve(
      [candidate("b", "bottle")],
      "query",
    );
    expect(result.mode).toBe("lexical");
    expect(retriever.status).toBe("unavailable");
  });

  test("rejects mixed vector dimensions instead of reporting semantic results", async () => {
    const retriever = new SemanticMemoryRetriever({
      loadEmbedder: async () => async () => [
        [1, 0],
        [1, 0, 0],
      ],
    });
    await retriever.warmup();
    const result = await retriever.retrieve(
      [candidate("b", "bottle")],
      "query",
    );
    expect(result.mode).toBe("lexical");
  });
});

test.skipIf(process.env.DREAMWALKER_TEST_EMBEDDINGS !== "1")(
  "real local multilingual embeddings find an old Russian memory beneath 320 newer episodes",
  async () => {
    const retriever = new SemanticMemoryRetriever();
    expect(await retriever.warmup()).toBe(true);
    const bottle = candidate(
      "bottle",
      "Санитар забрал мою бутылку из двора.",
      1,
    );
    const candidates = [
      ...Array.from({ length: 320 }, (_, i) =>
        candidate(
          `room-${i}`,
          `Художник прошёл через комнату ${i} в гостиницу.`,
          i + 4,
        ),
      ),
      candidate("door", "Художник открыл дверь в гостиницу.", 3),
      candidate("bench", "Турышев сидел на оранжевой лавке.", 2),
      bottle,
    ];
    // A bounded first inference may legitimately time out on a slow CPU; repeat
    // after the same shared job completes rather than loosen production limits.
    let result = await retriever.retrieve(candidates, "Who took my bottle?", {
      limit: 1,
      timeoutMs: 2_000,
    });
    for (let i = 0; result.memories[0]?.id !== bottle.id && i < 30; i++) {
      result = await retriever.retrieve(candidates, "Who took my bottle?", {
        limit: 1,
        timeoutMs: 2_000,
      });
    }
    expect(result.mode).toBe("semantic");
    expect(result.memories).toEqual([bottle]);
  },
  180_000,
);
