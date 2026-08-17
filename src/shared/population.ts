/**
 * The sleeper's deal: who stands where, and which authored links have moved.
 *
 * Lives in `shared/` so the player can start a training run (or recover from a
 * failed inhabit) without waiting on the model. The server uses the same builder
 * after an AI proposal, so a fallback deal and a live deal are the same shape.
 */

import type {
  DreamPopulation,
  FigureAgenda,
  FigureProfile,
  InterestSeed,
  PopulationRetarget,
  RoomAssignment,
} from "./ai";
import type { DreamArtifact } from "./dream";
import { makeRng } from "./rng";
import { shardIdForClue } from "./yield";

export interface PopulationProposal {
  figures: Array<{
    id: string;
    name: string;
    homeRoomId: string;
    role: string;
    voice: string;
    desire: string;
    fear: string;
    taboo: string;
    agenda: FigureAgenda[];
  }>;
  interests: Array<{
    id: string;
    name: string;
    roomId?: string;
    sensorySeed: string;
    solid: boolean;
  }>;
  retargets?: PopulationRetarget[];
  roomMoods: Record<string, string>;
}

interface FigureSlot {
  id: string;
  homeRoomId: string;
  archetypeId: string;
  name: string;
  authoredShardId: string | null;
}

interface InterestSlot {
  id: string;
  roomId: string;
  clueId: string | null;
  sensorySeed: string | null;
}

export interface PopulationOptions {
  shuffle?: boolean;
  seed?: string;
  dryWallet?: boolean;
}

const FALLBACK_INTERESTS = [
  ["Погнутый стул", "На холодной спинке остался тёплый след ладони."],
  ["Доска объявлений", "Под свежим листом проступает старое пятно от кнопки."],
  ["Стакан с водой", "Вода пахнет железом, хотя стакан выглядит чистым."],
  [
    "Связка квитанций",
    "Одна дата зачёркнута так сильно, что бумага порвалась.",
  ],
  ["Выключенный радиоприёмник", "Из динамика едва слышно дыхание помех."],
] as const;

/** Gatekeeper stays on the bench; the Eye stays at the last door. */
export function pinnedHome(
  artifact: DreamArtifact,
  figureId: string,
  options?: { dryWallet?: boolean },
): string | null {
  if (figureId === "turyshev") return artifact.spawn.roomId;
  if (figureId === "glaz") return artifact.finaleRoomId;
  if (figureId === "kripto-bro" && options?.dryWallet) {
    return (
      artifact.rooms.find((room) => room.id.includes("metro"))?.id ??
      "25-metro-i-poezd-kotoryi-ne-tot"
    );
  }
  if (figureId === "shchenok") return "m9-shkaf";
  if (figureId === "raisa") return "02-shkola-kabinet-russkogo";
  return null;
}

export function populationSlots(artifact: DreamArtifact): {
  figures: FigureSlot[];
  interests: InterestSlot[];
} {
  const placeRooms = artifact.rooms.filter((room) => room.kind === "place");
  const figures: FigureSlot[] = artifact.figures.map((figure) => ({
    id: figure.id,
    homeRoomId: figure.roomId,
    archetypeId: figure.archetypeId,
    name: figure.name,
    authoredShardId: figure.holdsShardId,
  }));

  const fallbackRoomIds = placeRooms.map((room) => room.id);
  const authoredClueIds = new Set(
    artifact.rooms.flatMap((room) =>
      room.hotspots
        .map((hotspot) => hotspot.clueId)
        .filter((id): id is string => id !== null),
    ),
  );
  const figureShards = new Set(
    artifact.figures
      .map((figure) => figure.holdsShardId)
      .filter((id): id is string => id !== null),
  );
  const authoredClueRooms = placeRooms
    .filter((room) => room.tags.includes("clue-compatible"))
    .map((room) => room.id);
  const clueRooms =
    authoredClueRooms.length > 0 ? authoredClueRooms : fallbackRoomIds;
  const clues: InterestSlot[] = artifact.content.clues
    .filter((clue) => {
      if (authoredClueIds.has(clue.id)) return false;
      const shardId = shardIdForClue(clue.id);
      return shardId === null || !figureShards.has(shardId);
    })
    .map((clue, index) => ({
      id: `clue-interest-${clue.id}`,
      roomId:
        clueRooms[index % Math.max(1, clueRooms.length)] ??
        artifact.spawn.roomId,
      clueId: clue.id,
      sensorySeed: clue.sensorySeed,
    }));
  const ambient: InterestSlot[] = placeRooms
    .slice(0, 12)
    .map((room, index) => ({
      id: `interest-${index + 1}`,
      roomId: room.id,
      clueId: null,
      sensorySeed: null,
    }));
  return { figures, interests: [...clues, ...ambient] };
}

function dealHomes(
  artifact: DreamArtifact,
  slots: FigureSlot[],
  proposal: PopulationProposal | null,
  options: PopulationOptions,
): Map<string, string> {
  const rooms = artifact.rooms.filter(
    (room) => room.kind === "place" && room.figureSlots.length > 0,
  );
  const capacity = new Map(
    rooms.map((room) => [room.id, room.figureSlots.length]),
  );
  const used = new Map(rooms.map((room) => [room.id, 0]));
  const rng = options.shuffle
    ? makeRng(options.seed ?? `deal:${artifact.slug}:${Date.now()}`)
    : null;
  const homes = new Map<string, string>();

  const claim = (preferred: string | undefined, fallback: string): string => {
    const order = [preferred, fallback, ...rooms.map((room) => room.id)].filter(
      (id): id is string => !!id && capacity.has(id),
    );
    for (const id of order) {
      if ((used.get(id) ?? 0) < (capacity.get(id) ?? 1)) {
        used.set(id, (used.get(id) ?? 0) + 1);
        return id;
      }
    }
    return fallback;
  };

  const pinOf = (id: string) =>
    pinnedHome(artifact, id, { dryWallet: options.dryWallet });
  const ordered = [
    ...slots.filter((slot) => pinOf(slot.id) !== null),
    ...slots.filter((slot) => pinOf(slot.id) === null),
  ];
  for (const slot of ordered) {
    const proposed = proposal?.figures.find((figure) => figure.id === slot.id);
    const pin =
      pinnedHome(artifact, slot.id, { dryWallet: options.dryWallet }) ??
      undefined;
    const rolled = !pin && rng ? rng.pick(rooms).id : undefined;
    homes.set(
      slot.id,
      claim(pin ?? proposed?.homeRoomId ?? rolled, pin ?? slot.homeRoomId),
    );
  }
  return homes;
}

function sanitiseRetargets(
  artifact: DreamArtifact,
  retargets: PopulationProposal["retargets"],
): DreamPopulation["retargets"] {
  const rooms = new Set(artifact.rooms.map((room) => room.id));
  // Rifts only, checked here as well as in `applyPatch`: the model is not trusted to be
  // polite about a staircase, and neither half of the pair is allowed to be the only one
  // that knows the rule.
  const rifts = new Set(
    artifact.rooms.flatMap((room) =>
      room.doors
        .filter((door) => door.threshold === "rift")
        .map((door) => door.id),
    ),
  );
  return (retargets ?? []).filter(
    (retarget) => rifts.has(retarget.doorId) && rooms.has(retarget.toRoomId),
  );
}

export function buildPopulation(
  artifact: DreamArtifact,
  proposal: PopulationProposal | null,
  source: DreamPopulation["source"],
  options: PopulationOptions = {},
): DreamPopulation {
  const slots = populationSlots(artifact);
  const proposedFigures = new Map(
    proposal?.figures.map((figure) => [figure.id, figure]),
  );
  const usedShards = new Set<string>();
  const homes = dealHomes(artifact, slots.figures, proposal, options);

  const figures: FigureProfile[] = slots.figures.map((slot) => {
    const proposed = proposedFigures.get(slot.id);
    const authored = artifact.content.characters.find(
      (character) => character.id === slot.id,
    );
    const authoredShard = slot.authoredShardId;
    const holdsShardId =
      authoredShard && !usedShards.has(authoredShard) ? authoredShard : null;
    if (holdsShardId) usedShards.add(holdsShardId);
    const homeRoomId = homes.get(slot.id) ?? slot.homeRoomId;
    const agendaRooms = (proposed?.agenda ?? []).map((stop) =>
      artifact.rooms.some(
        (room) => room.id === stop.roomId && room.kind === "place",
      )
        ? stop.roomId
        : homeRoomId,
    );
    return {
      id: slot.id,
      name: authored?.name ?? proposed?.name.trim().slice(0, 60) ?? slot.name,
      archetypeId: slot.archetypeId,
      homeRoomId,
      personality: authored?.personality ?? "Держится за привычный порядок.",
      role:
        authored?.role ??
        proposed?.role.trim().slice(0, 100) ??
        "следит за привычным порядком",
      voice:
        authored?.voice ??
        proposed?.voice.trim().slice(0, 120) ??
        "отвечает коротко, избегает прямых слов",
      desire:
        authored?.desire ??
        proposed?.desire.trim().slice(0, 140) ??
        "чтобы день повторился без перемен",
      fear:
        authored?.fear ??
        proposed?.fear.trim().slice(0, 140) ??
        "заметить в знакомом месте чужого",
      taboo:
        authored?.taboo ??
        proposed?.taboo.trim().slice(0, 140) ??
        "не говорит о внешнем мире",
      holdsShardId,
      agenda: (["early", "middle", "late"] as const).map((phase, index) => ({
        phase,
        roomId: agendaRooms[index] ?? homeRoomId,
        activity: authored?.initialActivity ?? "занят привычным делом",
      })),
    };
  });

  const objectShards = new Set(
    artifact.rooms
      .flatMap((room) =>
        room.hotspots
          .map((hotspot) => hotspot.clueId)
          .filter((id): id is string => id !== null),
      )
      .map((clueId) => shardIdForClue(clueId))
      .filter((id): id is string => id !== null),
  );
  for (const shard of artifact.shards) {
    if (usedShards.has(shard.id) || objectShards.has(shard.id)) continue;
    const receiver = figures.find((figure) => figure.holdsShardId === null);
    if (!receiver) break;
    receiver.holdsShardId = shard.id;
    usedShards.add(shard.id);
  }

  const proposedInterests = new Map(
    proposal?.interests.map((interest) => [interest.id, interest]),
  );
  const interests: InterestSeed[] = slots.interests.map((slot, index) => {
    const proposed = proposedInterests.get(slot.id);
    const fallback = FALLBACK_INTERESTS[index % FALLBACK_INTERESTS.length]!;
    const proposedRoom =
      proposed?.roomId &&
      artifact.rooms.some(
        (room) => room.id === proposed.roomId && room.kind === "place",
      )
        ? proposed.roomId
        : slot.roomId;
    return {
      id: slot.id,
      roomId: proposedRoom,
      name: slot.clueId
        ? "Неуместный предмет"
        : proposed?.name.trim().slice(0, 70) || fallback[0],
      sensorySeed:
        slot.sensorySeed ??
        proposed?.sensorySeed.trim().slice(0, 220) ??
        fallback[1],
      solid: proposed?.solid ?? index % 3 === 0,
      holdsShardId: null,
      clueId: slot.clueId,
    };
  });

  const roomMoods: Record<string, string> = {};
  for (const room of artifact.rooms) {
    const authored = `${room.atmosphere} ${room.personality}`.trim();
    roomMoods[room.id] =
      authored.length > 1
        ? authored.slice(0, 140)
        : proposal?.roomMoods[room.id]?.trim().slice(0, 140) ||
          `${room.name}: воздух кажется чуть тяжелее, чем должен.`;
  }
  return {
    figures,
    interests,
    roomMoods,
    retargets: sanitiseRetargets(artifact, proposal?.retargets),
    assignments: dealPlaces(artifact, options),
    source,
  };
}

/**
 * Deal the places onto the rooms.
 *
 * A seeded shuffle rather than a model call: the model gets to decide where *people* and
 * *things* go, but which place is behind which door is a permutation, and a permutation
 * is exactly the kind of thing that should not depend on a network round trip.
 *
 * Two rooms stay where they are, and both are load-bearing:
 *
 *   - the spawn. §19's courtyard is «безопасная комната. Единственная», and a run that
 *     opens somewhere else opens with the sanitar already in trouble.
 *   - the finale. The Eye is the last door, and it is pinned to that room by
 *     `homeRoomFor`, so moving the room out from under it would put the ending
 *     somewhere nobody was sent.
 *
 * Meta-spaces never move either: their picture is `backdropFit: "screen"`, they are the
 * gaps between places rather than places, and swapping two of them would mean nothing.
 */
function dealPlaces(
  artifact: DreamArtifact,
  options: PopulationOptions,
): RoomAssignment[] {
  const movable = artifact.rooms
    .filter(
      (room) =>
        room.kind === "place" &&
        room.id !== artifact.spawn.roomId &&
        room.id !== artifact.finaleRoomId,
    )
    .map((room) => room.id);
  if (movable.length < 2) return [];

  const dealt = options.shuffle
    ? makeRng(`places:${options.seed ?? artifact.secretHash}`).shuffle(movable)
    : movable;
  return movable.map((roomId, index) => ({
    roomId,
    cardId: dealt[index] ?? roomId,
  }));
}

/** Instant offline deal. Used by training and by a live inhabit that failed. */
export function fallbackPopulation(
  artifact: DreamArtifact,
  options: PopulationOptions = { shuffle: true },
): DreamPopulation {
  return buildPopulation(artifact, null, "fallback", options);
}
