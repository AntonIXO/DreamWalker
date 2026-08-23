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

import { makeRng } from "../../shared/rng";
import { mayYieldShard } from "../../shared/yield";
import { clampPortraitByExhaustion } from "../game/exhaustion";
import { lookAt } from "../../../dreams/son/looks";
import { npcFor, talkContext } from "../../../dreams/son/npcs";
import { getLocale } from "../../shared/i18n";
import type {
  CycleExitResult,
  ExamineResult,
  FinaleResult,
} from "../../shared/ai";
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
 */
const LOADED_STEMS_RU = [
  "двор",
  "лавочк",
  "развилк",
  "кирилл",
  "лёш",
  "леш",
  "турышев",
  "сидор",
  "сид-фраз",
  "кошел",
  "мнемон",
  "битко",
  "полк",
  "гробы",
  "глаз",
  "санитар",
  "снаруж",
];

const LOADED_STEMS_EN = [
  "courtyard",
  "bench",
  "fork",
  "kirill",
  "lesh",
  "turyshev",
  "sidor",
  "seed",
  "phrase",
  "wallet",
  "mnemonic",
  "bitcoin",
  "shelf",
  "coffin",
  "eye",
  "sanitar",
  "orderly",
  "outside",
];

const HEDGE_STEMS_RU = [
  "наверн",
  "кажется",
  "может",
  "не знаю",
  "просто",
  "как-то",
];

const HEDGE_STEMS_EN = [
  "maybe",
  "seems",
  "might",
  "don't know",
  "dont know",
  "just",
  "somehow",
  "perhaps",
  "probably",
];

/**
 * The stem is how the match is found, but the player must be quoted their own word —
 * being challenged over "котельн" would read as the game showing its wiring.
 */
function quotedWordFor(utterance: string, stem: string): string {
  const words = utterance.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  return words.find((word) => word.toLowerCase().includes(stem)) ?? stem;
}

const DEFLECTIONS_RU = [
  "Здесь всегда так. Не обращай внимания.",
  "Я не помню. Тут никто толком не помнит.",
  "Ты бы шёл. Скоро обход.",
  "Спроси у кого-нибудь другого.",
  "Странный день. Все спрашивают.",
];

const DEFLECTIONS_EN = [
  "It is always like this here. Pay no mind.",
  "I don't remember. Nobody remembers properly here.",
  "You should move along. Rounds are soon.",
  "Ask someone else.",
  "Strange day. Everyone is asking.",
];

const LEVERAGE_STEMS_RU: Array<{
  about: string;
  id: string;
  stems: string[];
}> = [
  {
    about: "kirill",
    id: "kirill:chuzhaia-zasluga",
    stems: ["ноут", "acer", "хакатон", "заслуг", "присво"],
  },
  {
    about: "mama",
    id: "mama:masshtab-problemy",
    stems: ["деньг", "трат", "мармелад", "преумен"],
  },
  {
    about: "kripto-bro",
    id: "kripto-bro:vsio-krome-summ",
    stems: ["поезд", "вокзал", "кинул", "сумм"],
  },
  {
    about: "hudozhnik",
    id: "hudozhnik:pereskaz",
    stems: ["смех", "хохот", "не слышн", "пересказ"],
  },
  {
    about: "turyshev",
    id: "turyshev:vsio-normalno",
    stems: ["нормальн", "лавочк", "подъезд"],
  },
  {
    about: "babushka-nadya",
    id: "babushka-nadya:prichiny-zapretov",
    stems: ["не бери", "запрет", "нельзя брать"],
  },
];

const LEVERAGE_STEMS_EN: Array<{
  about: string;
  id: string;
  stems: string[];
}> = [
  {
    about: "kirill",
    id: "kirill:chuzhaia-zasluga",
    stems: ["laptop", "acer", "hackathon", "credit", "stole"],
  },
  {
    about: "mama",
    id: "mama:masshtab-problemy",
    stems: ["money", "spending", "marmalade", "downplay"],
  },
  {
    about: "kripto-bro",
    id: "kripto-bro:vsio-krome-summ",
    stems: ["train", "station", "ripped off", "amount"],
  },
  {
    about: "hudozhnik",
    id: "hudozhnik:pereskaz",
    stems: ["laughter", "laugh", "inaudible", "retelling"],
  },
  {
    about: "turyshev",
    id: "turyshev:vsio-normalno",
    stems: ["normal", "bench", "entrance"],
  },
  {
    about: "babushka-nadya",
    id: "babushka-nadya:prichiny-zapretov",
    stems: ["don't take", "prohibition", "forbidden"],
  },
];

function leverageFrom(said: string, speakerId: string) {
  const isRu = getLocale() === "ru";
  const list = isRu ? LEVERAGE_STEMS_RU : LEVERAGE_STEMS_EN;
  for (const entry of list) {
    // Nobody hands over their own noose.
    if (entry.about === speakerId) continue;
    if (entry.stems.some((stem) => said.includes(stem))) {
      return { aboutFigureId: entry.about, leverageId: entry.id };
    }
  }
  return null;
}

const WARM_RU = [
  "Ты первый, кто спросил по-человечески.",
  "Ну... если тихо. Только тихо.",
  "Не здесь. Но раз ты уже стоишь.",
];

const WARM_EN = [
  "You are the first to ask like a human being.",
  "Well... if quietly. Only quietly.",
  "Not here. But since you're already standing here.",
];

export class ScriptedMind implements DreamMind {
  readonly name = "scripted";
  readonly waiting = false;
  private turnCount = 0;

  constructor(private readonly world: WorldState) {}

  // --- conversation ------------------------------------------------------

  async turn(request: TurnRequest): Promise<TurnResponse> {
    this.turnCount++;
    const isRu = getLocale() === "ru";
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
        leverageLearned: null,
        pressed: null,
      };
    }

    const ctx = talkContext(this.world, {
      figureId: request.figureId,
      utterance: request.utterance,
      offeredMemoryText: null,
      leverageOffered: request.leverageOffered ?? null,
      cycle: 1,
    });
    if (ctx) {
      const authored = npcFor(figure.id).talk(ctx);
      if (authored) {
        const somethingHappenedHere = [...this.world.fates.values()].some(
          (record) =>
            record.roomId === figure.roomId && record.figureId !== figure.id,
        );
        if (somethingHappenedHere && authored.reply.length < 140) {
          const extra = isRu
            ? " Тут был ещё один. Куда делся, не знаю."
            : " There was someone else here. Don't know where they went.";
          authored.reply = `${authored.reply}${extra}`;
        }
        return authored;
      }
    }

    const said = request.utterance.toLowerCase();
    const rng = makeRng(`${request.figureId}:${this.turnCount}:${said.length}`);

    const loadedStems = isRu ? LOADED_STEMS_RU : LOADED_STEMS_EN;
    const hedgeStems = isRu ? HEDGE_STEMS_RU : HEDGE_STEMS_EN;
    const deflections = isRu ? DEFLECTIONS_RU : DEFLECTIONS_EN;
    const warmList = isRu ? WARM_RU : WARM_EN;

    const hit = loadedStems.find((stem) => said.includes(stem));
    const hedged = hedgeStems.some((stem) => said.includes(stem));

    let tell: Tell | null = null;
    if (hit) {
      const quoted = quotedWordFor(request.utterance, hit);
      tell = {
        quoted,
      };
    }

    const mayYield = mayYieldShard({
      figureId: figure.id,
      utterance: request.utterance,
      visitCounts: this.world.visitCounts,
      leveraged: Boolean(request.leverageOffered),
    });
    const yielded =
      mayYield && figure.holdsShardId ? figure.holdsShardId : null;

    let reply: string;
    if (yielded) {
      const shard = this.world.artifact.shards.find((s) => s.id === yielded);
      const quoteWrap = isRu ? `«${tell?.quoted}»` : `“${tell?.quoted}”`;
      reply = (
        tell
          ? `${quoteWrap}… ${rng.pick(warmList)} ${shard?.hint ?? ""}`
          : `${rng.pick(warmList)} ${shard?.hint ?? ""}`
      )
        .trim()
        .slice(0, 180);
    } else if (hit) {
      const quoteWrap = isRu ? `«${tell!.quoted}»` : `“${tell!.quoted}”`;
      const ask = isRu
        ? `${quoteWrap}… Откуда ты это знаешь?`
        : `${quoteWrap}… How do you know that?`;
      reply = `${ask} ${rng.pick(deflections)}`;
    } else if (hedged) {
      reply = isRu ? "Да. Наверное." : "Yeah. Probably.";
    } else {
      reply = rng.pick(deflections);
    }

    // The offline version of *the figures notice*.
    const somethingHappenedHere = [...this.world.fates.values()].some(
      (record) =>
        record.roomId === figure.roomId && record.figureId !== figure.id,
    );
    if (somethingHappenedHere && reply.length < 140) {
      const extra = isRu
        ? " Тут был ещё один. Куда делся, не знаю."
        : " There was another one here. Don't know where they went.";
      reply = `${reply}${extra}`;
    }

    return {
      reply,
      tell,
      yieldedShardId: yielded,
      residueDelta: tell
        ? [
            isRu
              ? `Санитар знает слово «${tell.quoted}».`
              : `The orderly knows the word “${tell.quoted}”.`,
          ]
        : [],
      memoryEffect: null,
      resonance: null,
      figureMemorySummary: tell
        ? isRu
          ? `Чужой знает слово «${tell.quoted}» и задаёт слишком точные вопросы.`
          : `The stranger knows the word “${tell.quoted}” and asks too precise questions.`
        : isRu
          ? "Этот человек уже подходил и расспрашивал."
          : "This person has already approached and questioned.",
      journalEntry: yielded
        ? isRu
          ? `${figure.name} проговорился о важной детали.`
          : `${figure.name} let slip an important detail.`
        : null,
      leverageLearned: leverageFrom(said, figure.id),
      pressed: request.leverageOffered
        ? hedged
          ? "leveraged"
          : "broken"
        : null,
      portraitState:
        figure.id === "shchenok" || figure.id === "kurt"
          ? "neutral"
          : clampPortraitByExhaustion(
              this.world.exhaustion,
              hit
                ? this.turnCount >= 4
                  ? "knows"
                  : "wary"
                : hedged
                  ? "interested"
                  : "neutral",
              figure.portraitState,
            ),
    };
  }

  async examine(request: ExamineRequest): Promise<ExamineResult> {
    const isRu = getLocale() === "ru";
    const lines = isRu
      ? [
          "Ничего. Пыль и та ненастоящая.",
          "Кто-то это уже трогал. Недавно.",
          "Слишком аккуратно лежит для этой комнаты.",
          "Здесь чего-то не хватает, и непонятно чего.",
        ]
      : [
          "Nothing. Even the dust isn't real.",
          "Someone touched this recently.",
          "Lies too neatly for this room.",
          "Something is missing here, not clear what.",
        ];
    const hash = ((request.x * 73856093) ^ (request.y * 19349663)) >>> 0;
    const interest = this.world.interests.find(
      (candidate) => candidate.id === request.interestId,
    );
    const hotspot =
      request.hotspotId && request.roomId
        ? (this.world.roomById
            .get(request.roomId)
            ?.hotspots.find((entry) => entry.id === request.hotspotId) ?? null)
        : null;
    const clueId = interest?.clueId ?? hotspot?.clueId ?? null;
    const authoredRoom = request.roomId
      ? this.world.roomById.get(request.roomId)
      : null;
    const looked = lookAt(hotspot?.id);
    const inscription =
      looked?.reply ??
      (hotspot?.id === "nadpis" ? authoredRoom?.copy.nadpis : null);
    const clue = clueId
      ? this.world.artifact.content.clues.find(
          (candidate) => candidate.id === clueId,
        )
      : null;
    return {
      reply:
        inscription ??
        interest?.sensorySeed ??
        clue?.sensorySeed ??
        lines[hash % lines.length]!,
      yieldedShardId: interest?.holdsShardId ?? null,
      clueObservedId: clueId,
      leverageLearned: leverageFrom(
        (interest?.sensorySeed ?? "").toLowerCase(),
        "",
      ),
    };
  }

  // --- the heartbeat -----------------------------------------------------

  /** A wall mask the room is not already wearing, or null if the author authored none. */
  private variantFor(roomId: string | undefined): string | null {
    if (!roomId) return null;
    const room = this.world.roomById.get(roomId);
    if (!room) return null;
    const options = Object.keys(room.cellVariants).filter(
      (name) => name !== room.activeVariant,
    );
    return options[0] ?? null;
  }

  async mutate(observation: Observation): Promise<CycleExitResult> {
    const isRu = getLocale() === "ru";
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
          room.kind === "place" &&
          room.id !== figure?.roomId &&
          room.id !== this.world.artifact.spawn.roomId &&
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

    // 3. A room stood in for a long time and then left gets quietly rearranged.
    const lingered = Object.entries(observation.dwell)
      .filter(
        ([roomId, seconds]) =>
          seconds > 12 && roomId !== observation.currentRoomId,
      )
      .sort((a, b) => b[1] - a[1]);
    const lingeredRoom = lingered[0]?.[0];
    const lingeredVariant = this.variantFor(lingeredRoom);
    if (lingeredRoom && lingeredVariant) {
      patches.push({
        kind: "shiftWalls",
        roomId: lingeredRoom,
        variantId: lingeredVariant,
        reason: "the player stayed too long",
      });
    }

    // 4. Something the player has already used starts arriving somewhere else.
    if (observation.visitedRoomIds.length >= 3 && rng.chance(0.4)) {
      const rewireable = this.world.rooms.flatMap((room) =>
        room.id === observation.currentRoomId
          ? []
          : room.doors.filter((door) => door.threshold === "rift"),
      );
      const victim = rng.maybePick(rewireable);
      const destination = rng.maybePick(
        this.world.rooms.filter(
          (room) => room.kind === "place" && room.id !== victim?.toRoomId,
        ),
      );
      if (victim && destination) {
        patches.push({
          kind: "retargetDoor",
          doorId: victim.id,
          toRoomId: destination.id,
          reason: "the player has been through here before",
        });
      }
    }

    // 5. If nothing at all has provoked it, the dream still shifts a little.
    if (patches.length === 0) {
      const idle = rng.maybePick(
        this.world.rooms.filter(
          (room) =>
            room.kind === "place" &&
            room.id !== observation.currentRoomId &&
            Object.keys(room.cellVariants).length > 0,
        ),
      );
      const variant = this.variantFor(idle?.id);
      if (idle && variant) {
        patches.push({
          kind: "shiftWalls",
          roomId: idle.id,
          variantId: variant,
          reason: "restlessness",
        });
      }
    }

    return {
      patches,
      sleeperSummary: isRu
        ? "Сон запомнил маршрут санитара."
        : "The dream remembered the orderly's route.",
    };
  }

  async judge(words: string[]): Promise<FinaleResult> {
    const isRu = getLocale() === "ru";
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
          wallet: "full",
          amount: "0.08412000",
          reply: isRu
            ? "Шесть слов встали на места. Аппарат забирает ключ из сна."
            : "Six words clicked into place. The apparatus extracts the key from the dream.",
        }
      : {
          verdict: "miss",
          wallet: "dry",
          reply: isRu
            ? "Порядок не совпал. Сон уходит глубже."
            : "The order did not match. The dream sinks deeper.",
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
