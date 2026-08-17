const WORDS_KEY = "dreamwalker.words";

interface StoredNotebook {
  words: string[];
  observedClueIds: string[];
}

/** Six editable hypotheses. Observation is tracked separately from correctness. */
export class WordNotebook {
  private wordsValue = Array<string>(6).fill("");
  private observed = new Set<string>();

  constructor(private readonly slug: string) {
    try {
      const raw = localStorage.getItem(`${WORDS_KEY}.${slug}`);
      if (!raw) return;
      const stored = JSON.parse(raw) as StoredNotebook;
      this.wordsValue = Array.from({ length: 6 }, (_, index) =>
        String(stored.words?.[index] ?? "").slice(0, 24),
      );
      this.observed = new Set(stored.observedClueIds ?? []);
    } catch {
      // Corrupt local notes should not stop the dream from opening.
    }
  }

  get words(): readonly string[] {
    return this.wordsValue;
  }

  get observedCount(): number {
    return this.observed.size;
  }

  get observedIds(): readonly string[] {
    return [...this.observed];
  }

  hasObserved(clueId: string): boolean {
    return this.observed.has(clueId);
  }

  observe(clueId: string): void {
    this.observed.add(clueId);
    this.persist();
  }

  set(index: number, word: string): void {
    if (index < 0 || index >= 6) return;
    this.wordsValue[index] = word
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .slice(0, 24);
    this.persist();
  }

  private persist(): void {
    try {
      const value: StoredNotebook = {
        words: this.wordsValue,
        observedClueIds: [...this.observed],
      };
      localStorage.setItem(`${WORDS_KEY}.${this.slug}`, JSON.stringify(value));
    } catch {
      // Local persistence is a convenience; the current in-memory notebook still works.
    }
  }
}
