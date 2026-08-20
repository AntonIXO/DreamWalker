/**
 * Finale sequence: when the game ends, the finale soundtrack bed plays.
 * After 20 seconds, the frenzy erupts: all dream characters burst out and fly chaotically
 * across the entire screen, while the sanitar dances front-and-center, rapidly shuffling
 * feet frames from authored assets and spinning in celebration.
 */

import { Container, Graphics, Sprite, Texture } from "pixi.js";

import type { AtlasTextures } from "./atlasTextures";
import type { AuthoredWalk } from "./walkerView";

interface FlyingCharacter {
  readonly sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotationSpeed: number;
  baseScale: number;
  wobblePhase: number;
  wobbleSpeed: number;
  wobbleAmp: number;
}

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: number;
  rotation: number;
  vRot: number;
  alpha: number;
}

const FRENZY_DELAY_SECONDS = 20;
const CONFETTI_COUNT = 70;
const FLYING_FIGURES_COUNT = 32;

const DISCO_COLORS = [
  0xff3366, 0x33ccff, 0xffd700, 0x00ff88, 0xff66cc, 0x9933ff, 0xff9933,
  0x66ffcc, 0xffffff,
];

export class FinaleFrenzy {
  readonly root = new Container({
    label: "finale-frenzy",
    eventMode: "none",
    interactiveChildren: false,
    visible: false,
    zIndex: 1000,
  });

  private readonly charactersContainer = new Container({
    label: "flying-characters",
  });
  private readonly effectsContainer = new Container({
    label: "confetti-effects",
  });
  private readonly sanitarContainer = new Container({
    label: "dancing-sanitar-root",
  });
  private readonly sanitarSprite: Sprite;
  private readonly confettiGfx = new Graphics();

  private readonly characterPool: Texture[] = [];
  private readonly sanitarFrames: Texture[] = [];
  private readonly flyingCharacters: FlyingCharacter[] = [];
  private readonly confetti: ConfettiParticle[] = [];

  private sequenceActive = false;
  private frenzyActive = false;
  private elapsedSinceEnd = 0;
  private totalTime = 0;
  private sanitarFrameTimer = 0;
  private sanitarFrameIndex = 0;
  private width: number;
  private height: number;

  constructor(
    atlas: AtlasTextures,
    figureTextures: ReadonlyMap<string, Texture>,
    sanitarWalk: AuthoredWalk | null,
    lobbyPatient: Texture | null,
    width: number,
    height: number,
  ) {
    this.width = width;
    this.height = height;

    this.root.addChild(this.charactersContainer);
    this.root.addChild(this.effectsContainer);
    this.root.addChild(this.sanitarContainer);
    this.effectsContainer.addChild(this.confettiGfx);

    // Build character textures pool
    for (const texture of figureTextures.values()) {
      this.characterPool.push(texture);
    }
    if (lobbyPatient) {
      this.characterPool.push(lobbyPatient);
    }
    for (const [name, texture] of atlas.frames.entries()) {
      if (name.startsWith("figure_") && name.endsWith("_s_0")) {
        this.characterPool.push(texture);
      }
    }
    if (this.characterPool.length === 0) {
      const fallback = atlas.frames.get("player_s_0");
      if (fallback) this.characterPool.push(fallback);
    }

    // Build sanitar dance frames from authored walk assets
    if (sanitarWalk) {
      if (sanitarWalk.east.length > 0) {
        this.sanitarFrames.push(...sanitarWalk.east);
      }
      if (sanitarWalk.south.length > 0) {
        this.sanitarFrames.push(...sanitarWalk.south);
      }
      if (sanitarWalk.north && sanitarWalk.north.length > 0) {
        this.sanitarFrames.push(...sanitarWalk.north);
      }
      if (sanitarWalk.east.length > 0) {
        this.sanitarFrames.push(...[...sanitarWalk.east].reverse());
      }
    }
    if (this.sanitarFrames.length === 0) {
      const fallback =
        atlas.frames.get("player_s_0") ?? Texture.WHITE ?? Texture.EMPTY;
      this.sanitarFrames.push(fallback);
    }

    this.sanitarSprite = new Sprite({
      texture: this.sanitarFrames[0]!,
      anchor: { x: 0.5, y: 0.5 },
      roundPixels: true,
    });
    this.sanitarContainer.addChild(this.sanitarSprite);
    this.sanitarContainer.position.set(width / 2, height / 2);
  }

  get isSequenceActive(): boolean {
    return this.sequenceActive;
  }

  get isFrenzyRunning(): boolean {
    return this.frenzyActive;
  }

  get remainingSecondsToFrenzy(): number {
    return Math.max(0, FRENZY_DELAY_SECONDS - this.elapsedSinceEnd);
  }

  /**
   * Start the finale sequence when an ending is reached.
   * Tracks 20 seconds before launching the character frenzy & sanitar dance.
   */
  startSequence(): void {
    if (this.sequenceActive) return;
    this.sequenceActive = true;
    this.elapsedSinceEnd = 0;
    this.frenzyActive = false;
  }

  /**
   * Immediately launches the character frenzy and dancing sanitar.
   */
  triggerFrenzy(): void {
    this.sequenceActive = true;
    this.elapsedSinceEnd = FRENZY_DELAY_SECONDS;
    if (this.frenzyActive) return;
    this.frenzyActive = true;
    this.root.visible = true;
    this.spawnFrenzy();
  }

  stop(): void {
    this.sequenceActive = false;
    this.frenzyActive = false;
    this.elapsedSinceEnd = 0;
    this.root.visible = false;
    this.cleanup();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (!this.frenzyActive) {
      this.sanitarContainer.position.set(width / 2, height / 2);
    }
  }

  private spawnFrenzy(): void {
    this.cleanup();

    // 1. Spawn flying characters
    const count = Math.max(FLYING_FIGURES_COUNT, this.characterPool.length * 2);
    for (let i = 0; i < count; i++) {
      const texture = this.characterPool[i % this.characterPool.length]!;
      const sprite = new Sprite({
        texture,
        anchor: { x: 0.5, y: 0.5 },
        roundPixels: true,
      });

      // Distribute around screen edges or random starting positions
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist =
        Math.min(this.width, this.height) * (0.3 + Math.random() * 0.4);
      const x = this.width / 2 + Math.cos(angle) * dist;
      const y = this.height / 2 + Math.sin(angle) * dist;

      // High velocity flight vector
      const speed = 260 + Math.random() * 420;
      const flightAngle = Math.random() * Math.PI * 2;
      const vx = Math.cos(flightAngle) * speed;
      const vy = Math.sin(flightAngle) * speed;

      const baseScale = 2.4 + Math.random() * 1.8;
      sprite.scale.set(baseScale);
      sprite.position.set(x, y);

      this.charactersContainer.addChild(sprite);
      this.flyingCharacters.push({
        sprite,
        x,
        y,
        vx,
        vy,
        rotationSpeed: (Math.random() - 0.5) * 8.0,
        baseScale,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleSpeed: 4 + Math.random() * 6,
        wobbleAmp: 40 + Math.random() * 80,
      });
    }

    // 2. Spawn confetti particles
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      this.confetti.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 350,
        vy: -100 - Math.random() * 400,
        size: 4 + Math.random() * 8,
        color: DISCO_COLORS[i % DISCO_COLORS.length]!,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 10,
        alpha: 0.8 + Math.random() * 0.2,
      });
    }

    this.sanitarContainer.position.set(this.width / 2, this.height * 0.52);
  }

  private cleanup(): void {
    for (const char of this.flyingCharacters) {
      char.sprite.destroy();
    }
    this.flyingCharacters.length = 0;
    this.confetti.length = 0;
    this.confettiGfx.clear();
  }

  update(delta: number): void {
    if (!this.sequenceActive) return;

    this.totalTime += delta;

    if (!this.frenzyActive) {
      this.elapsedSinceEnd += delta;
      if (this.elapsedSinceEnd >= FRENZY_DELAY_SECONDS) {
        this.triggerFrenzy();
      }
      return;
    }

    // --- Update Flying Characters ---
    for (const char of this.flyingCharacters) {
      char.wobblePhase += char.wobbleSpeed * delta;
      const wobble = Math.sin(char.wobblePhase) * char.wobbleAmp * delta;

      char.x += char.vx * delta;
      char.y += (char.vy + wobble) * delta;
      char.sprite.rotation += char.rotationSpeed * delta;

      // Bounce off screen boundaries
      const margin = 20;
      if (char.x < margin && char.vx < 0) {
        char.vx = Math.abs(char.vx) * (0.9 + Math.random() * 0.2);
        char.rotationSpeed = (Math.random() - 0.5) * 10;
      } else if (char.x > this.width - margin && char.vx > 0) {
        char.vx = -Math.abs(char.vx) * (0.9 + Math.random() * 0.2);
        char.rotationSpeed = (Math.random() - 0.5) * 10;
      }

      if (char.y < margin && char.vy < 0) {
        char.vy = Math.abs(char.vy) * (0.9 + Math.random() * 0.2);
      } else if (char.y > this.height - margin && char.vy > 0) {
        char.vy = -Math.abs(char.vy) * (0.9 + Math.random() * 0.2);
      }

      // Dynamic scale pulse
      const pulse = 1 + 0.15 * Math.sin(this.totalTime * 8 + char.wobblePhase);
      const flipX = char.vx < 0 ? -1 : 1;
      char.sprite.scale.set(
        char.baseScale * pulse * flipX,
        char.baseScale * pulse,
      );
      char.sprite.position.set(char.x, char.y);
    }

    // --- Update Dancing Sanitar ---
    // 1. Rapid leg frame stepping from authored assets ("ногами из ассетов перебирает")
    this.sanitarFrameTimer += delta;
    const frameInterval = 0.065; // ~15.4 fps rapid shuffle
    if (this.sanitarFrameTimer >= frameInterval) {
      this.sanitarFrameTimer -= frameInterval;
      this.sanitarFrameIndex =
        (this.sanitarFrameIndex + 1) % this.sanitarFrames.length;
      this.sanitarSprite.texture = this.sanitarFrames[this.sanitarFrameIndex]!;
    }

    // 2. Spinning in rhythm ("и крутится")
    const spinSpeed = 3.6 + Math.sin(this.totalTime * 3) * 1.5;
    this.sanitarContainer.rotation += spinSpeed * delta;

    // 3. Groovy jump & dance motion
    const bounceBeat = Math.sin(this.totalTime * 14);
    const hop = Math.abs(Math.cos(this.totalTime * 7)) * 28;
    const centerX = this.width / 2 + Math.sin(this.totalTime * 2.5) * 45;
    const centerY = this.height * 0.52 - hop;
    this.sanitarContainer.position.set(centerX, centerY);

    // 4. Squash and stretch rhythm
    const baseSanitarScale = 4.6;
    const squash = 1 + 0.22 * Math.abs(bounceBeat);
    const stretch = 1 - 0.16 * Math.abs(bounceBeat);
    const flip = Math.sin(this.totalTime * 6) >= 0 ? 1 : -1;
    this.sanitarSprite.scale.set(
      baseSanitarScale * stretch * flip,
      baseSanitarScale * squash,
    );

    // --- Update Confetti Particles ---
    this.confettiGfx.clear();
    for (const p of this.confetti) {
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy += 220 * delta; // Gravity
      p.rotation += p.vRot * delta;

      // Wrap around or bounce from bottom
      if (p.y > this.height + 20) {
        p.y = -10;
        p.x = Math.random() * this.width;
        p.vy = -120 - Math.random() * 320;
      }
      if (p.x < -20) p.x = this.width + 10;
      if (p.x > this.width + 20) p.x = -10;

      this.confettiGfx.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      this.confettiGfx.fill({ color: p.color, alpha: p.alpha });
    }
  }

  destroy(): void {
    this.stop();
    this.root.destroy({ children: true });
  }
}
