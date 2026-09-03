/**
 * Server-only. Authored wallet override and money tells. The player pack must not
 * import this: the tells are the answer key to «сухой или полный».
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EMPTY_AMOUNT,
  NEVER_LOCKED,
  type DreamWallet,
  type WalletKind,
  type WalletReason,
} from "../../src/shared/wallet";

export {
  effectiveWalletKind,
  rollWallet,
  walletIsLocked,
  type DreamWallet,
  type WalletKind,
} from "../../src/shared/wallet";

const DEFAULT_AMOUNT = "0.08412000";
const REASONS: readonly WalletReason[] = [
  "never-funded",
  "already-taken",
  "spent",
];

/**
 * `wallet.local.json` pins the wallet for every run of this dream. Optional: without it
 * the wallet is rolled per run (`src/shared/wallet.ts`). An author who wants a dream
 * that is always dry, or locked until a date, writes it here and never ships it.
 */
export function readDreamWallet(dreamDir: string): DreamWallet | null {
  const path = join(dreamDir, "wallet.local.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DreamWallet>;
    const kind: WalletKind =
      raw.wallet === "dry" || raw.wallet === "locked" ? raw.wallet : "full";
    const reason = REASONS.includes(raw.reason as WalletReason)
      ? (raw.reason as WalletReason)
      : "never-funded";
    const unlockAfter =
      typeof raw.unlockAfter === "string" &&
      Number.isFinite(Date.parse(raw.unlockAfter))
        ? raw.unlockAfter
        : kind === "locked"
          ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
          : NEVER_LOCKED;
    return {
      wallet: kind,
      reason,
      unlockAfter,
      amount:
        kind === "dry"
          ? EMPTY_AMOUNT
          : typeof raw.amount === "string"
            ? raw.amount
            : DEFAULT_AMOUNT,
    };
  } catch (error) {
    console.warn("[wallet] wallet.local.json ignored:", error);
    return null;
  }
}

/**
 * Sensory lines the sleeper swaps by wallet. Never shipped in the artifact.
 *
 * `endings.md`: «Тельцы честные и никогда не врут». Three or four money scenes leaning
 * the same way are the answer, and the player who reads the dream knows before the
 * finale. A locked wallet reads as full — the money exists, it is only out of reach —
 * except at the cell itself, which is the one place the lock can be seen.
 */
export const MONEY_TELLS: Record<
  string,
  { dry: string; full: string; locked?: string }
> = {
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
  iacheika: {
    dry: "Ячейка стеклянная и пустая. Таймер считает вверх над ничем.",
    full: "Деньги видны. До них двадцать сантиметров. Таймер давно перестал что-то значить.",
    locked:
      "Деньги видны. До них двадцать сантиметров. Таймер считает вверх, и стекло запотевает изнутри.",
  },
};

export function moneyTellFor(
  wallet: WalletKind,
  hotspotId: string | null | undefined,
): string | null {
  if (!hotspotId) return null;
  const pick = (row: (typeof MONEY_TELLS)[string]): string =>
    wallet === "locked" ? (row.locked ?? row.full) : row[wallet];
  const row = MONEY_TELLS[hotspotId];
  if (row) return pick(row);
  for (const [key, lines] of Object.entries(MONEY_TELLS)) {
    if (hotspotId.includes(key) || key.includes(hotspotId)) return pick(lines);
  }
  return null;
}
