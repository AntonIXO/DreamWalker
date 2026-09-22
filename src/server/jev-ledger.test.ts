import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JevLedger } from "./jev-ledger";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function file(): string {
  const directory = mkdtempSync(join(tmpdir(), "dream-jev-ledger-"));
  directories.push(directory);
  return join(directory, "usage.json");
}
function entry(id: string, reservedUsd = 0.001, rootId = id) {
  return { id, rootId, reservedUsd, model: "jev-test" };
}

describe("durable Jev budget", () => {
  test("attempts including failures share a rolling minute and survive restart", () => {
    const path = file();
    let now = 100_000;
    const ledger = new JevLedger(path, () => now);
    for (let i = 0; i < 10; i++)
      expect(ledger.reserve(entry(`${i}`))).toBeNull();
    expect(ledger.reserve(entry("blocked"))).toBe("rate_limit");
    expect(new JevLedger(path, () => now).reserve(entry("still-blocked"))).toBe(
      "rate_limit",
    );
    now += 60_000;
    expect(ledger.reserve(entry("next-minute"))).toBeNull();
  });

  test("a reservation counts until actual cost is known; ambiguous cost survives restart", () => {
    const path = file();
    const ledger = new JevLedger(path);
    expect(ledger.reserve(entry("lost", 0.6))).toBeNull();
    ledger.settle("lost", { model: "jev-test", status: "timeout" });
    expect(new JevLedger(path).reserve(entry("over-budget", 0.5))).toBe(
      "budget_limit",
    );
    ledger.settle("lost", {
      model: "jev-test",
      costUsd: 0.1,
      inputTokens: 2000,
    });
    expect(new JevLedger(path).reserve(entry("affordable", 0.5))).toBeNull();
    expect(JSON.parse(readFileSync(path, "utf8")).entries[0].inputTokens).toBe(
      2000,
    );
  });

  test("expiry uses a rolling hour, while a restarted pending attempt stays charged", () => {
    const path = file();
    let now = 10_000;
    const ledger = new JevLedger(path, () => now);
    expect(ledger.reserve(entry("pending", 1))).toBeNull();
    now += 3_599_999;
    expect(new JevLedger(path, () => now).reserve(entry("early", 0.01))).toBe(
      "budget_limit",
    );
    now++;
    expect(
      new JevLedger(path, () => now).reserve(entry("expired", 1)),
    ).toBeNull();
  });

  test("deduplicates request ids and caps a cause across different NPCs", () => {
    const ledger = new JevLedger(file());
    expect(ledger.reserve(entry("first", 0.001, "root"))).toBeNull();
    expect(ledger.reserve(entry("first", 0.001, "root"))).toBe(
      "duplicate_request",
    );
    expect(ledger.reserve(entry("second", 0.001, "root"))).toBeNull();
    expect(ledger.reserve(entry("third", 0.001, "root"))).toBe("cause_limit");
  });

  test("corrupt or unwritable accounting cannot become free calls", () => {
    const path = file();
    writeFileSync(path, "broken");
    expect(() => new JevLedger(path).reserve(entry("no"))).toThrow(
      "ledger_unavailable",
    );
    expect(() =>
      new JevLedger(join(path, "child")).reserve(entry("no")),
    ).toThrow("ledger_unavailable");
  });
});
