import { describe, expect, spyOn, test } from "bun:test";

import fixture from "../../shared/__fixtures__/tiny-dream.json";
import { validateDreamArtifact } from "../../shared/dream";
import { createWorld } from "../game/world";
import { MindMemory } from "./memory";
import { ObservationLog } from "./observation";
import { RemoteMind, snapshot } from "./remote";
import { ScriptedMind } from "./scripted";
import { ContextMemory } from "./context-memory";

function setup() {
  const world = createWorld(validateDreamArtifact(structuredClone(fixture)));
  const memory = new MindMemory(`remote-test-${crypto.randomUUID()}`);
  const fallback = new ScriptedMind(world, memory);
  const mind = new RemoteMind(
    world,
    memory,
    { cycleNumber: () => 1, journal: () => [] },
    fallback,
  );
  return { world, memory, fallback, mind };
}

describe("remote snapshot identity and fate masking", () => {
  test("spoken memories follow their witnesses across rooms and outlive the recent transcript", async () => {
    const { world, memory, fallback } = setup();
    const speaker = world.figures[0]!;
    speaker.x = 5;
    speaker.y = 4;
    world.figures.push({ ...speaker, id: "nearby", name: "Сосед", x: 6 });
    world.figures.push({
      ...speaker,
      id: "elsewhere",
      name: "Другой",
      roomId: "b",
    });
    const mind = new RemoteMind(
      world,
      memory,
      {
        cycleNumber: () => 1,
        journal: () => [],
        playerPose: () => ({ roomId: "a", x: 4, y: 4 }),
      },
      fallback,
    );
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
      url: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      void url;
      void init;
      return new Response(
        JSON.stringify({
          type: "result",
          value: {
            reply: "Я тебя услышал.",
            figureMemorySummary: "Помнит беседу.",
            residueDelta: [],
            tell: null,
            yieldedShardId: null,
          },
        }) + "\n",
      );
    }) as typeof fetch);
    try {
      await mind.turn({
        figureId: speaker.id,
        utterance: "Первый разговор о потерянной бутылке.",
      });
      for (let i = 0; i < 41; i++)
        await mind.turn({
          figureId: speaker.id,
          utterance: `Другая реплика ${i}`,
        });
      expect(
        mind
          .conversation(speaker.id)
          .some((line) => line.text.includes("потерянной бутылке")),
      ).toBe(false);
      speaker.roomId = "b";
      expect(
        memory.episodes
          .forObserver(speaker.id, 1)
          .some((entry) => entry.text.includes("потерянной бутылке")),
      ).toBe(true);
      expect(
        memory.episodes
          .forObserver("nearby", 1)
          .some((entry) => entry.text.includes("потерянной бутылке")),
      ).toBe(true);
      expect(memory.episodes.forObserver("elsewhere", 1)).toEqual([]);
      mind.forgetFigures();
      expect(memory.episodes.forObserver(speaker.id, 2)).toEqual([]);
      expect(
        memory.episodes
          .forObserver("sleeper", 2)
          .some((entry) => entry.text.includes("потерянной бутылке")),
      ).toBe(true);
    } finally {
      mind.abort();
      fetchSpy.mockRestore();
    }
  });
  test("Kirill remains a physical actor without exposing his past death", () => {
    const { world } = setup();
    world.figures[0]!.id = "kirill";
    world.fateHistory.push({
      figureId: "kirill",
      fate: "dead",
      cycle: 1,
      roomId: "a",
      by: "kill",
      remains: null,
      quoted: null,
    });

    for (const viewer of ["kirill", "figure2", "__thing__"]) {
      const view = snapshot(world, "upper-dynamic", viewer);
      expect(view.figures.find((figure) => figure.id === "kirill")?.fate).toBe(
        "present",
      );
      expect(view.fateHistory).toEqual([]);
    }
    expect(snapshot(world, "upper-dynamic", "glaz").fateHistory).toHaveLength(
      1,
    );
  });
});

describe("returning figure memory lifetimes", () => {
  function returningFigure() {
    const state = setup();
    state.world.figures[0]!.id = "kirill";
    const returnToLife = () => {
      state.world.fateHistory.push({
        figureId: "kirill",
        fate: "dead",
        cycle: 1,
        roomId: "a",
        by: "kill",
        quoted: null,
        remains: null,
      });
      state.memory.refreshFigureLives(state.world.fateHistory);
    };
    const reload = () => {
      const restoredMemory = new MindMemory(`reload-${crypto.randomUUID()}`);
      restoredMemory.restore(state.memory.snapshot());
      const restored = new RemoteMind(
        state.world,
        restoredMemory,
        { cycleNumber: () => 1, journal: () => [] },
        new ScriptedMind(state.world, restoredMemory),
      );
      restored.restoreFigures(state.mind.snapshotFigures());
      return restored;
    };
    return { ...state, returnToLife, reload };
  }

  test("opening a returned figure's conversation hides the old transcript before another turn", () => {
    const { mind, returnToLife } = returningFigure();
    mind.noteReaction("kirill", "OLD_LIFE_LINE");
    expect(mind.conversation("kirill")).toHaveLength(1);
    returnToLife();
    expect(mind.conversation("kirill")).toEqual([]);
  });

  test("a new-life reaction survives a full memory and transcript reload", () => {
    const { mind, returnToLife, reload } = returningFigure();
    mind.noteReaction("kirill", "OLD_LIFE_LINE");
    returnToLife();
    mind.noteReaction("kirill", "NEW_LIFE_LINE");
    expect(mind.conversation("kirill")).toEqual([
      { speaker: "figure", text: "NEW_LIFE_LINE" },
    ]);
    expect(reload().conversation("kirill")).toEqual([
      { speaker: "figure", text: "NEW_LIFE_LINE" },
    ]);
  });

  test("refreshing the conversation preserves observations already collected in the new life", () => {
    const { world, memory, mind, returnToLife } = returningFigure();
    mind.noteReaction("kirill", "OLD_LIFE_LINE");
    returnToLife();
    new ContextMemory(memory).observe(world, { roomId: "a", x: 3, y: 3 }, 1);
    const fresh = memory.episodes.forObserver("kirill", 1);
    expect(fresh.some((entry) => entry.kind === "observation")).toBe(true);
    expect(mind.conversation("kirill")).toEqual([]);
    expect(memory.episodes.forObserver("kirill", 1)).toEqual(fresh);
  });

  test("execution feedback that creates a new-life memory survives reload", () => {
    const { mind, returnToLife, reload } = returningFigure();
    returnToLife();
    const feedback = [
      {
        action: { type: "take" as const, objectId: "cup" },
        ok: false,
        refusal: "out of reach",
        events: [],
        worldRevision: 1,
      },
    ];
    mind.noteExecution("kirill", feedback);
    expect(reload().snapshotFigures().get("kirill")?.execution).toEqual(
      feedback,
    );
  });
});

describe("remote request cancellation", () => {
  test("cycle reset aborts an in-flight turn and leaves no transcript or spent memory", async () => {
    const { world, mind, memory } = setup();
    memory.setInitialMemories(["snow"]);
    const offered = memory.availableMemories()[0]!;
    let signal: AbortSignal | undefined;
    let finish!: (response: Response) => void;
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(((
      _url: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }) as typeof fetch);
    try {
      const pending = mind.turn({
        figureId: world.figures[0]!.id,
        utterance: "hello",
        offeredMemoryId: offered.id,
      });
      const rejected = pending.catch((error: unknown) => error);
      mind.forgetFigures();
      finish(
        new Response(
          JSON.stringify({
            type: "result",
            value: {
              reply: "old reply",
              figureMemorySummary: "old",
              residueDelta: [],
              tell: null,
              yieldedShardId: null,
            },
          }) + "\n",
        ),
      );
      expect(await rejected).toMatchObject({ name: "AbortError" });
      expect(signal?.aborted).toBe(true);
      expect(mind.conversation(world.figures[0]!.id)).toEqual([]);
      expect(memory.episodes.snapshot().episodes).toEqual([]);
      expect(memory.memory(offered.id)).not.toBeNull();
      expect(mind.failureCount).toBe(0);
    } finally {
      mind.abort();
      fetchSpy.mockRestore();
    }
  });

  test("a request deadline uses the cycle fallback while explicit cancellation does not", async () => {
    const { world, mind, fallback } = setup();
    let expire!: () => void;
    const nativeTimeout = globalThis.setTimeout;
    const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(((
      handler: () => void,
      delay?: number,
    ) => {
      if (delay === 25_000) {
        expire = handler;
        return nativeTimeout(() => undefined, 60_000);
      }
      return nativeTimeout(handler, delay);
    }) as typeof setTimeout);
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      ((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        })) as unknown as typeof fetch,
    );
    const fallbackSpy = spyOn(fallback, "mutate");
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pending = mind.mutate(new ObservationLog().snapshot(world));
      expire();
      await expect(pending).resolves.toHaveProperty("patches");
      expect(fallbackSpy).toHaveBeenCalledTimes(1);
      expect(mind.failureCount).toBe(1);
      const cancelled = mind.mutate(new ObservationLog().snapshot(world));
      const rejected = cancelled.catch((error: unknown) => error);
      mind.abort();
      expect(await rejected).toMatchObject({ name: "AbortError" });
      expect(fallbackSpy).toHaveBeenCalledTimes(1);
    } finally {
      mind.abort();
      timerSpy.mockRestore();
      fetchSpy.mockRestore();
      fallbackSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

test("NPC intent and actual execution survive reload, reach the next turn, and reset with the cycle", async () => {
  const { world, mind } = setup();
  const payloads: Array<{
    figureMemory: import("../../shared/ai").FigureMemory;
  }> = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    _url: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    payloads.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        type: "result",
        value: {
          reply: "Сейчас передам.",
          intent: null,
          figureMemorySummary: "Попросил чашку.",
          residueDelta: [],
          tell: null,
          yieldedShardId: null,
        },
      }) + "\n",
    );
  }) as typeof fetch);
  try {
    const figureId = world.figures[0]!.id;
    await mind.turn({ figureId, utterance: "Передай чашку." });
    const feedback: import("../../shared/ai").NpcExecutionFeedback[] = [
      {
        action: { type: "give", objectId: "cup", to: { kind: "player" } },
        ok: false,
        refusal: "out of reach",
        events: [],
        worldRevision: 4,
      },
    ];
    mind.noteExecution(figureId, feedback);
    feedback[0]!.refusal = "changed outside memory";
    const reloaded = setup().mind;
    reloaded.restoreFigures(mind.snapshotFigures());
    await reloaded.turn({ figureId, utterance: "Что с чашкой?" });
    expect(payloads[1]!.figureMemory.intent).toBe("Передай чашку.");
    expect(payloads[1]!.figureMemory.execution?.[0]).toMatchObject({
      ok: false,
      refusal: "out of reach",
      worldRevision: 4,
    });
    reloaded.forgetFigures();
    expect(reloaded.snapshotFigures().size).toBe(0);
  } finally {
    mind.abort();
    fetchSpy.mockRestore();
  }
});

test("a cancelled free-form command cannot commit history or a late action plan", async () => {
  const { mind, world } = setup();
  let finish!: (response: Response) => void;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    (() =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })) as unknown as typeof fetch,
  );
  try {
    const before = structuredClone(world.objects);
    const pending = mind
      .act("Подними это", null)
      .catch((error: unknown) => error);
    mind.abort();
    finish(
      new Response(
        JSON.stringify({
          type: "result",
          value: { reply: "Взято", worldActions: [], receipts: [] },
        }) + "\n",
      ),
    );
    expect(await pending).toMatchObject({ name: "AbortError" });
    expect(mind.snapshotActions()).toEqual([]);
    expect(world.objects).toEqual(before);
    mind.rememberAction("Подними это", "Слишком далеко.");
    const history = mind.snapshotActions();
    const reloaded = setup().mind;
    reloaded.restoreActions(history);
    history[0]!.text = "changed outside";
    expect(reloaded.snapshotActions()[0]?.text).toBe("Подними это");
    reloaded.forgetFigures();
    expect(reloaded.snapshotActions()).toEqual([]);
  } finally {
    mind.abort();
    fetchSpy.mockRestore();
  }
});
