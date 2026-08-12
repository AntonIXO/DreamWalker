/**
 * Mission graph generation — a TypeScript port of amidos2006/GraphDungeonGenerator,
 * which implements Joris Dormans' split between *mission* (what you do) and *space*
 * (where you do it). §6 of the concept keeps this as the starting layout only: the
 * Lord curates what comes out, and the sleeper rearranges it later.
 *
 * The graph is grown from `start -> end` by applying grammar rules within the budgets
 * in `recipe.ts`. Every rule application is validated and rolled back if it produces a
 * graph the player could not solve — a lock whose key sits behind it, an unreachable
 * room — so whatever this function returns is always crossable.
 */

import {
  NodeType,
  type MissionEdge,
  type MissionGraph,
  type MissionNode,
  type NodeTypeName,
} from "../../../src/shared/dream";
import { DoorType, type DoorTypeName } from "../../../src/shared/tilecodes";
import {
  RULE_NAMES,
  validateRecipe,
  type Recipe,
  type RuleName,
} from "./recipe";
import type { Rng } from "./rng";

/** Only start and end are pinned to a single connection; the lattice allows four. */
const MAX_DEGREE = 4;

interface Snapshot {
  nodes: MissionNode[];
  edges: MissionEdge[];
}

class GraphBuilder {
  readonly nodes = new Map<string, MissionNode>();
  edges: MissionEdge[] = [];
  readonly startId = "start";
  readonly endId = "end";

  private counters = new Map<string, number>();
  private edgeSeq = 0;
  private access = new Map<string, number>();

  constructor(private readonly rng: Rng) {
    this.nodes.set(this.startId, node(this.startId, NodeType.START));
    this.nodes.set(this.endId, node(this.endId, NodeType.END));
    this.addEdge(this.startId, this.endId, DoorType.OPEN, null);
    this.recomputeAccess();
  }

  // --- construction -------------------------------------------------------

  private nextId(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}${n}`;
  }

  addNode(type: NodeTypeName): MissionNode {
    const prefix = ID_PREFIX[type];
    const created = node(this.nextId(prefix), type);
    this.nodes.set(created.id, created);
    return created;
  }

  addEdge(
    from: string,
    to: string,
    door: DoorTypeName,
    keyId: string | null,
  ): MissionEdge {
    const edge: MissionEdge = {
      id: `e${this.edgeSeq++}`,
      from,
      to,
      door,
      keyId,
    };
    this.edges.push(edge);
    return edge;
  }

  removeEdge(id: string): void {
    this.edges = this.edges.filter((e) => e.id !== id);
  }

  // --- queries ------------------------------------------------------------

  degree(id: string): number {
    return this.edges.filter((e) => e.from === id || e.to === id).length;
  }

  maxDegreeOf(id: string): number {
    return id === this.startId || id === this.endId ? 1 : MAX_DEGREE;
  }

  hasRoom(id: string): boolean {
    return this.degree(id) < this.maxDegreeOf(id);
  }

  connected(a: string, b: string): boolean {
    return this.edges.some(
      (e) => (e.from === a && e.to === b) || (e.from === b && e.to === a),
    );
  }

  openEdges(): MissionEdge[] {
    return this.edges.filter((e) => e.door === DoorType.OPEN);
  }

  accessOf(id: string): number {
    return this.access.get(id) ?? Infinity;
  }

  nodeList(): MissionNode[] {
    return [...this.nodes.values()];
  }

  /**
   * Access level = the fewest gates between the start and a room. Open and lever
   * edges are free; key and puzzle doors cost one. Lever edges are one-way — they are
   * backdoors you open from the far side, so they must not make the room behind a
   * lock look cheap to reach.
   *
   * 0-1 BFS: zero-cost edges go to the front of the queue, gated ones to the back.
   */
  recomputeAccess(): void {
    const dist = new Map<string, number>([[this.startId, 0]]);
    const deque: string[] = [this.startId];

    while (deque.length > 0) {
      const current = deque.shift()!;
      const currentDist = dist.get(current)!;

      for (const edge of this.edges) {
        let next: string | null = null;
        if (edge.from === current) next = edge.to;
        else if (edge.to === current && edge.door !== DoorType.LEVER_LOCK)
          next = edge.from;
        if (next === null) continue;

        const cost =
          edge.door === DoorType.KEY_LOCK || edge.door === DoorType.PUZZLE_LOCK
            ? 1
            : 0;
        const candidate = currentDist + cost;
        if (candidate < (dist.get(next) ?? Infinity)) {
          dist.set(next, candidate);
          if (cost === 0) deque.unshift(next);
          else deque.push(next);
        }
      }
    }

    this.access = dist;
    for (const n of this.nodes.values())
      n.accessLevel = dist.get(n.id) ?? Infinity;
  }

  /** Rooms you can stand in without ever passing the given edges. */
  reachableWithout(blocked: ReadonlySet<string>): Set<string> {
    const seen = new Set([this.startId]);
    const stack = [this.startId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const edge of this.edges) {
        if (blocked.has(edge.id)) continue;
        let next: string | null = null;
        if (edge.from === current) next = edge.to;
        else if (edge.to === current && edge.door !== DoorType.LEVER_LOCK)
          next = edge.from;
        if (next === null || seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    return seen;
  }

  // --- transactions -------------------------------------------------------

  snapshot(): Snapshot {
    return {
      nodes: this.nodeList().map((n) => ({ ...n })),
      edges: this.edges.map((e) => ({ ...e })),
    };
  }

  restore(snap: Snapshot): void {
    this.nodes.clear();
    for (const n of snap.nodes) this.nodes.set(n.id, { ...n });
    this.edges = snap.edges.map((e) => ({ ...e }));
    this.recomputeAccess();
  }

  /**
   * Every room reachable, every lock openable by a key that lies in front of it, no
   * node over its connection budget. A rule that breaks any of these is rolled back.
   */
  validate(): string | null {
    for (const n of this.nodes.values()) {
      if (!Number.isFinite(this.accessOf(n.id)))
        return `${n.id} is unreachable`;
      if (this.degree(n.id) > this.maxDegreeOf(n.id)) {
        return `${n.id} has ${this.degree(n.id)} connections, max ${this.maxDegreeOf(n.id)}`;
      }
    }
    for (const n of this.nodes.values()) {
      if (n.type !== NodeType.LOCK || !n.requiresKeyId) continue;
      const key = this.nodes.get(n.requiresKeyId);
      if (!key) return `lock ${n.id} points at missing key ${n.requiresKeyId}`;
      if (this.accessOf(key.id) >= this.accessOf(n.id)) {
        return `key ${key.id} is not in front of lock ${n.id}`;
      }
    }
    return null;
  }

  // --- grammar rules ------------------------------------------------------
  // Each returns true if it changed anything. The driver validates and reverts.

  /** a -> b  becomes  a -> n -> b. Grows the spine without changing difficulty. */
  addNormal(): boolean {
    const edge = this.rng.maybePick(
      this.edges.filter((e) => e.door !== DoorType.LEVER_LOCK),
    );
    if (!edge) return false;
    const inserted = this.addNode(NodeType.NORMAL);
    this.removeEdge(edge.id);
    this.addEdge(edge.from, inserted.id, edge.door, edge.keyId);
    this.addEdge(inserted.id, edge.to, DoorType.OPEN, null);
    return true;
  }

  /** A room the world itself gates: you poke at it until it lets you through (§3). */
  addPuzzle(): boolean {
    const edge = this.rng.maybePick(this.openEdges());
    if (!edge) return false;
    const puzzle = this.addNode(NodeType.PUZZLE);
    this.removeEdge(edge.id);
    this.addEdge(edge.from, puzzle.id, DoorType.OPEN, null);
    this.addEdge(puzzle.id, edge.to, DoorType.PUZZLE_LOCK, null);
    return true;
  }

  /**
   * A threshold the dream refuses, plus the leverage that opens it — hung off some
   * room you can already reach without passing the new door.
   */
  addKeyLock(): boolean {
    const edge = this.rng.maybePick(this.openEdges());
    if (!edge) return false;

    const lock = this.addNode(NodeType.LOCK);
    this.removeEdge(edge.id);
    const lockedEdge = this.addEdge(
      edge.from,
      lock.id,
      DoorType.KEY_LOCK,
      null,
    );
    this.addEdge(lock.id, edge.to, DoorType.OPEN, null);
    this.recomputeAccess();

    const inFront = [...this.reachableWithout(new Set([lockedEdge.id]))]
      .map((id) => this.nodes.get(id)!)
      .filter((n) => n.type !== NodeType.END && this.hasRoom(n.id));
    const host = this.rng.maybePick(inFront);
    if (!host) return false;

    const key = this.addNode(NodeType.KEY);
    key.opensLockId = lock.id;
    lock.requiresKeyId = key.id;
    lockedEdge.keyId = key.id;
    this.addEdge(host.id, key.id, DoorType.OPEN, null);
    return true;
  }

  /**
   * A way round that the sleeper forgot to close: found deep, it opens onto somewhere
   * shallow. One-way, so it shortens the walk back without cheapening the gate.
   */
  addLever(): boolean {
    this.recomputeAccess();
    const deep = this.nodeList().filter(
      (n) =>
        this.accessOf(n.id) >= 2 &&
        this.hasRoom(n.id) &&
        n.type !== NodeType.END,
    );
    const host = this.rng.maybePick(deep);
    if (!host) return false;

    const shallow = this.nodeList().filter(
      (n) =>
        this.accessOf(n.id) <= this.accessOf(host.id) - 2 &&
        this.hasRoom(n.id) &&
        n.id !== host.id,
    );
    const target = this.rng.maybePick(shallow);
    if (!target) return false;

    const lever = this.addNode(NodeType.LEVER);
    this.addEdge(host.id, lever.id, DoorType.OPEN, null);
    this.addEdge(lever.id, target.id, DoorType.LEVER_LOCK, null);
    return true;
  }

  /**
   * Close a loop. §6 wants cyclic layouts rather than a tree — a nightmare that comes
   * back round on itself, not a corridor you retrace.
   */
  makeLink(): boolean {
    this.recomputeAccess();
    const candidates = this.nodeList().filter(
      (n) => n.id !== this.startId && n.id !== this.endId && this.hasRoom(n.id),
    );
    const pairs: Array<[MissionNode, MissionNode]> = [];
    for (const a of candidates) {
      for (const b of candidates) {
        if (a.id >= b.id || this.connected(a.id, b.id)) continue;
        if (Math.abs(this.accessOf(a.id) - this.accessOf(b.id)) > 1) continue;
        pairs.push([a, b]);
      }
    }
    const pair = this.rng.maybePick(pairs);
    if (!pair) return false;
    this.addEdge(pair[0].id, pair[1].id, DoorType.OPEN, null);
    return true;
  }

  /** A dead end. Somewhere to put a figure who has nothing to do with the way through. */
  makeBranching(): boolean {
    const hosts = this.nodeList().filter(
      (n) => n.id !== this.startId && n.id !== this.endId && this.hasRoom(n.id),
    );
    const host = this.rng.maybePick(hosts);
    if (!host) return false;
    const leaf = this.addNode(NodeType.NORMAL);
    this.addEdge(host.id, leaf.id, DoorType.OPEN, null);
    return true;
  }

  /**
   * Pull a gate one room earlier, so difficulty is not all bunched at the end. The
   * room that loses the lock becomes ordinary and the one before it takes it on.
   */
  moveLockBack(): boolean {
    const locked = this.rng.shuffle(
      this.edges.filter((e) => e.door === DoorType.KEY_LOCK),
    );
    for (const edge of locked) {
      const middle = this.nodes.get(edge.from);
      if (
        !middle ||
        middle.type !== NodeType.NORMAL ||
        middle.id === this.startId
      )
        continue;

      const incoming = this.edges.filter(
        (e) => e.id !== edge.id && (e.from === middle.id || e.to === middle.id),
      );
      const earlier = incoming.find((e) => e.door === DoorType.OPEN);
      if (!earlier) continue;

      const lock = this.nodes.get(edge.to);
      if (!lock || lock.type !== NodeType.LOCK) continue;

      earlier.door = DoorType.KEY_LOCK;
      earlier.keyId = edge.keyId;
      edge.door = DoorType.OPEN;
      edge.keyId = null;

      middle.type = NodeType.LOCK;
      middle.requiresKeyId = lock.requiresKeyId;
      lock.type = NodeType.NORMAL;
      lock.requiresKeyId = null;

      const key = middle.requiresKeyId
        ? this.nodes.get(middle.requiresKeyId)
        : null;
      if (key) key.opensLockId = middle.id;
      return true;
    }
    return false;
  }

  toMissionGraph(): MissionGraph {
    this.recomputeAccess();
    return {
      nodes: this.nodeList().map((n) => ({ ...n })),
      edges: this.edges.map((e) => ({ ...e })),
      startId: this.startId,
      endId: this.endId,
    };
  }
}

const ID_PREFIX: Record<NodeTypeName, string> = {
  [NodeType.START]: "start",
  [NodeType.END]: "end",
  [NodeType.NORMAL]: "room",
  [NodeType.KEY]: "key",
  [NodeType.LOCK]: "lock",
  [NodeType.PUZZLE]: "puzzle",
  [NodeType.LEVER]: "lever",
};

function node(id: string, type: NodeTypeName): MissionNode {
  return { id, type, accessLevel: 0, opensLockId: null, requiresKeyId: null };
}

/**
 * Rules are applied in phases rather than in one shuffled pile. Growing the spine
 * before hanging gates on it, and only closing loops once there is something to loop
 * through, produces graphs that read as places instead of tangles.
 */
const PHASES: RuleName[][] = [
  ["addNormal"],
  ["addKeyLock", "addPuzzle"],
  ["moveLockBack"],
  ["makeBranching"],
  ["makeLink", "addLever"],
];

const ATTEMPTS_PER_APPLICATION = 8;

export interface GeneratedMission {
  graph: MissionGraph;
  /** What actually fired, in order. Shown in the terminal so a reroll is legible. */
  applied: RuleName[];
  seed: number;
}

export function generateMissionGraph(
  rng: Rng,
  recipe: Recipe,
): GeneratedMission {
  validateRecipe(recipe);
  const builder = new GraphBuilder(rng);
  const applied: RuleName[] = [];

  for (const phase of PHASES) {
    const queue: RuleName[] = [];
    for (const rule of phase) {
      const budget = recipe[rule];
      const count = rng.int(budget.min, budget.max);
      for (let i = 0; i < count; i++) queue.push(rule);
    }

    for (const rule of rng.shuffle(queue)) {
      for (let attempt = 0; attempt < ATTEMPTS_PER_APPLICATION; attempt++) {
        const snap = builder.snapshot();
        const changed = builder[rule]();
        builder.recomputeAccess();
        if (changed && builder.validate() === null) {
          applied.push(rule);
          break;
        }
        builder.restore(snap);
      }
    }
  }

  const problem = builder.validate();
  if (problem)
    throw new Error(`generated an unsolvable mission graph: ${problem}`);

  return { graph: builder.toMissionGraph(), applied, seed: rng.seed };
}

/** Rule names in the order the driver applies them. Used by the terminal preview. */
export const APPLICATION_ORDER: readonly RuleName[] = PHASES.flat();

export { RULE_NAMES };
