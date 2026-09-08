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

bun run lord init son            # title, genre contract, style words, palette
bun run lord secret son          # the sealed mnemonic
bun run lord import son          # rooms + souls from dream-walker-anton/
bun run lord rooms son --rebind  # attach bible links
bun run lord rooms son --check   # walk doors and links from the courtyard
bun run lord figures son         # default deal (Turyshev on the bench, …)
bun run lord backdrops son       # room paintings
bun run lord clues son --yes     # six wordless objects
bun run lord build son           # validate and publish to public/dream/
bun run lord play son            # build, then serve it at localhost:8080
```

For normal development, run `bun run dev`. It starts Vite on `:8080` and the Bun API on
`:8081`. Run `bun run build && bun run start` for the production server.

`bun run lord status` shows what is done and what is not. Every command also takes flags
(`--title`, `--seed`, `--yes`, …) so the whole flow scripts without a human.

### Playing

`WASD`/arrows to walk, `E` to speak or pick up/examine, `I` for inventory and free-form
item commands, `J` for the people journal, `N` for the
six-word notebook, `M` to spend a memory for two minutes, `Esc` to step away, and `H` for controls. `F1`, `B`, and `K`
are debug controls.

### Autosave

An active dream resumes automatically when the same browser opens the same site again.
A local checkpoint is written every second, on page hide, and after entering the dream,
a cycle reset or an ending. It includes the player position, live world and inventory,
cycle timer, NPC conversations, notebook and memory. Closed-browser time does not count
against the cycle timer. In-flight model calls and room transitions keep the last complete
checkpoint until they finish.

This first version has one local slot per dream, with no account or cross-device sync.
Clearing site data removes it. Changed dream artifacts or save format versions are refused
with a notice; there is no migration yet. Storage failures leave the previous checkpoint
intact and show a warning. `window.dreamWalker.saveNow()` writes a checkpoint for debugging.

## What is where

```
dreams/<slug>/     the authored dream. draft.json is the authoring state; dream.json,
                   atlas.png and atlas.json are the build output. secret.local.txt holds
                   the plaintext secret and is gitignored — it never ships.
                   content/rooms/*.json contains room prose + graphics; content/characters/
                   contains personality + portrait states; content/clues/ contains public
                   clue cards. mnemonic.local.json is the private clue-to-word map.
tools/lord/        the CLI. rooms/figures/import are the catalog path; art/ the tile
                   pipeline; term/ the terminal UI including the truecolor pixel preview.
src/shared/        the artifact format and tile vocabulary, read by both sides.
src/player/        the web game: render/, game/, ui/, mind/.
src/server/        OAuth/account RPC, AI agents, API, and static production server.
```

## How the world is made

There is no generated overworld. The diary in `dream-walker-bible.md` / `dream-walker-anton/`
*is* the mission: 25 places, 4 meta-spaces, 14 figures. Rooms are ASCII boxes with
authored connections. You leave a room by walking into a threshold — a door, a staircase,
a one-way lift, or a `rift`, which is a doorway that comes out somewhere it should not.
Inhabit deals every card into a new arrangement each run;
training does the same shuffle locally so the game starts without a model.

Every rule application is validated and rolled back if it would make the dream
unsolvable, so what the Lord is offered is always crossable. There is no solver beyond
that, on purpose (§2): the person at the keyboard decides whether a map is any good.

## Inventory and actions in words

Press **I** or the **Вещи** button to open the inventory. It lists what the player
carries and visible objects nearby, including contents of open containers. Selecting
an item gives commands such as «подними её», «отдай её Турышеву» and «напиши на ней
не трогать» a concrete subject. The object action menu (**F**) also opens this view.
Examine and put-down buttons work directly; free-form commands use the configured AI.

Commands can take, drop, give, put, open, close, activate or use existing objects,
and break, wet, dirty, clean or inscribe them when possible. Changes persist in the
actual object state. The courtyard urn is an open container. Other gestures can be
observed without pretending that an unsupported physical transformation happened.
Distance, ownership, authored refusals and fixed structures still matter.

The engine applies commands as the player, runs the room's reactions, records World
Mind witnesses, and can show short responses from NPCs who observed the outcome.
Failed steps stop the remaining plan; closing or cancelling a pending command applies
nothing from its late response. Inventory and command history survive reloads;
pre-container saves are upgraded without losing held objects or notebook entries.

## World Mind and NPC decisions

World Mind keeps a bounded ledger of physical actions and their observed results.
NPCs receive their own actions and events they witnessed nearby, with walls and
closed containers limiting perception. Arriving later does not reveal past events.
The sleeper receives the full ledger when planning the next cycle; the Eye retains
its authored knowledge of deaths.

NPCs can `observe_world` and `preview_actions` before acting. A preview runs on a
copy, stops at the first refusal, and cannot change the game or spend the physical
action budget. Actual tools remain bound to the speaking figure. Repeating a refused
action in an unchanged world does not execute it again.
Turns are capped at eight physical attempts and twelve model decision steps, with a
60-second dialogue deadline. A valid final reply from the tool phase is reused to
avoid a redundant model call.

Each figure retains a short unfinished intent and the browser's execution feedback.
If replay fails, the next turn sees the failure even when the model predicted success.
Goals guide the next conversation; they do not schedule hidden background actions.
The ledger, intents and feedback survive a reload and clear with the cycle, while
the sleeper's summary survives as before.

## The heartbeat

The sleeping mind plans its defence when a cycle ends (§5, §6), not on a wall-clock
interval. The outgoing cycle is summarized for the model, the artifact is restored in
place, and the returned patch plan is applied to the fresh cycle. Figures forget their
conversation; the sanitar's journal and the sleeper's compact understanding persist.

Every model change is a typed `MapPatch`. The server discards unknown ids, caps the plan,
and the heartbeat refuses visible geometry. `applyPatch` owns all tile writes and keeps
the world structurally coherent, but deliberately does not run a solvability solver: a
defending dream is allowed to make a later cycle impossible, as §6 specifies.

## Authoring rooms and characters

`lord content <slug>` creates the content skeleton without overwriting existing cards.
The checked-in files are deliberately plain JSON so an author can write them directly:

- `content/rooms/*.json` — room name, description, atmosphere, personality, tags,
  compatible physical room ids, graphics roles, optional backdrop PNG, glitch preset,
  and normalized figure/object/clue anchors;
- `content/characters/*.json` — the exact figure id, name, personality, role, voice,
  desire, fear, taboo, initial activity, and four suspicion portrait frame names;
- `content/settings.json` — how many cards from the larger room catalog are active;
- `content/clues/*.json` — only public sensory direction and generated image paths.

The model receives this catalog and current assignments. It may move existing figures,
props and equally-sized room cards, but the server rejects unknown ids; it cannot invent a
new personality or room. `lord build` validates every figure id, room id, atlas role,
portrait frame and clue image reference before publishing format v3.

For a full-room PNG, put the source at
`dreams/<slug>/content/assets/rooms/<name>.png` and set the card to
`"backdropImage": "assets/rooms/<name>.png"`. The player draws it inside the structural
wall ring, above placeholder tiles and below figures; collision and door geometry stay
authored by the map.

The renderer uses a fixed 640×360 logical frame and nearest-neighbour integer enlargement.
Current generated map tiles remain 16×16 foundation art; final human room art can be added
through each room card without changing AI contracts or the physical map.

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

Terrain candidates are still drawn procedurally by `tools/lord/art/candidates.ts`.
Mnemonic clue objects use Retro Diffusion at author time through `lord clues`: the command
checks live style limits, performs a free cost estimate, submits async jobs with retry and
backoff, then runs a 32×32 downscale, palette conversion and pixel correction. Only the
chosen PNGs ship. Runtime never calls an image model.

The public artifact contains no answer text. It carries six known BIP39 positions, six
empty positions and the SHA-256 commitment. Six generated objects encode the hidden nouns
semantically; the player writes hypotheses manually, and the exact ordered 12-word phrase
is validated only at the finale. The phrase is a dummy game flag and must never hold funds.

## AI runtime

`src/server/agent-runtime.ts` contains four schema-validated model agents and one exact
server-side judge:

- inhabit installs the six authored personalities, authored clue interests, room moods,
  and safe ambient interests without seeing the sealed mnemonic;
- dialogue streams a figure's answer, may yield only that figure's shard, and enforces
  that every tell quotes an exact substring of the player's current words inside one
  short visible reply;
- examine is the safe, slow channel — things do not suspect, and a thing may yield only
  the shard assigned to that exact world interest;
- cycle exit compresses sleeper memory and proposes only the closed patch vocabulary;
- finale is not generative: it normalizes twelve words, validates the English BIP39
  checksum and compares the SHA-256 commitment exactly. A miss never reveals the answer.

`RemoteMind` keeps the last six lines and a compact summary per figure for the current
cycle, plus persistent discovered shards, sleeper
tells, and exactly three irreplaceable player memories. A memory can be offered in a
conversation or burned with `M` for `+2:00`. Any failed call falls back per action to
`ScriptedMind`; the Pixi ticker keeps rendering while only simulation is paused.

Generated population is cached under `.dreamwalker/runtime/`, keyed by dream slug and
sealed-secret hash. A disconnected first run receives a deterministic population made
from the same six authored character cards rather than an empty map.

### Codex OAuth (default)

Install the official `codex` CLI, start the game, and choose “Подключить ChatGPT”. The
server asks `codex app-server` for a device code; the player opens the verification URL
and authorizes it. Inference then runs through `ai-sdk-provider-codex-app-server` using
`gpt-5.6-luna`, `xhigh`, stateless threads, read-only sandbox, and the user's Codex plan
limits. No OpenAI API key is requested or stored by the game.

OAuth state lives under `.dreamwalker/codex-home` by default. Override the executable or
state directory with `DREAMWALKER_CODEX_PATH` and `DREAMWALKER_CODEX_HOME`.

### Anthropic Messages-compatible provider

Set the proxy URL and token to bypass Codex OAuth. The model defaults to
`gemini-3.8-flash-high` and remains overridable:

```bash
ANTHROPIC_BASE_URL=http://localhost:8091 \
ANTHROPIC_AUTH_TOKEN=anything \
ANTHROPIC_MODEL=gemini-3.8-flash-high \
bun run start
```

The server normalizes the base URL to `/v1`, sends the token as bearer auth, and accepts
JSON-in-text compatibility responses while still validating every result with Zod. The
token remains server-side and is never bundled by Vite.

### OpenAI-compatible provider (CloseRouter)

`OPENAI_KEY` is a CloseRouter bearer. With it set, the server uses
https://api.closerouter.dev/v1 unless `DREAMWALKER_AI_PROVIDER` forces another backend.

```bash
DREAMWALKER_AI_PROVIDER=openai
OPENAI_BASE_URL=https://api.closerouter.dev/v1
OPENAI_KEY=closerouter_…
OPENAI_MODEL=openai/gpt-5.6-luna
```

## Status

Working: format-4 authored rooms, bible link graph, inhabit/training catalog deal,
indexed-PNG art pipeline, PixiJS player, typed runtime patches, AI
population/dialogue/examination/cycle/finale, Codex device OAuth, an
Anthropic-compatible provider, OpenAI-compatible CloseRouter (`openai/gpt-5.6-luna`),
persistent memory economy, journal, and deterministic offline fallback.

Not built: final human-painted room/portrait atlases and multi-server dream federation.

## Verification

`bun test` covers provider URL normalization, cycle extension, persistent/spent memory,
and patch/reset behavior. `bun run build` performs the full typecheck and Vite build;
`bun run lint` includes Prettier enforcement.

Never give a runtime credential a `VITE_` prefix. Vite inlines `VITE_*` into the client
bundle. See `.env.example` for the server-only variables.
