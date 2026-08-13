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

import type { TileRect } from "../../shared/rect";
import { cellAt } from "../../shared/roomGrid";
import type { TonusDelta } from "../../shared/tonus";
import type { BeatEntry, Heartbeat } from "../mind/heartbeat";
import type { WorldState } from "../game/world";

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
    /**
     * The chart position, if the session is running.
     *
     * The player is never shown a number (§3 — no meters, ever). Behind F1 it is the
     * only way to tell a clamped counter from one that is about to wrap.
     */
    private readonly tonusAt?: () => TonusDelta,
    private readonly fxAt?: () => { preset: string; phase: string },
    /** The tile rect the heartbeat treats as off limits — `camera.visibleTiles()`. */
    private readonly viewAt?: () => TileRect,
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

    // Sized for the biggest authored room; `drawMap` picks a per-room scale inside it.
    const widest = Math.max(1, ...world.rooms.map((room) => room.width));
    const tallest = Math.max(1, ...world.rooms.map((room) => room.height));
    this.canvas.width = Math.min(240, widest * 8);
    this.canvas.height = Math.min(200, tallest * 8);

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
  /**
   * The room the sanitar is standing in, drawn from its walk mask.
   *
   * Format 3 drew the whole 249×209 world at 2px a tile, because there was one grid and
   * the interesting question was where in it you were. With authored rooms the useful
   * picture is the room itself: which cells are solid, where the doors and hotspots are,
   * and whether the walls have shifted under you.
   */
  private drawMap(playerTileX: number, playerTileY: number): void {
    const { palette } = this.world.artifact;
    const colorOf = (role: string): string =>
      palette.colors[palette.roles[role as keyof typeof palette.roles] ?? 0] ??
      "#000";

    this.ctx.fillStyle = colorOf("background");
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const room = this.world.roomById.get(this.world.currentRoomId);
    if (!room) return;
    const scale = Math.max(
      2,
      Math.min(
        Math.floor(this.canvas.width / Math.max(1, room.width)),
        Math.floor(this.canvas.height / Math.max(1, room.height)),
      ),
    );

    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) {
        const cell = cellAt(room, x, y);
        if (cell === "void") continue;
        this.ctx.fillStyle = colorOf(
          cell === "wall" || cell === "wallFace"
            ? "wall"
            : cell === "threshold"
              ? "threshold"
              : cell === "floorAlt"
                ? "floorAlt"
                : "floor",
        );
        this.ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    for (const prop of room.props) {
      this.ctx.fillStyle = prop.solid ? "#6f8fd6" : "#3a4a6a";
      this.ctx.fillRect(
        prop.x * scale,
        prop.y * scale,
        prop.w * scale,
        prop.h * scale,
      );
    }

    // Doors first, then what they became: a sealed one is why you opened this panel.
    for (const door of room.doors) {
      this.ctx.fillStyle = door.type === "sealed" ? "#ff4444" : "#e6c164";
      this.ctx.fillRect(
        door.x * scale,
        door.y * scale,
        Math.max(2, door.w * scale),
        Math.max(2, door.h * scale),
      );
    }

    for (const hotspot of room.hotspots) {
      if (room.closedHotspotIds.has(hotspot.id)) continue;
      this.ctx.fillStyle = hotspot.link ? "#c98ade" : "#5cc6d1";
      this.ctx.fillRect(hotspot.x * scale - 1, hotspot.y * scale - 1, 3, 3);
    }

    this.ctx.fillStyle = colorOf("highlight");
    this.ctx.fillRect(playerTileX * scale - 2, playerTileY * scale - 2, 5, 5);

    // What the heartbeat is forbidden to touch. On a floor bigger than the screen this
    // outline is the only way to see the §6 guard working at all — everything outside it
    // is fair game, and the refusals in the log below should line up with what is inside.
    const view = this.viewAt?.();
    if (view) {
      this.ctx.strokeStyle = "#ff8c42";
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(
        view.x * scale + 0.5,
        view.y * scale + 0.5,
        view.w * scale - 1,
        view.h * scale - 1,
      );
    }
  }

  private drawStats(): void {
    const rooms = this.world.rooms;
    const doors = [...this.world.doorById.values()];
    const sealed = doors.filter((door) => door.type === "sealed").length;
    const links = rooms.reduce(
      (total, room) =>
        total + room.hotspots.filter((hotspot) => hotspot.link).length,
      0,
    );
    const held = this.world.figures.filter((f) => f.holdsShardId).length;
    const worldHooks = this.world.interests.filter((interest) =>
      Boolean(interest.holdsShardId),
    ).length;
    const here = this.world.roomById.get(this.world.currentRoomId);
    const visits = this.world.visitCounts.get(this.world.currentRoomId) ?? 0;

    this.statsEl.innerHTML = "";
    const rows: Array<[string, string]> = [
      ["room", `${here?.name ?? "?"} (${this.world.currentRoomId})`],
      [
        "visits",
        `${visits}${visits > 1 && here?.revisit.escalates ? " — escalating" : ""}`,
      ],
      ["rooms", `${rooms.length}, ${this.world.visited.size} seen this cycle`],
      ["doors", `${doors.length}, ${sealed} sealed`],
      ["links", String(links)],
      ["tonus", this.tonusAt ? formatTonus(this.tonusAt()) : "—"],
      [
        "glitch",
        this.fxAt ? `${this.fxAt().preset} · ${this.fxAt().phase}` : "—",
      ],
      [
        "population",
        `${this.world.figures.length} people, ${this.world.interests.length} interests`,
      ],
      [
        "hooks",
        `${held} with people, ${worldHooks} in world / ${this.world.artifact.shards.length}`,
      ],
      ["mind wakes", "cycle exit"],
      ["beat budget", String(this.heartbeat.budgetRemaining)],
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

function formatTonus(position: TonusDelta): string {
  const sign = (n: number): string => (n > 0 ? `+${n}` : String(n));
  return `${sign(position.x)}, ${sign(position.y)}`;
}
