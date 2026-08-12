/**
 * `lord figures <slug>` — put people in the rooms and hand them what they know.
 *
 * §2 is firm that this is a *seeding*, not a schema: the Lord decides who starts out
 * holding which hook, and from then on the sleeping mind may move them. So this command
 * proposes a spread and lets the Lord reroll it — it is not solving anything.
 *
 * Hooks go to rooms that already mean something in the mission: the leverage a lock
 * needs sits in the room the graph called a key, which is what makes the map's shape
 * and the story's shape the same shape.
 */

import {
  NodeType,
  decodeTiles,
  type FigurePlacement,
  type Room,
} from "../../../src/shared/dream";
import { isFloorTile } from "../../../src/shared/tilecodes";
import { ARCHETYPES } from "../art/silhouettes";
import { loadDraft, saveDraft } from "../project";
import { makeRng, randomSeedWord, type Rng } from "../worldgen/rng";
import {
  color,
  heading,
  isInteractive,
  note,
  ok,
  readOneOf,
} from "../term/prompt";
import type { Flags } from "../cli";

const FIGURE_NAMES = [
  "Санитарка",
  "Человек в халате",
  "Кто-то в очереди",
  "Женщина у окна",
  "Мальчик",
  "Дежурный",
  "Тот, кто ждёт",
  "Соседка",
];

/** A spot inside the room that is actually floor and not the doorway everyone uses. */
function standingSpot(
  room: Room,
  tiles: Uint8Array,
  width: number,
  rng: Rng,
  taken: Set<string>,
): { x: number; y: number } | null {
  const cx = room.rect.x + Math.floor(room.rect.w / 2);
  const cy = room.rect.y + Math.floor(room.rect.h / 2);

  for (let attempt = 0; attempt < 40; attempt++) {
    // Start at the middle and widen, so figures gravitate to where you will see them.
    const spread = 1 + Math.floor(attempt / 8);
    const x = cx + rng.int(-spread, spread);
    const y = cy + rng.int(-spread, spread);
    const key = `${x},${y}`;
    if (taken.has(key)) continue;
    if (!isFloorTile(tiles[y * width + x] ?? 0)) continue;
    taken.add(key);
    return { x, y };
  }
  return null;
}

function propose(
  draft: Awaited<ReturnType<typeof loadDraft>>,
  seed: string,
): FigurePlacement[] {
  const map = draft.map;
  if (!map) throw new Error("no layout yet — run `lord layout` first");

  const rng = makeRng(seed);
  const tiles = decodeTiles(map.tiles, map.width * map.height);
  const taken = new Set<string>();

  const rooms = map.rooms.filter((r) => r.kind === "room");
  const keyRooms = rng.shuffle(
    rooms.filter((r) => r.nodeType === NodeType.KEY),
  );
  const otherRooms = rng.shuffle(
    rooms.filter(
      (r) =>
        r.nodeType !== NodeType.KEY &&
        r.nodeType !== NodeType.START &&
        r.nodeType !== NodeType.END,
    ),
  );

  const hosts = [...keyRooms, ...otherRooms];
  const placements: FigurePlacement[] = [];
  const names = rng.shuffle(FIGURE_NAMES);

  // One holder per hook first.
  draft.shards.forEach((shard, i) => {
    const room = hosts[i];
    if (!room) return;
    const spot = standingSpot(room, tiles, map.width, rng, taken);
    if (!spot) return;
    placements.push({
      id: `figure${placements.length + 1}`,
      archetypeId: ARCHETYPES[placements.length % ARCHETYPES.length]!,
      name: names[placements.length % names.length]!,
      roomId: room.id,
      x: spot.x,
      y: spot.y,
      holdsShardId: shard.id,
    });
  });

  // Then a couple who know nothing, so holding something is not obvious from the map.
  const ambient = rng.int(1, 3);
  for (let i = 0; i < ambient; i++) {
    const room = hosts[draft.shards.length + i];
    if (!room) break;
    const spot = standingSpot(room, tiles, map.width, rng, taken);
    if (!spot) continue;
    placements.push({
      id: `figure${placements.length + 1}`,
      archetypeId: ARCHETYPES[placements.length % ARCHETYPES.length]!,
      name: names[placements.length % names.length]!,
      roomId: room.id,
      x: spot.x,
      y: spot.y,
      holdsShardId: null,
    });
  }

  return placements;
}

function show(
  placements: readonly FigurePlacement[],
  draft: Awaited<ReturnType<typeof loadDraft>>,
): void {
  console.log();
  for (const figure of placements) {
    const room = draft.map?.rooms.find((r) => r.id === figure.roomId);
    const shard = draft.shards.find((s) => s.id === figure.holdsShardId);
    const holds = shard
      ? color.yellow(shard.hint)
      : color.grey("knows nothing");
    console.log(
      `  ${color.bold(figure.name.padEnd(20))} ${color.grey((room?.name ?? figure.roomId).padEnd(18))} ${holds}`,
    );
  }
}

export async function figuresCommand(
  slug: string | undefined,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord figures <slug>");
  const draft = await loadDraft(slug);
  if (!draft.map)
    throw new Error(
      `"${slug}" has no layout yet — run \`lord layout ${slug}\``,
    );
  if (draft.shards.length === 0) {
    note("this dream has no hooks yet; figures will be placed knowing nothing");
  }

  heading(`Figures — ${draft.title}`);

  let seed = flags.seed ?? randomSeedWord();

  for (;;) {
    const placements = propose(draft, seed);
    show(placements, draft);

    const accept = async (): Promise<void> => {
      draft.figures = placements;
      await saveDraft(draft);
      console.log();
      ok(`${placements.length} figures placed`);
      console.log();
      note(`Next: bun run lord build ${slug}`);
    };

    if (!isInteractive() || flags.yes) return accept();

    console.log();
    const key = await readOneOf(
      ["r", "a", "q"],
      `${color.bold("r")}eroll · ${color.bold("a")}ccept · ${color.bold("q")}uit`,
    );
    if (key === "q") {
      note("nothing written");
      return;
    }
    if (key === "r") {
      seed = randomSeedWord();
      continue;
    }
    return accept();
  }
}
