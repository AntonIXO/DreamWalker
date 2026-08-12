/**
 * The tell that the sleeper stirred.
 *
 * §7 makes a specific argument worth honouring: Undertale breaks its own picture on
 * purpose — glitches, distortion — to say "something is wrong here". In a game about a
 * dream that rearranges itself while you are inside it, tearing is not a defect to be
 * hidden but the only honest signal available. This is the one place in the codebase
 * where a rendering artefact is the intended output.
 *
 * Deliberately short and low-amplitude. The player should be unsure whether they saw it.
 */

import type { Camera } from "./camera";

const DURATION = 0.42;
const AMPLITUDE = 3;

export class Shiver {
  private remaining = 0;
  private strength = 1;
  private phase = 0;

  constructor(private readonly camera: Camera) {}

  get active(): boolean {
    return this.remaining > 0;
  }

  /** @param intensity roughly "how much of the world just changed", 0..1 */
  trigger(intensity = 1): void {
    this.remaining = DURATION;
    this.strength = Math.max(this.strength, Math.min(1, intensity));
    this.phase = 0;
  }

  update(deltaSeconds: number): void {
    if (this.remaining <= 0) return;

    this.remaining = Math.max(0, this.remaining - deltaSeconds);
    this.phase += deltaSeconds;

    if (this.remaining === 0) {
      this.strength = 1;
      this.camera.setShake(0, 0);
      return;
    }

    // Decays to nothing, and jitters on whole pixels only — a sub-pixel shake on
    // 16px tiles just looks like the renderer lost its nerve.
    const decay = this.remaining / DURATION;
    const amount = AMPLITUDE * decay * this.strength;
    const dx = Math.round(Math.sin(this.phase * 61) * amount);
    const dy = Math.round(Math.cos(this.phase * 47) * amount * 0.6);
    this.camera.setShake(dx, dy);
  }
}
