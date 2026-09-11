/**
 * Prep-room play: walk, stand next to a thing, open the matching readout.
 */

import { t } from "../../shared/i18n";
import type { Texture } from "pixi.js";

import { Action, Input, keyFor } from "../game/input";
import { type MindSettings } from "../mind/settings";
import { liveEntryBody } from "./entry";
import { WalkerSprite, type AuthoredWalk } from "../render/walkerView";

import type { AtlasTextures } from "../render/atlasTextures";
import type { Camera } from "../render/camera";
import { LOBBY_DEFINITION } from "./definition";
import { InspectPanel } from "./inspect";
import {
  createLobbyWalker,
  lobbyWalkFrame,
  updateLobbyWalker,
  type LobbyWalker,
} from "./move";
import { prefersReducedMotion } from "./motion";
import { LobbyPrompt } from "./prompt";
import { LobbyScene } from "./scene";
import type { DreamArtifact } from "../../shared/dream";
import type { LobbyHotspot } from "./types";

export interface LobbyCallbacks {
  onTerminal(): void;
  onControls(): void;
  onEnterDream(mode: "live" | "training"): void;
}

export class LobbySession {
  readonly definition = LOBBY_DEFINITION;
  readonly scene: LobbyScene;
  readonly walker: LobbyWalker;
  private readonly sprite: WalkerSprite;
  private readonly prompt: LobbyPrompt;
  private readonly inspect: InspectPanel;
  private settings: MindSettings | null = null;
  private nearest: LobbyHotspot | null = null;
  private held = false;

  constructor(
    parent: HTMLElement,
    artifact: DreamArtifact,
    atlas: AtlasTextures,
    private readonly camera: Camera,
    private readonly callbacks: LobbyCallbacks,
    extras: {
      sanitarWalk?: AuthoredWalk | null;
      patientTexture?: Texture | null;
      backdropTexture?: Texture | null;
    } = {},
  ) {
    this.scene = new LobbyScene(
      this.definition,
      artifact,
      atlas,
      extras.patientTexture ?? null,
      extras.backdropTexture ?? null,
    );
    this.walker = createLobbyWalker(this.definition);
    this.sprite = new WalkerSprite(atlas, "player", extras.sanitarWalk ?? null);
    this.scene.actorLayer.addChild(this.sprite.sprite);
    this.sprite.update(
      this.walker.x,
      this.walker.y,
      this.walker.facing,
      0,
      false,
      0,
    );

    this.prompt = new LobbyPrompt(parent);
    this.inspect = new InspectPanel(parent, {
      onClose: () => {
        this.held = false;
      },
    });

    this.camera.setWorldSize(this.definition.width, this.definition.height);
    this.camera.fit(this.definition.width, this.definition.height);
    this.camera.cutTo(this.walker.x, this.walker.y);
  }

  get isHeld(): boolean {
    return this.held || this.inspect.isOpen;
  }

  setMind(settings: MindSettings): void {
    this.settings = settings;
    this.scene.setMind(this.mindReady, settings.state === "authorizing");
  }

  get mindReady(): boolean {
    if (!this.settings) return false;
    return (
      this.settings.state === "connected" || this.settings.provider !== "codex"
    );
  }

  panelClosed(): void {
    this.held = false;
  }

  closeInspect(): void {
    this.inspect.close();
  }

  get inspectOpen(): boolean {
    return this.inspect.isOpen;
  }

  update(input: Input, deltaSeconds: number, locked = false): void {
    const blocked = locked || this.held || this.inspect.isOpen;
    if (!blocked) {
      updateLobbyWalker(
        this.walker,
        this.definition,
        input.axis(),
        deltaSeconds,
      );
      if (this.walker.moving) this.prompt.dismissHint();
    }

    this.nearest = this.findHotspot();
    const interact = keyFor("interact").split(" · ")[0] ?? "E";
    this.prompt.setPrompt(
      this.nearest ? `${interact} — ${this.promptFor(this.nearest)}` : null,
    );
    this.prompt.update(deltaSeconds);
    this.scene.update(deltaSeconds);

    if (!blocked && input.consume(Action.INTERACT) && this.nearest) {
      this.use(this.nearest);
    }

    this.sprite.update(
      this.walker.x,
      this.walker.y,
      this.walker.facing,
      lobbyWalkFrame(this.walker),
      this.walker.moving,
      this.walker.travelled,
    );
    this.camera.follow(this.walker.x, this.walker.y, deltaSeconds);
    this.camera.update(deltaSeconds);
  }

  private promptFor(hotspot: LobbyHotspot): string {
    if (hotspot.kind === "dream-entry") {
      return this.mindReady ? t("lobby.entry_ready") : t("lobby.entry_blocked");
    }
    if (hotspot.kind === "terminal") return t("lobby.terminal_prompt");
    if (hotspot.kind === "patient") return t("lobby.patient_prompt");
    if (hotspot.kind === "controls") return t("lobby.controls_prompt");
    if (hotspot.kind === "settings") return t("lobby.settings_prompt");
    return hotspot.prompt;
  }

  private findHotspot(): LobbyHotspot | null {
    const size = this.definition.tileSize;
    let best: LobbyHotspot | null = null;
    let bestDist = Infinity;
    for (const hotspot of this.definition.hotspots) {
      const hx = hotspot.x * size;
      const hy = hotspot.y * size;
      const dist = Math.hypot(hx - this.walker.x, hy - this.walker.y);
      if (dist <= hotspot.reach * size && dist < bestDist) {
        best = hotspot;
        bestDist = dist;
      }
    }
    return best;
  }

  private use(hotspot: LobbyHotspot): void {
    this.prompt.dismissHint();
    if (hotspot.kind === "terminal") {
      this.held = true;
      this.callbacks.onTerminal();
      return;
    }
    if (hotspot.kind === "controls") {
      this.held = true;
      this.callbacks.onControls();
      return;
    }
    if (hotspot.kind === "patient") {
      this.held = true;
      this.inspect.open({
        title: t("lobby.patient_title"),
        category: t("lobby.patient_category"),
        body: t("lobby.patient_body"),
      });
      return;
    }
    if (hotspot.kind === "settings") {
      this.held = true;
      const motion = prefersReducedMotion()
        ? t("lobby.settings_reduced")
        : t("lobby.settings_full");
      this.inspect.open({
        title: t("lobby.settings_title"),
        category: t("lobby.settings_category"),
        body: `${t("lobby.settings_body")}\n\n${motion}`,
      });
      return;
    }
    if (hotspot.kind === "dream-entry") {
      this.held = true;
      const actions = [];
      if (this.mindReady) {
        actions.push({
          label: t("lobby.entry_start"),
          onClick: () => {
            this.inspect.close();
            this.callbacks.onEnterDream("live");
          },
        });
      }
      actions.push({
        label: t("lobby.entry_train"),
        kind: "ghost" as const,
        onClick: () => {
          this.inspect.close();
          this.callbacks.onEnterDream("training");
        },
      });
      this.inspect.open({
        title: t("lobby.entry_title"),
        category: t("lobby.entry_category"),
        body: liveEntryBody(this.mindReady, this.settings),
        actions,
      });
    }
  }

  teardown(): void {
    this.prompt.hide();
    this.inspect.close();
    this.prompt.destroy();
    this.inspect.destroy();
    this.sprite.destroy();
    this.scene.destroy();
  }
}
