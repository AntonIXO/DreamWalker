/**
 * The HUD.
 *
 * Kept to almost nothing on purpose. §3 rules out a suspicion meter — being found out
 * has to arrive as something a figure *says*, tied to words the player chose, never as a
 * bar filling up. So there is nowhere here to put the most important number in the game,
 * and that is the correct amount of interface.
 *
 * DOM rather than canvas text: it is crisper at any zoom, it is selectable, and it keeps
 * the pixel-art layer free of anything that is not pixel art.
 */

import { formatClock } from "../game/cycle";

export interface HudModel {
  title: string;
  roomName: string;
  cycleNumber: number;
  remainingSeconds: number;
  journalCount: number;
  /** Transient line: a door refusing, something shifting in another room. */
  whisper: string | null;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly roomEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly cycleEl: HTMLElement;
  private readonly whisperEl: HTMLElement;
  private whisperUntil = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="hud-top">
        <span class="hud-room"></span>
        <span class="hud-cycle"></span>
        <span class="hud-clock"></span>
      </div>
      <div class="hud-whisper"></div>
    `;
    parent.appendChild(this.root);

    this.roomEl = this.root.querySelector(".hud-room")!;
    this.clockEl = this.root.querySelector(".hud-clock")!;
    this.cycleEl = this.root.querySelector(".hud-cycle")!;
    this.whisperEl = this.root.querySelector(".hud-whisper")!;
  }

  /** Says something once, briefly. Repeats of the same line do not restack. */
  whisper(text: string, seconds = 3.5): void {
    if (this.whisperEl.textContent === text && this.whisperUntil > 0) return;
    this.whisperEl.textContent = text;
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
    if (muted) this.whisperEl.classList.remove("visible");
  }

  update(model: HudModel, deltaSeconds: number): void {
    this.roomEl.textContent = model.roomName;
    this.cycleEl.textContent = `цикл ${model.cycleNumber}`;
    this.clockEl.textContent = formatClock(model.remainingSeconds);
    // The last half-minute is the only time the clock is allowed to be loud.
    this.clockEl.classList.toggle("urgent", model.remainingSeconds <= 30);

    if (model.whisper) this.whisper(model.whisper);

    if (this.whisperUntil > 0) {
      this.whisperUntil -= deltaSeconds;
      if (this.whisperUntil <= 0 || this.muted) {
        this.whisperUntil = 0;
        this.whisperEl.classList.remove("visible");
      }
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
