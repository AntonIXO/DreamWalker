/**
 * One honest sign that the game is waiting for inference rather than frozen.
 *
 * Model calls can take long enough that a decorative ellipsis is ambiguous. This status
 * stays above menus and conversations, names the work, and shows elapsed time. The motion
 * itself is CSS-driven so it keeps running while the main thread is busy preparing art.
 */

interface Activity {
  detail: string;
  startedAt: number;
}

/** Fast cache hits and scripted fallbacks should feel instant, not flash a status. */
const SHOW_DELAY_MS = 500;

export class ModelThinkingIndicator {
  private readonly root: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly elapsed: HTMLTimeElement;
  private readonly activities = new Map<number, Activity>();
  private nextId = 0;
  private timer: number | null = null;
  private hideTimer: number | null = null;
  private showFrame: number | null = null;
  private showTimer: number | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "model-thinking";
    this.root.hidden = true;
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    this.root.setAttribute("aria-atomic", "true");
    this.root.innerHTML = `
      <span class="model-thinking-mark" aria-hidden="true">
        <i></i><i></i><i></i>
      </span>
      <span class="model-thinking-copy">
        <strong>Модель думает</strong>
        <span class="model-thinking-detail"></span>
      </span>
      <time class="model-thinking-elapsed" aria-hidden="true">0:00</time>
    `;
    parent.appendChild(this.root);

    this.detail = this.root.querySelector(".model-thinking-detail")!;
    this.elapsed = this.root.querySelector(".model-thinking-elapsed")!;
  }

  /** Start an activity and return an idempotent function that ends just that activity. */
  begin(detail: string): () => void {
    const id = ++this.nextId;
    this.activities.set(id, { detail, startedAt: performance.now() });
    this.queueShow();

    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.activities.delete(id);
      if (this.activities.size > 0) this.queueShow();
      else this.hide();
    };
  }

  async run<T>(detail: string, task: () => Promise<T>): Promise<T> {
    const end = this.begin(detail);
    try {
      return await task();
    } finally {
      end();
    }
  }

  private latest(): Activity | null {
    const entries = [...this.activities.values()];
    return entries.at(-1) ?? null;
  }

  private queueShow(): void {
    const activity = this.latest();
    if (!activity) return;
    if (!this.root.hidden) {
      this.showLatest();
      return;
    }
    if (this.showTimer !== null) return;
    this.showTimer = window.setTimeout(() => {
      this.showTimer = null;
      if (this.activities.size > 0) this.showLatest();
    }, SHOW_DELAY_MS);
  }

  private showLatest(): void {
    const activity = this.latest();
    if (!activity) return;
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.detail.textContent = activity.detail;
    this.root.hidden = false;
    // Keep entry and exit interruptible: a new request can retarget this transition from
    // its current opacity instead of replaying a keyframe from zero.
    if (this.showFrame !== null) cancelAnimationFrame(this.showFrame);
    this.showFrame = requestAnimationFrame(() => {
      if (this.activities.size > 0) this.root.classList.add("visible");
      this.showFrame = null;
    });
    this.updateElapsed();
    if (this.timer === null) {
      this.timer = window.setInterval(() => this.updateElapsed(), 1_000);
    }
  }

  private updateElapsed(): void {
    const activity = this.latest();
    if (!activity) return;
    const totalSeconds = Math.floor(
      (performance.now() - activity.startedAt) / 1_000,
    );
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    this.elapsed.textContent = `${minutes}:${seconds}`;
    this.elapsed.dateTime = `PT${totalSeconds}S`;
  }

  private hide(): void {
    if (this.showTimer !== null) {
      window.clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.showFrame !== null) {
      cancelAnimationFrame(this.showFrame);
      this.showFrame = null;
    }
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.root.classList.remove("visible");
    this.hideTimer = window.setTimeout(() => {
      if (this.activities.size === 0) this.root.hidden = true;
      this.hideTimer = null;
    }, 180);
  }

  destroy(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    if (this.showFrame !== null) cancelAnimationFrame(this.showFrame);
    if (this.showTimer !== null) window.clearTimeout(this.showTimer);
    this.root.remove();
  }
}
