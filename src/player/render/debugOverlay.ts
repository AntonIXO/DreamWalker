/**
 * F1 — what the dream actually is.
 *
 * This exists because the two things most likely to go wrong in this game are invisible
 * from inside it: whether the mission graph the Lord generated is any good, and what the
 * heartbeat is doing behind your back. The overlay makes both legible — a minimap that
 * shows the live tile grid rather than the authored one, the graph with its access
 * levels, and a running log of every patch, including the ones that were refused.
 *
 * The refusals are the interesting half: they are the invariant of §6 doing its job.
 */

import { NodeType, type MissionNode } from "../../shared/dream";
import { TILE_PALETTE_ROLE } from "../../shared/tilecodes";
import type { BeatEntry, Heartbeat } from "../mind/heartbeat";
import type { WorldState } from "../game/world";

const NODE_COLOR: Record<string, string> = {
  [NodeType.START]: "#5fd68a",
  [NodeType.END]: "#c98ade",
  [NodeType.KEY]: "#e6c164",
  [NodeType.LOCK]: "#d1655c",
  [NodeType.PUZZLE]: "#5cc6d1",
  [NodeType.LEVER]: "#6f8fd6",
  [NodeType.NORMAL]: "#9aa0aa",
};

export class DebugOverlay {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly statsEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private visible = false;
  private lastLogLength = -1;

  constructor(
    parent: HTMLElement,
    private readonly world: WorldState,
    private readonly heartbeat: Heartbeat,
  ) {
    this.root = document.createElement("div");
    this.root.className = "debug";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="debug-head">F1 — карта сна · B — удар сердца · K — выдать ключи</div>
      <canvas class="debug-map"></canvas>
      <div class="debug-stats"></div>
      <div class="debug-log"></div>
    `;
    parent.appendChild(this.root);

    this.canvas = this.root.querySelector(".debug-map")!;
    this.statsEl = this.root.querySelector(".debug-stats")!;
    this.logEl = this.root.querySelector(".debug-log")!;

    // Two pixels per tile: big enough to read the shape, small enough to fit a corner.
    this.canvas.width = world.width * 2;
    this.canvas.height = world.height * 2;

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context for the debug map");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.hidden = !this.visible;
    if (this.visible) this.lastLogLength = -1;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  update(playerTileX: number, playerTileY: number): void {
    if (!this.visible) return;
    this.drawMap(playerTileX, playerTileY);
    this.drawStats();
    if (this.heartbeat.log.length !== this.lastLogLength) {
      this.lastLogLength = this.heartbeat.log.length;
      this.drawLog();
    }
  }

  /** Drawn from the *live* grid, so a patch shows up here the moment it lands. */
  private drawMap(playerTileX: number, playerTileY: number): void {
    const { palette } = this.world.artifact;
    const colorOf = (role: string): string =>
      palette.colors[palette.roles[role as keyof typeof palette.roles] ?? 0] ??
      "#000";

    this.ctx.fillStyle = colorOf("background");
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let y = 0; y < this.world.height; y++) {
      for (let x = 0; x < this.world.width; x++) {
        const tile = this.world.tiles[y * this.world.width + x]!;
        if (tile === 0) continue;
        this.ctx.fillStyle = colorOf(TILE_PALETTE_ROLE[tile] ?? "background");
        this.ctx.fillRect(x * 2, y * 2, 2, 2);
      }
    }

    // Mission nodes on top, so the shape of the mission is readable over the space.
    for (const room of this.world.rooms) {
      if (room.kind !== "room" || !room.nodeType) continue;
      const cx = (room.rect.x + room.rect.w / 2) * 2;
      const cy = (room.rect.y + room.rect.h / 2) * 2;
      this.ctx.fillStyle = NODE_COLOR[room.nodeType] ?? "#fff";
      this.ctx.fillRect(cx - 3, cy - 3, 6, 6);
      this.ctx.fillStyle = "#000";
      this.ctx.font = "8px monospace";
      this.ctx.fillText(String(room.accessLevel), cx - 2, cy + 3);
    }

    // Sealed doors, which is what you came to this overlay to see.
    for (const door of this.world.doors) {
      if (door.type !== "sealed") continue;
      this.ctx.fillStyle = "#ff4444";
      this.ctx.fillRect(door.x * 2 - 2, door.y * 2 - 2, 5, 5);
    }

    this.ctx.fillStyle = colorOf("highlight");
    this.ctx.fillRect(playerTileX * 2 - 2, playerTileY * 2 - 2, 5, 5);
  }

  private drawStats(): void {
    const { graph } = this.world.artifact.map;
    const byType = new Map<string, number>();
    for (const node of graph.nodes)
      byType.set(node.type, (byType.get(node.type) ?? 0) + 1);

    const sealed = this.world.doors.filter((d) => d.type === "sealed").length;
    const held = this.world.figures.filter((f) => f.holdsShardId).length;
    const worldHooks = this.world.interests.filter((interest) =>
      Boolean(interest.holdsShardId),
    ).length;
    const worst = worstKeyLockGap(graph.nodes);

    this.statsEl.innerHTML = "";
    const rows: Array<[string, string]> = [
      [
        "rooms",
        `${graph.nodes.length} (${[...byType].map(([t, n]) => `${n} ${t}`).join(", ")})`,
      ],
      ["depth", String(Math.max(...graph.nodes.map((n) => n.accessLevel)))],
      ["doors", `${this.world.doors.length}, ${sealed} sealed`],
      [
        "population",
        `${this.world.figures.length} people, ${this.world.interests.length} interests`,
      ],
      [
        "hooks",
        `${held} with people, ${worldHooks} in world / ${this.world.artifact.shards.length}`,
      ],
      ["visited", `${this.world.visited.size}/${this.world.rooms.length}`],
      ["mind wakes", "cycle exit"],
      ["beat budget", String(this.heartbeat.budgetRemaining)],
      ["key/lock ok", worst],
    ];

    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "debug-row";
      const k = document.createElement("span");
      k.textContent = label;
      const v = document.createElement("b");
      v.textContent = value;
      row.append(k, v);
      this.statsEl.appendChild(row);
    }
  }

  private drawLog(): void {
    this.logEl.replaceChildren();
    for (const entry of this.heartbeat.log.slice(-14).reverse()) {
      this.logEl.appendChild(renderEntry(entry));
    }
  }

  destroy(): void {
    this.root.remove();
  }
}

function renderEntry(entry: BeatEntry): HTMLElement {
  const node = document.createElement("div");
  const outcome =
    entry.withheld ??
    (entry.result.ok ? "applied" : (entry.result.refusal ?? "refused"));
  node.className = `debug-entry ${entry.result.ok ? "applied" : "refused"}`;

  const head = document.createElement("b");
  head.textContent = `${Math.round(entry.at)}s ${entry.patch.kind}`;
  const detail = document.createElement("span");
  detail.textContent = ` — ${outcome}`;
  const why = document.createElement("i");
  why.textContent = entry.patch.reason;

  node.append(head, detail, document.createElement("br"), why);
  return node;
}

/**
 * The one invariant worth checking every frame: no lock may need a key that lies
 * behind it. The generator guarantees it, and the heartbeat must not break it.
 */
function worstKeyLockGap(nodes: readonly MissionNode[]): string {
  const worst = "yes";
  for (const node of nodes) {
    if (node.type !== NodeType.LOCK || !node.requiresKeyId) continue;
    const key = nodes.find((n) => n.id === node.requiresKeyId);
    if (!key) return `NO — ${node.id} has no key`;
    if (key.accessLevel >= node.accessLevel)
      return `NO — ${key.id} behind ${node.id}`;
  }
  return worst;
}
