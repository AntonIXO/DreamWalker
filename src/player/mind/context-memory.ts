/** Sample senses and routes; actual physical outcomes come from the action ledger. */
import { RETURNS_WHOLE } from "../../shared/verbs";
import { MAX_MEMORY_TEXT } from "../../shared/episodic-memory";
import { canObserveWorldPose } from "../../shared/world-mind";
import type {
  ActorPose,
  WorldMutator,
  WorldObjectState,
} from "../../shared/world-object";
import { bindWorldMutator, staticPlayerPose } from "../game/world-mutator";
import type { WorldState } from "../game/world";
import type { MindMemory } from "./memory";

interface SeenActor {
  id: string;
  name: string;
  pose: ActorPose;
}

interface SeenObject {
  pose: ActorPose;
  location: string;
}

const MAX_CHANGED_ENTITIES = 10;

function clipped(text: string, limit = 240): string {
  return text.trim().slice(0, limit);
}

function roomName(world: WorldState, roomId: string): string {
  return clipped(world.roomById.get(roomId)?.name ?? roomId, 120);
}

/** Hidden container contents have no visible pose, including in one's own bag. */
function objectView(
  object: WorldObjectState,
  world: WorldState,
  actors: Map<string, SeenActor>,
  seen = new Set<string>(),
): SeenObject | null {
  if (seen.has(object.id)) return null;
  seen.add(object.id);
  const location = object.location;
  if (location.kind === "room")
    return { pose: location, location: "в комнате" };
  if (location.kind === "held") {
    const holder = actors.get(
      location.actor.kind === "player" ? "player" : location.actor.id,
    );
    return holder ? { pose: holder.pose, location: `у ${holder.name}` } : null;
  }
  if (location.kind !== "inside") return null;
  const parent = world.objectById.get(location.objectId);
  if (!parent || parent.state.open !== true) return null;
  const parentView = objectView(parent, world, actors, seen);
  return parentView
    ? {
        pose: parentView.pose,
        location: `в открытом «${clipped(parent.name)}»`,
      }
    : null;
}

function objectDescription(object: WorldObjectState, location: string): string {
  const state = object.state;
  const details = [location];
  if (state.open !== undefined)
    details.push(state.open ? "открыто" : "закрыто");
  if (state.active !== undefined)
    details.push(state.active ? "включено" : "выключено");
  if (state.broken !== undefined)
    details.push(state.broken ? "сломано" : "целое");
  if (state.wet !== undefined) details.push(state.wet ? "мокрое" : "сухое");
  if (state.dirty !== undefined)
    details.push(state.dirty ? "грязное" : "чистое");
  if (state.inscription !== undefined)
    details.push(
      state.inscription
        ? `надпись: «${clipped(state.inscription)}»`
        : "без надписи",
    );
  // Lock policy, clue/shard bindings, tags and sensory seeds are not visible facts.
  return `«${clipped(object.name)}»: ${details.join(", ")}.`;
}

export class ContextMemory {
  private cycle: number | null = null;
  private runId: string | null = null;
  private actors = new Map<string, SeenActor>();
  private visibleActors = new Map<string, Set<string>>();
  private readonly visibleEntities = new Map<string, Map<string, string>>();
  private readonly signatures = new Map<string, Map<string, string>>();
  private readonly deaths = new Map<string, number>();

  constructor(private readonly memory: MindMemory) {}

  resetTracking(): void {
    this.cycle = null;
    this.runId = null;
    this.actors.clear();
    this.visibleActors.clear();
    this.visibleEntities.clear();
    this.signatures.clear();
    this.deaths.clear();
  }

  observe(world: WorldState, playerPose: ActorPose, cycle: number): void {
    this.memory.refreshFigureLives(world.fateHistory);
    if (this.cycle !== cycle || this.runId !== this.memory.runId) {
      this.resetTracking();
      this.cycle = cycle;
      this.runId = this.memory.runId;
    }
    const next = new Map<string, SeenActor>([
      [
        "player",
        {
          id: "player",
          name: "Санитар",
          pose: { ...playerPose },
        },
      ],
      ...world.figures.map((figure): [string, SeenActor] => [
        figure.id,
        {
          id: figure.id,
          name: clipped(figure.name, 120),
          pose: { roomId: figure.roomId, x: figure.x, y: figure.y },
        },
      ]),
    ]);
    const mutator = bindWorldMutator(world, staticPlayerPose(playerPose));

    for (const id of RETURNS_WHOLE) {
      const deaths = this.memory.figureLife(id);
      if (this.deaths.has(id) && this.deaths.get(id) !== deaths) {
        // A new incarnation has no route from its previous body's last room.
        this.actors.delete(id);
        this.visibleActors.delete(id);
        this.visibleEntities.delete(id);
        this.signatures.delete(id);
      }
      this.deaths.set(id, deaths);
    }

    const visible = new Map<string, Set<string>>();
    for (const observer of next.values()) {
      visible.set(
        observer.id,
        new Set(
          [...next.values()]
            .filter((actor) =>
              canObserveWorldPose(mutator, observer.pose, actor.pose),
            )
            .map((actor) => actor.id),
        ),
      );
    }

    for (const actor of next.values()) {
      const previous = this.actors.get(actor.id);
      if (previous && previous.pose.roomId !== actor.pose.roomId) {
        this.rememberMovement(world, actor, previous, next, visible, cycle);
      }
      this.rememberSenses(world, mutator, actor, next, visible, cycle);
    }
    this.actors = next;
    this.visibleActors = visible;
  }

  private rememberMovement(
    world: WorldState,
    actor: SeenActor,
    previous: SeenActor,
    actors: Map<string, SeenActor>,
    visible: Map<string, Set<string>>,
    cycle: number,
  ): void {
    const from = previous.pose.roomId;
    const to = actor.pose.roomId;
    const originId = `travel:${cycle}:${crypto.randomUUID()}`;
    const provenance = (witnessId: string, roomId: string) => ({
      kind: "observed" as const,
      originWitnessId: witnessId,
      speakerId: null,
      hops: 0 as const,
      acquiredRoomId: roomId,
      acquiredCycle: cycle,
    });
    this.memory.episodes.add({
      id: crypto.randomUUID(),
      cycle,
      kind: "movement",
      text: `${actor.name} перешёл из «${roomName(world, from)}» в «${roomName(world, to)}».`,
      roomIds: [from, to],
      entityIds: [actor.id],
      observerIds: ["sleeper", actor.id],
      originId,
      subjectActorId: actor.id,
      shareable: actor.id === "player",
      provenance: provenance(actor.id, to),
    });
    for (const witness of actors.values()) {
      if (witness.id === actor.id) continue;
      // A witness left behind knows disappearance, never the unseen destination.
      if (
        witness.pose.roomId === from &&
        this.actors.get(witness.id)?.pose.roomId === from &&
        this.visibleActors.get(witness.id)?.has(actor.id)
      ) {
        this.memory.episodes.add({
          id: crypto.randomUUID(),
          cycle,
          kind: "movement",
          text: `${witness.name} больше не видит ${actor.name} в «${roomName(world, from)}». Куда он ушёл, отсюда не видно.`,
          roomIds: [from],
          entityIds: [actor.id, witness.id],
          observerIds: [witness.id],
          originId,
          subjectActorId: actor.id,
          shareable: actor.id === "player",
          provenance: provenance(witness.id, from),
        });
      }
      if (visible.get(witness.id)?.has(actor.id)) {
        this.memory.episodes.add({
          id: crypto.randomUUID(),
          cycle,
          kind: "movement",
          text: `${witness.name} видит, что ${actor.name} появился в «${roomName(world, to)}». Откуда он пришёл, отсюда не видно.`,
          roomIds: [to],
          entityIds: [actor.id, witness.id],
          observerIds: [witness.id],
          originId,
          subjectActorId: actor.id,
          shareable: actor.id === "player",
          provenance: provenance(witness.id, to),
        });
      }
    }
  }

  private rememberSenses(
    world: WorldState,
    mutator: WorldMutator,
    observer: SeenActor,
    actors: Map<string, SeenActor>,
    visible: Map<string, Set<string>>,
    cycle: number,
  ): void {
    const known = this.signatures.get(observer.id) ?? new Map<string, string>();
    this.signatures.set(observer.id, known);
    const roomId = observer.pose.roomId;
    const enteredRoom = this.actors.get(observer.id)?.pose.roomId !== roomId;
    const room = world.roomById.get(roomId);
    if (!room) return;
    const title = roomName(world, roomId);
    const mood = clipped(
      world.population?.roomMoods[roomId] ?? room.atmosphere,
    );
    const place = `${title}\n${mood}`;
    const changes: Array<{ text: string; entityId?: string }> = [];
    const previousSeen = this.visibleEntities.get(observer.id);
    const seen = new Map<string, string>();
    if (known.get("room") !== `${roomId}:${place}`) {
      known.set("room", `${roomId}:${place}`);
      changes.push({
        text: `${observer.name} находится в «${title}».${mood ? ` ${mood}` : ""}`,
      });
    }
    const remember = (id: string, text: string): void => {
      const key = `${roomId}:${id}`;
      if (
        changes.length >= MAX_CHANGED_ENTITIES ||
        (!enteredRoom && known.get(key) === text)
      )
        return;
      known.set(key, text);
      changes.push({ text, entityId: id });
    };
    for (const id of visible.get(observer.id) ?? []) {
      if (id === observer.id) continue;
      const actor = actors.get(id)!;
      seen.set(id, actor.name);
      // An authored agenda is a habit, not something a witness can observe.
      remember(id, `Здесь виден ${actor.name}.`);
    }
    for (const object of world.objects) {
      const view = objectView(object, world, actors);
      if (view && canObserveWorldPose(mutator, observer.pose, view.pose)) {
        seen.set(object.id, clipped(object.name));
        remember(object.id, objectDescription(object, view.location));
      }
    }
    if (this.actors.get(observer.id)?.pose.roomId === roomId) {
      for (const [id, name] of previousSeen ?? []) {
        if (seen.has(id)) continue;
        known.delete(`${roomId}:${id}`);
        // Cross-room departures already have their own carefully scoped record.
        if (actors.has(id) && actors.get(id)!.pose.roomId !== roomId) continue;
        if (changes.length >= MAX_CHANGED_ENTITIES) break;
        changes.push({
          text: `«${name}» больше не видно отсюда.`,
          entityId: id,
        });
      }
    }
    this.visibleEntities.set(observer.id, seen);
    if (changes.length === 0) return;
    // Keep every accepted fact within the store's limit. Truncating one large scene
    // would mark its tail as remembered even though those facts were never stored.
    const prefix = `Наблюдение ${observer.name} в «${title}»: `;
    let text = prefix;
    let entityIds = [observer.id];
    const flush = (): void => {
      if (text === prefix) return;
      this.memory.episodes.add({
        id: crypto.randomUUID(),
        cycle,
        kind: "observation",
        text,
        roomIds: [roomId],
        entityIds,
        observerIds: ["sleeper", observer.id],
      });
      text = prefix;
      entityIds = [observer.id];
    };
    for (const change of changes) {
      if (text.length + change.text.length + 1 > MAX_MEMORY_TEXT) flush();
      text += `${text === prefix ? "" : " "}${change.text}`;
      if (change.entityId) entityIds.push(change.entityId);
    }
    flush();
  }
}
