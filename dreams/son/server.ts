/**
 * Server-only. Wallet, money tells, lock. The player pack must not import this.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type WalletKind = "full" | "dry";
export type WalletReason = "never-funded" | "already-taken" | "spent";

export interface DreamWallet {
  wallet: WalletKind;
  reason: WalletReason;
  unlockAfter: string;
  amount: string;
}

const DEFAULT_FULL: DreamWallet = {
  wallet: "full",
  reason: "never-funded",
  unlockAfter: "2020-01-01T00:00:00.000Z",
  amount: "0.08412000",
};

const DEFAULT_DRY: DreamWallet = {
  wallet: "dry",
  reason: "never-funded",
  unlockAfter: "2020-01-01T00:00:00.000Z",
  amount: "0.00000000",
};

export function readDreamWallet(dreamDir: string): DreamWallet {
  try {
    const raw = JSON.parse(
      readFileSync(join(dreamDir, "wallet.local.json"), "utf8"),
    ) as Partial<DreamWallet>;
    const dry = raw.wallet === "dry";
    const base = dry ? DEFAULT_DRY : DEFAULT_FULL;
    return {
      wallet: dry ? "dry" : "full",
      reason: raw.reason ?? base.reason,
      unlockAfter: raw.unlockAfter ?? base.unlockAfter,
      amount: dry ? "0.00000000" : (raw.amount ?? base.amount),
    };
  } catch {
    return { ...DEFAULT_FULL };
  }
}

export function walletIsLocked(wallet: DreamWallet, now = Date.now()): boolean {
  const at = Date.parse(wallet.unlockAfter);
  return Number.isFinite(at) && now < at;
}

/** Sensory lines the sleeper swaps by wallet. Never shipped in the artifact. */
export const MONEY_TELLS: Record<string, { dry: string; full: string }> = {
  "akcionnyi-cennik-na-kotoryh-cena-meniaetsia": {
    dry: "На ценнике 180 вместо 30. Сзади очередь, и он уже не будет спорить.",
    full: "Ценник переписывают вниз, когда думают, что никто не смотрит.",
  },
  "piat-tysiach-nalichnymi-kotorye-uzhe-otd": {
    dry: "Пять тысяч уже отданы. На столе чек на говноут, который потом забрал Кирилл.",
    full: "Пачка лежит под клавиатурой. Кто-то считает её ещё раз и не отдаёт.",
  },
  "urna-nabitaia-akkuratno": {
    dry: "В урне купюры, сложенные как мусор. Они ему не нравились.",
    full: "В урне только чеки. Деньги кто-то вынул и спрятал.",
  },
  "chuzhie-sumki-na-platforme": {
    dry: "Сумки ждут не тот поезд. Крипто-бро уже вышел на другой.",
    full: "Сумки тяжёлые. Внутри считают, не открывая.",
  },
};

export function moneyTellFor(
  wallet: WalletKind,
  hotspotId: string | null | undefined,
): string | null {
  if (!hotspotId) return null;
  const row = MONEY_TELLS[hotspotId];
  if (row) return row[wallet];
  for (const [key, lines] of Object.entries(MONEY_TELLS)) {
    if (hotspotId.includes(key) || key.includes(hotspotId))
      return lines[wallet];
  }
  return null;
}
