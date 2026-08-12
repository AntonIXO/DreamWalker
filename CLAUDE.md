# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A top-down web game where a "sanitar" infiltrates a sleeping person's dream (see
`dream-walker-concept.md`, the design document). This repo is the technical foundation:
world editor, artifact format, player, heartbeat, and the model seam.

The world is **Pokémon-shaped, not dungeon-shaped**: towns joined by wide routes, a
treeline for a border, water and one-way ledges, buildings you walk into. It is generated
from a mission graph (Dormans) whose _space_ stage was replaced — the graph machinery is
unchanged and still correct.

Comments throughout reference the concept doc by section (`§3`, `§6`, …). When changing
behaviour those sections describe, read them first — several non-obvious decisions
(no solvability solver, no suspicion meter, height-is-never-a-gate) are deliberate and
explained there.

## Commands

```bash
bun install
bun run dev            # vite dev server on :8080, serves public/dream/
bun run start          # production API + built static game on :8080
bun run build          # tsc --noEmit && vite build
bun test               # Bun regression tests
bun run lint           # eslint .  (prettier runs as an eslint rule; --fix for formatting)
bun run lord <cmd>     # the world editor CLI
```

The Lord flow, in order. Each command also takes flags (`--title`, `--seed`, `--recipe`,
`--palette`, `--yes`, …) so the whole thing scripts without a TTY:

```bash
bun run lord init <slug>     # title, genre contract, style words, palette
                             #   palette is measured off assets/*.png when there is
                             #   exactly one; --palette ash forces a built-in instead
bun run lord secret <slug>   # the sealed line + hooks
bun run lord layout <slug>   # generate world, [r]eroll / [a]ccept
bun run lord art <slug>      # 4 tilesets per role, press 1-4
bun run lord figures <slug>  # place figures, assign hooks
bun run lord build <slug>    # validate + publish to public/dream/
bun run lord play <slug>     # build, then start the dev server
bun run lord status [slug]   # what is done and what is not
```

Tests use Bun's built-in runner. Browser behavior is still verified by driving the live
game from the console — see "Verifying changes" below.

## Architecture

### Two programs and one file between them

This is the single most important thing to understand, and it is easy to get backwards.

- **`tools/lord/`** — a CLI, run by a human author, offline, once per dream. It generates
  and curates. Runs under bun, so it may use `node:fs`, `node:zlib`, etc.
- **`src/player/`** — the web game. It loads exactly one artifact and generates no
  _world_. One server, one dream, one secret (§8).
- **`src/shared/`** — the contract: artifact types, validator, tile vocabulary, autotiling,
  RNG, **and the tile-drawing code** (`src/shared/art/`). Must stay free of DOM _and_ node
  APIs, since both sides import it.

`src/player/` must never import from `tools/`. Randomness at author time is a reroll knob;
the accepted output is committed data. Nothing re-derives a world from a seed at runtime.

**The one exception, and it is deliberate:** `src/player/render/foundry.ts` mints tile art
at runtime when the sleeper makes terrain the Lord never baked (§6 — "разум подкинул").
It is not free invention — it calls the same `src/shared/art/terrain.ts` the CLI called,
with the same palette and the same measured `StyleProfile`, so a tile minted mid-cycle is
drawn by the same code as one baked last week. The Lord chooses what the world is made of;
the sleeper chooses what it makes with it.

### Artifact lifecycle

```
dreams/<slug>/draft.json         authoring state, may be half-finished, hand-editable
dreams/<slug>/secret.local.txt   plaintext secret — gitignored, never ships
        ↓ lord build (the only place the full validator runs)
dreams/<slug>/dream.json + atlas.png + atlas.json
        ↓ copied
public/dream/                    gitignored; what the player fetches
```

`validateDreamArtifact` (`src/shared/dream.ts`) runs at build time _and_ again in the
browser at load. It checks relational invariants, not just shapes — doors pointing at real
rooms, no lock whose key sits behind it. The artifact carries `secretHash` only.

### Generation pipeline (author time)

`tools/lord/worldgen/`, run in sequence by `lord layout`:

1. `missionGraph.ts` — a port of GraphDungeonGenerator (Dormans' mission/space split).
   Grows `start → end` by grammar rules within `recipe.ts` budgets. **Every rule
   application is snapshotted, applied, validated, and rolled back on failure**, so the
   returned graph is always crossable. Access level = fewest gates from start, computed by
   0-1 BFS; lever edges are one-way and excluded from it.
2. `layout.ts` — places mission nodes on a lattice two cells apart, then routes every edge
   with A*. Unchanged from the dungeon version: it is a good skeleton whatever gets drawn
   on it. Node cells become **places**, route cells become **roads**.
3. `regions.ts` — decides what each node _is_: town, wild, landmark. Degree and access
   level, not just node type — a junction wants people whatever the mission calls it.
4. `overworld.ts` — the tile fill, in eight layers, each subordinate to the one before:
   walkable mask → elevation → water → biome ground → tall grass → treeline → ledges and
   gates → towns and interiors. **Every layer may only take walkable ground away**, which
   is what makes the reachability check at the end almost always pass.

`commands/layout.ts` calls `strandedRegions()` and rerolls any world whose terrain walled a
place off. This is _not_ the solvability solver §2 forbids — it does not ask whether the
dream can be understood, only whether the generator's own layers accidentally built a wall.
It has caught real bugs (a building across the only road; a cliff face spanning a route).

### Runtime (player)

`createWorld(artifact)` builds a mutable `WorldState`; the artifact stays the immutable
starting state. **`src/player/game/patch.ts` is the only thing allowed to write to
`world.tiles`.** Everything the sleeper does arrives as a `MapPatch` and goes through
`applyPatch`, which keeps ids, tile spans, indexes, and mutable structures coherent. It
does not solve the resulting map: §6 deliberately leaves reachability to the sleeper's
prompt, so a defensive cycle may become impossible.

`mind/heartbeat.ts` runs the model on cycle exit; `B` can force it for debugging. Two
rules live in the heartbeat, **not** in the model, because the model is not trusted to be
polite:

- it never applies a patch overlapping **what is currently on screen** (`camera.visibleTiles()`),
  read _after_ the mind's await, because a model turn takes seconds and the player keeps walking;
- it caps patches per beat and calls per cycle.

Cycle reset first plans from the outgoing observation, then runs `resetWorld` and applies
that plan to the fresh cycle before resetting observations. It restores **in place**. Do not rebuild
`world`/`heartbeat` on reset — the tilemap, mind, and debug overlay all hold long-lived
references to them.

### The AI seam

`src/player/mind/types.ts` is the browser contract. `remote.ts` calls the Bun API and
falls back per request to deterministic `scripted.ts`. `src/server/agent-runtime.ts`
contains schema-validated dialogue, examine, cycle-exit, and finale agents. The default
provider uses Codex device OAuth through `codex app-server`, pinned to `gpt-5.6-luna` at
`xhigh`; setting the three `ANTHROPIC_*` variables selects an Anthropic
Messages-compatible endpoint instead. The finale agent alone sees the plaintext secret.

`tools/lord/art/candidates.ts` is the art seam (`CandidateSource`). Replacing the
procedural generator with Retro Diffusion changes that function body only, and stays
author-time — never runtime.

## Things that will bite you

- **Cell coordinate parity is load-bearing.** `tiles.ts` gives even columns/rows a
  room-sized footprint and odd ones a narrow lane. Rooms are placed on even coordinates,
  so `layout.ts` normalises the grid by an _even_ shift. An odd shift silently swaps rooms
  and corridors.
- **Door tile spans are duplicated** — `doorSpan` in `tools/lord/worldgen/tiles.ts` and
  `doorTiles` in `src/player/game/world.ts`. They must agree; move them to `src/shared/`
  if you touch either.
- **Frame names are a cross-module string contract**: `tools/lord/art/silhouettes.ts`
  writes `player_<dir>_<frame>` / `figure_<archetype>_<dir>_<frame>`, and
  `src/player/render/walkerView.ts` reconstructs them. Atlas frames must all be
  `tileSize × tileSize`; `bakeAtlas` throws otherwise.
- **Two tile→role maps** in `src/shared/tilecodes.ts`: `TILE_ROLE` (atlas frames) and
  `TILE_PALETTE_ROLE` (one flat colour, for minimaps and the terminal preview). Keep both
  updated when adding a tile.
- **`isSolidTile` deliberately excludes doors.** Whether a door is passable depends on
  what the player carries; that lives in `world.ts:canPassDoor`, not in the tile grid.
- **The atlas is an indexed PNG** written by hand in `tools/lord/art/png.ts`. Index 0 is
  transparency, so a dream palette index `i` is stored as `i+1`. The palette limit is
  enforced by the file format, which is the point.

## Conventions

- Code, identifiers and comments in English; in-fiction text shown to the player (room
  names, dialogue, HUD) in Russian.
- The `ScriptedMind` keyword lists are **stems**, not words — Russian inflects, and whole
  words would let a player walk past every tell by declining a noun.
- No suspicion meter, ever (§3). Being noticed arrives as something a figure _says_, with
  the player's own words quoted back.

## Verifying changes

`window.dreamWalker` exposes the live game (`world`, `player`, `heartbeat`,
`observations`, `cycle`, `journal`, `restartCycle`).

When driving the browser from an agent, note that a **backgrounded tab freezes
`requestAnimationFrame`**, so the game loop stops and nothing appears to respond. Drive the
real loop manually instead:

```js
const d = window.dreamWalker;
let t = performance.now();
for (let i = 0; i < 60; i++) {
  t += 16.7;
  d.app.ticker.update(t);
}
```

Synthetic input must be a sustained `keydown` (movement reads held keys, not taps):
`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }))`.

In-game: `H` controls panel, `F1` debug overlay (live minimap, mission graph with access
levels, patch log including refusals), `B` force a heartbeat, `K` grant every key.

Key labels in `ui/controls.ts` are derived from `input.ts:keyFor()` rather than copied, so
rebinding updates the panel. Bindings are by `event.code` — a _physical_ key, not a
character — so `preventDefault` on a bound key while the player is typing eats a letter
(`KeyD` is `в` on a Russian layout). `Input` therefore never cancels a key it is not going
to act on; see the comment at the top of that file before touching it.
