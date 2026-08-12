import type {
  AiStreamEvent,
  CycleExitRequestPayload,
  DialogueRequestPayload,
  ExamineRequestPayload,
  FinaleRequestPayload,
  FigureTranscriptLine,
  WorldSnapshot,
} from "../../shared/ai";
import type { WorldState } from "../game/world";
import { MindMemory } from "./memory";
import type { Observation } from "./observation";
import type {
  DreamMind,
  ExamineRequest,
  TurnRequest,
  TurnResponse,
} from "./types";

const REQUEST_TIMEOUT_MS = 120_000;
const TRANSCRIPT_LINES = 16;

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

function snapshot(world: WorldState): WorldSnapshot {
  return {
    rooms: world.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      kind: room.kind,
    })),
    doors: world.doors.map((door) => ({
      id: door.id,
      type: door.type,
      fromRoomId: door.fromRoomId,
      toRoomId: door.toRoomId,
    })),
    figures: world.figures.map((figure) => ({
      id: figure.id,
      name: figure.name,
      roomId: figure.roomId,
      holdsShardId: figure.holdsShardId,
    })),
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
  if (!response.body) throw new RemoteMindError("internal", "Сон не вернул поток.");

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

/** Server-backed mind with a deterministic per-call fallback. */
export class RemoteMind implements DreamMind {
  readonly name = "remote";
  private readonly transcripts = new Map<string, FigureTranscriptLine[]>();
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
    if (error instanceof DOMException && error.name === "AbortError") return false;
    if (error instanceof RemoteMindError && error.code === "aborted") return false;
    this.failures++;
    console.warn("[mind] remote call fell back to ScriptedMind:", error);
    return true;
  }

  async turn(
    request: TurnRequest,
    onPartial?: (reply: string) => void,
  ): Promise<TurnResponse> {
    const controller = this.controller();
    const history = this.transcripts.get(request.figureId) ?? [];
    const offeredMemory = this.memory.memory(request.offeredMemoryId);
    const payload: DialogueRequestPayload = {
      slug: this.world.artifact.slug,
      cycleNumber: this.context.cycleNumber(),
      figureId: request.figureId,
      utterance: request.utterance,
      offeredMemory,
      history,
      knownShardIds: [...this.memory.knownShardIds],
      sleeper: this.memory.sleeper,
      world: snapshot(this.world),
    };

    try {
      const result = await streamRequest<TurnResponse>(
        "/api/ai/dialogue",
        payload,
        controller.signal,
        onPartial,
      );
      history.push(
        { speaker: "sanitar", text: request.utterance },
        { speaker: "figure", text: result.reply },
      );
      this.transcripts.set(
        request.figureId,
        history.slice(-TRANSCRIPT_LINES),
      );
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
      return this.fallback.turn(request, onPartial);
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
      x: request.x,
      y: request.y,
      knownShardIds: [...this.memory.knownShardIds],
      world: snapshot(this.world),
    };
    try {
      const result = await streamRequest<Awaited<ReturnType<DreamMind["examine"]>>>(
        "/api/ai/examine",
        payload,
        controller.signal,
      );
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
      transcripts: Object.fromEntries(this.transcripts),
      world: snapshot(this.world),
    };
    try {
      const result = await streamRequest<Awaited<ReturnType<DreamMind["mutate"]>>>(
        "/api/ai/cycle-exit",
        payload,
        controller.signal,
      );
      this.memory.replaceSleeperSummary(result.sleeperSummary);
      return result;
    } catch (error) {
      if (!this.failed(error)) throw error;
      return this.fallback.mutate(observation);
    } finally {
      this.finish(controller);
    }
  }

  async judge(diagnosis: string) {
    const controller = this.controller();
    const payload: FinaleRequestPayload = {
      slug: this.world.artifact.slug,
      diagnosis,
      knownShardIds: [...this.memory.knownShardIds],
      journal: this.context.journal(),
    };
    try {
      return await streamRequest<Awaited<ReturnType<DreamMind["judge"]>>>(
        "/api/ai/finale",
        payload,
        controller.signal,
      );
    } catch (error) {
      if (!this.failed(error)) throw error;
      return this.fallback.judge(diagnosis);
    } finally {
      this.finish(controller);
    }
  }

  availableMemories() {
    return this.memory.availableMemories();
  }

  forgetFigures(): void {
    this.transcripts.clear();
    this.fallback.forgetFigures();
  }

  abort(): void {
    this.activeController?.abort();
    this.activeController = null;
  }
}
