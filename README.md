# Dream Walker

A sanitar with new voodoo technology walks into someone else's dream. Every dream has a
secret. The sleeper does not want it found — and **knows you are there**.

Design document: [`dream-walker-concept.md`](dream-walker-concept.md). Section numbers
throughout the code refer to it.

This repository contains the world editor, artifact format, PixiJS player, and the live
sleeping mind. The mind runs through AI SDK 6 with a deterministic `ScriptedMind`
fallback, so the game remains playable when inference is unavailable.

## Two programs

The concept's structure is not one app but two, and they meet at a file on disk.

**`lord` — the world editor.** The Lord is a _person_, not a seed (§2, §7.4). They write
and seal the secret, curate a starting layout, choose the art, place the figures, and bake
a dream artifact. Runs offline, on the author's machine, once.

**The player and game server.** The browser loads one immutable artifact; the Bun server
owns inference, OAuth state, and the plaintext secret used only by the finale judge. The
model generates dialogue and closed `MapPatch` objects, never a replacement artifact.

```
bun install

bun run lord init first-room     # title, genre contract, style words, palette
bun run lord secret first-room   # the one immutable line; seed the hooks
bun run lord layout first-room   # generate a map, [r]eroll until it is right, [a]ccept
bun run lord art first-room      # four candidates per tile, press 1-4
bun run lord figures first-room  # place the figures, hand them hooks
bun run lord build first-room    # validate and publish the artifact
bun run lord play first-room     # build, then serve it at localhost:8080
```

For normal development, run `bun run dev`. It starts Vite on `:8080` and the Bun API on
`:8081`. Run `bun run build && bun run start` for the production server.

`bun run lord status` shows what is done and what is not. Every command also takes flags
(`--title`, `--seed`, `--yes`, …) so the whole flow scripts without a human.

### Playing

`WASD`/arrows to walk, `E` to speak or examine, `M` to spend a memory for two minutes,
`Esc` to step away, and `H` for controls. `F1`, `B`, and `K` are debug controls.

## What is where

```
dreams/<slug>/     the authored dream. draft.json is the authoring state; dream.json,
                   atlas.png and atlas.json are the build output. secret.local.txt holds
                   the plaintext secret and is gitignored — it never ships.
tools/lord/        the CLI. worldgen/ is the map generator, art/ the tile pipeline,
                   term/ the terminal UI including the truecolor pixel preview.
src/shared/        the artifact format and tile vocabulary, read by both sides.
src/player/        the web game: render/, game/, ui/, mind/.
src/server/        OAuth/account RPC, AI agents, API, and static production server.
```

## How the world is made

`lord layout` is a TypeScript port of
[GraphDungeonGenerator](https://github.com/amidos2006/GraphDungeonGenerator), which
implements Joris Dormans' split between **mission** (what you do) and **space** (where you
do it). A mission graph is grown from `start → end` by grammar rules — `addKeyLock`,
`addPuzzle`, `addLever`, `makeLink` and friends — within budgets set in
`tools/lord/worldgen/recipe.ts`, then laid onto a lattice and routed with A*.

Node types are read in the dream's own terms: a _key_ is leverage somebody holds, a _lock_
is a threshold the dream refuses you, a _puzzle_ is something only the world will give up,
a _lever_ is a way round the sleeper forgot to close.

Every rule application is validated and rolled back if it would make the dream
unsolvable, so what the Lord is offered is always crossable. There is no solver beyond
that, on purpose (§2): the person at the keyboard decides whether a map is any good.

## The heartbeat

The sleeping mind plans its defence when a cycle ends (§5, §6), not on a wall-clock
interval. The outgoing cycle is summarized for the model, the artifact is restored in
place, and the returned patch plan is applied to the fresh cycle. Figures forget their
conversation; the sanitar's journal and the sleeper's compact understanding persist.

Every model change is a typed `MapPatch`. The server discards unknown ids, caps the plan,
and the heartbeat refuses visible geometry. `applyPatch` owns all tile writes and keeps
the world structurally coherent, but deliberately does not run a solvability solver: a
defending dream is allowed to make a later cycle impossible, as §6 specifies.

## Art

The palette is fixed at the level of the dream — twelve to sixteen colours, chosen once
(§7.1) — and the atlas is written as an **indexed** PNG, so the palette is a property of
the file rather than a promise. There is nowhere in the format to put a seventeenth
colour.

Tiles are curated, not accepted: `lord art` draws four candidates per role directly in the
terminal in truecolor and the Lord presses `1`–`4`. That human-as-selector step is the
concept's whole answer to slop (§7.4), and it is the part that does not change when the
candidate generator does. Characters are palette-swapped silhouettes with a two-frame walk
(§7.2, §7.3) — no generated animation, ever.

Today the candidates are drawn procedurally by
`tools/lord/art/candidates.ts`. Swapping in Retro Diffusion replaces the body of one
function and nothing else; it is author-time only, never runtime.

## AI runtime

`src/server/agent-runtime.ts` contains four schema-validated agents:

- dialogue streams a figure's answer, may yield only that figure's shard, and enforces
  that every tell quotes an exact substring of the player's current words;
- examine is the safe, slow channel — things do not suspect;
- cycle exit compresses sleeper memory and proposes only the closed patch vocabulary;
- finale compares the player's diagnosis with the sealed line by meaning. It is the only
  agent that sees plaintext, and the server reveals it only after `match`.

`RemoteMind` keeps bounded per-figure transcripts, persistent discovered shards, sleeper
tells, and exactly three irreplaceable player memories. A memory can be offered in a
conversation or burned with `M` for `+2:00`. Any failed call falls back per action to
`ScriptedMind`; the Pixi ticker keeps rendering while only simulation is paused.

### Codex OAuth (default)

Install the official `codex` CLI, start the game, and choose “Подключить ChatGPT”. The
server asks `codex app-server` for a device code; the player opens the verification URL
and authorizes it. Inference then runs through `ai-sdk-provider-codex-app-server` using
`gpt-5.6-luna`, `xhigh`, stateless threads, read-only sandbox, and the user's Codex plan
limits. No OpenAI API key is requested or stored by the game.

OAuth state lives under `.dreamwalker/codex-home` by default. Override the executable or
state directory with `DREAMWALKER_CODEX_PATH` and `DREAMWALKER_CODEX_HOME`.

### Anthropic Messages-compatible provider

Set all three variables to bypass Codex OAuth:

```bash
ANTHROPIC_BASE_URL=http://proxy.example/anthropic \
ANTHROPIC_AUTH_TOKEN=... \
ANTHROPIC_MODEL=your-model \
bun run start
```

The server normalizes the base URL to `/v1`, sends the token as bearer auth, and accepts
JSON-in-text compatibility responses while still validating every result with Zod. The
token remains server-side and is never bundled by Vite.

## Status

Working: the Lord CLI end to end, artifact validator, world generation, indexed-PNG art
pipeline, PixiJS player, typed runtime patches, AI dialogue/examination/cycle/finale,
Codex device OAuth, an Anthropic-compatible provider, persistent memory economy, journal,
and deterministic offline fallback.

Not built: Retro Diffusion calls and multi-server dream federation (§8).

## Verification

`bun test` covers provider URL normalization, cycle extension, persistent/spent memory,
and patch/reset behavior. `bun run build` performs the full typecheck and Vite build;
`bun run lint` includes Prettier enforcement.

Never give a runtime credential a `VITE_` prefix. Vite inlines `VITE_*` into the client
bundle. See `.env.example` for the server-only variables.
