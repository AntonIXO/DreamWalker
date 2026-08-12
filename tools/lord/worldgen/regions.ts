/**
 * What each mission node *is*, once the dream is a world rather than a building.
 *
 * Dormans' split survives this change untouched: the mission graph still says what gates
 * what, and `missionGraph.ts` is not modified at all. What changes is the reading. A
 * dungeon renders a mission node as a room and an edge as a corridor; an overworld renders
 * a node as a **place** and an edge as a **route**. That is the whole of the difference,
 * and it is why the generator did not need rewriting to stop making dungeons.
 *
 * The mapping is deliberately not one-to-one with `NodeType`, because a Pokémon overworld
 * does not have seven kinds of place — it has towns you talk in, routes you cross, and
 * landmarks that mean something. Degree and access level decide the rest: a node with many
 * neighbours is a junction and wants to be a town whatever the mission calls it.
 */

import {
  NodeType,
  type MissionGraph,
  type MissionNode,
} from "../../../src/shared/dream";

/**
 * What a place is for. Drives its footprint, its terrain, and whether people live in it.
 */
export const RegionKind = {
  /** People, buildings you walk into, no wild grass. The safe squares of the map. */
  TOWN: "town",
  /** Open country you pass through. Grass, water, the occasional nook. */
  WILD: "wild",
  /** One feature the world is built around: a lake, a stand of trees, a ruin. */
  LANDMARK: "landmark",
  /** Inside a building. Reached by a warp, never by walking. */
  INTERIOR: "interior",
} as const;

export type RegionKindName = (typeof RegionKind)[keyof typeof RegionKind];

export interface Region {
  nodeId: string;
  kind: RegionKindName;
  biome: string;
  /** Whether the sanitar arrives here, so the generator can keep the first screen calm. */
  isStart: boolean;
  isEnd: boolean;
  /** How many buildings to try to fit. Towns only. */
  buildings: number;
}

/**
 * Biomes, in the order they are handed out along the critical path.
 *
 * Sequenced rather than scattered, because a world that changes as you get further from
 * home reads as a journey, and one that changes at random reads as noise. This is the
 * cheapest version of the thing Gen 1 does by hand.
 */
const BIOME_SEQUENCE = ["meadow", "wood", "marsh", "ash"] as const;

/** Places with at least this many neighbours are junctions, and junctions want people. */
const TOWN_DEGREE = 3;

function degrees(graph: MissionGraph): Map<string, number> {
  const count = new Map<string, number>();
  for (const node of graph.nodes) count.set(node.id, 0);
  for (const edge of graph.edges) {
    count.set(edge.from, (count.get(edge.from) ?? 0) + 1);
    count.set(edge.to, (count.get(edge.to) ?? 0) + 1);
  }
  return count;
}

function kindFor(
  node: MissionNode,
  degree: number,
  graph: MissionGraph,
): RegionKindName {
  // Where you arrive and where you are going are both towns: the first so the dream opens
  // somewhere legible, the last so the end of the road is a place and not a field.
  if (node.id === graph.startId || node.id === graph.endId)
    return RegionKind.TOWN;

  switch (node.type) {
    // A key is leverage somebody holds, so it needs somebody to hold it, so it needs a
    // building for them to be in.
    case NodeType.KEY:
      return RegionKind.TOWN;
    // A puzzle is something only the world gives up (§3's safe channel) and a lever is a
    // way round the sleeper forgot — both are features, not settlements.
    case NodeType.PUZZLE:
    case NodeType.LEVER:
      return RegionKind.LANDMARK;
    case NodeType.LOCK:
      return RegionKind.LANDMARK;
    default:
      return degree >= TOWN_DEGREE ? RegionKind.TOWN : RegionKind.WILD;
  }
}

export function classifyRegions(graph: MissionGraph): Map<string, Region> {
  const degree = degrees(graph);
  const maxAccess = Math.max(1, ...graph.nodes.map((n) => n.accessLevel));

  const regions = new Map<string, Region>();
  for (const node of graph.nodes) {
    const kind = kindFor(node, degree.get(node.id) ?? 0, graph);

    // Biome tracks how deep into the mission you are, not where you are on the map, so
    // the world gets stranger as the dream gets harder rather than as you walk east.
    const step = Math.min(
      BIOME_SEQUENCE.length - 1,
      Math.floor((node.accessLevel / maxAccess) * BIOME_SEQUENCE.length),
    );

    regions.set(node.id, {
      nodeId: node.id,
      kind,
      biome: BIOME_SEQUENCE[step]!,
      isStart: node.id === graph.startId,
      isEnd: node.id === graph.endId,
      buildings:
        kind === RegionKind.TOWN ? (node.id === graph.startId ? 2 : 3) : 0,
    });
  }
  return regions;
}

/** Names in the dream's own language. The Lord may overwrite any of them by hand. */
const NAMES: Record<RegionKindName, string[]> = {
  [RegionKind.TOWN]: ["Посёлок", "Слобода", "Двор", "Станция"],
  [RegionKind.WILD]: ["Поле", "Пустошь", "Луг", "Тропа"],
  [RegionKind.LANDMARK]: ["Озеро", "Развалины", "Роща", "Колодец"],
  [RegionKind.INTERIOR]: ["Дом", "Комната", "Внутри"],
};

export function nameFor(region: Region, counters: Map<string, number>): string {
  if (region.isStart) return "Дом";
  if (region.isEnd) return "Дальний двор";

  const options = NAMES[region.kind];
  const base = options[(counters.get(region.kind) ?? 0) % options.length]!;
  const used = (counters.get(region.kind) ?? 0) + 1;
  counters.set(region.kind, used);

  const repeat = Math.floor((used - 1) / options.length) + 1;
  return repeat > 1 ? `${base} ${repeat}` : base;
}
