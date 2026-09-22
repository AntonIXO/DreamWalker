/** Local agendas travel through doors; they never request an inference. */
import { pinnedHome } from "../../shared/population";
import { cellAt, isWalkableCell } from "../../shared/roomGrid";
import { createActionCause, type ActionCause } from "../../shared/world-action";
import { getActorOccupancy } from "../../shared/world-object";
import { fateOf } from "./fates";
import { planNpcRoute } from "./npc-action-queue";
import { NpcTaskCoordinator, type NpcTaskOwner } from "./npc-task-coordinator";
import { tileBlockedBySolids } from "./object-collision";
import {
  canPassDoor,
  doorDestination,
  type FigureState,
  type WorldState,
} from "./world";

interface PendingRoutine {
  figureId: string;
  phase: FigureState["agendaPhase"];
  roomId: string;
  activity: string;
  cause: ActionCause;
  /** A refusal sleeps until the route dependencies change. */
  blockedOn: string | null;
  remainingSeconds: number;
}

export interface NpcRoutinesSnapshot {
  pending: PendingRoutine[];
}

function phaseAt(progress: number): FigureState["agendaPhase"] {
  return progress < 1 / 3 ? "early" : progress < 2 / 3 ? "middle" : "late";
}

function ownerOf(pending: PendingRoutine): NpcTaskOwner {
  return { kind: "routine", id: pending.cause.taskId! };
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(36);
}

export class NpcRoutines {
  private readonly pending = new Map<string, PendingRoutine>();
  private readonly cellKeys = new WeakMap<string[], string>();

  constructor(
    private readonly world: WorldState,
    private readonly coordinator: NpcTaskCoordinator,
    private readonly options: { dryWallet?: boolean | (() => boolean) } = {},
  ) {}

  tick(
    cycleProgress: number,
    frozenFigureId: string | null = null,
    deltaSeconds = 0,
  ): void {
    const phase = phaseAt(cycleProgress);
    const elapsed = Math.max(
      0,
      Math.min(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0.1),
    );
    // The graph ignores actor animation/revision. Compute it only when a pending
    // route can actually be reconsidered, and share it across this tick's actors.
    let graphKey: string | undefined;
    const dependencies = (figure: FigureState): string => {
      graphKey ??= this.graphKey();
      return JSON.stringify([
        graphKey,
        figure.roomId,
        this.world.objects
          .filter(
            (object) =>
              object.keyId &&
              object.location.kind === "held" &&
              object.location.actor.kind === "figure" &&
              object.location.actor.id === figure.id,
          )
          .map((object) => object.keyId)
          .sort(),
      ]);
    };

    for (const figure of this.world.figures) {
      let pending = this.pending.get(figure.id);
      if (pending) {
        pending.remainingSeconds -= elapsed;
        if (pending.remainingSeconds <= 0) {
          this.pending.delete(figure.id);
          this.coordinator.cancel(figure.id, ownerOf(pending), "expired");
          figure.agendaPhase = pending.phase;
          continue;
        }
      }
      if (!this.eligible(figure)) {
        if (pending)
          this.coordinator.cancel(
            figure.id,
            ownerOf(pending),
            "routine interrupted",
          );
        this.pending.delete(figure.id);
        continue;
      }
      if (figure.id === frozenFigureId) continue;
      if (pending && pending.phase !== phase) {
        this.pending.delete(figure.id);
        this.coordinator.cancel(figure.id, ownerOf(pending), "agenda changed");
        pending = undefined;
      }
      if (this.coordinator.isBusy(figure.id)) continue;
      if (!pending) {
        if (figure.agendaPhase === phase) continue;
        const stop = figure.agenda.find((entry) => entry.phase === phase);
        const pin = this.pinnedRoom(figure.id);
        if (!stop || (pin !== null && stop.roomId !== pin)) {
          figure.agendaPhase = phase;
          continue;
        }
        // An in-room change of occupation does not require another walk or job.
        if (stop.roomId === figure.roomId) {
          figure.agendaPhase = phase;
          figure.activity = stop.activity;
          continue;
        }
        const cause = createActionCause("routine");
        cause.taskId = cause.rootId;
        pending = {
          figureId: figure.id,
          phase,
          roomId: stop.roomId,
          activity: stop.activity,
          cause,
          blockedOn: null,
          remainingSeconds: 180,
        };
        this.pending.set(figure.id, pending);
      }
      const dependencyKey = dependencies(figure);
      if (pending.blockedOn === dependencyKey) continue;
      const room = this.world.roomById.get(pending.roomId);
      const slots = [...(room?.figureSlots ?? [])].sort(
        (a, b) =>
          Number(b.id === figure.slotId) - Number(a.id === figure.slotId),
      );
      const slot =
        room?.kind !== "meta" && room
          ? slots.find(
              (entry) =>
                isWalkableCell(cellAt(room, entry.x, entry.y)) &&
                !tileBlockedBySolids(this.world, room.id, entry.x, entry.y),
            )
          : undefined;
      const actions = slot
        ? planNpcRoute(this.world, figure.id, {
            roomId: pending.roomId,
            x: slot.x,
            y: slot.y,
          })
        : null;
      if (!actions) {
        pending.blockedOn = dependencyKey;
        continue;
      }
      const job = pending;
      const accepted = this.coordinator.tryEnqueue(
        figure.id,
        ownerOf(job),
        actions,
        {
          cause: job.cause,
          lifetimeSeconds: job.remainingSeconds,
          beforeAction: () =>
            this.eligible(figure) &&
            (this.pinnedRoom(figure.id) ?? job.roomId) === job.roomId,
          onComplete: (result) => {
            if (this.pending.get(figure.id) !== job) return;
            if (result.ok) {
              figure.activity = job.activity;
              this.pending.delete(figure.id);
            } else if (result.refusal === "expired") {
              // A deadline is not a reason to start the same job again.
              this.pending.delete(figure.id);
            } else if (
              result.refusal?.startsWith("preempted") ||
              result.refusal === "conversation began" ||
              result.refusal === "cancelled"
            ) {
              job.blockedOn = null;
            } else {
              job.blockedOn = this.dependencyKey(figure);
            }
          },
        },
      );
      if (accepted) {
        figure.agendaPhase = phase;
        job.blockedOn = null;
      }
    }
  }

  snapshot(): NpcRoutinesSnapshot {
    return { pending: structuredClone([...this.pending.values()]) };
  }

  restore(snapshot?: NpcRoutinesSnapshot): void {
    this.clear();
    for (const pending of snapshot?.pending ?? []) {
      if (!this.world.figures.some((figure) => figure.id === pending.figureId))
        continue;
      if (!this.world.roomById.has(pending.roomId)) continue;
      this.pending.set(pending.figureId, {
        ...structuredClone(pending),
        remainingSeconds: Math.max(
          0,
          Math.min(
            Number.isFinite(pending.remainingSeconds)
              ? pending.remainingSeconds
              : 180,
            180,
          ),
        ),
      });
    }
  }

  clear(): void {
    const old = [...this.pending.values()];
    this.pending.clear();
    for (const pending of old)
      this.coordinator.cancel(pending.figureId, ownerOf(pending));
  }

  private eligible(figure: FigureState): boolean {
    const fate = fateOf(this.world, figure.id);
    return (
      figure.id !== "glaz" &&
      (fate === "present" || fate === "leveraged") &&
      !getActorOccupancy(this.world.objects, { kind: "figure", id: figure.id })
    );
  }

  private pinnedRoom(figureId: string): string | null {
    const dryWallet =
      typeof this.options.dryWallet === "function"
        ? this.options.dryWallet()
        : this.options.dryWallet;
    return pinnedHome(this.world.artifact, figureId, { dryWallet });
  }

  private dependencyKey(figure: FigureState): string {
    return JSON.stringify([
      this.graphKey(),
      figure.roomId,
      this.world.objects
        .filter(
          (object) =>
            object.keyId &&
            object.location.kind === "held" &&
            object.location.actor.kind === "figure" &&
            object.location.actor.id === figure.id,
        )
        .map((object) => object.keyId)
        .sort(),
    ]);
  }

  private graphKey(): string {
    const objectIds = new Set(this.world.objects.map((object) => object.id));
    return fingerprint(
      JSON.stringify([
        this.world.rooms.map((room) => {
          let cells = this.cellKeys.get(room.cells);
          if (cells === undefined) {
            cells = fingerprint(room.cells.join("\n"));
            this.cellKeys.set(room.cells, cells);
          }
          return [
            room.id,
            cells,
            room.figureSlots,
            room.props.filter(
              (prop) =>
                prop.solid &&
                !objectIds.has(prop.id) &&
                !objectIds.has(`${room.id}:${prop.id}`),
            ),
            room.doors.map((door) => [
              door.id,
              door.x,
              door.y,
              door.type,
              door.hidden,
              door.keyId,
              doorDestination(this.world, door),
              door.type === "keyLock" ? false : canPassDoor(this.world, door),
            ]),
          ];
        }),
        this.world.objects
          .filter(
            (object) => object.body?.solid && object.location.kind === "room",
          )
          .map((object) => [object.location, object.body]),
        this.world.interests
          .filter((interest) => !objectIds.has(interest.id))
          .map((interest) => [
            interest.roomId,
            Math.round(interest.x),
            Math.round(interest.y),
          ]),
      ]),
    );
  }
}
