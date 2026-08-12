/**
 * Space generation — the second half of Dormans' split. The mission graph says what
 * gates what; this decides where any of it is.
 *
 * Rooms are placed on a lattice two cells apart, then every mission edge is routed
 * through the free cells between them with A*. The cells a route passes through become
 * corridors. One mission graph unfolds into a thousand maps, which is the whole point
 * of keeping the two separate — and it is what lets the sleeper rearrange the space
 * later without the mission falling apart.
 */

import type { MissionEdge, MissionGraph } from "../../../src/shared/dream";
import type { Rng } from "./rng";

export type Dir = "n" | "e" | "s" | "w";

export const DIRS: Record<Dir, { dx: number; dy: number }> = {
  n: { dx: 0, dy: -1 },
  e: { dx: 1, dy: 0 },
  s: { dx: 0, dy: 1 },
  w: { dx: -1, dy: 0 },
};

export const OPPOSITE: Record<Dir, Dir> = { n: "s", e: "w", s: "n", w: "e" };

export interface CellPos {
  cx: number;
  cy: number;
}

export interface LayoutCell extends CellPos {
  kind: "room" | "corridor";
  /** Mission node this cell realises, for `room` cells. */
  nodeId: string | null;
  /** Mission edges whose route passes through, for `corridor` cells. */
  edgeIds: string[];
  /** Sides this cell opens onto. Drives where walls get carved. */
  connections: Dir[];
}

export interface RouteResult {
  edgeId: string;
  /** Mission edge endpoints, kept in the graph's own direction. */
  fromRoomId: string;
  toRoomId: string;
  /** Corridor cells only, ordered from `fromRoomId` to `toRoomId`. */
  cells: CellPos[];
  /** The room the door is cut into — always the deeper of the two. */
  doorRoomId: string;
  otherRoomId: string;
  /** Which wall of `doorRoomId` the door sits in. */
  doorSide: Dir;
  doorCell: CellPos;
}

export interface Layout {
  cells: LayoutCell[];
  routes: RouteResult[];
  /** Node id -> its cell, after normalising to a 0-based grid. */
  nodeCells: Map<string, CellPos>;
  widthCells: number;
  heightCells: number;
}

const PLACEMENT_ATTEMPTS = 240;
/** How far outside the placed rooms a corridor may wander looking for a way round. */
const ROUTING_MARGIN = 3;
/** Straight corridors read better than staircases, so turning costs a little. */
const TURN_PENALTY = 0.6;
/**
 * A loop that takes fifteen cells to close is not a loop, it is a hike. When a route
 * gets that long the placement is bad, so throw the whole attempt away and re-place.
 */
const MAX_ROUTE_CELLS = 9;

const key = (cx: number, cy: number): string => `${cx},${cy}`;

/**
 * Breadth-first over the mission graph, so a room is always placed next to something
 * already on the board. Levers are skipped as parents — they are one-way backdoors,
 * and letting them define the tree drags shortcuts into the middle of the map.
 */
function spanningOrder(
  graph: MissionGraph,
): Array<{ id: string; parent: string | null }> {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  const order: Array<{ id: string; parent: string | null }> = [];
  const seen = new Set([graph.startId]);
  const queue = [graph.startId];
  order.push({ id: graph.startId, parent: null });

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      order.push({ id: next, parent: current });
      queue.push(next);
    }
  }

  // Any node the traversal missed would mean a disconnected graph, which
  // generateMissionGraph already rejects — but place them rather than lose them.
  for (const node of graph.nodes) {
    if (!seen.has(node.id)) order.push({ id: node.id, parent: null });
  }
  return order;
}

function tryPlaceRooms(
  graph: MissionGraph,
  rng: Rng,
): Map<string, CellPos> | null {
  const placed = new Map<string, CellPos>();
  const taken = new Set<string>();

  const claim = (id: string, cx: number, cy: number): void => {
    placed.set(id, { cx, cy });
    taken.add(key(cx, cy));
  };

  claim(graph.startId, 0, 0);

  for (const { id, parent } of spanningOrder(graph)) {
    if (placed.has(id)) continue;
    if (parent === null) return null;
    const anchor = placed.get(parent);
    if (!anchor) return null;

    let settled = false;
    for (const dir of rng.shuffle(Object.keys(DIRS) as Dir[])) {
      const { dx, dy } = DIRS[dir];
      const cx = anchor.cx + dx * 2;
      const cy = anchor.cy + dy * 2;
      // The cell between must stay free too, or there is nowhere to run the corridor.
      if (
        taken.has(key(cx, cy)) ||
        taken.has(key(anchor.cx + dx, anchor.cy + dy))
      )
        continue;
      claim(id, cx, cy);
      settled = true;
      break;
    }
    if (!settled) return null;
  }

  return placed;
}

interface RouteContext {
  occupiedByRoom: Set<string>;
  usedByCorridor: Set<string>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * A* between two room cells. Rooms other than the endpoints are impassable, and a
 * corridor cell already claimed by another route is too — two passages sharing a cell
 * would silently weld together two parts of the mission that the graph keeps apart.
 */
function routeBetween(
  from: CellPos,
  to: CellPos,
  ctx: RouteContext,
): CellPos[] | null {
  const startKey = key(from.cx, from.cy);
  const goalKey = key(to.cx, to.cy);

  const heuristic = (cx: number, cy: number): number =>
    Math.abs(cx - to.cx) + Math.abs(cy - to.cy);

  interface Frontier {
    cx: number;
    cy: number;
    cost: number;
    estimate: number;
    from: Dir | null;
  }

  const open: Frontier[] = [
    {
      cx: from.cx,
      cy: from.cy,
      cost: 0,
      estimate: heuristic(from.cx, from.cy),
      from: null,
    },
  ];
  const best = new Map<string, number>([[startKey, 0]]);
  const cameFrom = new Map<string, string>();

  while (open.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.estimate < open[bestIndex]!.estimate) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0]!;
    const currentKey = key(current.cx, current.cy);

    if (currentKey === goalKey) {
      const path: CellPos[] = [];
      let cursor: string | undefined = currentKey;
      while (cursor !== undefined) {
        const [cx, cy] = cursor.split(",").map(Number) as [number, number];
        path.push({ cx, cy });
        cursor = cameFrom.get(cursor);
      }
      path.reverse();
      // Endpoints are rooms; only the middle becomes corridor.
      return path.slice(1, -1);
    }

    for (const dir of Object.keys(DIRS) as Dir[]) {
      const { dx, dy } = DIRS[dir];
      const nx = current.cx + dx;
      const ny = current.cy + dy;
      const nextKey = key(nx, ny);

      if (nx < ctx.bounds.minX || nx > ctx.bounds.maxX) continue;
      if (ny < ctx.bounds.minY || ny > ctx.bounds.maxY) continue;
      if (nextKey !== goalKey) {
        if (ctx.occupiedByRoom.has(nextKey)) continue;
        if (ctx.usedByCorridor.has(nextKey)) continue;
      }

      const cost =
        current.cost +
        1 +
        (current.from !== null && current.from !== dir ? TURN_PENALTY : 0);
      if (cost >= (best.get(nextKey) ?? Infinity)) continue;

      best.set(nextKey, cost);
      cameFrom.set(nextKey, currentKey);
      open.push({
        cx: nx,
        cy: ny,
        cost,
        estimate: cost + heuristic(nx, ny),
        from: dir,
      });
    }
  }

  return null;
}

function directionBetween(a: CellPos, b: CellPos): Dir | null {
  for (const dir of Object.keys(DIRS) as Dir[]) {
    const { dx, dy } = DIRS[dir];
    if (a.cx + dx === b.cx && a.cy + dy === b.cy) return dir;
  }
  return null;
}

function accessOf(graph: MissionGraph, id: string): number {
  return graph.nodes.find((n) => n.id === id)?.accessLevel ?? 0;
}

function attemptLayout(graph: MissionGraph, rng: Rng): Layout | null {
  const placed = tryPlaceRooms(graph, rng);
  if (!placed) return null;

  const xs = [...placed.values()].map((c) => c.cx);
  const ys = [...placed.values()].map((c) => c.cy);
  const ctx: RouteContext = {
    occupiedByRoom: new Set([...placed.values()].map((c) => key(c.cx, c.cy))),
    usedByCorridor: new Set(),
    bounds: {
      minX: Math.min(...xs) - ROUTING_MARGIN,
      minY: Math.min(...ys) - ROUTING_MARGIN,
      maxX: Math.max(...xs) + ROUTING_MARGIN,
      maxY: Math.max(...ys) + ROUTING_MARGIN,
    },
  };

  // Short edges first: the tree edges claim their obvious single cell before the
  // long-way-round links start eating the space they need.
  const ordered = [...graph.edges].sort((a, b) => {
    const da = manhattan(placed.get(a.from)!, placed.get(a.to)!);
    const db = manhattan(placed.get(b.from)!, placed.get(b.to)!);
    return da - db;
  });

  const routes: RouteResult[] = [];
  const corridorEdges = new Map<string, string[]>();

  for (const edge of ordered) {
    const fromCell = placed.get(edge.from);
    const toCell = placed.get(edge.to);
    if (!fromCell || !toCell) return null;

    const path = routeBetween(fromCell, toCell, ctx);
    if (path === null || path.length === 0 || path.length > MAX_ROUTE_CELLS)
      return null;

    for (const cell of path) {
      const cellKey = key(cell.cx, cell.cy);
      ctx.usedByCorridor.add(cellKey);
      const list = corridorEdges.get(cellKey) ?? [];
      list.push(edge.id);
      corridorEdges.set(cellKey, list);
    }

    routes.push(describeDoor(graph, edge, fromCell, toCell, path));
  }

  return assemble(placed, routes, corridorEdges);
}

function manhattan(a: CellPos, b: CellPos): number {
  return Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
}

/**
 * The door goes in the wall of the deeper room. A gate should read as *this* room
 * refusing you, not as the corridor being fussy — and it keeps the shallow side of a
 * lock walkable so the player can see what they cannot yet reach.
 */
function describeDoor(
  graph: MissionGraph,
  edge: MissionEdge,
  fromCell: CellPos,
  toCell: CellPos,
  path: CellPos[],
): RouteResult {
  const fromIsDeeper = accessOf(graph, edge.from) > accessOf(graph, edge.to);
  const doorRoomId = fromIsDeeper ? edge.from : edge.to;
  const otherRoomId = fromIsDeeper ? edge.to : edge.from;
  const doorCell = fromIsDeeper ? fromCell : toCell;
  const neighbour = fromIsDeeper ? path[0]! : path[path.length - 1]!;
  const doorSide = directionBetween(doorCell, neighbour) ?? "n";

  return {
    edgeId: edge.id,
    fromRoomId: edge.from,
    toRoomId: edge.to,
    cells: path,
    doorRoomId,
    otherRoomId,
    doorSide,
    doorCell,
  };
}

function assemble(
  placed: Map<string, CellPos>,
  routes: RouteResult[],
  corridorEdges: Map<string, string[]>,
): Layout {
  const cells = new Map<string, LayoutCell>();

  for (const [nodeId, pos] of placed) {
    cells.set(key(pos.cx, pos.cy), {
      ...pos,
      kind: "room",
      nodeId,
      edgeIds: [],
      connections: [],
    });
  }
  for (const [cellKey, edgeIds] of corridorEdges) {
    const [cx, cy] = cellKey.split(",").map(Number) as [number, number];
    cells.set(cellKey, {
      cx,
      cy,
      kind: "corridor",
      nodeId: null,
      edgeIds,
      connections: [],
    });
  }

  // Walk each full route (room -> corridors -> room) and open both sides of every step.
  for (const route of routes) {
    const full: CellPos[] = [
      placed.get(route.fromRoomId)!,
      ...route.cells,
      placed.get(route.toRoomId)!,
    ];

    for (let i = 0; i < full.length - 1; i++) {
      const a = full[i]!;
      const b = full[i + 1]!;
      const dir = directionBetween(a, b);
      if (!dir) continue;
      addConnection(cells, a, dir);
      addConnection(cells, b, OPPOSITE[dir]);
    }
  }

  // Normalise so the grid starts at (0, 0) — but shift by an *even* amount. Rooms are
  // placed two apart from (0, 0), so they all sit on even coordinates, and `tiles.ts`
  // relies on that parity to give room columns a wide footprint and corridor columns a
  // narrow one. An odd shift would silently swap the two.
  const list = [...cells.values()];
  const minX = 2 * Math.floor(Math.min(...list.map((c) => c.cx)) / 2);
  const minY = 2 * Math.floor(Math.min(...list.map((c) => c.cy)) / 2);
  const shift = (pos: CellPos): CellPos => ({
    cx: pos.cx - minX,
    cy: pos.cy - minY,
  });

  const shiftedCells = list.map((cell) => ({ ...cell, ...shift(cell) }));
  const shiftedRoutes = routes.map((route) => ({
    ...route,
    cells: route.cells.map(shift),
    doorCell: shift(route.doorCell),
  }));
  const nodeCells = new Map<string, CellPos>();
  for (const [nodeId, pos] of placed) nodeCells.set(nodeId, shift(pos));

  return {
    cells: shiftedCells,
    routes: shiftedRoutes,
    nodeCells,
    widthCells: Math.max(...shiftedCells.map((c) => c.cx)) + 1,
    heightCells: Math.max(...shiftedCells.map((c) => c.cy)) + 1,
  };
}

function addConnection(
  cells: Map<string, LayoutCell>,
  pos: CellPos,
  dir: Dir,
): void {
  const cell = cells.get(key(pos.cx, pos.cy));
  if (cell && !cell.connections.includes(dir)) cell.connections.push(dir);
}

export function generateLayout(graph: MissionGraph, rng: Rng): Layout {
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const layout = attemptLayout(graph, rng);
    if (layout) return layout;
  }
  throw new Error(
    `could not lay out ${graph.nodes.length} rooms in ${PLACEMENT_ATTEMPTS} attempts — ` +
      `the recipe is probably making a graph too tangled for a 2D grid`,
  );
}
