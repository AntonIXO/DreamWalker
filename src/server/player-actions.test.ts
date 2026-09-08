import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3Usage } from "@ai-sdk/provider";
import type {
  ActionRequestPayload,
  ExamineRequestPayload,
  WorldSnapshot,
  WorldSnapshotObject,
} from "../shared/ai";
import { createPlayerWorldSession } from "../shared/world-sandbox";
import { AgentRuntime } from "./agent-runtime";
import type { CodexAccountProcess } from "./codex-account";
import { playerActionSchema } from "./player-actions";

const ROOM = "19-dvor-i-oranzhevye-lavochki";
const usage: LanguageModelV3Usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function generated(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage,
    warnings: [],
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
  Object.assign(agents, { model });
  return agents;
}

function object(id: string, x = 2): WorldSnapshotObject {
  return {
    id,
    name: id === "cup" ? "Кружка" : "Коробка",
    location: { kind: "room", roomId: ROOM, x, y: 2 },
    mobility: "carryable",
    affordances: [
      "examine",
      "take",
      "give",
      "drop",
      "put",
      "open",
      "close",
      "use",
    ],
    state: {},
    keyId: null,
    body: null,
    clueId: "PRIVATE_CLUE_BINDING",
    holdsShardId: "PRIVATE_SHARD_BINDING",
    tags: ["PRIVATE_TAG"],
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
      [ROOM]: { width: 14, height: 5, cells: Array(5).fill("..............") },
    },
    doors: [],
    figures: [
      {
        id: "turyshev",
        name: "Турышев",
        roomId: ROOM,
        x: 3,
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
    objects: [
      object("cup"),
      { ...object("box", 3), state: { open: false }, tags: ["container"] },
    ],
    interests: [],
    player: { roomId: ROOM, x: 2, y: 2 },
    fateHistory: [],
    worldRevision: 0,
    mood: "upper-dynamic",
  };
}

function request(
  utterance = "Подними её, напиши сбоку «мой сон», а потом спрячь в коробку.",
): ActionRequestPayload {
  return {
    slug: "son",
    cycleNumber: 1,
    utterance,
    selectedObjectId: "cup",
    world: world(),
    history: [{ speaker: "player", text: "Я говорю про кружку." }],
  };
}

describe("natural language player actions", () => {
  test("a compound command uses selection/history and returns player-bound verified alterations and witnesses", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        const text = JSON.stringify(prompt);
        expect(text.includes("Я говорю про кружку")).toBe(true);
        expect(text.includes("Selected object")).toBe(true);
        expect(text.includes("PRIVATE_")).toBe(false);
        return generated({
          actions: [
            {
              type: "take",
              objectId: "cup",
              actor: { kind: "sleeper" },
              source: "sleeper",
            },
            {
              type: "alter",
              objectId: "cup",
              verb: "написать",
              changes: { inscription: "мой сон" },
            },
            { type: "open", targetId: "box" },
            { type: "put", objectId: "cup", intoObjectId: "box" },
          ],
          successReply: "На кружке теперь «мой сон»; она лежит в коробке.",
          reactions: [
            { figureId: "turyshev", reply: "Коробку потом закрой." },
            { figureId: "invented", reply: "Я всё видел." },
          ],
        });
      },
    });
    const payload = request();
    const result = await runtime(model).act(
      payload,
      new AbortController().signal,
    );
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(result.worldActions.map((entry) => entry.action.type)).toEqual([
      "take",
      "alter",
      "open",
      "put",
    ]);
    expect(
      result.worldActions.every(
        (entry) => entry.actor.kind === "player" && entry.source === "player",
      ),
    ).toBe(true);
    expect(result.receipts.every((entry) => entry.ok)).toBe(true);
    expect(result.reactions?.map((entry) => entry.figureId)).toEqual([
      "turyshev",
    ]);
    expect(payload.world.objects[0]?.location.kind).toBe("room");
    const replay = createPlayerWorldSession(payload.world);
    for (const entry of result.worldActions)
      expect(replay.runAction(entry.action).ok).toBe(true);
    expect(replay.world.objectById.get("cup")?.state.inscription).toBe(
      "мой сон",
    );
    expect(replay.world.objectById.get("cup")?.location).toEqual({
      kind: "inside",
      objectId: "box",
    });
  });

  test("a failed dependent step preserves only the successful prefix and suppresses predicted success/reactions", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: generated({
        actions: [
          { type: "take", objectId: "cup" },
          {
            type: "give",
            objectId: "cup",
            to: { kind: "figure", id: "turyshev" },
          },
          {
            type: "alter",
            objectId: "cup",
            verb: "разбить",
            changes: { broken: true },
          },
        ],
        successReply: "Всё получилось, кружка передана и разбита.",
        reactions: [{ figureId: "turyshev", reply: "Получил." }],
      }),
    });
    const payload = request("Возьми кружку и отдай Турышеву.");
    payload.world.figures[0]!.x = 6;
    const result = await runtime(model).act(
      payload,
      new AbortController().signal,
    );
    expect(result.worldActions.map((entry) => entry.action.type)).toEqual([
      "take",
    ]);
    expect(result.receipts).toHaveLength(2);
    expect(result.receipts[1]?.ok).toBe(false);
    expect(result.reply).toContain("не дотянуться");
    expect(result.reply).not.toContain("разбита");
    expect(result.reactions).toEqual([]);
  });

  test("a fixed object cannot be broken merely because the planner says it succeeds", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: generated({
        actions: [
          {
            type: "alter",
            objectId: "cup",
            verb: "разбить",
            changes: { broken: true },
          },
        ],
        successReply: "Вещь разбита.",
      }),
    });
    const payload = request("Разбей это.");
    payload.world.objects[0]!.mobility = "fixed";
    const result = await runtime(model).act(
      payload,
      new AbortController().signal,
    );
    expect(result.worldActions).toEqual([]);
    expect(result.receipts[0]?.ok).toBe(false);
    expect(result.reply).not.toContain("разбита");
  });

  test("movement, traversal, admin changes and lock alterations are outside the planner contract", () => {
    for (const action of [
      { type: "moveTo", x: 8, y: 2 },
      { type: "traverseDoor", doorId: "rift" },
      { type: "shiftWalls", roomId: ROOM, variantId: "new" },
      {
        type: "alter",
        objectId: "box",
        verb: "отпереть",
        changes: { locked: false },
      },
    ]) {
      expect(playerActionSchema.safeParse(action).success).toBe(false);
    }
  });

  test("an unsupported gesture never inherits the model's invented physical outcome", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: generated({
        actions: [
          { type: "gesture", objectId: "cup", verb: "превратить в дракона" },
        ],
        successReply: "Кружка превращается в дракона.",
      }),
    });
    const result = await runtime(model).act(
      request("Преврати её в дракона."),
      new AbortController().signal,
    );
    expect(result.receipts[0]?.events[0]?.type).toBe("object.gestured");
    expect(result.reply).toContain("остаётся прежней");
    expect(result.reply).not.toContain("превращается");
  });

  test("a successful take cannot launder an unsupported gesture into a physical transformation", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: generated({
        actions: [
          { type: "take", objectId: "cup" },
          { type: "gesture", objectId: "cup", verb: "превратить в дракона" },
        ],
        successReply: "Ты взял кружку, и она превратилась в дракона.",
        reactions: [{ figureId: "turyshev", reply: "Вот так дракон." }],
      }),
    });
    const result = await runtime(model).act(
      request(),
      new AbortController().signal,
    );
    expect(result.worldActions).toHaveLength(2);
    expect(result.reply).toContain("осталось попыткой");
    expect(result.reply).not.toContain("превратилась");
    expect(result.reactions).toEqual([]);
  });

  test("a nearby person who cannot see the actual altered object gets no fabricated reaction", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: generated({
        actions: [
          {
            type: "alter",
            objectId: "cup",
            verb: "написать",
            changes: { inscription: "мой сон" },
          },
        ],
        successReply: "На кружке появилась надпись.",
        reactions: [{ figureId: "turyshev", reply: "Вижу твою надпись." }],
      }),
    });
    const payload = request("Напиши на кружке «мой сон».");
    payload.world.player.x = 8;
    payload.world.figures[0]!.x = 0;
    payload.world.objects = [
      {
        ...object("cup", 10),
        interaction: { reach: 3, prompt: "Кружка", refusal: null },
      },
    ];
    const result = await runtime(model).act(
      payload,
      new AbortController().signal,
    );
    expect(result.receipts[0]?.ok).toBe(true);
    expect(result.reactions).toEqual([]);
  });

  test("an ambiguous command asks a practical question without inventing an action", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: generated({
        actions: [],
        successReply: "Сделано.",
        refusalReply: "Какую вещь положить в коробку?",
      }),
    });
    const result = await runtime(model).act(
      request("Положи туда то."),
      new AbortController().signal,
    );
    expect(result.reply).toBe("Какую вещь положить в коробку?");
    expect(result.worldActions).toEqual([]);
    expect(result.reactions).toEqual([]);
  });
});

function examineRequest(
  snap: WorldSnapshot,
  objectId: string,
): ExamineRequestPayload {
  return {
    slug: "son",
    runId: "00000000-0000-4000-8000-000000000001",
    cycleNumber: 1,
    roomId: snap.player.roomId,
    interestId: null,
    hotspotId: null,
    objectId,
    x: snap.player.x,
    y: snap.player.y,
    knownShardIds: [],
    world: snap,
  };
}

describe("examine live inventory objects", () => {
  test("a clue carried to another room retains its actual clue and shard bindings", async () => {
    let shardId = "";
    const model = new MockLanguageModelV3({
      doGenerate: async () =>
        generated({
          reply: "Рисунок всё ещё различим.",
          yieldedShardId: shardId,
          clueObservedId: "invented",
          leverageLearned: null,
        }),
    });
    const agents = runtime(model);
    const source = agents.artifact.rooms
      .filter((room) => room.id !== ROOM)
      .flatMap((room) => room.hotspots)
      .find((hotspot) => hotspot.clueId && !hotspot.refusal)!;
    const clueId = source.clueId!;
    shardId = agents.artifact.shards[0]!.id;
    const snap = world();
    const carried = {
      ...object(source.propId ?? source.id),
      name: source.prompt,
      clueId,
      holdsShardId: shardId,
      location: { kind: "held" as const, actor: { kind: "player" as const } },
    };
    snap.objects = [carried];
    const result = await agents.examine(
      examineRequest(snap, carried.id),
      new AbortController().signal,
    );
    expect(result.clueObservedId).toBe(clueId);
    expect(result.yieldedShardId).toBe(shardId);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  test("a carried legacy interest uses its original sensory source and current inscription", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        const text = JSON.stringify(prompt);
        expect(text.includes("LIVE_INTEREST_SOURCE")).toBe(true);
        expect(text.includes("МОЙ СОН")).toBe(true);
        expect(text.includes("Текущее состояние важнее")).toBe(true);
        return generated({
          reply: "На потёртой поверхности написано «МОЙ СОН».",
          yieldedShardId: null,
          clueObservedId: null,
          leverageLearned: null,
        });
      },
    });
    const snap = world();
    snap.objects = [
      {
        ...object("mobile-interest"),
        clueId: null,
        holdsShardId: null,
        state: { inscription: "МОЙ СОН", dirty: true },
        location: { kind: "held", actor: { kind: "player" } },
      },
    ];
    snap.interests = [
      {
        id: "mobile-interest",
        name: "Кружка",
        roomId: "previous-room",
        sensorySeed: "LIVE_INTEREST_SOURCE",
        holdsShardId: null,
        clueId: null,
      },
    ];
    const result = await runtime(model).examine(
      examineRequest(snap, "mobile-interest"),
      new AbortController().signal,
    );
    expect(result.reply).toContain("МОЙ СОН");
  });

  test("the original prop's authored refusal survives relocation and prevents clue disclosure", async () => {
    const model = new MockLanguageModelV3();
    const agents = runtime(model);
    const source = agents.artifact.rooms
      .flatMap((room) => room.hotspots.map((hotspot) => ({ room, hotspot })))
      .find(({ hotspot }) => hotspot.refusal)!;
    const objectId = `${source.room.id}:${source.hotspot.propId ?? source.hotspot.id}`;
    const snap = world();
    snap.objects = [
      {
        ...object(objectId),
        clueId: agents.artifact.content.clues[0]!.id,
        holdsShardId: agents.artifact.shards[0]!.id,
        location: { kind: "held", actor: { kind: "player" } },
      },
    ];
    const result = await agents.examine(
      examineRequest(snap, objectId),
      new AbortController().signal,
    );
    expect(result.reply).toBe(source.hotspot.refusal!);
    expect(result.clueObservedId).toBeNull();
    expect(result.yieldedShardId).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  test("an object inside a closed container cannot be examined by guessing its ID", async () => {
    const model = new MockLanguageModelV3();
    const snap = world();
    snap.objects[0]!.location = { kind: "inside", objectId: "box" };
    await expect(
      runtime(model).examine(
        examineRequest(snap, "cup"),
        new AbortController().signal,
      ),
    ).rejects.toThrow("не видно");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  test("a pure information command reads current inscription without a gesture or mutation", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        expect(JSON.stringify(prompt).includes("МОЙ СОН")).toBe(true);
        return generated({
          actions: [],
          successReply: "",
          refusalReply: "На кружке написано «МОЙ СОН».",
          reactions: [],
        });
      },
    });
    const payload = request("Что теперь на ней написано?");
    payload.world.objects[0]!.state = { inscription: "МОЙ СОН" };
    const result = await runtime(model).act(
      payload,
      new AbortController().signal,
    );
    expect(result.reply).toContain("МОЙ СОН");
    expect(result.worldActions).toEqual([]);
    expect(result.receipts).toEqual([]);
  });
});
