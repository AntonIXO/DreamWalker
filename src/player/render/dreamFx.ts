/**
 * The picture tearing the sleeper is allowed.
 *
 * Authored per room (`graphics.glitchPreset`) and driven by tonus / shiver / overflow,
 * so any published dream gets the same four looks without new art. The filter is
 * detached when nothing is happening — an idle pass would be a full-screen copy
 * every frame for a courtyard that is supposed to sit still.
 */

import { Filter, Rectangle, UniformGroup, type Container } from "pixi.js";

import type { Palette } from "../../shared/dream";
import type { RoomGraphics } from "../../shared/room";
import { normaliseTonus, type TonusDelta } from "../../shared/tonus";
import { prefersReducedMotion } from "../lobby/motion";
import { DREAM_FX_FRAGMENT, DREAM_FX_VERTEX } from "./dreamFx.frag";

export type GlitchPreset = RoomGraphics["glitchPreset"];

export const BURST_SECONDS = 0.22;
export const OVERFLOW_SECONDS = 0.7;
/** Attach for tonus grade only once the marker is well off the origin. */
export const TONUS_ATTACH = 0.35;

export const PRESET_ID = {
  none: 0,
  split: 1,
  "double-edge": 2,
  "wrong-palette": 3,
} as const satisfies Record<GlitchPreset, number>;

export type DreamFxPhase = "idle" | "burst" | "overflow";

export interface DreamFxDebug {
  preset: GlitchPreset;
  phase: DreamFxPhase;
}

export function presetId(preset: GlitchPreset): number {
  return PRESET_ID[preset] ?? PRESET_ID.none;
}

export function envelope(remaining: number, duration: number): number {
  if (duration <= 0 || remaining <= 0) return 0;
  return Math.min(1, remaining / duration);
}

export function hexToRgb01(hex: string): Float32Array {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(n)) return new Float32Array([1, 1, 1]);
  return new Float32Array([
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  ]);
}

export function paletteSwatches(palette: Palette): {
  cream: Float32Array;
  live: Float32Array;
} {
  const creamHex =
    palette.colors[palette.roles.background] ??
    palette.colors[palette.roles.highlight] ??
    "#f3f6f6";
  const liveHex =
    palette.colors[palette.roles.accent] ??
    palette.colors[palette.roles.highlight] ??
    creamHex;
  return { cream: hexToRgb01(creamHex), live: hexToRgb01(liveHex) };
}

/** Link-flash analogue: the chart is a colour, never a number. */
export function burstTint(
  position: TonusDelta,
  cream: Float32Array,
  live: Float32Array,
): Float32Array {
  const upper = position.x >= 0;
  const dynamic = position.y >= 0;
  const out = new Float32Array(3);
  if (upper && dynamic) {
    out.set(live);
    return out;
  }
  if (upper) {
    out[0] = live[0]! * 0.55 + cream[0]! * 0.45;
    out[1] = live[1]! * 0.55 + cream[1]! * 0.45;
    out[2] = live[2]! * 0.55 + cream[2]! * 0.45;
    return out;
  }
  if (dynamic) {
    out[0] = 1 - live[0]!;
    out[1] = 1 - live[1]!;
    out[2] = 1 - live[2]!;
    return out;
  }
  out[0] = (1 - cream[0]!) * 0.72 + live[0]! * 0.12;
  out[1] = (1 - cream[1]!) * 0.72 + live[1]! * 0.12;
  out[2] = (1 - cream[2]!) * 0.72 + live[2]! * 0.12;
  return out;
}

export function shouldAttach(state: {
  enabled: boolean;
  preset: GlitchPreset;
  burst: number;
  overflow: number;
  tonus: TonusDelta;
}): boolean {
  if (!state.enabled) return false;
  if (state.preset !== "none") return true;
  if (state.burst > 0.001 || state.overflow > 0.001) return true;
  const n = normaliseTonus(state.tonus);
  return Math.max(Math.abs(n.x), Math.abs(n.y)) >= TONUS_ATTACH;
}

const BURST_PADDING = 8;

export class DreamFx {
  private readonly filter: Filter;
  private readonly uniforms: UniformGroup;
  private readonly area = new Rectangle();
  private readonly cream: Float32Array;
  private readonly live: Float32Array;
  private preset: GlitchPreset = "none";
  private tonus: TonusDelta = { x: 0, y: 0 };
  private burstLeft = 0;
  private burstStrength = 0;
  private overflowLeft = 0;
  private time = 0;
  private attached = false;
  private enabled = false;

  constructor(
    private readonly target: Container,
    width: number,
    height: number,
    palette: Palette,
  ) {
    const swatches = paletteSwatches(palette);
    this.cream = swatches.cream;
    this.live = swatches.live;
    this.uniforms = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uBurst: { value: 0, type: "f32" },
      uOverflow: { value: 0, type: "f32" },
      uPreset: { value: 0, type: "i32" },
      uTonus: { value: new Float32Array(2), type: "vec2<f32>" },
      uReduced: { value: 0, type: "f32" },
      uCream: { value: this.cream, type: "vec3<f32>" },
      uLive: { value: this.live, type: "vec3<f32>" },
      uTint: { value: new Float32Array(this.live), type: "vec3<f32>" },
    });
    this.filter = Filter.from({
      gl: { vertex: DREAM_FX_VERTEX, fragment: DREAM_FX_FRAGMENT },
      resources: { dreamFx: this.uniforms },
      resolution: 1,
      antialias: "off",
      padding: 0,
    });
    this.resize(width, height);
  }

  get debugState(): DreamFxDebug {
    return {
      preset: this.preset,
      phase:
        this.overflowLeft > 0
          ? "overflow"
          : this.burstLeft > 0
            ? "burst"
            : "idle",
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.burstLeft = 0;
      this.burstStrength = 0;
      this.overflowLeft = 0;
      this.detach();
    }
  }

  setPreset(preset: GlitchPreset): void {
    this.preset = preset;
  }

  setTonus(position: TonusDelta): void {
    this.tonus = position;
  }

  /** 180–250 ms of bands. Intensity is how hard the picture is allowed to jump. */
  burst(intensity = 1): void {
    this.burstLeft = BURST_SECONDS;
    this.burstStrength = Math.max(
      this.burstStrength,
      Math.max(0, Math.min(1, intensity)),
    );
  }

  /** The wrap: invert, then wash toward this dream's cream. */
  overflow(): void {
    this.overflowLeft = OVERFLOW_SECONDS;
    this.burst(1);
  }

  resize(width: number, height: number): void {
    this.area.x = 0;
    this.area.y = 0;
    this.area.width = width;
    this.area.height = height;
    this.area.ceil();
    this.target.filterArea = this.area;
  }

  update(deltaSeconds: number): void {
    this.time += deltaSeconds;
    this.burstLeft = Math.max(0, this.burstLeft - deltaSeconds);
    this.overflowLeft = Math.max(0, this.overflowLeft - deltaSeconds);
    if (this.burstLeft === 0) this.burstStrength = 0;

    const burst = envelope(this.burstLeft, BURST_SECONDS) * this.burstStrength;
    const overflow = envelope(this.overflowLeft, OVERFLOW_SECONDS);
    const attach = shouldAttach({
      enabled: this.enabled,
      preset: this.preset,
      burst,
      overflow,
      tonus: this.tonus,
    });

    if (!attach) {
      this.detach();
      return;
    }

    const u = this.uniforms.uniforms;
    const n = normaliseTonus(this.tonus);
    const tint = burstTint(this.tonus, this.cream, this.live);
    u.uTime = this.time;
    u.uBurst = burst;
    u.uOverflow = overflow;
    u.uPreset = presetId(this.preset);
    (u.uTonus as Float32Array)[0] = n.x;
    (u.uTonus as Float32Array)[1] = n.y;
    u.uReduced =
      typeof window !== "undefined" && prefersReducedMotion() ? 1 : 0;
    const tintUniform = u.uTint as Float32Array;
    tintUniform[0] = tint[0]!;
    tintUniform[1] = tint[1]!;
    tintUniform[2] = tint[2]!;
    this.filter.padding = burst > 0.001 || overflow > 0.001 ? BURST_PADDING : 0;
    this.attach();
  }

  destroy(): void {
    this.detach();
    this.filter.destroy();
  }

  private attach(): void {
    if (this.attached) return;
    this.target.filters = [this.filter];
    this.target.filterArea = this.area;
    this.attached = true;
  }

  private detach(): void {
    if (!this.attached) return;
    this.target.filters = null;
    this.attached = false;
  }
}
