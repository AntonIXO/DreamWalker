/** A single atomic local checkpoint. No network or unload-only dependency. */
import { createWorldMind, type WorldMindState } from "../../shared/world-mind";
import { migrateWorldObjects } from "./object-migration";
import type { DreamArtifact } from "../../shared/dream";
import type { PlayerActionLine } from "../../shared/ai";
import type { Cycle, JournalEntry } from "./cycle";
import type { DreamSession } from "./session";
import type { WordNotebook } from "./wordNotebook";
import type { MindMemory } from "../mind/memory";
import type { RemoteMind } from "../mind/remote";
import type { Observation } from "../mind/observation";
import type { FinalePanel } from "../ui/finale";
import { buildDoorIndexes, rebuildObjectIndex, type WorldState } from "./world";

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

/** Restore before resuming simulation, preserving the world and room references. */
export function restoreWorld(world: WorldState, state: SavedWorld): void {
  const { rooms, worldMind, ...rest } = state;
  Object.assign(world, rest);
  world.worldMind = worldMind ? structuredClone(worldMind) : createWorldMind();
  for (const saved of rooms)
    Object.assign(world.roomById.get(saved.id)!, saved);
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

export class RunStore {
  readonly key: string;
  private readonly pack: string;
  private readonly priorContainerPack: string;

  // Use the unlocalized artifact so switching language does not invalidate a run.
  constructor(
    artifact: DreamArtifact,
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
      if (
        envelope.version !== 1 ||
        (envelope.pack !== this.pack &&
          envelope.pack !== this.priorContainerPack) ||
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
