/**
 * The finale, which had no test at all.
 *
 * `judge` is the one agent that never calls a model: it is a hash, a bip39 check and a
 * wallet. Every ending the player can reach hangs off it, so the branches are worth
 * pinning down — including the one where the phrase is right and there is nothing there.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { rollWallet, type WalletKind } from "../shared/wallet";
import { AgentRuntime } from "./agent-runtime";
import type { CodexAccountProcess } from "./codex-account";

const SECRET_PATH = join(process.cwd(), "dreams", "son", "secret.local.txt");
const HAS_SECRET = existsSync(SECRET_PATH);
const WALLET_OVERRIDE = existsSync(
  join(process.cwd(), "dreams", "son", "wallet.local.json"),
);

/** `judge` never touches the model, so the account only has to exist. */
const account = {
  status: () => ({ state: "disconnected" }),
  refresh: async () => {},
} as unknown as CodexAccountProcess;

function runtime(): AgentRuntime {
  return new AgentRuntime(account, {
    codexPath: "codex",
    codexHome: ".dreamwalker/codex-home",
  });
}

/** The sealed phrase, read the same way the server reads it. Never logged. */
function sealedWords(): string[] {
  return readFileSync(SECRET_PATH, "utf8")
    .split("\n\n")[0]!
    .trim()
    .split(/\s+/);
}

/** A run id that rolls to the wallet a branch needs. */
function runIdFor(kind: WalletKind): string {
  for (let i = 0; i < 5_000; i++) {
    const runId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    if (rollWallet("son", runId).wallet === kind) return runId;
  }
  throw new Error(`no run id rolled ${kind}`);
}

const ANY_RUN = runIdFor("full");
const signal = (): AbortSignal => new AbortController().signal;

describe("judge", () => {
  test("a run id that is not a run id is refused", async () => {
    await expect(
      runtime().judge(
        { slug: "son", runId: "../../etc/passwd", words: [] },
        signal(),
      ),
    ).rejects.toThrow();
  });

  test("eleven words are a miss, however right they are", async () => {
    if (!HAS_SECRET) return;
    const result = await runtime().judge(
      { slug: "son", runId: ANY_RUN, words: sealedWords().slice(0, 11) },
      signal(),
    );
    expect(result.verdict).toBe("miss");
  });

  test("twelve words outside the bip39 list are a miss", async () => {
    const result = await runtime().judge(
      { slug: "son", runId: ANY_RUN, words: Array(12).fill("qwerty") },
      signal(),
    );
    expect(result.verdict).toBe("miss");
  });

  test("a valid bip39 phrase that is not the secret is a miss", async () => {
    const words = [
      "legal",
      "winner",
      "thank",
      "year",
      "wave",
      "sausage",
      "worth",
      "useful",
      "legal",
      "winner",
      "thank",
      "yellow",
    ];
    const result = await runtime().judge(
      { slug: "son", runId: ANY_RUN, words },
      signal(),
    );
    expect(result.verdict).toBe("miss");
  });

  test("a miss never says where the error is, and never names a wallet", async () => {
    const result = await runtime().judge(
      { slug: "son", runId: ANY_RUN, words: Array(12).fill("qwerty") },
      signal(),
    );
    expect(result.wallet).toBeUndefined();
    expect(result.amount).toBeUndefined();
    expect(result.locked).toBeUndefined();
  });

  test("case and stray spacing do not change the phrase", async () => {
    if (!HAS_SECRET || WALLET_OVERRIDE) return;
    const shouted = sealedWords().map((word) => `  ${word.toUpperCase()} `);
    const result = await runtime().judge(
      { slug: "son", runId: runIdFor("full"), words: shouted },
      signal(),
    );
    expect(result.verdict).toBe("match");
  });

  test("the right phrase on a full run pays out", async () => {
    if (!HAS_SECRET || WALLET_OVERRIDE) return;
    const result = await runtime().judge(
      { slug: "son", runId: runIdFor("full"), words: sealedWords() },
      signal(),
    );
    expect(result.verdict).toBe("match");
    expect(result.wallet).toBe("full");
    expect(result.amount).not.toBe("0.00000000");
  });

  test("the right phrase on a dry run pays nothing — `endings.md` «Пусто»", async () => {
    if (!HAS_SECRET || WALLET_OVERRIDE) return;
    const result = await runtime().judge(
      { slug: "son", runId: runIdFor("dry"), words: sealedWords() },
      signal(),
    );
    expect(result.verdict).toBe("match");
    expect(result.wallet).toBe("dry");
    expect(result.amount).toBe("0.00000000");
  });

  test("the right phrase on a locked run opens nothing yet — layer 2", async () => {
    if (!HAS_SECRET || WALLET_OVERRIDE) return;
    const result = await runtime().judge(
      { slug: "son", runId: runIdFor("locked"), words: sealedWords() },
      signal(),
    );
    expect(result.verdict).toBe("match");
    expect(result.locked).toBe(true);
    expect(result.wallet).toBeUndefined();
  });

  test("the wallet is the same every time the same run asks", async () => {
    if (!HAS_SECRET || WALLET_OVERRIDE) return;
    const agents = runtime();
    const runId = runIdFor("dry");
    const first = await agents.judge(
      { slug: "son", runId, words: sealedWords() },
      signal(),
    );
    const second = await agents.judge(
      { slug: "son", runId, words: sealedWords() },
      signal(),
    );
    expect(second).toEqual(first);
  });

  test("the verdict speaks the player's language", async () => {
    const ru = await runtime().judge(
      { slug: "son", runId: ANY_RUN, words: Array(12).fill("qwerty") },
      signal(),
    );
    const en = await runtime().judge(
      {
        slug: "son",
        runId: ANY_RUN,
        words: Array(12).fill("qwerty"),
        locale: "en",
      },
      signal(),
    );
    expect(en.reply).not.toBe(ru.reply);
    expect(/[а-яё]/i.test(en.reply)).toBe(false);
  });

  test("another dream's slug is refused", async () => {
    await expect(
      runtime().judge(
        { slug: "vonesimo", runId: ANY_RUN, words: Array(12).fill("qwerty") },
        signal(),
      ),
    ).rejects.toThrow();
  });
});
