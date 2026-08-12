/**
 * Cycles.
 *
 * §5 takes the shape from Majora's Mask: a timer runs, the dream restarts, the figures
 * forget — and the player's notebook does not. Progression is knowledge, so failure is a
 * rhythm rather than a punishment, and a dream that repeats is clinically the right
 * thing for a mind circling a trauma.
 *
 * What survives a reset: the journal. What does not: the world, the figures, where the
 * hooks ended up, and everything the sleeper worked out about you.
 */

import type { DreamArtifact } from "../../shared/dream";

const JOURNAL_KEY = "dreamwalker.journal";

export interface JournalEntry {
  cycle: number;
  at: string;
  text: string;
}

/**
 * The Bombers' Notebook. §5 is specific that this is a journal of *people* rather than
 * of tasks — who was where, who said what, who looked at you sideways — and that it is
 * the only thing allowed to accumulate between cycles.
 */
export class Journal {
  private entries: JournalEntry[] = [];

  constructor(private readonly slug: string) {
    this.load();
  }

  private get storageKey(): string {
    return `${JOURNAL_KEY}.${this.slug}`;
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      this.entries = raw ? (JSON.parse(raw) as JournalEntry[]) : [];
    } catch {
      // A corrupt or unavailable store is not worth failing a dream over.
      this.entries = [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify(this.entries.slice(-200)),
      );
    } catch {
      // Private browsing, quota, whatever. The dream still runs.
    }
  }

  add(cycle: number, text: string): void {
    if (
      this.entries.some((entry) => entry.text === text && entry.cycle === cycle)
    )
      return;
    this.entries.push({ cycle, at: new Date().toISOString(), text });
    this.persist();
  }

  all(): readonly JournalEntry[] {
    return this.entries;
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.persist();
  }
}

export class Cycle {
  private remainingMs: number;
  private index = 1;

  constructor(private readonly artifact: DreamArtifact) {
    this.remainingMs = artifact.cycle.durationMs;
  }

  get number(): number {
    return this.index;
  }

  get remainingSeconds(): number {
    return Math.max(0, this.remainingMs / 1000);
  }

  get expired(): boolean {
    return this.remainingMs <= 0;
  }

  /** @returns true on the frame the cycle runs out. */
  update(deltaSeconds: number): boolean {
    if (this.remainingMs <= 0) return false;
    this.remainingMs -= deltaSeconds * 1000;
    return this.remainingMs <= 0;
  }

  restart(): void {
    this.index++;
    this.remainingMs = this.artifact.cycle.durationMs;
  }
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}
