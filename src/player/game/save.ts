/** A single atomic local checkpoint. No network or unload-only dependency. */
import { createWorldMind, type WorldMindState } from "../../shared/world-mind";
import { migrateWorldObjects } from "./object-migration";
import { migrateArchitectureSave } from "./save-art-migration";
import type { DreamArtifact } from "../../shared/dream";
import type { PlayerActionLine } from "../../shared/ai";
import type { DirectorSnapshot } from "../../shared/director";
import type { NpcAutonomySnapshot } from "../mind/npc-autonomy";
import type { NpcRoutinesSnapshot } from "./npc-routines";
import {
  LEGACY_SON_PACK_FINGERPRINTS,
  SON_LIVING_PACK_FINGERPRINT,
  SON_ARCHITECTURE_PACK_FINGERPRINT,
  SON_ART_PREVIEW_PACK_FINGERPRINTS,
} from "../../shared/legacy-dream-packs";
import { cloneObject } from "../../shared/world-object";
import type { Cycle, JournalEntry } from "./cycle";
import type { DreamSession } from "./session";
import type { WordNotebook } from "./wordNotebook";
import type { MindMemory } from "../mind/memory";
import type { RemoteMind } from "../mind/remote";
import type { Observation } from "../mind/observation";
import type { FinalePanel } from "../ui/finale";
import {
  buildDoorIndexes,
  rebuildObjectIndex,
  type FigureState,
  type WorldState,
} from "./world";

type SavedWorld = Omit<
  WorldState,
  | "artifact"
  | "roomById"
  | "doorById"
  | "roomIdByDoorId"
  | "objectById"
  | "worldMind"
> & { worldMind?: WorldMindState };

export interface RunSave {
  world: SavedWorld;
  session: ReturnType<DreamSession["snapshot"]>;
  cycle: ReturnType<Cycle["snapshot"]>;
  observations: Observation;
  heartbeatCalls: number;
  memory: ReturnType<MindMemory["snapshot"]>;
  journal: readonly JournalEntry[];
  notebook: ReturnType<WordNotebook["snapshot"]>;
  conversations: ReturnType<RemoteMind["snapshotFigures"]>;
  commands?: PlayerActionLine[];
  director?: DirectorSnapshot;
  npcAutonomy?: NpcAutonomySnapshot;
  npcRoutines?: NpcRoutinesSnapshot;
  mode?: "live" | "training";
  ending: ReturnType<FinalePanel["snapshotEnding"]>;
}

export function snapshotWorld(world: WorldState): SavedWorld {
  const { artifact, roomById, doorById, roomIdByDoorId, objectById, ...state } =
    world;
  void artifact;
  void roomById;
  void doorById;
  void roomIdByDoorId;
  void objectById;
  return state;
}

/**
 * Repair checkpoints written before meta-spaces were made empty.
 *
 * A led figure can be present in an older save even though current movement rejects
 * meta-space destinations. Keeping that stale location would resurrect a conversation
 * target in a room that cannot host one, so put it back on its authored/population home
 * (or another free authored slot) before the session resumes.
 */
function repairMetaFigureLocations(world: WorldState): void {
  const authored = new Map(
    world.artifact.figures.map((figure) => [figure.id, figure]),
  );

  const repair = (figures: FigureState[]): void => {
    const occupied = new Set<string>();
    for (const figure of figures) {
      const room = world.roomById.get(figure.roomId);
      if (!room || room.kind === "meta") continue;
      if (room.figureSlots.some((slot) => slot.id === figure.slotId)) {
        occupied.add(`${room.id}:${figure.slotId}`);
      }
    }

    for (let index = figures.length - 1; index >= 0; index--) {
      const figure = figures[index]!;
      const current = world.roomById.get(figure.roomId);
      if (current && current.kind !== "meta") continue;

      const base = world.baseFigures.find(
        (candidate) => candidate.id === figure.id,
      );
      const original = authored.get(figure.id);
      const preferredRoomIds = [base?.roomId, original?.roomId].filter(
        (roomId, first, all): roomId is string =>
          Boolean(roomId) && all.indexOf(roomId) === first,
      );
      const candidates = [
        ...preferredRoomIds,
        ...world.rooms.map((room) => room.id),
      ];
      const preferredSlotId = base?.slotId ?? original?.slotId;
      let placement: {
        room: (typeof world.rooms)[number];
        slot: (typeof world.rooms)[number]["figureSlots"][number];
      } | null = null;
      for (const roomId of candidates) {
        const room = world.roomById.get(roomId);
        if (!room || room.kind === "meta") continue;
        const slot =
          (preferredSlotId &&
            room.figureSlots.find(
              (candidate) =>
                candidate.id === preferredSlotId &&
                !occupied.has(`${room.id}:${candidate.id}`),
            )) ??
          room.figureSlots.find(
            (candidate) => !occupied.has(`${room.id}:${candidate.id}`),
          );
        if (slot) {
          placement = { room, slot };
          break;
        }
      }

      if (!placement) {
        figures.splice(index, 1);
        continue;
      }
      figure.roomId = placement.room.id;
      figure.slotId = placement.slot.id;
      figure.x = placement.slot.x;
      figure.y = placement.slot.y;
      figure.targetX = null;
      figure.targetY = null;
      figure.walking = false;
      figure.revision = Number.isFinite(figure.revision)
        ? figure.revision + 1
        : 1;
      occupied.add(`${placement.room.id}:${placement.slot.id}`);
    }
  };

  repair(world.baseFigures);
  repair(world.figures);
}

/** Restore before resuming simulation, preserving the world and room references. */
export function restoreWorld(world: WorldState, state: SavedWorld): void {
  const { rooms, worldMind, ...rest } = state;
  Object.assign(world, rest);
  world.worldMind = worldMind ? structuredClone(worldMind) : createWorldMind();
  for (const saved of rooms)
    Object.assign(world.roomById.get(saved.id)!, saved);
  repairMetaFigureLocations(world);
  // Container capabilities were added without relocating authored objects. Upgrade
  // old checkpoints in place, preserving everything the player changed or carries.
  const containers = new Map(
    migrateWorldObjects(world.artifact.rooms)
      .filter((object) => object.tags.includes("container"))
      .map((object) => [object.id, object]),
  );
  for (const object of [...world.objects, ...world.baseObjects]) {
    const authored = containers.get(object.id);
    if (!authored) continue;
    if (!object.tags.includes("container")) object.tags.push("container");
    for (const affordance of authored.affordances)
      if (!object.affordances.includes(affordance))
        object.affordances.push(affordance);
    if (object.state.open === undefined)
      object.state.open = authored.state.open;
  }
  world.roleRecognition ??= {};
  Object.assign(world, buildDoorIndexes(world.rooms));
  rebuildObjectIndex(world);
}

function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Map
      ? { $save: "map", value: [...item] }
      : item instanceof Set
        ? { $save: "set", value: [...item] }
        : item,
  );
}

function decode(value: string): unknown {
  return JSON.parse(value, (_key, item) => {
    if (item && item.$save === "map") return new Map(item.value);
    if (item && item.$save === "set") return new Set(item.value);
    return item;
  });
}

/** Detect damaged payloads and changed packs; not a security signature. */
function fingerprint(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

const LIVING_NEW_OBJECT_IDS = new Set([
  "riukzak-folded-cloth",
  "riukzak-fruit",
  "riukzak-vodka",
  "outfit-hudozhnik",
  "outfit-lysyi",
  "outfit-ded-slava",
  "school-pear-case",
  "hackathon-glass-case",
  "guard-belt-anchor",
  "cruiser-microphone-stand",
]);
const LIVING_NEW_DOOR_IDS = new Set([
  "10-komnata-s-grobami--secret-tkan-s-kodami",
  "05-shesterochka--secret-polka-dlia-veschei",
  "15-osennii-les-s-grobom--secret-grob",
  "m9-shkaf--secret-shkaf",
]);

/** Only reached after exact source/target and checksum validation. No old object is respawned. */
function migrateLivingSave(save: RunSave, artifact: DreamArtifact): void {
  const authoredObjects = migrateWorldObjects(artifact.rooms);
  const byId = new Map(authoredObjects.map((object) => [object.id, object]));
  const originRooms = structuredClone(artifact.rooms);
  for (const room of originRooms)
    for (const prop of room.props) delete prop.inside;
  const origins = new Map(
    migrateWorldObjects(originRooms).map((object) => [
      object.id,
      object.location,
    ]),
  );
  for (const list of [save.world.objects, save.world.baseObjects]) {
    for (const object of list) {
      const authored = byId.get(object.id);
      if (!authored?.profile) continue;
      const origin = origins.get(object.id);
      const atOrigin =
        object.location.kind === "room" &&
        origin?.kind === "room" &&
        object.location.roomId === origin.roomId &&
        object.location.x === origin.x &&
        object.location.y === origin.y;
      const priorAttachment = object.state.attachedTo;
      object.profile = structuredClone(authored.profile);
      object.mobility = authored.mobility;
      object.affordances = [...authored.affordances];
      object.tags = [...new Set([...object.tags, ...authored.tags])];
      object.state = { ...structuredClone(authored.state), ...object.state };
      if (
        !atOrigin &&
        authored.profile.attachment &&
        priorAttachment === undefined
      )
        object.state.attachedTo = null;
      if (atOrigin && authored.location.kind === "inside")
        object.location = { ...authored.location };
      object.visual = { ...object.visual, ...authored.visual };
      if (object.interaction)
        object.interaction.refusal = authored.interaction?.refusal ?? null;
    }
    const present = new Set(list.map((object) => object.id));
    for (const object of authoredObjects) {
      if (!LIVING_NEW_OBJECT_IDS.has(object.id) || present.has(object.id))
        continue;
      // A removed container remains removed; do not introduce orphaned contents.
      if (object.location.kind === "inside") {
        const parentId = object.location.objectId;
        const parent = list.find((candidate) => candidate.id === parentId);
        if (!parent || parent.location.kind === "removed") continue;
      }
      list.push(cloneObject(object));
      present.add(object.id);
    }
  }
  const authoredRooms = new Map(artifact.rooms.map((room) => [room.id, room]));
  for (const room of save.world.rooms) {
    const authored = authoredRooms.get(room.id);
    if (!authored) continue;
    for (const prop of room.props) {
      const next = authored.props.find((candidate) => candidate.id === prop.id);
      if (next?.profile) prop.profile = structuredClone(next.profile);
      if (next?.openImage) prop.openImage = next.openImage;
    }
    const props = new Set(room.props.map((prop) => prop.id));
    for (const prop of authored.props)
      if (LIVING_NEW_OBJECT_IDS.has(prop.id) && !props.has(prop.id))
        room.props.push(structuredClone(prop));
    const hotspots = new Set(room.hotspots.map((hotspot) => hotspot.id));
    for (const hotspot of authored.hotspots) {
      const previous = room.hotspots.find(
        (candidate) => candidate.id === hotspot.id,
      );
      if (previous && hotspot.profile)
        previous.profile = structuredClone(hotspot.profile);
      if (previous) previous.refusal = hotspot.refusal;
      if (
        LIVING_NEW_OBJECT_IDS.has(hotspot.propId ?? hotspot.id) &&
        !hotspots.has(hotspot.id)
      )
        room.hotspots.push(structuredClone(hotspot));
    }
    const doors = new Set(room.doors.map((door) => door.id));
    for (const door of authored.doors)
      if (LIVING_NEW_DOOR_IDS.has(door.id) && !doors.has(door.id))
        room.doors.push(structuredClone(door));
  }
  save.world.roleRecognition ??= {};
}

export class RunStore {
  readonly key: string;
  private readonly pack: string;
  private readonly priorContainerPack: string;

  // Use the unlocalized artifact so switching language does not invalidate a run.
  constructor(
    private readonly artifact: DreamArtifact,
    private readonly storage: () => Pick<Storage, "getItem" | "setItem"> = () =>
      localStorage,
  ) {
    this.key = `dreamwalker.run.${artifact.slug}`;
    this.pack = fingerprint(JSON.stringify(artifact));
    const beforeContainers = structuredClone(artifact);
    for (const room of beforeContainers.rooms)
      for (const prop of room.props) delete prop.container;
    this.priorContainerPack = fingerprint(JSON.stringify(beforeContainers));
  }

  load(artifact: DreamArtifact): {
    save: RunSave | null;
    unavailable: boolean;
  } {
    try {
      const raw = this.storage().getItem(this.key);
      if (!raw) return { save: null, unavailable: false };
      const envelope = JSON.parse(raw);
      const architectureMigration =
        this.artifact.slug === "son" &&
        this.pack === SON_ARCHITECTURE_PACK_FINGERPRINT &&
        (envelope.pack === SON_LIVING_PACK_FINGERPRINT ||
          SON_ART_PREVIEW_PACK_FINGERPRINTS.some(
            (value) => value === envelope.pack,
          ) ||
          LEGACY_SON_PACK_FINGERPRINTS.some(
            (value) => value === envelope.pack,
          ));
      const livingMigration =
        this.artifact.slug === "son" &&
        (this.pack === SON_LIVING_PACK_FINGERPRINT || architectureMigration) &&
        LEGACY_SON_PACK_FINGERPRINTS.some((value) => value === envelope.pack);
      if (
        envelope.version !== 1 ||
        (envelope.pack !== this.pack &&
          envelope.pack !== this.priorContainerPack &&
          !livingMigration &&
          !architectureMigration) ||
        typeof envelope.payload !== "string" ||
        fingerprint(envelope.payload) !== envelope.checksum
      ) {
        return { save: null, unavailable: true };
      }
      const save = decode(envelope.payload) as RunSave;
      const ids = new Set(artifact.rooms.map((room) => room.id));
      if (
        !save ||
        !save.world ||
        !ids.has(save.world.currentRoomId) ||
        save.world.rooms.length !== ids.size ||
        new Set(save.world.rooms.map((room) => room.id)).size !== ids.size ||
        save.world.rooms.some(
          (room) =>
            !ids.has(room.id) || !(room.closedHotspotIds instanceof Set),
        ) ||
        !(save.world.flags instanceof Map) ||
        !(save.world.keysHeld instanceof Set) ||
        !(save.conversations instanceof Map) ||
        !(save.session.dwellMs instanceof Map) ||
        !Number.isFinite(save.session.player.x) ||
        !Number.isFinite(save.session.player.y) ||
        !["n", "s", "e", "w"].includes(save.session.player.facing) ||
        !Number.isInteger(save.cycle.number) ||
        save.cycle.number < 1 ||
        !Number.isFinite(save.cycle.remainingMs) ||
        !Array.isArray(save.journal) ||
        !Array.isArray(save.notebook.words) ||
        !Array.isArray(save.memory.memories) ||
        (save.session.meta && !ids.has(save.session.meta.returnTo.roomId))
      ) {
        return { save: null, unavailable: true };
      }
      if (livingMigration) migrateLivingSave(save, this.artifact);
      if (architectureMigration) migrateArchitectureSave(save, this.artifact);
      return { save, unavailable: false };
    } catch {
      return { save: null, unavailable: true };
    }
  }

  write(save: RunSave): boolean {
    try {
      const payload = encode(save);
      // setItem is atomic: a quota failure keeps the previous complete checkpoint.
      this.storage().setItem(
        this.key,
        JSON.stringify({
          version: 1,
          pack: this.pack,
          checksum: fingerprint(payload),
          payload,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
