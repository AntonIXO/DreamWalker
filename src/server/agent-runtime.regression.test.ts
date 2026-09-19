import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type {
  LanguageModelV3Content,
  LanguageModelV3Prompt,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";

import type {
  DialogueRequestPayload,
  WorldSnapshot,
  WorldSnapshotObject,
} from "../shared/ai";
import { AgentRuntime, npcDialogueTools } from "./agent-runtime";
import type { CodexAccountProcess } from "./codex-account";
import { dialogueWorldContext } from "./dialogue-messages";
import { createNpcWorldSession } from "../shared/world-sandbox";
import {
  captureWorldAction,
  createWorldMind,
  recordWorldAction,
} from "../shared/world-mind";

const RUN_A = "00000000-0000-4000-8000-000000000001";
const RUN_B = "00000000-0000-4000-8000-000000000002";
const ROOM = "19-dvor-i-oranzhevye-lavochki";
const usage: LanguageModelV3Usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const reply = {
  reply: "Держи кружку.",
  tell: null,
  yieldedShardId: null,
  residueDelta: [],
  memoryEffect: null,
  resonance: null,
  figureMemorySummary: "Попросил кружку.",
  journalEntry: null,
  portraitState: "neutral",
  leverageLearned: null,
  pressed: null,
  worldActions: [],
};

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage,
    warnings: [],
  };
}

function textStream(value: unknown) {
  return {
    stream: simulateReadableStream({
      initialDelayInMs: null,
      chunkDelayInMs: null,
      chunks: [
        { type: "text-start" as const, id: "reply" },
        {
          type: "text-delta" as const,
          id: "reply",
          delta: JSON.stringify(value),
        },
        { type: "text-end" as const, id: "reply" },
        {
          type: "finish" as const,
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage,
        },
      ],
    }),
  };
}

function runtime(model: MockLanguageModelV3): AgentRuntime {
  const agents = new AgentRuntime({} as CodexAccountProcess, {
    codexPath: "unused",
    codexHome: ".dreamwalker/codex-home",
    openai: {
      baseURL: "https://unused.invalid/v1",
      apiKey: "test",
      model: "test",
    },
  });
  // Inject only the model transport; exercise the real SDK loop and sandbox.
  Object.assign(agents, { model });
  return agents;
}

function cup(id = "cup"): WorldSnapshotObject {
  return {
    id,
    name: "Кружка",
    location: { kind: "room", roomId: ROOM, x: 2, y: 2 },
    mobility: "carryable",
    affordances: ["take", "give"],
    state: {},
    keyId: null,
    body: null,
    clueId: "private-clue-binding",
    holdsShardId: "private-shard-binding",
    tags: ["private-engine-tag"],
  };
}

function world(): WorldSnapshot {
  return {
    rooms: [
      {
        id: ROOM,
        name: "Двор",
        kind: "place",
        personality: null,
        visitCount: 1,
        tags: [],
      },
    ],
    geometry: {
      [ROOM]: { width: 5, height: 5, cells: Array(5).fill(".....") },
    },
    doors: [
      {
        id: "arch",
        fromRoomId: ROOM,
        toRoomId: "elsewhere",
        x: 4,
        y: 2,
        type: "open",
        threshold: "rift",
        keyId: null,
      },
    ],
    figures: [
      {
        id: "turyshev",
        name: "Турышев",
        roomId: ROOM,
        x: 2,
        y: 2,
        holdsShardId: null,
        role: "привратник",
        personality: "спокойный",
        activity: "сидит",
        fate: "present",
        fateCycle: null,
        fateRoomId: null,
        fateQuoted: null,
      },
    ],
    objects: [cup()],
    interests: [],
    player: { roomId: ROOM, x: 3, y: 2 },
    fateHistory: [],
    worldRevision: 0,
    mood: "upper-dynamic",
  };
}

function request(runId = RUN_A): DialogueRequestPayload {
  return {
    slug: "son",
    runId,
    cycleNumber: 1,
    figureId: "turyshev",
    utterance: "Дай кружку.",
    leverageOffered: null,
    offeredMemory: null,
    figureMemory: { summary: "", lines: [] },
    knownShardIds: [],
    sleeper: { summary: "", tells: [] },
    world: world(),
    exhaustion: 0,
  };
}

function lastToolOutput(
  prompt: LanguageModelV3Prompt,
): Record<string, unknown> {
  const message = prompt.at(-1);
  if (message?.role !== "tool") throw new Error("expected a tool receipt");
  const part = message.content.at(-1);
  if (part?.type !== "tool-result") throw new Error("expected a tool result");
  const output = part.output;
  if (output?.type !== "json") throw new Error("expected a JSON tool result");
  return output.value as Record<string, unknown>;
}

function toolCall(name: string, input: unknown) {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: `call-${name}`,
        toolName: name,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
    usage,
    warnings: [],
  };
}

describe("NPC dialogue context and execution", () => {
  test("the universe mind recalls private events from every room across cycle resets", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: textResult({
        patches: [],
        sleeperSummary: "Санитар ищет бутылку.",
      }),
    });
    const world = request().world;
    await runtime(model).endCycle(
      {
        slug: request().slug,
        cycleNumber: 2,
        runId: RUN_A,
        world,
        knownShardIds: [],
        sleeper: { summary: "", tells: [] },
        transcripts: {},
        observation: {
          elapsedSeconds: 200,
          currentRoomId: ROOM,
          visitedRoomIds: [ROOM],
          dwell: {},
          refusedDoors: {},
          approachedFigures: {},
          learnedShardIds: [],
          beatsThisCycle: 0,
          fatesThisCycle: {},
        },
        memories: [
          {
            id: "earlier-secret",
            sequence: 1,
            cycle: 1,
            kind: "dialogue",
            text: "GLOBAL_PRIOR_CYCLE: разговор художника в другой комнате",
            roomIds: ["hotel"],
            entityIds: ["artist"],
            observerIds: ["sleeper", "artist"],
          },
          {
            id: "elsewhere",
            sequence: 2,
            cycle: 2,
            kind: "action",
            text: "GLOBAL_OFFSCREEN: другая фигура перенесла чашку",
            roomIds: ["kitchen"],
            entityIds: ["another"],
            observerIds: ["sleeper", "another"],
          },
        ],
      },
      new AbortController().signal,
    );
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain("GLOBAL_PRIOR_CYCLE");
    expect(prompt).toContain("GLOBAL_OFFSCREEN");
    expect(prompt).toContain("разум всего сна");
    expect(prompt).toContain(
      "Не приписывай свои общие знания каждому персонажу",
    );
  });
  test("dynamic context recalls across rooms without exposing private, sleeper or previous-cycle memories", async () => {
    const model = new MockLanguageModelV3({ doGenerate: textResult(reply) });
    const payload = request();
    payload.sleeper.summary = "SLEEPER_PRIVATE_SECRET";
    payload.memories = [
      {
        id: "shared",
        sequence: 1,
        cycle: payload.cycleNumber,
        kind: "dialogue",
        text: "OVERHEARD_IN_OLD_ROOM: санитар говорил о бутылке",
        roomIds: ["old-room"],
        entityIds: ["another-npc"],
        observerIds: [payload.figureId, "another-npc"],
        originId: "heard-origin",
        provenance: {
          kind: "heard",
          originWitnessId: "turyshev",
          speakerId: "turyshev",
          hops: 1,
          acquiredCycle: payload.cycleNumber,
          acquiredRoomId: ROOM,
        },
      },
      {
        id: "private",
        sequence: 2,
        cycle: payload.cycleNumber,
        kind: "dialogue",
        text: "PRIVATE_NPC_SECRET",
        roomIds: [ROOM],
        entityIds: [],
        observerIds: ["another-npc"],
      },
      {
        id: "sleeper",
        sequence: 3,
        cycle: payload.cycleNumber,
        kind: "action",
        text: "SLEEPER_ARCHIVE_SECRET",
        roomIds: [ROOM],
        entityIds: [],
        observerIds: ["sleeper"],
      },
      {
        id: "old-cycle",
        sequence: 4,
        cycle: payload.cycleNumber - 1,
        kind: "dialogue",
        text: "PREVIOUS_CYCLE_SECRET",
        roomIds: [ROOM],
        entityIds: [],
        observerIds: [payload.figureId],
      },
    ];
    payload.figureMemory.lines = Array.from({ length: 24 }, (_, i) => ({
      speaker: i % 2 ? ("figure" as const) : ("sanitar" as const),
      text: `TRANSCRIPT_${i}_END`,
    }));
    await runtime(model).dialogue(
      payload,
      new AbortController().signal,
      () => {},
    );
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain("OVERHEARD_IN_OLD_ROOM");
    expect(prompt).toContain("heard_report");
    expect(prompt).toContain("рассказал об этом");
    expect(prompt).toContain(payload.world.rooms[0]!.name);
    expect(prompt).toContain("действительное местоположение");
    expect(prompt).not.toContain("SLEEPER_PRIVATE_SECRET");
    expect(prompt).not.toContain("SLEEPER_ARCHIVE_SECRET");
    expect(prompt).not.toContain("PRIVATE_NPC_SECRET");
    expect(prompt).not.toContain("PREVIOUS_CYCLE_SECRET");
    expect(prompt).not.toContain("TRANSCRIPT_0_END");
    expect(prompt).toContain("TRANSCRIPT_23_END");
  });
  test("trimming a third spoken quote clears tell and resonance without another generation", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: textResult({
        ...reply,
        reply: "Бутылки не хватает. Ты её взял — я видел. Ты не отсюда.",
        tell: { quoted: "Ты не отсюда" },
        resonance: { declaration: "Ты не отсюда." },
      }),
    });
    const payload = request();
    payload.utterance = "Ты не отсюда";
    payload.leverageOffered = "turyshev:vsio-normalno";
    const partials: string[] = [];
    const result = await runtime(model).dialogue(
      payload,
      new AbortController().signal,
      (partial) => partials.push(partial),
    );
    expect(result.reply).toBe("Бутылки не хватает. Ты её взял — я видел.");
    expect(partials).toEqual([result.reply]);
    expect(result.tell).toBeNull();
    expect(result.resonance).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  test("streamed partials also stop at two spoken sentences", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        ...textResult(reply),
        content: [{ type: "text", text: "Сейчас отвечу." }],
      },
      doStream: async () =>
        textStream({
          ...reply,
          reply:
            "Бутылки не хватает. Ты её взял — я видел. Вчера ещё урна пропала. Садись пока.",
        }),
    });
    const partials: string[] = [];
    const result = await runtime(model).dialogue(
      request(),
      new AbortController().signal,
      (partial) => partials.push(partial),
    );
    expect(result.reply).toBe("Бутылки не хватает. Ты её взял — я видел.");
    expect(partials).toEqual([result.reply]);
  });

  test("a complete first-phase dialogue needs only one generation and still clamps model claims", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: textResult({
        ...reply,
        yieldedShardId: "invented-shard",
        intent: null,
      }),
    });
    const partials: string[] = [];
    const result = await runtime(model).dialogue(
      request(),
      new AbortController().signal,
      (partial) => partials.push(partial),
    );
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(partials).toEqual([reply.reply]);
    expect(result.reply).toBe(reply.reply);
    expect(result.intent).toBeNull();
    expect(result.yieldedShardId).toBeNull();
    expect(result.worldActions).toEqual([]);
  });

  test("a token-limited first phase still finalizes even if its JSON happens to parse", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        ...textResult({ ...reply, reply: "Незавершённый первый вариант." }),
        finishReason: { unified: "length", raw: "length" },
      },
      doStream: async () => textStream(reply),
    });
    const result = await runtime(model).dialogue(
      request(),
      new AbortController().signal,
      () => {},
    );
    expect(model.doStreamCalls).toHaveLength(1);
    expect(result.reply).toBe(reply.reply);
  });

  test("NPC opens a container, sees its contents, then takes and gives the object", async () => {
    let step = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        const text = JSON.stringify(prompt);
        // The real model has no way to guess these IDs or poses from a name alone.
        expect(/\bcup\b/.test(text)).toBe(step > 0);
        expect(text).toContain('\\"id\\": \\"arch\\"');
        expect(text).toContain('\\"x\\": 2');
        step++;
        const content: LanguageModelV3Content[] =
          step < 4
            ? [
                {
                  type: "tool-call",
                  toolCallId: `call-${step}`,
                  toolName: step === 1 ? "open" : step === 2 ? "take" : "give",
                  input: JSON.stringify(
                    step === 1
                      ? { targetId: "box" }
                      : step === 2
                        ? { objectId: "cup" }
                        : { objectId: "cup", to: "player" },
                  ),
                },
              ]
            : [{ type: "text", text: "Держи кружку." }];
        return {
          content,
          finishReason: {
            unified: step < 4 ? "tool-calls" : "stop",
            raw: undefined,
          },
          usage,
          warnings: [],
        };
      },
      doStream: async ({ prompt }) => {
        expect(prompt.at(-1)?.role).toBe("user");
        const context = JSON.stringify(prompt);
        expect(context.includes("object.given")).toBe(true);
        expect(context).toContain("той же реплики");
        return textStream(reply);
      },
    });
    const payload = request();
    payload.world.objects[0]!.location = { kind: "inside", objectId: "box" };
    payload.world.objects.push({
      ...cup("box"),
      name: "Коробка",
      affordances: ["open", "close", "put"],
      state: { open: false },
      tags: ["container"],
    });
    payload.leverageOffered = "turyshev:vsio-normalno";
    const result = await runtime(model).dialogue(
      payload,
      new AbortController().signal,
      () => {},
    );
    expect(result.worldActions.map((envelope) => envelope.action.type)).toEqual(
      ["open", "take", "give"],
    );
    expect(
      result.worldActions.every(
        (envelope) =>
          envelope.actor.kind === "figure" && envelope.actor.id === "turyshev",
      ),
    ).toBe(true);
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "turyshev:vsio-normalno",
    );
    expect(payload.world.objects[0]?.location.kind).toBe("inside");
  });

  test("local world context omits remote objects, closed contents, and semantic bindings", () => {
    const snap = world();
    const box = { ...cup("box"), state: { open: false } };
    snap.objects.push(
      box,
      { ...cup("hidden"), location: { kind: "inside", objectId: "box" } },
      {
        ...cup("remote"),
        location: { kind: "room", roomId: "elsewhere", x: 1, y: 1 },
      },
    );
    const context = dialogueWorldContext(snap, "turyshev");
    expect(context.objects.map((object) => object.id)).toEqual(["cup", "box"]);
    expect(JSON.stringify(context)).not.toContain("private-");
    box.state.open = true;
    expect(
      dialogueWorldContext(snap, "turyshev").objects.map((object) => object.id),
    ).toContain("hidden");
  });

  test("system hook follows the live shard after a sleeper relocation", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: textResult(reply),
      doStream: async () => textStream(reply),
    });
    const agents = runtime(model);
    const payload = request();
    payload.figureId = "kirill";
    payload.world.figures[0]!.id = "kirill";
    const authoredShardId = agents.artifact.figures.find(
      (figure) => figure.id === "kirill",
    )!.holdsShardId;
    const movedShard = agents.artifact.shards.find(
      (shard) => shard.id !== authoredShardId,
    )!;
    payload.world.figures[0]!.holdsShardId = movedShard.id;
    await agents.dialogue(payload, new AbortController().signal, () => {});
    const system = model.doGenerateCalls[0]!.prompt.find(
      (message) => message.role === "system",
    );
    expect(system?.content).toContain(
      `--- ЗАЦЕПКА ---\nЗАЦЕПКА\n${movedShard.hint}`,
    );
  });

  test("another run inhabiting does not replace this run's room mood", async () => {
    let inhabitCount = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async ({ tools }) =>
        tools?.length
          ? textResult(reply)
          : textResult({
              figures: [],
              interests: [],
              roomMoods: {
                [ROOM]: ++inhabitCount === 1 ? "RUN_A_MOOD" : "RUN_B_MOOD",
              },
            }),
      doStream: async () => textStream(reply),
    });
    // A room without authored mood lets the two runs compose different moods.
    const agents = runtime(model);
    const artifact = structuredClone(agents.artifact);
    const room = artifact.rooms.find((entry) => entry.id === ROOM)!;
    room.atmosphere = "";
    room.personality = "";
    Object.assign(agents, { artifact });
    const signal = new AbortController().signal;
    await agents.inhabit({ slug: "son", runId: RUN_A }, signal);
    await agents.inhabit({ slug: "son", runId: RUN_B }, signal);
    await agents.dialogue(request(RUN_A), signal, () => {});
    const first = JSON.stringify(model.doGenerateCalls[2]?.prompt);
    expect(first.includes("RUN_A_MOOD")).toBe(true);
    expect(first).not.toContain("RUN_B_MOOD");
    await agents.dialogue(request(RUN_B), signal, () => {});
    expect(JSON.stringify(model.doGenerateCalls[3]?.prompt)).toContain(
      "RUN_B_MOOD",
    );
  });
});

describe("World Mind deliberation", () => {
  test("preview cannot distinguish a hidden child from an absent target or probe beyond a threshold", async () => {
    const snap = world();
    snap.objects[0]!.location = { kind: "inside", objectId: "box" };
    snap.objects.push({
      ...cup("box"),
      name: "Коробка",
      affordances: ["open", "close", "put"],
      state: { open: false },
      tags: ["container"],
    });
    const session = createNpcWorldSession(snap, "turyshev");
    const tools = npcDialogueTools(session, (live) =>
      dialogueWorldContext(snap, "turyshev", live),
    );
    const options = { toolCallId: "test-preview", messages: [] };
    const hidden = await tools.preview_actions.execute!(
      {
        goal: "Открыть коробку и взять вещь.",
        actions: [
          { type: "open", targetId: "box" },
          { type: "take", objectId: "cup" },
        ],
      },
      options,
    );
    const absent = await tools.preview_actions.execute!(
      {
        goal: "Открыть коробку и взять вещь.",
        actions: [
          { type: "open", targetId: "box" },
          { type: "take", objectId: "does-not-exist" },
        ],
      },
      options,
    );
    expect(hidden).toEqual(absent);
    expect(hidden).toMatchObject({
      ok: false,
      committed: false,
      steps: [],
      projectedRevision: 0,
    });
    const beyond = await tools.preview_actions.execute!(
      {
        goal: "Пройти и продолжить идти.",
        actions: [
          { type: "traverseDoor", doorId: "arch" },
          { type: "moveTo", x: 2, y: 2 },
        ],
      },
      options,
    );
    expect(beyond).toMatchObject({ ok: false, steps: [] });
    expect(session.remainingActions).toBe(8);
    expect(session.attempts).toEqual([]);
    expect(session.world.objectById.get("box")?.state.open).toBe(false);
  });

  test("current perception hides people and things beyond a wall or sight radius", () => {
    const snap = world();
    snap.geometry = {
      [ROOM]: { width: 12, height: 5, cells: Array(5).fill("....#.......") },
    };
    snap.player = { roomId: ROOM, x: 6, y: 2 };
    snap.objects.push(
      {
        ...cup("behind-wall"),
        location: { kind: "room", roomId: ROOM, x: 6, y: 2 },
      },
      {
        ...cup("too-far"),
        location: { kind: "room", roomId: ROOM, x: 11, y: 2 },
      },
    );
    snap.figures.push({ ...snap.figures[0]!, id: "unseen-figure", x: 6 });
    snap.doors.push({ ...snap.doors[0]!, id: "unseen-door", x: 8 });
    const context = dialogueWorldContext(snap, "turyshev");
    expect(context.player).toBeNull();
    expect(context.figures.map((figure) => figure.id)).toEqual(["turyshev"]);
    expect(context.objects.map((object) => object.id)).toEqual(["cup"]);
    expect(context.doors.map((door) => door.id)).toEqual(["arch"]);
  });

  test("observe and preview never act or reveal closed contents; real receipts drive the next step", async () => {
    let step = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        step++;
        switch (step) {
          case 1:
            return toolCall("observe_world", {});
          case 2: {
            const output = lastToolOutput(prompt);
            expect(output.remainingActions).toBe(8);
            expect(JSON.stringify(output).includes("cup")).toBe(false);
            return toolCall("preview_actions", {
              goal: "Посмотреть, что осталось в коробке.",
              actions: [{ type: "open", targetId: "box" }],
            });
          }
          case 3: {
            const output = lastToolOutput(prompt);
            expect(output.committed).toBe(false);
            expect(output.ok).toBe(true);
            expect(output.remainingActions).toBe(8);
            expect(JSON.stringify(output).includes("cup")).toBe(false);
            expect(output.world).toBeUndefined();
            return toolCall("observe_world", {});
          }
          case 4: {
            const output = lastToolOutput(prompt);
            expect(output.worldRevision).toBe(0);
            expect(JSON.stringify(output).includes("cup")).toBe(false);
            return toolCall("open", { targetId: "box" });
          }
          case 5: {
            const output = lastToolOutput(prompt);
            expect(output.ok).toBe(true);
            expect(output.remainingActions).toBe(7);
            expect(JSON.stringify(output).includes("cup")).toBe(true);
            return toolCall("preview_actions", {
              goal: "Отдать кружку и вернуться к разговору.",
              actions: [
                { type: "take", objectId: "cup" },
                { type: "give", objectId: "cup", to: { kind: "player" } },
              ],
            });
          }
          case 6: {
            const output = lastToolOutput(prompt);
            expect(output.ok).toBe(true);
            expect(output.remainingActions).toBe(7);
            return toolCall("take", { objectId: "cup" });
          }
          case 7:
            expect(lastToolOutput(prompt).ok).toBe(true);
            return toolCall("give", { objectId: "cup", to: "player" });
          case 8:
            expect(lastToolOutput(prompt).ok).toBe(true);
            return toolCall("observe_world", {});
          default: {
            const output = lastToolOutput(prompt);
            expect(output.remainingActions).toBe(5);
            const scene = output.observation as ReturnType<
              typeof dialogueWorldContext
            >;
            expect(
              scene.objects.find((object) => object.id === "cup")?.location,
            ).toEqual({ kind: "held", actor: { kind: "player" } });
            return textResult({ ...reply, intent: null });
          }
        }
      },
      doStream: async () => textStream({ ...reply, intent: null }),
    });
    const payload = request();
    payload.world.objects[0]!.location = { kind: "inside", objectId: "box" };
    payload.world.objects.push({
      ...cup("box"),
      name: "Коробка",
      affordances: ["open", "close", "put"],
      state: { open: false },
      tags: ["container"],
    });
    const result = await runtime(model).dialogue(
      payload,
      new AbortController().signal,
      () => {},
    );
    expect(result.worldActions.map((entry) => entry.action.type)).toEqual([
      "open",
      "take",
      "give",
    ]);
    expect(result.intent).toBeNull();
    expect(payload.world.objects[0]?.location.kind).toBe("inside");
    expect(payload.world.objects[1]?.state.open).toBe(false);
  });

  test("a refusal reaches final generation and is never replayed as a successful action", async () => {
    let step = 0;
    const honest = {
      ...reply,
      reply: "Кружка пока не у меня. Сейчас посмотрю.",
      intent: "Достать кружку.",
      worldActions: [
        {
          actor: { kind: "figure", id: "turyshev" },
          source: "npc",
          action: { type: "give", objectId: "cup", to: { kind: "player" } },
        },
      ],
    };
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        if (step++ === 0)
          return toolCall("give", { objectId: "cup", to: "player" });
        const output = lastToolOutput(prompt);
        expect(output.ok).toBe(false);
        expect(typeof output.refusal).toBe("string");
        expect(output.remainingActions).toBe(7);
        return {
          ...textResult(honest),
          content: [{ type: "text", text: honest.reply }],
        };
      },
      doStream: async ({ prompt }) => {
        const last = JSON.stringify(prompt.at(-1));
        expect(last.includes('\\"ok\\": false')).toBe(true);
        expect(last.includes("отказы не исполнились")).toBe(true);
        return textStream(honest);
      },
    });
    const result = await runtime(model).dialogue(
      request(),
      new AbortController().signal,
      () => {},
    );
    expect(result.worldActions).toEqual([]);
    expect(result.intent).toBe("Достать кружку.");
    expect(result.reply).toBe(honest.reply);
  });

  test("ordinary dialogue receives the unfinished intent and actual replay failure without forcing tools", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        const situation = JSON.stringify(prompt);
        expect(situation.includes("Вернуть кружку хозяину")).toBe(true);
        expect(situation.includes("REPLAY_FAILED_AFTER_DIALOGUE")).toBe(true);
        expect(situation.includes("не свершившийся факт")).toBe(true);
        return textResult({ ...reply, intent: "Вернуть кружку хозяину" });
      },
      doStream: async () =>
        textStream({ ...reply, intent: "Вернуть кружку хозяину" }),
    });
    const payload = request();
    payload.figureMemory.intent = "Вернуть кружку хозяину";
    payload.figureMemory.execution = [
      {
        action: { type: "give", objectId: "cup", to: { kind: "player" } },
        ok: false,
        refusal: "REPLAY_FAILED_AFTER_DIALOGUE",
        events: [],
        worldRevision: 8,
      },
    ];
    const result = await runtime(model).dialogue(
      payload,
      new AbortController().signal,
      () => {},
    );
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(result.worldActions).toEqual([]);
    expect(result.intent).toBe(payload.figureMemory.intent);
  });

  test("server scopes world memory again and keeps the Eye's authored fate exception", () => {
    const snap = world();
    snap.figures.push({ ...snap.figures[0]!, id: "papa" });
    const session = createNpcWorldSession(snap, "papa");
    const envelope = {
      actor: { kind: "figure" as const, id: "papa" },
      source: "npc" as const,
      action: { type: "take" as const, objectId: "cup" },
    };
    const mind = createWorldMind();
    const before = captureWorldAction(session.world, envelope);
    const result = session.runTool("take", { objectId: "cup" });
    const witnessed = recordWorldAction(
      mind,
      session.world,
      envelope,
      result,
      before,
      1,
    )!;
    const unseen = {
      ...structuredClone(witnessed),
      sequence: 2,
      witnessIds: ["papa"],
      witnessRooms: { papa: [ROOM] },
      events: [],
      before: {
        actor: null,
        objects: [
          {
            id: "hidden-record",
            name: "UNWITNESSED_SECRET",
            location: { kind: "room" as const, roomId: "other", x: 0, y: 0 },
            state: {},
          },
        ],
        door: null,
      },
    };
    snap.worldMind = [witnessed, unseen];
    snap.figures.push({
      ...snap.figures[0]!,
      id: "absent",
      roomId: "other",
      fate: "dead",
      fateQuoted: "HIDDEN_FATE_QUOTE",
    });
    snap.fateHistory.push({
      figureId: "absent",
      figureName: "Отсутствующий",
      fate: "dead",
      cycle: 1,
      roomId: "other",
    });
    const ordinary = dialogueWorldContext(snap, "turyshev");
    expect(ordinary.worldMind).toHaveLength(1);
    expect(ordinary.worldMind[0]?.action).toBeNull();
    expect(JSON.stringify(ordinary).includes("UNWITNESSED_SECRET")).toBe(false);
    expect(JSON.stringify(ordinary).includes("HIDDEN_FATE_QUOTE")).toBe(false);
    const eye = dialogueWorldContext(snap, "glaz");
    expect(eye.fateHistory).toHaveLength(1);
    expect(JSON.stringify(eye).includes("HIDDEN_FATE_QUOTE")).toBe(true);
  });
});

describe("examine output boundaries", () => {
  test("examines the live interest after its sensory description changes", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: textResult({
        reply: "Свежая трещина пересекает ручку.",
        yieldedShardId: null,
        clueObservedId: null,
        leverageLearned: null,
      }),
    });
    const agents = runtime(model);
    const signal = new AbortController().signal;
    const population = await agents.inhabit(
      { slug: "son", runId: RUN_A, fallback: true },
      signal,
    );
    const seed = population.interests[0]!;
    const snap = world();
    const sensorySeed = "LIVE_CHANGED_DESCRIPTION";
    snap.interests = [{ ...seed, sensorySeed }];
    await agents.examine(
      {
        slug: "son",
        runId: RUN_A,
        cycleNumber: 1,
        roomId: seed.roomId,
        interestId: seed.id,
        hotspotId: null,
        x: 2,
        y: 2,
        knownShardIds: [],
        world: snap,
      },
      signal,
    );
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      sensorySeed,
    );
  });

  test.each(["invented-person", "ubiitsa"])(
    "does not invent leverage on %s",
    async (figureId) => {
      const model = new MockLanguageModelV3({
        doGenerate: textResult({
          reply: "На кружке царапина.",
          yieldedShardId: null,
          clueObservedId: null,
          leverageLearned: { aboutFigureId: figureId, leverageId: "invented" },
        }),
      });
      const agents = runtime(model);
      const snap = world();
      snap.interests.push({
        id: "cup-interest",
        roomId: ROOM,
        name: "Кружка",
        sensorySeed: "На кружке царапина.",
        holdsShardId: null,
        clueId: null,
      });
      const result = await agents.examine(
        {
          slug: "son",
          runId: RUN_A,
          cycleNumber: 1,
          roomId: ROOM,
          interestId: "cup-interest",
          hotspotId: null,
          x: 2,
          y: 2,
          knownShardIds: [],
          world: snap,
        },
        new AbortController().signal,
      );
      expect(result.leverageLearned).toBeNull();
    },
  );
});
