# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A top-down web game where a "sanitar" infiltrates a sleeping person's dream.
`dream-walker-bible.md` and `dream-walker-new/` are the grammar; `dream-walker-concept.md`
is the AI/engine seam. This repo is the technical foundation: world editor, artifact
format, player, heartbeat, and the model.

The world is **29 authored rooms, not a generated overworld**. Travel is LSD linking
(touch a thing, hard cut) plus a few real hotel thresholds. The sleeper does not invent
rooms — it deals the catalog (all 25 places, 4 meta-spaces, 14 figures) into a new
arrangement each run.

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
bun run lord secret <slug>   # the sealed line + hooks
bun run lord import <slug>   # pull rooms/characters from dream-walker-new/
bun run lord rooms <slug>    # list / --rebind bible links / --check walkability
bun run lord art <slug>      # 4 tilesets per role, press 1-4
bun run lord figures <slug>  # place figures, assign hooks
bun run lord backdrops <slug> # room paintings (Retro Diffusion at author time)
bun run lord clues <slug>    # six wordless objects
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
the accepted output is committed data. The sleeper may reseat the catalog at inhabit and
cycle-exit; it may not invent rooms.

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

### Catalog (author time)

There is no worldgen. `dream-walker-new/rooms.md` and `characters/*/SOUL.md` are the
mission. `lord import` / `lord rooms --rebind` attach those links to authored ASCII
rooms. `lord rooms --check` walks doors **and** links from the courtyard spawn.

The default deal (Turyshev on the bench, Kirill in the ditch, artist in the hotel, Eye at
the finale) lives in `content/figures.json`. Inhabit may reseat anyone except the
gatekeeper and the Eye. Training does the same shuffle locally so play never waits on a
model.

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

- it never applies a patch overlapping **what is currently on screen** — both halves:
  the room id _and_ `camera.visibleTiles()`. `patchTouches` returns `PatchScope[]`
  (`{roomId, rect}`, `rect: null` meaning the whole room, which only `shiftWalls` claims),
  and the viewport is read _after_ the mind's await, because a model turn takes seconds and
  the player keeps walking. The room id alone was enough while a room was one screen; it is
  not once a floor is larger than the frame. `patchTouches` answers "what would the player
  notice" and is deliberately **not** `PatchResult.affectedRooms`, which answers "what must
  be redrawn" and still names both sides of a door;
- it caps patches per beat and calls per cycle.

Cycle reset first plans from the outgoing observation, then runs `resetWorld` and applies
that plan to the fresh cycle before resetting observations. It restores **in place**. Do not rebuild
`world`/`heartbeat` on reset — the tilemap, mind, and debug overlay all hold long-lived
references to them.

### The AI seam

`src/player/mind/types.ts` is the browser contract. `remote.ts` calls the Bun API and
falls back per request to deterministic `scripted.ts`. `src/server/agent-runtime.ts`
contains schema-validated inhabit, dialogue, examine, cycle-exit, and finale agents.
`ANTHROPIC_*` selects an Anthropic-compatible proxy (default model
`gemini-3.6-flash-high`). Without those variables the server uses Codex device OAuth
(`gpt-5.6-luna` at `xhigh`). Live inhabit may take a few seconds; on timeout or any
error the client installs `fallbackPopulation` and play continues. Training never
calls the model. The finale agent alone sees the plaintext secret.

`tools/lord/art/candidates.ts` is the art seam (`CandidateSource`). Replacing the
procedural generator with Retro Diffusion changes that function body only, and stays
author-time — never runtime.

## Things that will bite you

- **Hotel hub doors stay on the wall face.** Punching `_` under them turns the first
  floor row into a warp carpet. `punchDoorThresholds` skips y=1 and the south wall;
  the walker presses into the solid cell (`doorIsUsable`).
- **Links are the map.** `--wire` is a backup spine, not the grammar. The courtyard
  exit is the intercom, not the bottle (bottle → М4 is once, close-range, optional).
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
