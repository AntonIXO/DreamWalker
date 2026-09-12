/** Nearby figures trade a bounded witnessed fact; no model call or global broadcast. */
import type {
  EpisodicMemory,
  MemoryEpisode,
} from "../../shared/episodic-memory";
import { canObserveWorldPose } from "../../shared/world-mind";
import type { ActorPose } from "../../shared/world-object";
import { fateOf } from "../game/fates";
import type { FigureState, WorldState } from "../game/world";
import { bindWorldMutator, staticPlayerPose } from "../game/world-mutator";

export const RUMOR_INTERVAL_SECONDS = 5;
export const RUMOR_PAIR_COOLDOWN_SECONDS = 60;
export const RUMOR_HEARING_DISTANCE = 4;
const MAX_SEEN_ORIGINS = 4096;
const MAX_COOLDOWNS = 256;
const MAX_ID_LENGTH = 160;

export interface RumorDelivery {
  speakerId: string;
  listenerId: string;
  text: string;
  heardByPlayer: boolean;
  originId: string;
}

interface PairCooldown {
  firstId: string;
  secondId: string;
  until: number;
}

interface KnownOrigin {
  figureId: string;
  originId: string;
}

interface RumorSnapshot {
  cycle: number | null;
  clockSeconds: number;
  elapsedSeconds: number;
  cooldowns: PairCooldown[];
  seenOrigins: KnownOrigin[];
}

interface Candidate {
  speaker: FigureState;
  listener: FigureState;
  source: MemoryEpisode;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function identifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function finiteTime(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value < Number.MAX_SAFE_INTEGER / 2
  );
}

function pairKey(first: string, second: string): string {
  return JSON.stringify([first, second].sort());
}

function originKey(figureId: string, originId: string): string {
  return JSON.stringify([figureId, originId]);
}

function brief(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  const prefix = compact.slice(0, limit - 1);
  const end = prefix.lastIndexOf(" ");
  return `${prefix.slice(0, end > limit / 2 ? end : undefined)}…`;
}

function compareSources(a: MemoryEpisode, b: MemoryEpisode): number {
  const priority = (entry: MemoryEpisode) => (entry.kind === "action" ? 1 : 0);
  return priority(b) - priority(a) || b.sequence - a.sequence;
}

/** Scheduling state is checkpointed; a reload does not repeat a just-heard rumor. */
export class RumorExchange {
  private cycle: number | null = null;
  private clockSeconds = 0;
  private elapsedSeconds = 0;
  private readonly cooldowns = new Map<string, PairCooldown>();
  private readonly seenOrigins = new Map<string, KnownOrigin>();

  constructor(private readonly episodes: EpisodicMemory) {}

  reset(): void {
    this.cycle = null;
    this.clockSeconds = 0;
    this.elapsedSeconds = 0;
    this.cooldowns.clear();
    this.seenOrigins.clear();
  }

  /** The owner revokes episode access before starting a figure's new incarnation. */
  forgetFigure(id: string): void {
    for (const [key, entry] of this.cooldowns) {
      if (entry.firstId === id || entry.secondId === id)
        this.cooldowns.delete(key);
    }
    for (const [key, entry] of this.seenOrigins) {
      if (entry.figureId === id) this.seenOrigins.delete(key);
    }
  }

  snapshot(): RumorSnapshot {
    return structuredClone({
      cycle: this.cycle,
      clockSeconds: this.clockSeconds,
      elapsedSeconds: this.elapsedSeconds,
      cooldowns: [...this.cooldowns.values()],
      seenOrigins: [...this.seenOrigins.values()],
    });
  }

  restore(value: unknown): void {
    this.reset();
    const data = record(value);
    if (
      !data ||
      !Number.isSafeInteger(data.cycle) ||
      (data.cycle as number) < 1 ||
      !finiteTime(data.clockSeconds) ||
      !finiteTime(data.elapsedSeconds)
    )
      return;
    this.cycle = data.cycle as number;
    this.clockSeconds = data.clockSeconds;
    this.elapsedSeconds = Math.min(data.elapsedSeconds, RUMOR_INTERVAL_SECONDS);
    if (Array.isArray(data.cooldowns)) {
      for (const item of data.cooldowns.slice(-MAX_COOLDOWNS)) {
        const pair = record(item);
        if (
          !pair ||
          !identifier(pair.firstId) ||
          !identifier(pair.secondId) ||
          pair.firstId === pair.secondId ||
          !finiteTime(pair.until) ||
          pair.until <= this.clockSeconds
        )
          continue;
        const entry = {
          firstId: pair.firstId,
          secondId: pair.secondId,
          until: Math.min(
            pair.until,
            this.clockSeconds + RUMOR_PAIR_COOLDOWN_SECONDS,
          ),
        };
        this.cooldowns.set(pairKey(entry.firstId, entry.secondId), entry);
      }
    }
    if (Array.isArray(data.seenOrigins)) {
      for (const item of data.seenOrigins.slice(-MAX_SEEN_ORIGINS)) {
        const known = record(item);
        if (known && identifier(known.figureId) && identifier(known.originId))
          this.rememberOrigin(known.figureId, known.originId);
      }
    }
  }

  tick(
    world: WorldState,
    playerPose: ActorPose,
    cycle: number,
    deltaSeconds: number,
    paused = false,
  ): RumorDelivery | null {
    if (!Number.isSafeInteger(cycle) || cycle < 1) return null;
    if (this.cycle !== cycle) {
      this.reset();
      this.cycle = cycle;
    }
    if (paused || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0)
      return null;
    this.clockSeconds += deltaSeconds;
    this.elapsedSeconds += deltaSeconds;
    if (this.elapsedSeconds < RUMOR_INTERVAL_SECONDS) return null;
    // A delayed frame gets one opportunity, never a burst of queued conversations.
    this.elapsedSeconds = 0;
    for (const [key, pair] of this.cooldowns) {
      if (pair.until <= this.clockSeconds) this.cooldowns.delete(key);
    }

    const figures = world.figures.filter((figure) => {
      const fate = fateOf(world, figure.id);
      return fate !== "dead" && fate !== "gone" && fate !== "broken";
    });
    const mutator = bindWorldMutator(world, staticPlayerPose(playerPose));
    const canHear = (listener: ActorPose, speaker: ActorPose): boolean =>
      listener.roomId === speaker.roomId &&
      Math.hypot(listener.x - speaker.x, listener.y - speaker.y) <=
        RUMOR_HEARING_DISTANCE &&
      canObserveWorldPose(mutator, listener, speaker);

    // All candidates use one frozen pre-delivery view. New knowledge cannot travel
    // through a chain of figures during this tick.
    const available = new Map<string, MemoryEpisode[]>();
    for (const id of ["player", ...figures.map((figure) => figure.id)]) {
      const knowledge = this.episodes
        .forObserver(id, cycle)
        .filter((entry) => entry.cycle === cycle);
      for (const entry of knowledge) {
        if (entry.originId) this.rememberOrigin(id, entry.originId);
      }
      available.set(id, knowledge);
    }
    const choices: Candidate[] = [];
    for (const speaker of figures) {
      const sources = (available.get(speaker.id) ?? [])
        .filter((entry) => this.canShare(entry, speaker.id, cycle))
        .sort(compareSources);
      if (!sources.length) continue;
      for (const listener of figures) {
        if (
          listener.id === speaker.id ||
          !canHear(listener, speaker) ||
          !canHear(speaker, listener) ||
          this.cooldowns.has(pairKey(speaker.id, listener.id))
        )
          continue;
        const source = sources.find(
          (entry) => !this.knows(listener.id, entry.originId!),
        );
        if (source) choices.push({ speaker, listener, source });
      }
    }
    choices.sort(
      (a, b) =>
        compareSources(a.source, b.source) ||
        a.speaker.id.localeCompare(b.speaker.id) ||
        a.listener.id.localeCompare(b.listener.id),
    );
    const chosen = choices[0];
    if (!chosen) return null;
    const { speaker, listener, source } = chosen;
    const provenance = source.provenance!;
    const originId = source.originId!;
    const hops = (provenance.hops + 1) as 1 | 2;
    const heardByPlayer = canHear(playerPose, speaker);
    const recipients = new Set(
      figures
        .filter(
          (figure) => figure.id !== speaker.id && canHear(figure, speaker),
        )
        .map((figure) => figure.id),
    );
    if (heardByPlayer) recipients.add("player");
    for (const id of recipients) {
      if (this.knows(id, originId)) continue;
      this.episodes.add({
        id: `rumor:${crypto.randomUUID()}`,
        cycle,
        kind: source.kind,
        text: source.text,
        roomIds: [...new Set([...source.roomIds, speaker.roomId])],
        entityIds: [...new Set([...source.entityIds, speaker.id])],
        observerIds: [id, "sleeper"],
        originId,
        subjectActorId: "player",
        shareable: true,
        provenance: {
          kind: "heard",
          originWitnessId: provenance.originWitnessId,
          speakerId: speaker.id,
          hops,
          acquiredRoomId: speaker.roomId,
          acquiredCycle: cycle,
        },
      });
      this.rememberOrigin(id, originId);
    }
    this.cooldowns.set(pairKey(speaker.id, listener.id), {
      firstId: speaker.id,
      secondId: listener.id,
      until: this.clockSeconds + RUMOR_PAIR_COOLDOWN_SECONDS,
    });
    while (this.cooldowns.size > MAX_COOLDOWNS)
      this.cooldowns.delete(this.cooldowns.keys().next().value!);
    const witnessName =
      world.figures.find((figure) => figure.id === provenance.originWitnessId)
        ?.name ??
      world.baseFigures.find(
        (figure) => figure.id === provenance.originWitnessId,
      )?.name ??
      provenance.originWitnessId;
    const attribution =
      provenance.kind === "heard"
        ? `Со слов ${brief(witnessName, 60)}: `
        : "Вот что я видел: ";
    return {
      speakerId: speaker.id,
      listenerId: listener.id,
      text: `${brief(speaker.name, 60)} — ${brief(listener.name, 60)}: «${attribution}${brief(source.text, 260)}»`,
      heardByPlayer,
      originId,
    };
  }

  private canShare(
    entry: MemoryEpisode,
    speakerId: string,
    cycle: number,
  ): boolean {
    const provenance = entry.provenance;
    return (
      entry.shareable === true &&
      entry.subjectActorId === "player" &&
      !!entry.originId &&
      (entry.kind === "action" || entry.kind === "movement") &&
      entry.cycle === cycle &&
      !!provenance &&
      provenance.acquiredCycle === cycle &&
      provenance.hops < 2 &&
      (provenance.kind === "heard" || provenance.originWitnessId === speakerId)
    );
  }

  private knows(figureId: string, originId: string): boolean {
    return this.seenOrigins.has(originKey(figureId, originId));
  }

  private rememberOrigin(figureId: string, originId: string): void {
    this.seenOrigins.set(originKey(figureId, originId), { figureId, originId });
    while (this.seenOrigins.size > MAX_SEEN_ORIGINS)
      this.seenOrigins.delete(this.seenOrigins.keys().next().value!);
  }
}
