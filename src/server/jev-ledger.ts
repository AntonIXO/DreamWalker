import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const JEV_MAX_ATTEMPTS_PER_MINUTE = 10;
export const JEV_MAX_USD_PER_HOUR = 1;

const entrySchema = z.object({
  id: z.string().max(128),
  rootId: z.string().max(128),
  at: z.number().finite().nonnegative(),
  reservedUsd: z.number().finite().nonnegative(),
  costUsd: z.number().finite().nonnegative().optional(),
  model: z.string().max(200),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  elapsedMs: z.number().finite().nonnegative().optional(),
  status: z.string().max(64).optional(),
});
const ledgerSchema = z.object({
  version: z.literal(1),
  entries: z.array(entrySchema).max(1000),
});
export type JevLedgerEntry = z.infer<typeof entrySchema>;
export type JevReservationRefusal =
  "rate_limit" | "budget_limit" | "duplicate_request" | "cause_limit";

/**
 * A reservation is durable before a request leaves the process. Missing usage or
 * a crashed/aborted request retains its full reservation after a server restart.
 * Only identifiers, accounting and timings live here; never prompts or keys.
 */
export class JevLedger {
  private entries: JevLedgerEntry[] = [];
  private healthy = true;

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {
    try {
      this.entries = ledgerSchema.parse(
        JSON.parse(readFileSync(path, "utf8")),
      ).entries;
      this.prune();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Corrupt accounting cannot safely be interpreted as zero spending.
        this.healthy = false;
      }
    }
  }

  private prune(): void {
    const cutoff = this.now() - HOUR;
    this.entries = this.entries.filter((entry) => entry.at > cutoff);
  }

  private persist(): void {
    if (!this.healthy) throw new Error("ledger_unavailable");
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      writeFileSync(
        temporary,
        JSON.stringify({ version: 1, entries: this.entries }),
        { mode: 0o600 },
      );
      renameSync(temporary, this.path);
    } catch {
      this.healthy = false;
      throw new Error("ledger_unavailable");
    }
  }

  reserve(entry: Omit<JevLedgerEntry, "at">): JevReservationRefusal | null {
    if (!this.healthy) throw new Error("ledger_unavailable");
    this.prune();
    const now = this.now();
    if (this.entries.some((previous) => previous.id === entry.id)) {
      return "duplicate_request";
    }
    if (
      this.entries.filter((previous) => previous.rootId === entry.rootId)
        .length >= 2
    ) {
      return "cause_limit";
    }
    if (
      this.entries.filter((previous) => previous.at > now - MINUTE).length >=
      JEV_MAX_ATTEMPTS_PER_MINUTE
    ) {
      return "rate_limit";
    }
    if (this.spentUsd() + entry.reservedUsd > JEV_MAX_USD_PER_HOUR) {
      return "budget_limit";
    }
    this.entries.push({ ...entry, at: now });
    this.persist();
    return null;
  }

  settle(
    id: string,
    usage: Pick<
      JevLedgerEntry,
      | "costUsd"
      | "model"
      | "inputTokens"
      | "outputTokens"
      | "elapsedMs"
      | "status"
    >,
  ): void {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error("ledger_unavailable");
    Object.assign(entry, usage);
    this.persist();
  }

  spentUsd(): number {
    this.prune();
    return this.entries.reduce(
      (total, entry) => total + (entry.costUsd ?? entry.reservedUsd),
      0,
    );
  }
}
