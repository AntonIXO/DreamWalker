import type { DreamMemory, SleeperMemory } from "../../shared/ai";
import { isRunId, newRunId } from "../../shared/wallet";
import { EpisodicMemory } from "../../shared/episodic-memory";
import { RETURNS_WHOLE } from "../../shared/verbs";
import { RumorExchange } from "./rumors";

interface StoredMindState {
  /** One descent into the dream. Seeds the wallet and the deal; a reload keeps it. */
  runId: string;
  knownShardIds: string[];
  sleeper: SleeperMemory;
  memories: DreamMemory[];
  exhaustion: number;
  episodes?: ReturnType<EpisodicMemory["snapshot"]>;
  rumors?: ReturnType<RumorExchange["snapshot"]>;
  figureLives?: Record<string, number>;
}

function emptyState(): StoredMindState {
  return {
    runId: newRunId(),
    knownShardIds: [],
    sleeper: { summary: "", tells: [] },
    memories: [],
    exhaustion: 0,
  };
}

/** Persistent knowledge belonging to the sanitar and the sleeper, not to one figure. */
export class MindMemory {
  private state: StoredMindState;
  readonly episodes = new EpisodicMemory();
  readonly rumors = new RumorExchange(this.episodes);

  constructor(private readonly slug: string) {
    this.state = this.load();
    this.episodes.restore(this.state.episodes);
    this.rumors.restore(this.state.rumors);
  }

  private get key(): string {
    return `dreamwalker.mind-state.${this.slug}`;
  }

  private load(): StoredMindState {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw) as Partial<StoredMindState>;
      return {
        runId: isRunId(parsed.runId) ? parsed.runId : newRunId(),
        knownShardIds: Array.isArray(parsed.knownShardIds)
          ? parsed.knownShardIds.filter(
              (id): id is string => typeof id === "string",
            )
          : [],
        sleeper: {
          summary:
            typeof parsed.sleeper?.summary === "string"
              ? parsed.sleeper.summary.slice(-1600)
              : "",
          tells: Array.isArray(parsed.sleeper?.tells)
            ? parsed.sleeper.tells.slice(-20)
            : [],
        },
        memories: Array.isArray(parsed.memories)
          ? parsed.memories.filter(
              (memory): memory is DreamMemory =>
                typeof memory?.id === "string" &&
                typeof memory.text === "string",
            )
          : [],
        exhaustion:
          typeof parsed.exhaustion === "number" &&
          Number.isFinite(parsed.exhaustion)
            ? parsed.exhaustion
            : 0,
        episodes: parsed.episodes,
        rumors: parsed.rumors,
        figureLives: Object.fromEntries(
          Object.entries(parsed.figureLives ?? {}).filter(
            ([id, count]) =>
              RETURNS_WHOLE.has(id) &&
              Number.isSafeInteger(count) &&
              count >= 0,
          ),
        ),
      };
    } catch {
      return emptyState();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.snapshot()));
    } catch {
      // The game remains playable when storage is disabled; persistence is the casualty.
    }
  }

  snapshot(): StoredMindState {
    return {
      ...structuredClone(this.state),
      episodes: this.episodes.snapshot(),
      rumors: this.rumors.snapshot(),
    };
  }

  restore(state: StoredMindState): void {
    this.state = structuredClone(state);
    this.episodes.restore(state.episodes);
    this.rumors.restore(state.rumors);
    this.save();
  }

  get knownShardIds(): readonly string[] {
    return this.state.knownShardIds;
  }

  get runId(): string {
    return this.state.runId;
  }

  /** A new descent: meta-progress stays, but this run's experiences do not carry over. */
  newRun(): string {
    this.state.runId = newRunId();
    this.episodes.clear();
    this.rumors.reset();
    this.state.figureLives = {};
    this.state.sleeper = { summary: "", tells: [] };
    this.save();
    return this.state.runId;
  }

  get sleeper(): SleeperMemory {
    return structuredClone(this.state.sleeper);
  }

  /** One incarnation boundary, applied before sensing, recall or rumor delivery. */
  refreshFigureLives(
    history: readonly { figureId: string; fate: string }[],
  ): void {
    const lives = (this.state.figureLives ??= {});
    for (const id of RETURNS_WHOLE) {
      const deaths = history.filter(
        (entry) => entry.figureId === id && entry.fate === "dead",
      ).length;
      if ((lives[id] ?? 0) !== deaths) {
        this.episodes.forgetObserver(id);
        this.rumors.forgetFigure(id);
      }
      lives[id] = deaths;
    }
  }

  figureLife(figureId: string): number {
    return this.state.figureLives?.[figureId] ?? 0;
  }

  get memories(): readonly DreamMemory[] {
    return this.state.memories;
  }

  get hasInitialMemories(): boolean {
    return this.state.memories.length > 0;
  }

  setInitialMemories(texts: readonly string[]): void {
    if (this.state.memories.length > 0) return;
    this.state.memories = texts
      .map((text) => text.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((text, index) => ({
        id: `self-${crypto.randomUUID()}-${index}`,
        text,
        origin: "self" as const,
        spent: false,
        signature: null,
      }));
    this.save();
  }

  availableMemories(): DreamMemory[] {
    return this.state.memories.filter((memory) => !memory.spent);
  }

  memory(id: string | null | undefined): DreamMemory | null {
    if (!id) return null;
    return (
      this.state.memories.find((memory) => memory.id === id && !memory.spent) ??
      null
    );
  }

  spendMemory(id: string): boolean {
    const memory = this.state.memories.find((candidate) => candidate.id === id);
    if (!memory || memory.spent) return false;
    memory.spent = true;
    this.save();
    return true;
  }

  get exhaustion(): number {
    return this.state.exhaustion;
  }

  setExhaustion(value: number): void {
    this.state.exhaustion = value;
    this.save();
  }

  spentMemoryTexts(): string[] {
    return this.state.memories
      .filter((memory) => memory.spent)
      .map((memory) => memory.text);
  }

  learnShard(id: string): void {
    if (this.state.knownShardIds.includes(id)) return;
    this.state.knownShardIds.push(id);
    this.save();
  }

  addTell(cycle: number, figureId: string, quoted: string): void {
    this.state.sleeper.tells.push({ cycle, figureId, quoted });
    this.state.sleeper.tells = this.state.sleeper.tells.slice(-20);
    this.save();
  }

  addResidue(lines: readonly string[]): void {
    if (lines.length === 0) return;
    this.state.sleeper.summary = [this.state.sleeper.summary, ...lines]
      .filter(Boolean)
      .join("\n")
      .slice(-1600);
    this.save();
  }

  replaceSleeperSummary(summary: string): void {
    this.state.sleeper.summary = summary.slice(-1600);
    this.save();
  }

  clear(): void {
    this.state = emptyState();
    this.episodes.clear();
    this.rumors.reset();
    this.save();
  }
}
