# Dream Walker

A sanitar with new voodoo technology walks into someone else's dream. Every dream has a
secret. The sleeper does not want it found — and **knows you are there**.

Design document: [`dream-walker-concept.md`](dream-walker-concept.md). Section numbers
throughout the code refer to it.

This repository is the **technical foundation**: the world editor, the artifact format,
the player, and the heartbeat. There is no AI in it yet — every place a model will go has
a typed seam and an offline stand-in, so the whole thing runs and is tunable today.

## Two programs

The concept's structure is not one app but two, and they meet at a file on disk.

**`lord` — the world editor.** The Lord is a *person*, not a seed (§2, §7.4). They write
and seal the secret, curate a starting layout, choose the art, place the figures, and bake
a dream artifact. Runs offline, on the author's machine, once.

**The player — the web game.** Loads one artifact and plays it. It generates nothing. One
server, one dream, one secret, one playthrough (§8).

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

`bun run lord status` shows what is done and what is not. Every command also takes flags
(`--title`, `--seed`, `--yes`, …) so the whole flow scripts without a human.

### Playing

`WASD`/arrows to walk, `E` to speak or examine, `Esc` to step away, `H` for the controls,
`F1` for the debug overlay, and alongside it `B` to force a heartbeat and `K` to grant
every key.

## What is where

```
dreams/<slug>/     the authored dream. draft.json is the authoring state; dream.json,
                   atlas.png and atlas.json are the build output. secret.local.txt holds
                   the plaintext secret and is gitignored — it never ships.
tools/lord/        the CLI. worldgen/ is the map generator, art/ the tile pipeline,
                   term/ the terminal UI including the truecolor pixel preview.
src/shared/        the artifact format and tile vocabulary, read by both sides.
src/player/        the web game: render/, game/, ui/, mind/.
```

## How the world is made

`lord layout` is a TypeScript port of
[GraphDungeonGenerator](https://github.com/amidos2006/GraphDungeonGenerator), which
implements Joris Dormans' split between **mission** (what you do) and **space** (where you
do it). A mission graph is grown from `start → end` by grammar rules — `addKeyLock`,
`addPuzzle`, `addLever`, `makeLink` and friends — within budgets set in
`tools/lord/worldgen/recipe.ts`, then laid onto a lattice and routed with A*.

Node types are read in the dream's own terms: a *key* is leverage somebody holds, a *lock*
is a threshold the dream refuses you, a *puzzle* is something only the world will give up,
a *lever* is a way round the sleeper forgot to close.

Every rule application is validated and rolled back if it would make the dream
unsolvable, so what the Lord is offered is always crossable. There is no solver beyond
that, on purpose (§2): the person at the keyboard decides whether a map is any good.

## The heartbeat

A timer wakes the sleeping mind while you are inside the dream and lets it change things
(§5, §6). Two rules keep that from being noise:

- **It never patches the room you are standing in.** Ground that moves under your feet
  reads as a bug; ground that moved while you were away reads as a threat.
- **Every change goes through `applyPatch`,** which enforces the invariant §6 sets out:
  *the world always leaves a path, but never a cheaper one than the one it destroyed.*
  Sealing a route that would strand a room is refused, with a reason you can read in the
  debug log. In the sample dream, 3 of 20 doors are sealable — exactly its redundant
  loops.

Cycles are Majora's: the timer runs out, the dream restarts from the artifact, the figures
forget, and the journal in `localStorage` does not.

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

## The seams where AI goes

`src/player/mind/types.ts` is the contract:

- `turn()` — a figure answers you, and lets slip that it noticed something specific about
  *how* you asked. A tell is never a meter; it quotes your own words back (§3).
- `mutate()` — the heartbeat's entry point.

`ScriptedMind` implements all of it offline and deterministically. Its `mutate` is real:
lean on a door and it gets sealed, keep visiting a figure and they are gone next time. So
the heartbeat is playable and tunable before a single model call exists.

The §3 fork is already demonstrable in the sample dream. Ask *"что случилось в
котельной"* and you are given a hook **and** challenged about the word you used; ask
*"наверное тут просто тихо"* and you are safe and learn nothing.

## Status

Working: the Lord CLI end to end, the artifact format and its validator, mission-graph and
space generation, the indexed-PNG art pipeline with terminal curation, the player
(tilemap, room-snap camera, walking character, collision, door gating), the patch system
and its invariant, the heartbeat, cycles and the journal, the dialogue panel, the debug
overlay.

Not built, by design: Retro Diffusion calls, any model inference, Codex OAuth, the memory
economy, federation, and the finale judge.

## Notes for later

- The browser-hostable path for ChatGPT/Codex auth is the **device-code** flow, not the
  loopback redirect — a hosted server cannot claim `http://localhost:<port>/auth/callback`.
  Worth stating once: the Codex CLI's `client_id` is the CLI's, and routing a game's
  inference through it is very likely outside OpenAI's terms. The seam is therefore
  provider-shaped, and a plain BYOK key is the other implementation.
- Never give the Retro Diffusion key a `VITE_` prefix. Vite inlines `VITE_*` into the
  client bundle, which would publish it to every player. It is a CLI-side variable; see
  `.env.example`.
