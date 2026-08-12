/**
 * `lord secret <slug>` — write the one thing that is not generated.
 *
 * §2 of the concept: the secret is a single immutable line, written by a person before
 * play. Not because a model could not invent one, but because a secret invented on the
 * way cannot be *found* — it can only be handed to you when the model decides to be
 * generous. A CTF without a fixed flag is not a CTF.
 *
 * The plaintext stays in dreams/<slug>/secret.local.txt, which is gitignored and never
 * copied into the artifact. dream.json carries only the SHA-256, which is enough for a
 * judge to check an answer and not enough for a player to read one.
 *
 * Shards are seeded here too, and they are deliberately not a schema of the solution —
 * §2 again: a few hooks, and the mind decides who ends up holding them.
 */

import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  dreamDir,
  loadDraft,
  loadSecret,
  saveDraft,
  saveSecret,
  sealSecret,
  secretPath,
} from "../project";
import {
  ask,
  askRequired,
  color,
  confirm,
  heading,
  note,
  ok,
  warn,
} from "../term/prompt";
import type { Flags } from "../cli";

export async function secretCommand(
  slug: string | undefined,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord secret <slug>");
  const draft = await loadDraft(slug);

  heading(`The sealed line — ${draft.title}`);

  const existing = await loadSecret(slug);
  if (existing && !flags.force) {
    warn("this dream already has a secret");
    note(color.grey(existing));
    const replace = await confirm("Replace it?", false);
    if (!replace) {
      note("left alone");
      return;
    }
  }

  note("One sentence. The thing the sleeper does not want found.");
  note(
    "It never gets said aloud in game — the player assembles it from pieces (§3).",
  );
  console.log();

  const plaintext =
    flags.secret ??
    (await askRequired(
      "Secret",
      existing ?? "Он запер котельную, зная, что там кто-то есть",
    ));

  await saveSecret(slug, plaintext);
  draft.secretHash = await sealSecret(plaintext);

  // Shards: the hooks. Three makes a detective story, seven makes a job (§10).
  const shardCount = flags.shards
    ? Number(flags.shards)
    : draft.shards.length || 4;
  console.log();
  note(
    `Now ${shardCount} hooks toward it. Each is one thing somebody in the dream knows.`,
  );
  note(
    "They are a seeding, not a plan: the sleeper decides who holds them, and moves them.",
  );
  console.log();

  const shards = [];
  for (let i = 0; i < shardCount; i++) {
    const existingHint = draft.shards[i]?.hint ?? "";
    const hint = await ask(
      `  hook ${i + 1}`,
      existingHint || SUGGESTED_HOOKS[i] || "",
    );
    if (!hint) continue;
    shards.push({ id: `shard${i + 1}`, hint });
  }
  draft.shards = shards;

  // `endings.md`: about one dream in four is dry, and it is decided *here* rather than
  // rolled at the finale — «броска в финале нет, иначе игрок справедливо решит, что его
  // кинула не игра, а рандом». Local and gitignored: a flag in a served file would turn
  // the whole discovery loop into a `curl`.
  const walletPath = join(dreamDir(slug), "wallet.local.json");
  const walletExists = await access(walletPath).then(
    () => true,
    () => false,
  );
  if (!walletExists) {
    const dry =
      flags.dry === true || (flags.wet !== true && Math.random() < 0.25);
    await writeFile(
      walletPath,
      `${JSON.stringify({ wallet: dry ? "dry" : "full" }, null, 2)}\n`,
      "utf8",
    );
    note(
      dry
        ? "this dream is dry — the tells are in the money scenes"
        : "this dream has funds",
    );
  }

  await saveDraft(draft);

  console.log();
  ok(`sealed as ${draft.secretHash.slice(0, 16)}…`);
  note(
    `plaintext in ${secretPath(slug).replace(process.cwd(), ".")} (gitignored)`,
  );
  ok(`${shards.length} hooks seeded`);
  console.log();
  note(`Next: bun run lord layout ${slug}`);
}

/** Only ever defaults — a Lord who accepts all four gets a coherent but generic dream. */
const SUGGESTED_HOOKS = [
  "Кто-то слышал стук из подвала и решил, что это трубы",
  "Ключ от котельной пропал за неделю до",
  "В журнале дежурств вырван один лист",
  "Он до сих пор не может находиться рядом с запахом гари",
];
