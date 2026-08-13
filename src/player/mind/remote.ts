import type {
  AiStreamEvent,
  CycleExitRequestPayload,
  DialogueRequestPayload,
  DreamPopulation,
  ExamineRequestPayload,
  FinaleRequestPayload,
  FigureTranscriptLine,
  FigureMemory,
  WorldSnapshot,
} from "../../shared/ai";
import type { DreamArtifact } from "../../shared/dream";
import { fallbackPopulation } from "../../shared/population";
import { RETURNS_WHOLE } from "../../shared/verbs";
import type { WorldState } from "../game/world";
import { MindMemory } from "./memory";
import type { Observation } from "./observation";
import type {
  DreamMind,
  ExamineRequest,
  TurnRequest,
  TurnResponse,
} from "./types";

const REQUEST_TIMEOUT_MS = 25_000;
const INHABIT_TIMEOUT_MS = 20_000;
const TRANSCRIPT_LINES = 6;

export interface RemoteMindContext {
  cycleNumber(): number;
  journal(): string[];
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
 */
function snapshot(
  world: WorldState,
  mood: WorldSnapshot["mood"] = "upper-dynamic",
  forFigureId: string | null = null,
): WorldSnapshot {
  const hidden = (figureId: string): boolean =>
    forFigureId !== null &&
    forFigureId !== "glaz" &&
    RETURNS_WHOLE.has(figureId);

  // Figures who are no longer in the world still belong in the snapshot. Splicing them
  // out of `world.figures` is what makes them gone; leaving them out of here would make
  // them never have existed, and then nobody could say «его нет там, где он был».
  const absent = [...world.fates.entries()]
    .filter(([id]) => !world.figures.some((figure) => figure.id === id))
    .map(([id, record]) => ({
      id,
      name: world.baseFigures.find((figure) => figure.id === id)?.name ?? id,
      roomId: record.roomId,
      holdsShardId: null,
      role: "часть этого сна",
      personality: "",
      activity: "",
      record,
    }));

  return {
    rooms: world.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      kind: room.kind,
      personality: room.personality,
      visitCount: world.visitCounts.get(room.id) ?? 0,
      tags: room.tags,
    })),
    doors: [...world.doorById.entries()].map(([id, door]) => ({
      id,
      type: door.type,
      fromRoomId: world.roomIdByDoorId.get(id) ?? "",
      toRoomId: door.toRoomId,
    })),
    figures: [
      ...world.figures.map((figure) => ({
        id: figure.id,
        name: figure.name,
        roomId: figure.roomId,
        holdsShardId: figure.holdsShardId,
        role: figure.role,
        personality: figure.personality,
        activity: figure.activity,
        record: world.fates.get(figure.id) ?? null,
      })),
      ...absent,
    ]
      .filter((figure) => !hidden(figure.id))
      .map(({ record, ...figure }) => ({
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

  while (true) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  consume(pending);
  if (value === undefined) {
    throw new RemoteMindError("internal", "Сон оборвал ответ.");
  }
  return value;
}

export async function inhabitDream(
  slug: string,
  artifact: DreamArtifact,
): Promise<DreamPopulation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INHABIT_TIMEOUT_MS);
  try {
    return await streamRequest<DreamPopulation>(
      "/api/ai/inhabit",
      { slug },
      controller.signal,
    );
  } catch (error) {
    console.warn("[mind] inhabit fell back to catalog deal:", error);
    return fallbackPopulation(artifact, { shuffle: true });
  } finally {
    clearTimeout(timeout);
  }
}

/** Server-backed mind with a deterministic per-call fallback. */
export class RemoteMind implements DreamMind {
  readonly name = "remote";
  private readonly figureMemories = new Map<string, FigureMemory>();
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

  private controller(): AbortController {
    this.abort();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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

  private failed(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError")
      return false;
    if (error instanceof RemoteMindError && error.code === "aborted")
      return false;
    this.failures++;
    console.warn("[mind] remote call fell back to ScriptedMind:", error);
    return true;
  }

  async turn(
    request: TurnRequest,
    onPartial?: (reply: string) => void,
  ): Promise<TurnResponse> {
    const controller = this.controller();
    const figureMemory = this.figureMemories.get(request.figureId) ?? {
      summary: "",
      lines: [],
    };
    const offeredMemory = this.memory.memory(request.offeredMemoryId);
    const payload: DialogueRequestPayload = {
      slug: this.world.artifact.slug,
      cycleNumber: this.context.cycleNumber(),
      figureId: request.figureId,
      utterance: request.utterance,
      offeredMemory,
      figureMemory,
      knownShardIds: [...this.memory.knownShardIds],
      sleeper: this.memory.sleeper,
      world: snapshot(this.world, "upper-dynamic", request.figureId),
    };

    try {
      const result = await streamRequest<TurnResponse>(
        "/api/ai/dialogue",
        payload,
        controller.signal,
        onPartial,
      );
      figureMemory.lines.push(
        { speaker: "sanitar", text: request.utterance },
        { speaker: "figure", text: result.reply },
      );
      figureMemory.lines = figureMemory.lines.slice(-TRANSCRIPT_LINES);
      figureMemory.summary = result.figureMemorySummary.slice(-400);
      this.figureMemories.set(request.figureId, figureMemory);
      if (result.yieldedShardId) this.memory.learnShard(result.yieldedShardId);
      if (result.tell) {
        this.memory.addTell(
          this.context.cycleNumber(),
          request.figureId,
          result.tell.quoted,
        );
      }
      this.memory.addResidue(result.residueDelta);
      if (offeredMemory) this.memory.spendMemory(offeredMemory.id);
      return result;
    } catch (error) {
      if (!this.failed(error)) throw error;
      const result = await this.fallback.turn(request, onPartial);
      figureMemory.lines.push(
        { speaker: "sanitar", text: request.utterance },
        { speaker: "figure", text: result.reply },
      );
      figureMemory.lines = figureMemory.lines.slice(-TRANSCRIPT_LINES);
      figureMemory.summary = result.figureMemorySummary.slice(-400);
      this.figureMemories.set(request.figureId, figureMemory);
      if (result.yieldedShardId) this.memory.learnShard(result.yieldedShardId);
      if (result.tell) {
        this.memory.addTell(
          this.context.cycleNumber(),
          request.figureId,
          result.tell.quoted,
        );
      }
      this.memory.addResidue(result.residueDelta);
      if (offeredMemory) this.memory.spendMemory(offeredMemory.id);
      return result;
    } finally {
      this.finish(controller);
    }
  }

  async examine(request: ExamineRequest) {
    const controller = this.controller();
    const payload: ExamineRequestPayload = {
      slug: this.world.artifact.slug,
      cycleNumber: this.context.cycleNumber(),
      roomId: request.roomId,
      interestId: request.interestId,
      hotspotId: request.hotspotId ?? null,
      x: request.x,
      y: request.y,
      knownShardIds: [...this.memory.knownShardIds],
      // A thing is still part of the dream, and the dream does not notice what happened
      // to Кирилл either.
      world: snapshot(this.world, "upper-dynamic", "__thing__"),
    };
    try {
      const result = await streamRequest<
        Awaited<ReturnType<DreamMind["examine"]>>
      >("/api/ai/examine", payload, controller.signal);
      if (result.yieldedShardId) this.memory.learnShard(result.yieldedShardId);
      return result;
    } catch (error) {
      if (!this.failed(error)) throw error;
      return this.fallback.examine(request);
    } finally {
      this.finish(controller);
    }
  }

  async mutate(observation: Observation) {
    const controller = this.controller();
    const payload: CycleExitRequestPayload = {
      slug: this.world.artifact.slug,
      cycleNumber: this.context.cycleNumber(),
      observation,
      knownShardIds: [...this.memory.knownShardIds],
      sleeper: this.memory.sleeper,
      transcripts: Object.fromEntries(
        [...this.figureMemories].map(([id, memory]) => [id, memory.lines]),
      ),
      world: snapshot(this.world),
    };
    try {
      const result = await streamRequest<
        Awaited<ReturnType<DreamMind["mutate"]>>
      >("/api/ai/cycle-exit", payload, controller.signal);
      this.memory.replaceSleeperSummary(result.sleeperSummary);
      return result;
    } catch (error) {
      if (!this.failed(error)) throw error;
      return this.fallback.mutate(observation);
    } finally {
      this.finish(controller);
    }
  }

  async judge(words: string[]) {
    const controller = this.controller();
    const payload: FinaleRequestPayload = {
      slug: this.world.artifact.slug,
      words,
    };
    try {
      return await streamRequest<Awaited<ReturnType<DreamMind["judge"]>>>(
        "/api/ai/finale",
        payload,
        controller.signal,
      );
    } catch (error) {
      if (!this.failed(error)) throw error;
      return this.fallback.judge(words);
    } finally {
      this.finish(controller);
    }
  }

  availableMemories() {
    return this.memory.availableMemories();
  }

  conversation(figureId: string): readonly FigureTranscriptLine[] {
    return this.figureMemories.get(figureId)?.lines ?? [];
  }

  forgetFigures(): void {
    this.figureMemories.clear();
    this.fallback.forgetFigures();
  }

  abort(): void {
    this.activeController?.abort();
    this.activeController = null;
  }
}
