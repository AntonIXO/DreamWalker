/**
 * The HUD.
 *
 * Kept to almost nothing on purpose. §3 rules out a suspicion meter — being found out
 * has to arrive as something a figure *says*, tied to words the player chose, never as a
 * bar filling up. The sky is the readout, inverted: nicer day, worse cover. The HUD
 * only names the band. Passers-by at the frame are the people who noticed you and
 * will not help.
 *
 * DOM rather than canvas text: it is crisper at any zoom, it is selectable, and it keeps
 * the pixel-art layer free of anything that is not pixel art.
 */

import { formatClock } from "../game/cycle";
import { t } from "../../shared/i18n";
import {
  EMPTY_FORECAST,
  type CrowdMark,
  type Forecast,
} from "../game/forecast";
import { setMarkdown } from "./markdown";

export interface HudModel {
  title: string;
  roomName: string;
  cycleNumber: number;
  remainingSeconds: number;
  journalCount: number;
  /** Transient line: a door refusing, something shifting in another room. */
  whisper: string | null;
  forecast?: Forecast;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly roomEl: HTMLElement;
  private readonly asideEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly cycleEl: HTMLElement;
  private readonly weatherEl: HTMLElement;
  private readonly whisperEl: HTMLElement;
  private readonly witnessesEl: HTMLElement;
  private readonly witnesses = new Map<string, HTMLElement>();
  private whisperUntil = 0;
  private whisperSource: string | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="hud-top">
        <span class="hud-room"></span>
        <span class="hud-weather" hidden></span>
        <span class="hud-aside" hidden></span>
        <span class="hud-cycle"></span>
        <span class="hud-clock"></span>
      </div>
      <div class="hud-witnesses" aria-hidden="true"></div>
      <div class="hud-whisper"></div>
    `;
    parent.appendChild(this.root);

    this.roomEl = this.root.querySelector(".hud-room")!;
    this.weatherEl = this.root.querySelector(".hud-weather")!;
    this.asideEl = this.root.querySelector(".hud-aside")!;
    this.clockEl = this.root.querySelector(".hud-clock")!;
    this.cycleEl = this.root.querySelector(".hud-cycle")!;
    this.witnessesEl = this.root.querySelector(".hud-witnesses")!;
    this.whisperEl = this.root.querySelector(".hud-whisper")!;
  }

  /** Says something once, briefly. Repeats of the same line do not restack. */
  whisper(text: string, seconds = 3.5): void {
    if (this.whisperSource === text && this.whisperUntil > 0) return;
    this.whisperSource = text;
    setMarkdown(this.whisperEl, text);
    this.whisperEl.classList.toggle("visible", !this.muted);
    this.whisperUntil = seconds;
  }

  private muted = false;

  /**
   * A panel is up. The whisper sits at the bottom of the screen, which is exactly where
   * the dialogue box goes, so leaving it visible prints two lines on top of each other.
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.root.classList.toggle("muted", muted);
    if (muted) this.whisperEl.classList.remove("visible");
  }

  update(model: HudModel, deltaSeconds: number): void {
    this.roomEl.textContent = model.roomName;
    this.cycleEl.textContent = t("hud.cycle", { n: model.cycleNumber });
    this.clockEl.textContent = formatClock(model.remainingSeconds);
    // The last half-minute is the only time the clock is allowed to be loud.
    this.clockEl.classList.toggle("urgent", model.remainingSeconds <= 30);
    this.paintForecast(model.forecast ?? EMPTY_FORECAST);

    if (model.whisper) this.whisper(model.whisper);

    if (this.whisperUntil > 0) {
      this.whisperUntil -= deltaSeconds;
      if (this.whisperUntil <= 0 || this.muted) {
        this.whisperUntil = 0;
        this.whisperEl.classList.remove("visible");
      }
    }
  }

  /** A quiet extra line under the room name — a timer, not a meter. */
  setAside(text: string | null): void {
    this.asideEl.hidden = !text;
    this.asideEl.textContent = text ?? "";
  }

  private paintForecast(forecast: Forecast): void {
    this.weatherEl.hidden = !forecast.weather;
    this.weatherEl.textContent = forecast.weather ?? "";
    this.weatherEl.dataset.sky = forecast.band;
    this.syncWitnesses(forecast.crowd);
  }

  private syncWitnesses(crowd: readonly CrowdMark[]): void {
    const seen = new Set<string>();
    crowd.forEach((mark, index) => {
      seen.add(mark.id);
      let node = this.witnesses.get(mark.id);
      if (!node) {
        node = document.createElement("span");
        node.className = "hud-witness";
        node.innerHTML = "<i></i><b></b>";
        this.witnessesEl.appendChild(node);
        this.witnesses.set(mark.id, node);
      }
      node.dataset.rank = mark.state;
      node.dataset.side = index % 2 === 0 ? "left" : "right";
      node.style.setProperty("--i", String(Math.floor(index / 2)));
      node.classList.toggle("on", !this.muted);
    });
    for (const [id, node] of this.witnesses) {
      if (seen.has(id)) continue;
      node.remove();
      this.witnesses.delete(id);
    }
  }

  /** Hide the cycle chrome while the sanitar is still in the procedure room. */
  setLobbyMode(on: boolean): void {
    this.root.classList.toggle("lobby-mode", on);
  }

  destroy(): void {
    this.root.remove();
  }
}
