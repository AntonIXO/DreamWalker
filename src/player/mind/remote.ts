import { getLocale, t } from "../../shared/i18n";
import type {
  AiStreamEvent,
  CycleExitRequestPayload,
  DialogueRequestPayload,
  DreamPopulation,
  ExamineRequestPayload,
  FinaleRequestPayload,
  FinaleResult,
  FigureTranscriptLine,
  FigureMemory,
  WorldSnapshot,
  WorldSnapshotObject,
  NpcExecutionFeedback,
  ActionRequestPayload,
  ActionResult,
  PlayerActionLine,
} from "../../shared/ai";
import type { ActorPose, WorldObjectState } from "../../shared/world-object";
import type { DreamArtifact } from "../../shared/dream";
import { fallbackPopulation } from "../../shared/population";
import { isMoneyHotspot, rollWallet } from "../../shared/wallet";
import { RETURNS_WHOLE } from "../../shared/verbs";
import {
  canObserveWorldPose,
  worldMindForFigure,
} from "../../shared/world-mind";
import { type WorldState } from "../game/world";
import { bindWorldMutator, staticPlayerPose } from "../game/world-mutator";
import { MindMemory } from "./memory";
import type { Observation } from "./observation";
import type {
  DreamMind,
  ExamineRequest,
  TurnRequest,
  TurnResponse,
} from "./types";
import { lookAt } from "../../../dreams/son/looks";

const REQUEST_TIMEOUT_MS = 25_000;
/** A dialogue can observe, preview, and act before producing its spoken reply. */
const DIALOGUE_TIMEOUT_MS = 60_000;
const INHABIT_TIMEOUT_MS = 20_000;
/** Spoken turns kept for the model. Two lines per exchange; this is the cycle. */
const TRANSCRIPT_LINES = 80;

export interface RemoteMindContext {
  observe?(): void;
  cycleNumber(): number;
  journal(): string[];
  playerPose?(): ActorPose | null;
}

class RemoteMindError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RemoteMindError";
  }
}

/**
 * The dream as the sleeper sees it.
 *
 * `forFigureId` is not a nicety. Кирилл «вернётся в следующей комнате целым и не
 * помнящим», and «Санитар, заметивший это вслух, палится мгновенно» — so nobody in the
 * dream may be told what happened to him. Enforced here rather than in the prompt,
 * because this is the strongest tell in the game and a sentence of instruction is not a
 * защита. The Eye is the exception, and cycle-exit gets the unfiltered list: the sleeper
 * is allowed to know.
 *
 * Player x/y lives on PlayerState, not WorldState. Callers that have the pose
 * should pass it; otherwise we fall back to the current room at (0, 0). UX/main
 * should pass the real pose into snapshot extras.
 */
export interface SnapshotExtras {
  playerPose?: ActorPose | null;
  objects?: WorldSnapshotObject[];
  worldRevision?: number;
}

function snapshotObjectOf(object: WorldObjectState): WorldSnapshotObject {
  return {
    interaction: object.interaction ? { ...object.interaction } : null,
    id: object.id,
    name: object.name,
    location: { ...object.location },
    mobility: object.mobility,
    affordances: [...object.affordances],
    state: { ...object.state },
    keyId: object.keyId,
    body: object.body ? { ...object.body } : null,
    clueId: object.clueId,
    holdsShardId: object.holdsShardId,
    tags: [...object.tags],
  };
}

export function snapshot(
  world: WorldState,
  mood: WorldSnapshot["mood"] = "upper-dynamic",
  forFigureId: string | null = null,
  extras?: SnapshotExtras,
): WorldSnapshot {
  const hidden = (figureId: string): boolean =>
    forFigureId !== null &&
    forFigureId !== "glaz" &&
    RETURNS_WHOLE.has(figureId);

  // Figures who are no longer in the world still belong in the snapshot. Splicing them
  // out of `world.figures` is what makes them gone; leaving them out of here would make
  // them never have existed, and then nobody could say «его нет там, где он был».
  const absent = [...world.fates.entries()]
    .filter(
      ([id]) =>
        !hidden(id) && !world.figures.some((figure) => figure.id === id),
    )
    .map(([id, record]) => ({
      id,
      name: world.baseFigures.find((figure) => figure.id === id)?.name ?? id,
      roomId: record.roomId,
      x: 0,
      y: 0,
      holdsShardId: null,
      role: "часть этого сна",
      personality: "",
      activity: "",
      record,
    }));

  return {
    worldMind:
      forFigureId === null
        ? structuredClone(world.worldMind.events)
        : worldMindForFigure(world.worldMind, forFigureId),
    geometry: Object.fromEntries(
      world.rooms.map((room) => [
        room.id,
        { width: room.width, height: room.height, cells: [...room.cells] },
      ]),
    ),
    keysHeld: [...world.keysHeld],
    rooms: world.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      kind: room.kind,
      personality: room.personality,
      visitCount: world.visitCounts.get(room.id) ?? 0,
      tags: room.tags,
    })),
    doors: [
      ...bindWorldMutator(world, staticPlayerPose(null)).doorById.values(),
    ],
    figures: [
      ...world.figures.map((figure) => ({
        id: figure.id,
        name: figure.name,
        roomId: figure.roomId,
        x: figure.x,
        y: figure.y,
        holdsShardId: figure.holdsShardId,
        role: figure.role,
        personality: figure.personality,
        activity: figure.activity,
        record: hidden(figure.id) ? null : (world.fates.get(figure.id) ?? null),
      })),
      ...absent,
    ].map(({ record, ...figure }) => ({
      ...figure,
      fate: record?.fate ?? "present",
      fateCycle: record?.cycle ?? null,
      fateRoomId: record?.roomId ?? null,
      fateQuoted: record?.quoted ?? null,
    })),
    interests: world.interests.map((interest) => ({
      id: interest.id,
      name: interest.name,
      roomId: interest.roomId,
      sensorySeed: interest.sensorySeed,
      holdsShardId: interest.holdsShardId,
      clueId: interest.clueId,
    })),
    fateHistory: world.fateHistory
      .filter((record) => !hidden(record.figureId))
      .map((record) => ({
        figureId: record.figureId,
        figureName:
          world.baseFigures.find((figure) => figure.id === record.figureId)
            ?.name ?? record.figureId,
        fate: record.fate,
        cycle: record.cycle,
        roomId: record.roomId,
      })),
    objects: extras?.objects ?? world.objects.map(snapshotObjectOf),
    player: extras?.playerPose ?? {
      roomId: world.currentRoomId,
      x: 0,
      y: 0,
    },
    worldRevision: extras?.worldRevision ?? world.revision,
    mood,
  };
}

async function streamRequest<T>(
  url: string,
  payload: unknown,
  signal: AbortSignal,
  onPartial?: (reply: string) => void,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  signal.throwIfAborted();
  if (!response.body)
    throw new RemoteMindError("internal", "Сон не вернул поток.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  let value: T | undefined;

  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as AiStreamEvent<T>;
    if (event.type === "partial") onPartial?.(event.reply);
    if (event.type === "result") value = event.value;
    if (event.type === "error") {
      throw new RemoteMindError(event.code, event.message);
    }
  };

  try {
    while (true) {
      const { value: chunk, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    consume(pending);
    signal.throwIfAborted();
    if (value === undefined) {
      throw new RemoteMindError("internal", "Сон оборвал ответ.");
    }
    return value;
  } finally {
    reader.releaseLock();
  }
}

export async function inhabitDream(
  slug: string,
  artifact: DreamArtifact,
  runId: string,
): Promise<DreamPopulation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INHABIT_TIMEOUT_MS);
  try {
    return await streamRequest<DreamPopulation>(
      "/api/ai/inhabit",
      { slug, runId, locale: getLocale() },
      controller.signal,
    );
  } catch (error) {
    console.warn("[mind] inhabit fell back to catalog deal:", error);
    return fallbackPopulation(artifact, {
      shuffle: true,
      seed: runId,
      dryWallet: rollWallet(slug, runId).wallet === "dry",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Server-backed mind. Dialogue is a per-figure AI SDK chat: spoken lines stay in
 * `figureMemories` for the cycle and go back as `messages`, not as a dump of the
 * last handful. Cycle reset still forgets them (`forgetFigures`).
 */
export class RemoteMind implements DreamMind {
  readonly name = "remote";
  private readonly figureMemories = new Map<string, FigureMemory>();
  private actionHistory: PlayerActionLine[] = [];
  private activeController: AbortController | null = null;
  private failures = 0;

  constructor(
    private readonly world: WorldState,
    readonly memory: MindMemory,
    private readonly context: RemoteMindContext,
    private readonly fallback: DreamMind,
  ) {}

  get waiting(): boolean {
    return this.activeController !== null;
  }

  get failureCount(): number {
    return this.failures;
  }

  private controller(timeoutMs = REQUEST_TIMEOUT_MS): AbortController {
    this.abort();
    const controller = new AbortController();
    const timeout = setTimeout(
      () =>
        controller.abort(
          new DOMException(
            "The dream took too long to answer.",
            "TimeoutError",
          ),
        ),
      timeoutMs,
    );
    controller.signal.addEventListener("abort", () => clearTimeout(timeout), {
      once: true,
    });
    this.activeController = controller;
    return controller;
  }

  private finish(controller: AbortController): void {
    if (!controller.signal.aborted) controller.abort();
    if (this.activeController === controller) this.activeController = null;
  }

  private failed(error: unknown, controller: AbortController): boolean {
    // A deadline is a transport failure and must trigger the advertised fallback.
    // Walking away or replacing a request must never execute a substitute action.
    const timedOut = controller.signal.reason?.name === "TimeoutError";
    if (controller.signal.aborted && !timedOut) return false;
    if (
      !timedOut &&
      error instanceof DOMException &&
      error.name === "AbortError"
    )
      return false;
    if (error instanceof RemoteMindError && error.code === "aborted")
      return false;
    this.failures++;
    console.warn("[mind] remote call failed:", error);
    return true;
  }

  async turn(
    request: TurnRequest,
    onPartial?: (reply: string) => void,
  ): Promise<TurnResponse> {
    this.refreshFigureLife(request.figureId);
    this.context.observe?.();
    const figureMemory = this.figureMemories.get(request.figureId) ?? {
      summary: "",
      lines: [],
    };
    const offeredMemory = this.memory.memory(request.offeredMemoryId);
    const controller = this.controller(DIALOGUE_TIMEOUT_MS);
    const payload: DialogueRequestPayload = {
      slug: this.world.artifact.slug,
      runId: this.memory.runId,
      cycleNumber: this.context.cycleNumber(),
      figureId: request.figureId,
      utterance: request.utterance,
      leverageOffered: request.leverageOffered ?? null,
      offeredMemory,
      figureMemory,
      knownShardIds: [...this.memory.knownShardIds],
      sleeper: this.memory.sleeper,
      world: snapshot(this.world, "upper-dynamic", request.figureId, {
        playerPose: this.context.playerPose?.() ?? null,
      }),
      exhaustion: this.world.exhaustion,
      locale: getLocale(),
      memories: this.memory.episodes.forObserver(
        request.figureId,
        this.context.cycleNumber(),
      ),
    };

    try {
      const result = await streamRequest<TurnResponse>(
        "/api/ai/dialogue",
        payload,
        controller.signal,
        onPartial,
      );
      this.rememberTurn(request, result, offeredMemory?.id ?? null);
      return result;
    } catch (error) {
      this.failed(error, controller);
      throw error;
    } finally {
      this.finish(controller);
    }
  }

  private rememberTurn(
    request: TurnRequest,
    result: TurnResponse,
    offeredMemoryId: string | null,
  ): void {
    const figureMemory = this.figureMemories.get(request.figureId) ?? {
      summary: "",
      lines: [],
    };
    figureMemory.lines.push(
      { speaker: "sanitar", text: request.utterance },
      { speaker: "figure", text: result.reply },
    );
    figureMemory.lines = figureMemory.lines.slice(-TRANSCRIPT_LINES);
    figureMemory.summary = result.figureMemorySummary.slice(-800);
    if (result.intent !== undefined) {
      figureMemory.intent = result.intent?.trim().slice(0, 240) || null;
    }
    this.figureMemories.set(request.figureId, figureMemory);
    if (RETURNS_WHOLE.has(request.figureId))
      figureMemory.deathCount = this.deathCount(request.figureId);
    this.rememberSpeech("player", request.utterance, request.figureId);
    this.rememberSpeech(request.figureId, result.reply);
    if (result.yieldedShardId) this.memory.learnShard(result.yieldedShardId);
    if (result.tell) {
      this.memory.addTell(
        this.context.cycleNumber(),
        request.figureId,
        result.tell.quoted,
      );
    }
    this.memory.addResidue(result.residueDelta);
    if (offeredMemoryId) this.memory.spendMemory(offeredMemoryId);
  }

  private refreshFigureLife(figureId: string): void {
    this.memory.refreshFigureLives(this.world.fateHistory);
    if (!RETURNS_WHOLE.has(figureId)) return;
    const deaths = this.deathCount(figureId);
    const memory = this.figureMemories.get(figureId);
    if (memory && (memory.deathCount ?? 0) !== deaths) {
      this.figureMemories.delete(figureId);
    }
  }

  private deathCount(figureId: string): number {
    return this.memory.figureLife(figureId);
  }

  /** Speech is evidence of what was said, never evidence of successful physics. */
  private rememberSpeech(
    speakerId: string,
    text: string,
    interlocutorId?: string,
  ): void {
    const player = this.context.playerPose?.() ?? {
      roomId: this.world.currentRoomId,
      x: 0,
      y: 0,
    };
    const speaker =
      speakerId === "player"
        ? player
        : this.world.figures.find((figure) => figure.id === speakerId);
    if (!speaker) return;
    const mutator = bindWorldMutator(this.world, staticPlayerPose(player));
    const observers = this.world.figures
      .filter(
        (figure) =>
          figure.id === interlocutorId ||
          figure.id === speakerId ||
          canObserveWorldPose(mutator, figure, speaker),
      )
      .map((figure) => figure.id);
    const playerHears =
      speakerId === "player" || canObserveWorldPose(mutator, player, speaker);
    const room = this.world.roomById.get(speaker.roomId);
    const name =
      speakerId === "player"
        ? "Санитар"
        : (this.world.figures.find((figure) => figure.id === speakerId)?.name ??
          speakerId);
    this.memory.episodes.add({
      id: `speech:${crypto.randomUUID()}`,
      cycle: this.context.cycleNumber(),
      kind: "dialogue",
      text: `В месте «${room?.name ?? speaker.roomId}» ${name} сказал: «${text.slice(0, 950)}». Это услышанная реплика; действия подтверждаются только квитанциями мира.`,
      roomIds: [speaker.roomId],
      entityIds: [speakerId, ...(interlocutorId ? [interlocutorId] : [])],
      observerIds: [
        "sleeper",
        ...(playerHears ? ["player"] : []),
        ...observers,
      ],
    });
  }

  private rememberExamination(request: ExamineRequest, reply: string): void {
    const roomId = request.roomId ?? this.world.currentRoomId;
    const objectId =
      request.objectId ?? request.interestId ?? request.hotspotId;
    const name = objectId
      ? (this.world.objectById.get(objectId)?.name ?? objectId)
      : "деталь";
    this.memory.episodes.add({
      id: `examine:${crypto.randomUUID()}`,
      cycle: this.context.cycleNumber(),
      kind: "observation",
      text: `Санитар осмотрел ${name} в месте «${this.world.roomById.get(roomId)?.name ?? roomId}»: ${reply}`,
      roomIds: [roomId],
      entityIds: objectId ? [objectId] : [],
      observerIds: ["player", "sleeper"],
    });
  }

  async examine(request: ExamineRequest) {
    this.context.observe?.();
    // Money hotspots go to the server even when a line is authored for them: the
    // sensory line there depends on the wallet, and the wallet lives only server-side.
    const looked =
      request.objectId || isMoneyHotspot(request.hotspotId)
        ? null
        : lookAt(request.hotspotId ?? null);
    if (looked) {
      this.rememberExamination(request, looked.reply);
      return looked;
    }
    const controller = this.controller();
    const payload: ExamineRequestPayload = {
      memories: this.memory.episodes.forObserver(
        "player",
        this.context.cycleNumber(),
      ),
      slug: this.world.artifact.slug,
      objectId: request.objectId ?? null,
      runId: this.memory.runId,
      cycleNumber: this.context.cycleNumber(),
      roomId: request.roomId,
      interestId: request.interestId,
      hotspotId: request.hotspotId ?? null,
      x: request.x,
      y: request.y,
      knownShardIds: [...this.memory.knownShardIds],
      // A thing is still part of the dream, and the dream does not notice what happened
      // to Кирилл either.
      world: snapshot(this.world, "upper-dynamic", "__thing__", {
        playerPose: this.context.playerPose?.() ?? null,
      }),
      locale: getLocale(),
    };
    try {
      const result = await streamRequest<
        Awaited<ReturnType<DreamMind["examine"]>>
      >("/api/ai/examine", payload, controller.signal);
      if (result.yieldedShardId) this.memory.learnShard(result.yieldedShardId);
      this.rememberExamination(request, result.reply);
      return result;
    } catch (error) {
      if (!this.failed(error, controller)) throw error;
      return this.fallback.examine(request);
    } finally {
      this.finish(controller);
    }
  }

  /** Free-form player intent is adjudicated against the same physical world as NPCs. */
  async act(
    utterance: string,
    selectedObjectId: string | null,
  ): Promise<ActionResult> {
    this.context.observe?.();
    const controller = this.controller(DIALOGUE_TIMEOUT_MS);
    const payload: ActionRequestPayload = {
      memories: this.memory.episodes.forObserver(
        "player",
        this.context.cycleNumber(),
      ),
      slug: this.world.artifact.slug,
      runId: this.memory.runId,
      cycleNumber: this.context.cycleNumber(),
      utterance,
      selectedObjectId,
      history: structuredClone(this.actionHistory),
      world: snapshot(this.world, "upper-dynamic", "__player__", {
        playerPose: this.context.playerPose?.() ?? null,
      }),
      locale: getLocale(),
    };
    // The player remembers their own confirmed actions; other people's unseen acts
    // are not part of the command interpreter's context.
    payload.world.worldMind = structuredClone(
      this.world.worldMind.events
        .filter((event) => event.actor?.kind === "player")
        .slice(-12),
    );
    try {
      return await streamRequest<ActionResult>(
        "/api/ai/action",
        payload,
        controller.signal,
      );
    } catch (error) {
      this.failed(error, controller);
      throw error;
    } finally {
      this.finish(controller);
    }
  }

  /** Called only after the browser has applied or refused the actual command. */
  rememberAction(utterance: string, reply: string): void {
    this.actionHistory.push(
      { speaker: "player", text: utterance.slice(0, 500) },
      { speaker: "world", text: reply.slice(0, 800) },
    );
    this.actionHistory = this.actionHistory.slice(-16);
  }

  noteReaction(figureId: string, reply: string): void {
    this.refreshFigureLife(figureId);
    this.rememberSpeech(figureId, reply);
    const memory = this.figureMemories.get(figureId) ?? {
      summary: "",
      lines: [],
    };
    memory.lines.push({ speaker: "figure", text: reply.slice(0, 320) });
    memory.lines = memory.lines.slice(-TRANSCRIPT_LINES);
    if (RETURNS_WHOLE.has(figureId))
      memory.deathCount = this.deathCount(figureId);
    this.figureMemories.set(figureId, memory);
  }

  snapshotActions(): PlayerActionLine[] {
    return structuredClone(this.actionHistory);
  }

  restoreActions(history: readonly PlayerActionLine[] = []): void {
    this.actionHistory = structuredClone(history.slice(-16));
  }

  async mutate(observation: Observation) {
    this.context.observe?.();
    const controller = this.controller();
    const payload: CycleExitRequestPayload = {
      runId: this.memory.runId,
      memories: this.memory.episodes.forObserver(
        "sleeper",
        this.context.cycleNumber(),
      ),
      slug: this.world.artifact.slug,
      cycleNumber: this.context.cycleNumber(),
      observation,
      knownShardIds: [...this.memory.knownShardIds],
      sleeper: this.memory.sleeper,
      transcripts: Object.fromEntries(
        [...this.figureMemories].map(([id, memory]) => [id, memory.lines]),
      ),
      world: snapshot(this.world),
      locale: getLocale(),
    };
    try {
      const result = await streamRequest<
        Awaited<ReturnType<DreamMind["mutate"]>>
      >("/api/ai/cycle-exit", payload, controller.signal);
      this.memory.replaceSleeperSummary(result.sleeperSummary);
      return result;
    } catch (error) {
      if (!this.failed(error, controller)) throw error;
      return this.fallback.mutate(observation);
    } finally {
      this.finish(controller);
    }
  }

  async judge(words: string[]) {
    const controller = this.controller();
    const payload: FinaleRequestPayload = {
      slug: this.world.artifact.slug,
      runId: this.memory.runId,
      words,
      locale: getLocale(),
    };
    try {
      return await streamRequest<Awaited<ReturnType<DreamMind["judge"]>>>(
        "/api/ai/finale",
        payload,
        controller.signal,
      );
    } catch (error) {
      if (!this.failed(error, controller)) throw error;
      // The finale is the one place a stand-in must not guess. A dropped connection
      // is a miss with its own line, never a prize.
      const silent: FinaleResult = {
        verdict: "miss",
        reply: t("finale.dream_silent"),
      };
      return silent;
    } finally {
      this.finish(controller);
    }
  }

  availableMemories() {
    return this.memory.availableMemories();
  }

  conversation(figureId: string): readonly FigureTranscriptLine[] {
    this.refreshFigureLife(figureId);
    return this.figureMemories.get(figureId)?.lines ?? [];
  }

  /** Store the result of replay, not the model's claim that its plan succeeded. */
  noteExecution(
    figureId: string,
    feedback: readonly NpcExecutionFeedback[],
  ): void {
    if (feedback.length === 0) return;
    this.refreshFigureLife(figureId);
    const memory = this.figureMemories.get(figureId) ?? {
      summary: "",
      lines: [],
    };
    memory.execution = structuredClone(feedback.slice(-8));
    if (RETURNS_WHOLE.has(figureId))
      memory.deathCount = this.deathCount(figureId);
    // A sandbox success may have cleared the intent before the real world refused it.
    // Keep the player's request available for reconsideration on the next turn.
    if (feedback.some((entry) => !entry.ok) && !memory.intent) {
      memory.intent =
        memory.lines
          .slice()
          .reverse()
          .find((line) => line.speaker === "sanitar")
          ?.text.slice(0, 240) ?? null;
    }
    this.figureMemories.set(figureId, memory);
  }

  snapshotFigures() {
    return structuredClone(this.figureMemories);
  }

  restoreFigures(state: ReturnType<RemoteMind["snapshotFigures"]>): void {
    this.abort();
    this.figureMemories.clear();
    for (const [id, memory] of state)
      this.figureMemories.set(id, structuredClone(memory));
    for (const id of RETURNS_WHOLE) this.refreshFigureLife(id);
  }

  forgetFigures(): void {
    this.abort();
    this.figureMemories.clear();
    this.actionHistory = [];
    this.fallback.forgetFigures();
  }

  abort(): void {
    this.activeController?.abort();
    this.activeController = null;
  }
}
