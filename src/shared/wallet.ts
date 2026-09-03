/**
 * The wallet is fiction, and its state is a roll per run.
 *
 * `endings.md`: about one dream in four is dry, and it is decided when the sanitar lies
 * down rather than at the finale — «броска в финале нет, иначе игрок справедливо решит,
 * что его кинула не игра, а рандом». `story.md` §3 adds a second layer: the phrase can be
 * right and the money still locked from its owner by his own hand.
 *
 * The roll is seeded off the run id, so a reload is not a reroll, the server can recover
 * it after a restart by recomputing, and a training run (no server) lands on the same
 * distribution. Neither side ever ships the state to the other: the client learns it only
 * through what the dream says about money.
 *
 * Shared by the server and the training-mode judge. No DOM, no node.
 */

import { makeRng } from "./rng";

export type WalletKind = "full" | "dry" | "locked";
export type WalletReason = "never-funded" | "already-taken" | "spent";

export interface DreamWallet {
  wallet: WalletKind;
  /** Why it is dry. Meaningless for `full`; kept so a dry tell can choose its story. */
  reason: WalletReason;
  /** ISO date. Before it the phrase opens nothing (`locked`). */
  unlockAfter: string;
  amount: string;
}

export const NEVER_LOCKED = "2020-01-01T00:00:00.000Z";
export const EMPTY_AMOUNT = "0.00000000";

const LOCK_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Hotspots whose sensory line depends on the wallet. Ids are not secret; the lines are. */
export const MONEY_HOTSPOT_IDS: readonly string[] = [
  "akcionnyi-cennik-na-kotoryh-cena-meniaetsia",
  "piat-tysiach-nalichnymi-kotorye-uzhe-otd",
  "urna-nabitaia-akkuratno",
  "chuzhie-sumki-na-platforme",
  "iacheika",
];

export function isMoneyHotspot(hotspotId: string | null | undefined): boolean {
  if (!hotspotId) return false;
  return MONEY_HOTSPOT_IDS.some(
    (key) => hotspotId === key || hotspotId.includes(key),
  );
}

function fakeAmount(rng: { next(): number }): string {
  // Somewhere between 0.03 and 0.30, eight decimals like a real balance line.
  const value = 0.03 + rng.next() * 0.27;
  return value.toFixed(8);
}

/**
 * full 50 / dry 25 / locked 25. Dry splits never-funded 50 / already-taken 30 / spent 20,
 * which is the order `endings.md` gives them: «самый жалкий вариант и самый частый».
 */
export function rollWallet(
  slug: string,
  runId: string,
  now: number = Date.now(),
): DreamWallet {
  const rng = makeRng(`wallet:${slug}:${runId}`);
  const roll = rng.next();
  if (roll < 0.5) {
    return {
      wallet: "full",
      reason: "never-funded",
      unlockAfter: NEVER_LOCKED,
      amount: fakeAmount(rng),
    };
  }
  if (roll < 0.75) {
    const why = rng.next();
    const reason: WalletReason =
      why < 0.5 ? "never-funded" : why < 0.8 ? "already-taken" : "spent";
    return {
      wallet: "dry",
      reason,
      unlockAfter: NEVER_LOCKED,
      amount: EMPTY_AMOUNT,
    };
  }
  return {
    wallet: "locked",
    reason: "never-funded",
    unlockAfter: new Date(now + LOCK_DAYS * DAY_MS).toISOString(),
    amount: fakeAmount(rng),
  };
}

export function walletIsLocked(wallet: DreamWallet, now = Date.now()): boolean {
  if (wallet.wallet === "dry") return false;
  const at = Date.parse(wallet.unlockAfter);
  return Number.isFinite(at) && now < at;
}

/** A lock that has run out is a full wallet. Tells and the judge both read this. */
export function effectiveWalletKind(
  wallet: DreamWallet,
  now = Date.now(),
): WalletKind {
  if (wallet.wallet === "dry") return "dry";
  return walletIsLocked(wallet, now) ? "locked" : "full";
}

const RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID.test(value);
}

export function newRunId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Old WebViews. Not cryptographic; it only has to be unique enough to seed a roll.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
