/** Bounded factual memories for one run. Retrieval never grants new witnesses. */
import { RETURNS_WHOLE } from "./verbs";
import type { WorldEvent } from "./world-action";
import {
  worldMindForFigure,
  type WorldMindEvent,
  type WorldMindObjectFact,
} from "./world-mind";
import type { AnyActor, WorldObjectPhysicalState } from "./world-object";

export const MAX_MEMORY_EPISODES = 1024;
export const MAX_MEMORY_TEXT = 1200;
const MAX_ID_LENGTH = 160;
const MAX_REFERENCES = 64;

export interface MemoryEpisode {
  id: string;
  sequence: number;
  cycle: number;
  kind: "action" | "dialogue" | "movement" | "observation";
  text: string;
  roomIds: string[];
  entityIds: string[];
  observerIds: string[];
  /** Stable across observer-specific views and subsequent retellings. */
  originId?: string;
  /** The observed actor; being mentioned or witnessing an event does not count. */
  subjectActorId?: string | null;
  shareable?: boolean;
  provenance?: MemoryProvenance;
}

export type MemoryEpisodeInput = Omit<MemoryEpisode, "sequence">;

export interface MemoryProvenance {
  kind: "observed" | "heard";
  originWitnessId: string;
  speakerId: string | null;
  hops: 0 | 1 | 2;
  acquiredRoomId: string;
  acquiredCycle: number;
}

export interface EpisodicMemorySnapshot {
  nextSequence: number;
  episodes: MemoryEpisode[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_ID_LENGTH
    ? value
    : null;
}

function identifiers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result = new Set<string>();
  for (const candidate of value.slice(0, MAX_REFERENCES * 2)) {
    const id = identifier(candidate);
    if (id) result.add(id);
    if (result.size >= MAX_REFERENCES) break;
  }
  return [...result];
}

function positiveInteger(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) > 0 &&
    (value as number) < Number.MAX_SAFE_INTEGER / 2
  );
}

function normalizeProvenance(value: unknown): MemoryProvenance | undefined {
  const source = record(value);
  if (!source) return undefined;
  const originWitnessId = identifier(source.originWitnessId);
  const acquiredRoomId = identifier(source.acquiredRoomId);
  const speakerId =
    source.speakerId === null ? null : identifier(source.speakerId);
  if (
    !originWitnessId ||
    !acquiredRoomId ||
    !Number.isSafeInteger(source.acquiredCycle) ||
    (source.acquiredCycle as number) < 0 ||
    !(
      (source.kind === "observed" &&
        source.hops === 0 &&
        source.speakerId === null) ||
      (source.kind === "heard" &&
        (source.hops === 1 || source.hops === 2) &&
        speakerId)
    )
  )
    return undefined;
  return {
    kind: source.kind as MemoryProvenance["kind"],
    originWitnessId,
    speakerId,
    hops: source.hops as MemoryProvenance["hops"],
    acquiredRoomId,
    acquiredCycle: source.acquiredCycle as number,
  };
}

function normalize(value: unknown): MemoryEpisodeInput | null {
  const item = record(value);
  if (!item) return null;
  const id = identifier(item.id);
  const text = typeof item.text === "string" ? item.text.trim() : "";
  const observerIds = identifiers(item.observerIds);
  if (
    !id ||
    !text ||
    !Number.isSafeInteger(item.cycle) ||
    (item.cycle as number) < 0 ||
    !observerIds.length ||
    (item.kind !== "action" &&
      item.kind !== "dialogue" &&
      item.kind !== "movement" &&
      item.kind !== "observation")
  )
    return null;
  const provenance = normalizeProvenance(item.provenance);
  const subjectActorId = identifier(item.subjectActorId);
  return {
    id,
    cycle: item.cycle as number,
    kind: item.kind,
    text: text.slice(0, MAX_MEMORY_TEXT),
    roomIds: identifiers(item.roomIds),
    entityIds: identifiers(item.entityIds),
    observerIds,
    originId: identifier(item.originId) ?? id,
    subjectActorId,
    shareable:
      item.shareable === true &&
      subjectActorId === "player" &&
      (item.kind === "action" || item.kind === "movement") &&
      provenance !== undefined,
    ...(provenance ? { provenance } : {}),
  };
}

export class EpisodicMemory {
  private episodes: MemoryEpisode[] = [];
  private ids = new Set<string>();
  private nextSequence = 1;
  private readonly capacity: number;

  constructor(options: { capacity?: number } = {}) {
    this.capacity = Number.isFinite(options.capacity)
      ? Math.max(
          1,
          Math.min(MAX_MEMORY_EPISODES, Math.floor(options.capacity!)),
        )
      : MAX_MEMORY_EPISODES;
  }

  add(input: MemoryEpisodeInput): void {
    const item = normalize(input);
    if (!item || this.ids.has(item.id)) return;
    this.episodes.push({ ...item, sequence: this.nextSequence++ });
    this.ids.add(item.id);
    this.trim();
  }

  private trim(): void {
    const removed = this.episodes.splice(
      0,
      Math.max(0, this.episodes.length - this.capacity),
    );
    for (const item of removed) this.ids.delete(item.id);
  }

  /** Copies isolate stored facts from callers and from later world mutations. */
  snapshot(): EpisodicMemorySnapshot {
    return structuredClone({
      nextSequence: this.nextSequence,
      episodes: this.episodes,
    });
  }

  /** Missing older-save data is an empty store; malformed entries grant no access. */
  restore(value: unknown): void {
    this.clear();
    const data = record(value);
    const candidates = Array.isArray(value)
      ? value
      : Array.isArray(data?.episodes)
        ? data.episodes
        : [];
    // Bound both persisted output and recovery work from a malformed save.
    for (const candidate of candidates.slice(-MAX_MEMORY_EPISODES * 2)) {
      const item = normalize(candidate);
      if (!item || this.ids.has(item.id)) continue;
      const savedSequence = record(candidate)?.sequence;
      const sequence = positiveInteger(savedSequence)
        ? Math.max(this.nextSequence, savedSequence)
        : this.nextSequence;
      this.episodes.push({ ...item, sequence });
      this.ids.add(item.id);
      this.nextSequence = sequence + 1;
    }
    if (positiveInteger(data?.nextSequence))
      this.nextSequence = Math.max(this.nextSequence, data.nextSequence);
    this.trim();
  }

  forObserver(observerId: string, cycle: number): MemoryEpisode[] {
    const acrossCycles = observerId === "sleeper" || observerId === "player";
    return structuredClone(
      this.episodes.filter(
        (episode) =>
          episode.observerIds.includes(observerId) &&
          (acrossCycles || episode.cycle === cycle) &&
          (acrossCycles ||
            observerId === "glaz" ||
            (episode.kind !== "action" && episode.kind !== "movement") ||
            episode.subjectActorId === observerId ||
            !episode.entityIds.some((id) => RETURNS_WHOLE.has(id))),
      ),
    );
  }

  /** A returning figure forgets; the other witnesses keep their own experience. */
  forgetObserver(observerId: string): void {
    if (observerId === "sleeper" || observerId === "player") return;
    this.episodes = this.episodes.filter((episode) => {
      episode.observerIds = episode.observerIds.filter(
        (id) => id !== observerId,
      );
      if (episode.observerIds.length) return true;
      this.ids.delete(episode.id);
      return false;
    });
  }

  clear(): void {
    this.episodes = [];
    this.ids.clear();
    this.nextSequence = 1;
  }
}

export interface MemoryNames {
  rooms: Record<string, string>;
  figures: Record<string, string>;
}

function actorId(actor: AnyActor | null): string | null {
  if (!actor) return null;
  if (actor.kind === "script") return `script:${actor.id}`;
  return actor.kind === "figure" ? actor.id : actor.kind;
}

function actorName(actor: AnyActor | null, names: MemoryNames): string {
  if (!actor) return "Кто-то";
  switch (actor.kind) {
    case "player":
      return "Санитар";
    case "figure":
      return names.figures[actor.id] ?? actor.id;
    case "sleeper":
      return "Спящий";
    case "script":
      return "Сон";
  }
}

function stateText(state: WorldObjectPhysicalState): string {
  const facts: string[] = [];
  const pairs = [
    ["open", "открыт", "закрыт"],
    ["active", "активен", "неактивен"],
    ["broken", "сломан", "цел"],
    ["locked", "заперт", "не заперт"],
    ["wet", "мокрый", "сухой"],
    ["dirty", "грязный", "чистый"],
  ] as const;
  for (const [key, yes, no] of pairs)
    if (typeof state[key] === "boolean") facts.push(state[key] ? yes : no);
  if (typeof state.inscription === "string")
    facts.push(`надпись ${JSON.stringify(state.inscription.slice(0, 240))}`);
  return facts.join(", ");
}

/** Render only the supplied view. Never look back into the unprojected receipt. */
function episodeForView(
  view: WorldMindEvent,
  observerId: string,
  names: MemoryNames,
): MemoryEpisodeInput | null {
  const rooms = new Set(view.roomIds);
  const entities = new Set<string>();
  const actor = actorId(view.actor);
  if (actor) entities.add(actor);
  const objects = new Map(
    [...view.before.objects, ...view.after.objects].map((object) => [
      object.id,
      object,
    ]),
  );
  const roomName = (id: string) => `«${names.rooms[id] ?? id}»`;
  const objectName = (id: string) => objects.get(id)?.name ?? "предмет";
  const where = (object: WorldMindObjectFact): string => {
    const location = object.location;
    switch (location.kind) {
      case "room":
        rooms.add(location.roomId);
        return `в ${roomName(location.roomId)}`;
      case "held": {
        const owner = actorId(location.actor);
        if (owner) entities.add(owner);
        return `у ${actorName(location.actor, names)}`;
      }
      case "inside":
        if (objects.has(location.objectId)) {
          entities.add(location.objectId);
          return `внутри «${objectName(location.objectId)}»`;
        }
        return "внутри вместилища";
      case "removed":
        return "больше нет в мире";
    }
  };
  const facts: string[] = [];
  const before = view.before.actor;
  const after = view.after.actor;
  const who = actorName(view.actor, names);
  if (before) rooms.add(before.roomId);
  if (after) rooms.add(after.roomId);
  if (before && after && before.roomId !== after.roomId)
    facts.push(
      `${who} перешёл из ${roomName(before.roomId)} в ${roomName(after.roomId)}.`,
    );
  else if (before && !after)
    facts.push(
      `${who} был в ${roomName(before.roomId)}, затем вышел из поля зрения; куда — не видно.`,
    );
  else if (!before && after)
    facts.push(
      `${who} появился в ${roomName(after.roomId)}; откуда — не видно.`,
    );
  else if (after)
    facts.push(
      `${who} ${before && (before.x !== after.x || before.y !== after.y) ? "переместился" : "находился"} в ${roomName(after.roomId)}.`,
    );

  const addEvent = (event: WorldEvent): void => {
    if ("objectId" in event && objects.has(event.objectId))
      entities.add(event.objectId);
    if ("doorId" in event) entities.add(event.doorId);
    const object = "objectId" in event ? `«${objectName(event.objectId)}»` : "";
    switch (event.type) {
      case "object.taken":
        facts.push(`${who} взял ${object}.`);
        break;
      case "object.dropped":
        facts.push(`${who} положил ${object}.`);
        break;
      case "object.given":
        facts.push(`${who} передал ${object} ${actorName(event.to, names)}.`);
        entities.add(actorId(event.to)!);
        break;
      case "object.moved":
        facts.push(
          `${object} помещён внутрь «${objectName(event.intoObjectId)}».`,
        );
        break;
      case "object.opened":
        facts.push(`${who} открыл ${object}.`);
        break;
      case "object.closed":
        facts.push(`${who} закрыл ${object}.`);
        break;
      case "object.activated":
        facts.push(`${who} активировал ${object}.`);
        break;
      case "object.used":
        facts.push(`${who} использовал ${object}.`);
        break;
      case "object.changed":
        facts.push(`${who} изменил ${object}: ${event.verb.slice(0, 80)}.`);
        break;
      case "object.gestured":
        facts.push(
          `${who}: жест «${event.verb.slice(0, 80)}» с ${object}; физического изменения нет.`,
        );
        break;
      case "door.opened":
        facts.push(`${who} открыл дверь.`);
        break;
      case "door.closed":
        facts.push(`${who} закрыл дверь.`);
        break;
      // Movement is described by visible endpoints, never by an intended destination.
      case "door.traversed":
      case "actor.moved":
      case "actor.enteredRoom":
        break;
    }
  };
  for (const event of view.events) addEvent(event);

  for (const [id, object] of objects) {
    entities.add(id);
    const old = view.before.objects.find((candidate) => candidate.id === id);
    const current = view.after.objects.find((candidate) => candidate.id === id);
    const describe = (fact: WorldMindObjectFact) =>
      [where(fact), stateText(fact.state)].filter(Boolean).join(", ");
    if (old && current) {
      const from = describe(old);
      const to = describe(current);
      facts.push(
        `«${object.name}»: ${from === to ? to : `до — ${from}; после — ${to}`}.`,
      );
    } else if (old)
      facts.push(
        `«${object.name}»: было ${describe(old)}; затем вне поля зрения.`,
      );
    else if (current)
      facts.push(`«${object.name}»: теперь ${describe(current)}.`);
  }
  for (const door of [view.before.door, view.after.door]) {
    if (!door) continue;
    rooms.add(door.fromRoomId);
    entities.add(door.id);
  }
  const oldDoor = view.before.door;
  const door = view.after.door;
  if (door) {
    const current = door.closed === true ? "закрыта" : "открыта";
    const old = oldDoor?.closed === true ? "закрыта" : "открыта";
    facts.push(
      `Дверь в ${roomName(door.fromRoomId)}: ${oldDoor && old !== current ? `${old} → ${current}` : current}.`,
    );
  }
  if (!facts.length) return null;
  const moved =
    before !== null &&
    after !== null &&
    (before.roomId !== after.roomId ||
      before.x !== after.x ||
      before.y !== after.y);
  const movement =
    view.actionType === "moveTo" || view.actionType === "traverseDoor";
  const movementObserved =
    movement && (moved || (before === null) !== (after === null));
  if (movement && !movementObserved) return null;
  const acquiredRoomId =
    view.witnessRooms[observerId]?.at(-1) ??
    after?.roomId ??
    before?.roomId ??
    [...rooms][0];
  const provenance: MemoryProvenance | undefined = acquiredRoomId
    ? {
        kind: "observed",
        originWitnessId: observerId,
        speakerId: null,
        hops: 0,
        acquiredRoomId,
        acquiredCycle: view.cycle,
      }
    : undefined;
  return {
    id: `world:${view.cycle}:${view.sequence}:${observerId}`,
    cycle: view.cycle,
    kind: movement ? "movement" : "action",
    text: facts.join(" ").slice(0, MAX_MEMORY_TEXT),
    roomIds: [...rooms],
    entityIds: [...entities],
    observerIds: [observerId],
    originId: `world:${view.cycle}:${view.sequence}`,
    subjectActorId: actor,
    shareable:
      view.actor?.kind === "player" &&
      provenance !== undefined &&
      (movementObserved || (!movement && view.events.length > 0)),
    ...(provenance ? { provenance } : {}),
  };
}

/** Successful world receipts only; an intention or refused proposal is not memory. */
export function episodesForWorldEvent(
  event: WorldMindEvent,
  names: MemoryNames,
): MemoryEpisodeInput[] {
  const result: MemoryEpisodeInput[] = [];
  const sleeper = episodeForView(event, "sleeper", names);
  if (sleeper) {
    // Keep who saw the event after the short receipt ring expires. This complete
    // view still belongs only to the sleeper; a witness gets its own projection.
    const witnesses = [...new Set(event.witnessIds)].map(
      (id) => names.figures[id] ?? id,
    );
    const witnessed = witnesses.length
      ? `Свидетели: ${witnesses.join(", ")}.`
      : "Свидетелей среди персонажей не было.";
    sleeper.text = `${witnessed} ${sleeper.text}`.slice(0, MAX_MEMORY_TEXT);
    result.push(sleeper);
  }
  // Receipts record figure visibility, not player visibility. Only the player's own
  // actions can be granted to the player here without inventing an observation.
  if (event.actor?.kind === "player") {
    const player = episodeForView(event, "player", names);
    if (player) result.push(player);
  }
  const observers = new Set(event.witnessIds);
  if (event.actor?.kind === "figure") observers.add(event.actor.id);
  for (const observerId of observers) {
    const view = worldMindForFigure([event], observerId, 1)[0];
    if (!view) continue;
    const episode = episodeForView(view, observerId, names);
    if (
      episode &&
      (observerId === "glaz" ||
        episode.subjectActorId === observerId ||
        !episode.entityIds.some((id) => RETURNS_WHOLE.has(id)))
    )
      result.push(episode);
  }
  return result;
}
