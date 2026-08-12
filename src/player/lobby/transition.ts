/**
 * The short tear between the procedure room and the dream.
 *
 * 180–250ms of band shift and a double contour. Reduced motion keeps only opacity.
 */

import { prefersReducedMotion } from "./motion";

const DURATION_MS = 220;

export class EnterTransition {
  private readonly root: HTMLElement;
  private timer: number | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "dream-enter";
    this.root.hidden = true;
    this.root.setAttribute("aria-hidden", "true");
    this.root.innerHTML = `
      <div class="dream-enter-bands"></div>
      <div class="dream-enter-outline"></div>
    `;
    parent.appendChild(this.root);
  }

  play(): Promise<void> {
    return new Promise((resolve) => {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.root.hidden = false;
      this.root.classList.remove("playing", "reduced");
      // Restart CSS animations by toggling the class after a frame.
      void this.root.offsetWidth;
      this.root.classList.add("playing");
      if (prefersReducedMotion()) this.root.classList.add("reduced");
      this.timer = window.setTimeout(() => {
        this.root.hidden = true;
        this.root.classList.remove("playing", "reduced");
        this.timer = null;
        resolve();
      }, DURATION_MS);
    });
  }

  destroy(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.root.remove();
  }
}
