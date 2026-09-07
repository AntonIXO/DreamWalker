/**
 * The finale, which had no test at all.
 *
 * `judge` is the one agent that never calls a model: it is a hash, a bip39 check and a
 * wallet. Every ending the player can reach hangs off it, so the branches are worth
 * pinning down — including the one where the phrase is right and there is nothing there.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { rollWallet, type WalletKind } from "../shared/wallet";
import {
  AgentRuntime,
  dialogueSchema,
  NPC_WORLD_TOOL_NAMES,
  npcDialogueTools,
} from "./agent-runtime";
import type { CodexAccountProcess } from "./codex-account";
import { createNpcWorldSession } from "../shared/world-sandbox";
import type { WorldSnapshot } from "../shared/ai";
import { snapshot } from "../player/mind/remote";
import { createWorld } from "../player/game/world";
import { validateDreamArtifact, type DreamArtifact } from "../shared/dream";
import fixture from "../shared/__fixtures__/tiny-dream.json";
import { ScriptedMind } from "../player/mind/scripted";
import { MindMemory } from "../player/mind/memory";
import { sonArtifact } from "../../dreams/son/pack";

const SECRET_PATH = join(process.cwd(), "dreams", "son", "secret.local.txt");
const HAS_SECRET = existsSync(SECRET_PATH);
const WALLET_OVERRIDE = existsSync(
  join(process.cwd(), "dreams", "son", "wallet.local.json"),
);

/** `judge` never touches the model, so the account only has to exist. */
const account = {
  status: () => ({ state: "disconnected" }),
  refresh: async () => {},
} as unknown as CodexAccountProcess;

function runtime(): AgentRuntime {
  return new AgentRuntime(account, {
    codexPath: "codex",
    codexHome: ".dreamwalker/codex-home",
  });
}

/** The sealed phrase, read the same way the server reads it. Never logged. */
function sealedWords(): string[] {
  return readFileSync(SECRET_PATH, "utf8")
    .split("\n\n")[0]!
    .trim()
    .split(/\s+/);
}

/** A run id that rolls to the wallet a branch needs. */
function runIdFor(kind: WalletKind): string {
  for (let i = 0; i < 5_000; i++) {
    const runId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    if (rollWallet("son", runId).wallet === kind) return runId;
  }
  throw new Error(`no run id rolled ${kind}`);
}

const ANY_RUN = runIdFor("full");
const signal = (): AbortSignal => new AbortController().signal;

describe("judge", () => {
  test("a run id that is not a run id is refused", async () => {
    await expect(
      runtime().judge(
        { slug: "son", runId: "../../etc/passwd", words: [] },
        signal(),
      ),
    ).rejects.toThrow();
  });

  test("eleven words are a miss, however right they are", async () => {
    if (!HAS_SECRET) return;
    const result = await runtime().judge(
      { slug: "son", runId: ANY_RUN, words: sealedWords().slice(0, 11) },
      signal(),
    );
    expect(result.verdict).toBe("miss");
  });

  test("twelve words outside the bip39 list are a miss", async () => {
    const result = await runtime().judge(
      { slug: "son", runId: ANY_RUN, words: Array(12).fill("qwerty") },
      signal(),
    );
    expect(result.verdict).toBe("miss");
  });

  test("a valid bip39 phrase that is not the secret is a miss", async () => {
    const words = [
      "legal",
      "winner",
      "thank",
      "year",
      "wave",
      "sausage",
      "worth",
      "useful",
      "legal",
      "winner",
      "thank",
      "yellow",
    ];
    const result = await runtime().judge(
      { slug: "son", runId: ANY_RUN, words },
      signal(),
    );
    expect(result.verdict).toBe("miss");
  });

  test("a miss never says where the error is, and never names a wallet", async () => {
    const result = await runtime().judge(
      { slug: "son", runId: ANY_RUN, words: Array(12).fill("qwerty") },
      signal(),
    );
    expect(result.wallet).toBeUndefined();
    expect(result.amount).toBeUndefined();
    expect(result.locked).toBeUndefined();
  });

  test("case and stray spacing do not change the phrase", async () => {
    if (!HAS_SECRET || WALLET_OVERRIDE) return;
    const shouted = sealedWords().map((word) => `  ${word.toUpperCase()} `);
    const result = await runtime().judge(
      { slug: "son", runId: runIdFor("full"), words: shouted },
      signal(),
    );
    expect(result.verdict).toBe("match");
  });

  test("the right phrase on a full run pays out", async () => {
    if (!HAS_SECRET || WALLET_OVERRIDE) return;
    const result = await runtime().judge(
      { slug: "son", runId: runIdFor("full"), words: sealedWords() },
      signal(),
    );
    expect(result.verdict).toBe("match");
    expect(result.wallet).toBe("full");
    expect(result.amount).not.toBe("0.00000000");
  });

  test("the right phrase on a dry run pays nothing — `endings.md` «Пусто»", async () => {
    if (!HAS_SECRET || WALLET_OVERRIDE) return;
    const result = await runtime().judge(
      { slug: "son", runId: runIdFor("dry"), words: sealedWords() },
      signal(),
    );
    expect(result.verdict).toBe("match");
    expect(result.wallet).toBe("dry");
    expect(result.amount).toBe("0.00000000");
  });

  test("the right phrase on a locked run opens nothing yet — layer 2", async () => {
    if (!HAS_SECRET || WALLET_OVERRIDE) return;
    const result = await runtime().judge(
      { slug: "son", runId: runIdFor("locked"), words: sealedWords() },
      signal(),
    );
    expect(result.verdict).toBe("match");
    expect(result.locked).toBe(true);
    expect(result.wallet).toBeUndefined();
  });

  test("the wallet is the same every time the same run asks", async () => {
    if (!HAS_SECRET || WALLET_OVERRIDE) return;
    const agents = runtime();
    const runId = runIdFor("dry");
    const first = await agents.judge(
      { slug: "son", runId, words: sealedWords() },
      signal(),
    );
    const second = await agents.judge(
      { slug: "son", runId, words: sealedWords() },
      signal(),
    );
    expect(second).toEqual(first);
  });

  test("the verdict speaks the player's language", async () => {
    const ru = await runtime().judge(
      { slug: "son", runId: ANY_RUN, words: Array(12).fill("qwerty") },
      signal(),
    );
    const en = await runtime().judge(
      {
        slug: "son",
        runId: ANY_RUN,
        words: Array(12).fill("qwerty"),
        locale: "en",
      },
      signal(),
    );
    expect(en.reply).not.toBe(ru.reply);
    expect(/[а-яё]/i.test(en.reply)).toBe(false);
  });

  test("another dream's slug is refused", async () => {
    await expect(
      runtime().judge(
        { slug: "vonesimo", runId: ANY_RUN, words: Array(12).fill("qwerty") },
        signal(),
      ),
    ).rejects.toThrow();
  });
});

const MINIMAL_DIALOGUE = {
  reply: "Садись.",
  tell: null,
  yieldedShardId: null,
  residueDelta: [],
  memoryEffect: null,
  resonance: null,
  figureMemorySummary: "",
  journalEntry: null,
  portraitState: "neutral" as const,
  leverageLearned: null,
  pressed: null,
};

function emptySnap(): WorldSnapshot {
  return {
    rooms: [],
    doors: [],
    figures: [],
    interests: [],
    fateHistory: [],
    objects: [],
    player: { roomId: "a", x: 0, y: 0 },
    worldRevision: 0,
    mood: "upper-dynamic",
  };
}

describe("dialogue worldActions schema", () => {
  test("worldActions defaults to an empty array", () => {
    const parsed = dialogueSchema.parse(MINIMAL_DIALOGUE);
    expect(parsed.worldActions).toEqual([]);
  });
});

describe("npc dialogue tools", () => {
  test("shiftWalls is not a tool", () => {
    const tools = npcDialogueTools(
      createNpcWorldSession(emptySnap(), "npc-1", () => ({
        ok: true,
        refusal: null,
        affectedRooms: [],
        affectedObjects: [],
        events: [],
      })),
    );
    expect(Object.keys(tools).sort()).toEqual([...NPC_WORLD_TOOL_NAMES].sort());
    expect("shiftWalls" in tools).toBe(false);
    expect(NPC_WORLD_TOOL_NAMES).not.toContain("shiftWalls");
  });
});

describe("world snapshot", () => {
  test("includes object locations and figure x,y when provided", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    const figure = world.figures[0];
    const snapped = snapshot(world, "upper-dynamic", null, {
      playerPose: { roomId: world.currentRoomId, x: 4, y: 7 },
      objects: [
        {
          id: "cup",
          name: "cup",
          location: { kind: "room", roomId: world.currentRoomId, x: 2, y: 3 },
          mobility: "carryable",
          affordances: ["take"],
          state: {},
          keyId: null,
          body: null,
          clueId: null,
          holdsShardId: null,
          tags: [],
        },
      ],
      worldRevision: 9,
    });
    expect(snapped.player).toEqual({
      roomId: world.currentRoomId,
      x: 4,
      y: 7,
    });
    expect(snapped.objects[0]?.location).toEqual({
      kind: "room",
      roomId: world.currentRoomId,
      x: 2,
      y: 3,
    });
    expect(snapped.worldRevision).toBe(9);
    if (figure) {
      const listed = snapped.figures.find((entry) => entry.id === figure.id);
      expect(listed?.x).toBe(figure.x);
      expect(listed?.y).toBe(figure.y);
    }
    expect(snapped.doors[0]?.threshold).toBeDefined();
    expect(typeof snapped.doors[0]?.x).toBe("number");
  });

  test("falls back to currentRoomId at (0, 0) when no player pose is passed", () => {
    const artifact = validateDreamArtifact(
      JSON.parse(JSON.stringify(fixture)),
    ) as DreamArtifact;
    const world = createWorld(artifact);
    const snapped = snapshot(world);
    expect(snapped.player).toEqual({
      roomId: world.currentRoomId,
      x: 0,
      y: 0,
    });
    expect(snapped.objects.length).toBeGreaterThan(0);
  });
});

describe("scripted dialogue", () => {
  test("does not invent worldActions", async () => {
    const world = createWorld(
      validateDreamArtifact(sonArtifact()) as DreamArtifact,
    );
    const mind = new ScriptedMind(world, new MindMemory(world.artifact.slug));
    const result = await mind.turn({
      figureId: "turyshev",
      utterance: "Куда мне идти?",
    });
    expect(result.worldActions).toEqual([]);
  });
});
