import type { DreamMemory, SleeperMemory } from "../../shared/ai";

interface StoredMindState {
  knownShardIds: string[];
  sleeper: SleeperMemory;
  memories: DreamMemory[];
}

function emptyState(): StoredMindState {
  return {
    knownShardIds: [],
    sleeper: { summary: "", tells: [] },
    memories: [],
  };
}

/** Persistent knowledge belonging to the sanitar and the sleeper, not to one figure. */
export class MindMemory {
  private state: StoredMindState;

  constructor(private readonly slug: string) {
    this.state = this.load();
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
        knownShardIds: Array.isArray(parsed.knownShardIds)
          ? parsed.knownShardIds.filter((id): id is string => typeof id === "string")
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
                typeof memory?.id === "string" && typeof memory.text === "string",
            )
          : [],
      };
    } catch {
      return emptyState();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.state));
    } catch {
      // The game remains playable when storage is disabled; persistence is the casualty.
    }
  }

  get knownShardIds(): readonly string[] {
    return this.state.knownShardIds;
  }

  get sleeper(): SleeperMemory {
    return structuredClone(this.state.sleeper);
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
    return this.state.memories.find((memory) => memory.id === id && !memory.spent) ?? null;
  }

  spendMemory(id: string): boolean {
    const memory = this.state.memories.find((candidate) => candidate.id === id);
    if (!memory || memory.spent) return false;
    memory.spent = true;
    this.save();
    return true;
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
    this.save();
  }
}
