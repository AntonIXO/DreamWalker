/**
 * The dream's sky. Screen-space, behind the map, so a road that does not paint its
 * ground opens onto weather instead of a dungeon floor.
 */

import {
  Filter,
  Rectangle,
  Sprite,
  Texture,
  UniformGroup,
  type Container,
} from "pixi.js";

import { prefersReducedMotion } from "../lobby/motion";
import { SKY_FRAGMENT, SKY_VERTEX } from "./sky.frag";

export interface SkySwatch {
  zenith: Float32Array;
  horizon: Float32Array;
  cloud: Float32Array;
  sun: Float32Array;
  rain: number;
  stars: number;
  sunSize: number;
}

const rgb = (hex: string): Float32Array => {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return new Float32Array([
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  ]);
};

const mix = (a: Float32Array, b: Float32Array, t: number): Float32Array => {
  const out = new Float32Array(3);
  const k = Math.max(0, Math.min(1, t));
  out[0] = a[0]! * (1 - k) + b[0]! * k;
  out[1] = a[1]! * (1 - k) + b[1]! * k;
  out[2] = a[2]! * (1 - k) + b[2]! * k;
  return out;
};

const mixNum = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

/**
 * Key palettes along cover. Night is wet and closed. Full cover is a too-nice
 * afternoon — the weather figures talk about when they already know.
 */
const KEYS: { at: number; look: SkySwatch }[] = [
  {
    at: 0,
    look: {
      zenith: rgb("#07080e"),
      horizon: rgb("#161c28"),
      cloud: rgb("#2a3140"),
      sun: rgb("#3a4038"),
      rain: 0,
      stars: 0.85,
      sunSize: 0.01,
    },
  },
  {
    at: 0.22,
    look: {
      zenith: rgb("#3a404c"),
      horizon: rgb("#6a7280"),
      cloud: rgb("#8a929c"),
      sun: rgb("#c8c0b0"),
      rain: 0.15,
      stars: 0.08,
      sunSize: 0.02,
    },
  },
  {
    at: 0.4,
    look: {
      zenith: rgb("#4a584c"),
      horizon: rgb("#7a8874"),
      cloud: rgb("#a8b0a0"),
      sun: rgb("#d0d4c4"),
      rain: 0.7,
      stars: 0,
      sunSize: 0.03,
    },
  },
  {
    at: 0.58,
    look: {
      zenith: rgb("#5a7a98"),
      horizon: rgb("#d0c4a8"),
      cloud: rgb("#e8e4dc"),
      sun: rgb("#f0e8c8"),
      rain: 0.08,
      stars: 0,
      sunSize: 0.05,
    },
  },
  {
    at: 0.78,
    look: {
      zenith: rgb("#3a88c8"),
      horizon: rgb("#f0dca0"),
      cloud: rgb("#f8f4ec"),
      sun: rgb("#fff4c4"),
      rain: 0,
      stars: 0,
      sunSize: 0.07,
    },
  },
  {
    at: 1,
    look: {
      zenith: rgb("#e8b85a"),
      horizon: rgb("#fff4d0"),
      cloud: rgb("#fffceb"),
      sun: rgb("#fff8e0"),
      rain: 0,
      stars: 0,
      sunSize: 0.14,
    },
  },
];

export function skyLook(cover: number): SkySwatch {
  const t = Math.max(0, Math.min(1, cover));
  let from = KEYS[0]!;
  let to = KEYS[KEYS.length - 1]!;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i]!;
    const b = KEYS[i + 1]!;
    if (t >= a.at && t <= b.at) {
      from = a;
      to = b;
      break;
    }
  }
  const span = to.at - from.at;
  const k = span <= 0 ? 0 : (t - from.at) / span;
  return {
    zenith: mix(from.look.zenith, to.look.zenith, k),
    horizon: mix(from.look.horizon, to.look.horizon, k),
    cloud: mix(from.look.cloud, to.look.cloud, k),
    sun: mix(from.look.sun, to.look.sun, k),
    rain: mixNum(from.look.rain, to.look.rain, k),
    stars: mixNum(from.look.stars, to.look.stars, k),
    sunSize: mixNum(from.look.sunSize, to.look.sunSize, k),
  };
}

/** How quickly the sky catches up when someone looks up. Seconds. */
const SETTLE = 0.85;

export class Sky {
  readonly root: Sprite;
  private readonly filter: Filter;
  private readonly uniforms: UniformGroup;
  private readonly area = new Rectangle();
  private enabled = false;
  private target = 0;
  private cover = 0;
  private time = 0;

  constructor(width: number, height: number) {
    this.uniforms = new UniformGroup({
      uTime: { value: 0, type: "f32" },
      uCover: { value: 0, type: "f32" },
      uReduced: { value: 0, type: "f32" },
      uRain: { value: 0, type: "f32" },
      uStars: { value: 0, type: "f32" },
      uSunSize: { value: 0.02, type: "f32" },
      uZenith: { value: new Float32Array(3), type: "vec3<f32>" },
      uHorizon: { value: new Float32Array(3), type: "vec3<f32>" },
      uCloud: { value: new Float32Array(3), type: "vec3<f32>" },
      uSun: { value: new Float32Array(3), type: "vec3<f32>" },
    });
    this.filter = Filter.from({
      gl: { vertex: SKY_VERTEX, fragment: SKY_FRAGMENT },
      resources: { sky: this.uniforms },
      resolution: 0.5,
      antialias: "off",
      padding: 0,
    });
    this.root = new Sprite({
      texture: Texture.WHITE,
      eventMode: "none",
      label: "sky",
    });
    this.root.filters = [this.filter];
    this.root.visible = false;
    this.resize(width, height);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.visible = enabled;
  }

  setCover(cover: number): void {
    this.target = Math.max(0, Math.min(1, cover));
  }

  resize(width: number, height: number): void {
    this.root.width = width;
    this.root.height = height;
    this.area.x = 0;
    this.area.y = 0;
    this.area.width = width;
    this.area.height = height;
    this.area.ceil();
    this.root.filterArea = this.area;
  }

  update(deltaSeconds: number): void {
    if (!this.enabled) return;
    this.time += deltaSeconds;
    const follow = 1 - Math.exp(-deltaSeconds / SETTLE);
    this.cover += (this.target - this.cover) * follow;
    const look = skyLook(this.cover);
    const u = this.uniforms.uniforms;
    u.uTime = this.time;
    u.uCover = this.cover;
    u.uReduced =
      typeof window !== "undefined" && prefersReducedMotion() ? 1 : 0;
    u.uRain = look.rain;
    u.uStars = look.stars;
    u.uSunSize = look.sunSize;
    copy3(u.uZenith as Float32Array, look.zenith);
    copy3(u.uHorizon as Float32Array, look.horizon);
    copy3(u.uCloud as Float32Array, look.cloud);
    copy3(u.uSun as Float32Array, look.sun);
  }

  attach(stage: Container): void {
    stage.addChildAt(this.root, 0);
  }

  destroy(): void {
    this.root.filters = [];
    this.filter.destroy();
    this.root.destroy();
  }
}

function copy3(into: Float32Array, from: Float32Array): void {
  into[0] = from[0]!;
  into[1] = from[1]!;
  into[2] = from[2]!;
}
