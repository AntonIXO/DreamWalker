import { describe, expect, test } from "bun:test";

import {
  EMPTY_AMOUNT,
  effectiveWalletKind,
  isMoneyHotspot,
  isRunId,
  newRunId,
  rollWallet,
  walletIsLocked,
} from "./wallet";

const SLUG = "son";
const DAY = 24 * 60 * 60 * 1000;

describe("rollWallet", () => {
  test("the same run id is the same wallet, always", () => {
    const runId = newRunId();
    const first = rollWallet(SLUG, runId, 0);
    const second = rollWallet(SLUG, runId, 0);
    expect(second).toEqual(first);
  });

  test("a different run is a different roll", () => {
    const kinds = new Set(
      Array.from(
        { length: 40 },
        (_, i) => rollWallet(SLUG, `run-${i}`, 0).wallet,
      ),
    );
    expect(kinds.size).toBeGreaterThan(1);
  });

  test("the same run id in another dream is its own roll", () => {
    const series = (slug: string): string =>
      Array.from({ length: 24 }, (_, i) =>
        JSON.stringify(rollWallet(slug, `seed-${i}`, 0)),
      ).join("|");
    expect(series(SLUG)).not.toBe(series("vonesimo"));
  });

  test("about half are full, a quarter dry, a quarter locked", () => {
    const tally = { full: 0, dry: 0, locked: 0 };
    const runs = 10_000;
    for (let i = 0; i < runs; i++) {
      tally[rollWallet(SLUG, `sample-${i}`, 0).wallet] += 1;
    }
    expect(tally.full / runs).toBeCloseTo(0.5, 1);
    expect(tally.dry / runs).toBeCloseTo(0.25, 1);
    expect(tally.locked / runs).toBeCloseTo(0.25, 1);
  });

  test("a dry wallet holds nothing and is never locked", () => {
    const dry = Array.from({ length: 500 }, (_, i) =>
      rollWallet(SLUG, `dry-${i}`, 0),
    ).find((wallet) => wallet.wallet === "dry");
    expect(dry).toBeDefined();
    expect(dry!.amount).toBe(EMPTY_AMOUNT);
    expect(walletIsLocked(dry!, 0)).toBe(false);
    expect(effectiveWalletKind(dry!, 0)).toBe("dry");
  });

  test("a locked wallet holds something and opens once the timer runs out", () => {
    const now = Date.parse("2026-09-03T00:00:00.000Z");
    const locked = Array.from({ length: 500 }, (_, i) =>
      rollWallet(SLUG, `locked-${i}`, now),
    ).find((wallet) => wallet.wallet === "locked");
    expect(locked).toBeDefined();
    expect(locked!.amount).not.toBe(EMPTY_AMOUNT);
    expect(effectiveWalletKind(locked!, now)).toBe("locked");
    // `story.md` §3: the lock is a date, not a puzzle. Past it the money is simply there.
    expect(effectiveWalletKind(locked!, now + 200 * DAY)).toBe("full");
  });
});

describe("run ids", () => {
  test("a fresh one is well-formed and unique", () => {
    const a = newRunId();
    const b = newRunId();
    expect(isRunId(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  test("junk is refused", () => {
    for (const value of ["", "../../etc", "1234", null, undefined, 7]) {
      expect(isRunId(value)).toBe(false);
    }
  });
});

describe("money hotspots", () => {
  test("the cell and the bin are money, the wardrobe note is not", () => {
    expect(isMoneyHotspot("iacheika")).toBe(true);
    expect(isMoneyHotspot("urna-nabitaia-akkuratno")).toBe(true);
    expect(isMoneyHotspot("nadpis")).toBe(false);
    expect(isMoneyHotspot(null)).toBe(false);
  });
});
