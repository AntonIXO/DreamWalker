/**
 * The dream, played by nobody.
 *
 * A deterministic stand-in for the sleeping mind. It is not a placeholder that returns
 * lorem ipsum — it implements the actual behaviour the real mind will have to have, so
 * the parts of the game that depend on that behaviour can be built and tuned now:
 *
 *   - `mutate` reads the observation and defends against what the player is doing. Lean
 *     on a door repeatedly and it gets sealed. Keep visiting one figure and they are
 *     gone next time you look. That is §5's heartbeat, and it is fully playable offline.
 *   - `turn` answers, and when the phrasing is too direct it quotes the offending words
 *     back. §3 asks that a tell always name the specific thing that caused it, and a
 *     keyword matcher can do that honestly even if it cannot do it cleverly.
 *
 * What it cannot do is be surprising, which is the entire reason for the model later.
 */

import { NodeType } from "../../shared/dream";
import { makeRng } from "../../shared/rng";
import type {
  CycleExitResult,
  ExamineResult,
  FinaleResult,
} from "../../shared/ai";
import { TERRAIN_NAMES } from "../../shared/map-patch";
import type { MapPatch } from "../game/patch";
import type { WorldState } from "../game/world";
import type { Observation } from "./observation";
import type {
  DreamMind,
  ExamineRequest,
  Tell,
  TurnRequest,
  TurnResponse,
} from "./types";

/**
 * Words that make a question direct. §3's trade: precision buys information and costs
 * cover, so the things worth asking about are exactly the things that give you away.
 *
 * These are *stems*, not words. The game is played in Russian, where "котельная"
 * becomes "котельной" the moment anyone asks a question about it, and matching whole
 * words would let a player walk straight past every tell by declining a noun. Stems are
 * blunt and will over-match occasionally, which is the right way round: a figure being
 * slightly too suspicious is in character, and one that never notices is not.
 */
const LOADED_STEMS = [
  "пожар",
  "гар",
  "огн",
  "огон",
  "дым",
  "котельн",
  "подвал",
  "ключ",
  "заперт",
  "умер",
  "смерт",
  "погиб",
  "виноват",
  "журнал",
  "стук",
  "сгор",
];

const HEDGE_STEMS = [
  "наверн",
  "кажется",
  "может",
  "не знаю",
  "просто",
  "как-то",
];

/**
 * The stem is how the match is found, but the player must be quoted their own word —
 * being challenged over "котельн" would read as the game showing its wiring.
 */
function quotedWordFor(utterance: string, stem: string): string {
  const words = utterance.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  return words.find((word) => word.toLowerCase().includes(stem)) ?? stem;
}

const DEFLECTIONS = [
  "Здесь всегда так. Не обращай внимания.",
  "Я не помню. Тут никто толком не помнит.",
  "Ты бы шёл. Скоро обход.",
  "Спроси у кого-нибудь другого.",
  "Странный день. Все спрашивают.",
];

const WARM = [
  "Ты первый, кто спросил по-человечески.",
  "Ну... если тихо. Только тихо.",
  "Не здесь. Но раз ты уже стоишь.",
];

export class ScriptedMind implements DreamMind {
  readonly name = "scripted";
  readonly waiting = false;
  private turnCount = 0;

  constructor(private readonly world: WorldState) {}

  // --- conversation ------------------------------------------------------

  async turn(request: TurnRequest): Promise<TurnResponse> {
    this.turnCount++;
    const figure = this.world.figures.find((f) => f.id === request.figureId);
    if (!figure) {
      return {
        reply: "…",
        tell: null,
        yieldedShardId: null,
        residueDelta: [],
        memoryEffect: null,
        resonance: null,
        figureMemorySummary: "",
        journalEntry: null,
        portraitState: "neutral",
      };
    }

    const said = request.utterance.toLowerCase();
    const rng = makeRng(`${request.figureId}:${this.turnCount}:${said.length}`);

    const hit = LOADED_STEMS.find((stem) => said.includes(stem));
    const hedged = HEDGE_STEMS.some((stem) => said.includes(stem));

    let tell: Tell | null = null;
    if (hit) {
      const quoted = quotedWordFor(request.utterance, hit);
      tell = {
        quoted,
      };
    }

    // A direct question buys the hook — and leaves a mark. A careful one is safe and
    // gets you nothing. That fork is the thing §9 says to test before anything else.
    const yielded = hit && figure.holdsShardId ? figure.holdsShardId : null;

    let reply: string;
    if (yielded) {
      const shard = this.world.artifact.shards.find((s) => s.id === yielded);
      reply =
        `«${tell!.quoted}»… Откуда ты это знаешь? ${rng.pick(WARM)} ${shard?.hint ?? ""}`
          .trim()
          .slice(0, 180);
    } else if (hit) {
      reply = `«${tell!.quoted}»… Откуда ты это знаешь? ${rng.pick(DEFLECTIONS)}`;
    } else if (hedged) {
      reply = "Да. Наверное.";
    } else {
      reply = rng.pick(DEFLECTIONS);
    }

    return {
      reply,
      tell,
      yieldedShardId: yielded,
      residueDelta: tell ? [`Санитар знает слово «${tell.quoted}».`] : [],
      memoryEffect: null,
      resonance: null,
      figureMemorySummary: tell
        ? `Чужой знает слово «${tell.quoted}» и задаёт слишком точные вопросы.`
        : "Этот человек уже подходил и расспрашивал.",
      journalEntry: yielded
        ? `${figure.name} проговорился о важной детали.`
        : null,
      portraitState: hit
        ? this.turnCount >= 4
          ? "knows"
          : "wary"
        : hedged
          ? "interested"
          : "neutral",
    };
  }

  async examine(request: ExamineRequest): Promise<ExamineResult> {
    const lines = [
      "Ничего. Пыль и та ненастоящая.",
      "Кто-то это уже трогал. Недавно.",
      "Слишком аккуратно лежит для этой комнаты.",
      "Здесь чего-то не хватает, и непонятно чего.",
    ];
    const hash = ((request.x * 73856093) ^ (request.y * 19349663)) >>> 0;
    const interest = this.world.interests.find(
      (candidate) => candidate.id === request.interestId,
    );
    return {
      reply: interest?.sensorySeed ?? lines[hash % lines.length]!,
      yieldedShardId: null,
      clueObservedId: interest?.clueId ?? null,
    };
  }

  // --- the heartbeat -----------------------------------------------------

  async mutate(observation: Observation): Promise<CycleExitResult> {
    const patches: MapPatch[] = [];
    const rng = makeRng(
      `beat:${observation.beatsThisCycle}:${observation.elapsedSeconds | 0}`,
    );

    // 1. A door the player keeps trying is a door the dream starts to mind.
    const nagged = Object.entries(observation.refusedDoors)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1]);
    for (const [doorId] of nagged.slice(0, 1)) {
      patches.push({
        kind: "sealDoor",
        doorId,
        reason: `player was refused by this door ${observation.refusedDoors[doorId]} times`,
      });
    }

    // 2. Somebody visited over and over is somebody worth moving.
    const pestered = Object.entries(observation.approachedFigures)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);
    const target = pestered[0]?.[0];
    if (target) {
      const figure = this.world.figures.find((f) => f.id === target);
      const elsewhere = this.world.rooms.filter(
        (room) =>
          room.kind === "room" &&
          room.id !== figure?.roomId &&
          room.nodeType !== NodeType.START &&
          !observation.visitedRoomIds.includes(room.id),
      );
      const destination = rng.maybePick(elsewhere);
      if (figure && destination) {
        patches.push({
          kind: "moveFigure",
          figureId: figure.id,
          toRoomId: destination.id,
          reason: "the player kept coming back to them",
        });
      }
    }

    // 3. A room stood in for a long time and then left gets quietly rearranged, so
    //    returning to it feels wrong in a way that is hard to point at.
    const lingered = Object.entries(observation.dwell)
      .filter(
        ([roomId, seconds]) =>
          seconds > 12 && roomId !== observation.currentRoomId,
      )
      .sort((a, b) => b[1] - a[1]);
    const lingeredRoom = lingered[0]?.[0];
    if (lingeredRoom) {
      patches.push({
        kind: "retileRoom",
        roomId: lingeredRoom,
        reason: `player spent ${Math.round(observation.dwell[lingeredRoom] ?? 0)}s here`,
      });
    }

    // 4. Once the player is genuinely getting somewhere, start moving what they are
    //    after. §2: kill the carrier and the knowledge surfaces elsewhere, dearer.
    if (observation.learnedShardIds.length >= 2) {
      const unheld = this.world.artifact.shards.find(
        (shard) => !this.world.figures.some((f) => f.holdsShardId === shard.id),
      );
      const empty = rng.maybePick(
        this.world.figures.filter((f) => f.holdsShardId === null),
      );
      if (unheld && empty) {
        patches.push({
          kind: "relocateShard",
          shardId: unheld.id,
          toFigureId: empty.id,
          reason: "the player is getting close; move what is left",
        });
      }
    }

    // 5. Somewhere the player has walked past more than once starts turning into something
    //    else. §6: the sleeper is not limited to rearranging what the Lord put there — it
    //    can put in what was never there, and `render/foundry.ts` draws it on the spot.
    if (observation.visitedRoomIds.length >= 3 && rng.chance(0.4)) {
      const elsewhere = rng.maybePick(
        this.world.rooms.filter(
          (room) =>
            room.kind === "room" &&
            room.region !== "interior" &&
            room.id !== observation.currentRoomId &&
            observation.visitedRoomIds.includes(room.id),
        ),
      );
      if (elsewhere) {
        patches.push({
          kind: "growTerrain",
          roomId: elsewhere.id,
          terrain: rng.pick(TERRAIN_NAMES),
          reason: "the player has been through here before",
        });
      }
    }

    // 6. If nothing at all has provoked it, the dream still shifts a little. A world
    //    that only ever reacts is a world you can hold still by doing nothing.
    if (patches.length === 0) {
      const idle = rng.maybePick(
        this.world.rooms.filter(
          (room) =>
            room.kind === "room" && room.id !== observation.currentRoomId,
        ),
      );
      if (idle) {
        patches.push({
          kind: "retileRoom",
          roomId: idle.id,
          reason: "restlessness",
        });
      }
    }

    return { patches, sleeperSummary: "Сон запомнил маршрут санитара." };
  }

  async judge(words: string[]): Promise<FinaleResult> {
    const phrase = words
      .map((word) => word.normalize("NFKD").trim().toLowerCase())
      .join(" ");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(phrase),
    );
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return hash === this.world.artifact.content.mnemonic.hash
      ? {
          verdict: "match",
          reply: "Шесть слов встали на места. Аппарат забирает ключ из сна.",
        }
      : {
          verdict: "miss",
          reply: "Фраза не открыла кошелёк. Сон не говорит, где ошибка.",
        };
  }

  availableMemories(): readonly [] {
    return [];
  }

  conversation(): readonly [] {
    return [];
  }

  forgetFigures(): void {
    this.turnCount = 0;
  }

  abort(): void {
    // No network turn to interrupt.
  }
}
