/**
 * Finale sequence: when the game ends, all other music stops and the finale soundtrack plays.
 * After 20 seconds, all dream characters run out together and perform a synchronized group dance
 * around the sanitar, who dances in the center, rapidly shuffling feet frames from authored assets
 * and spinning in celebration.
 */

import { Container, Graphics, Sprite, Texture } from "pixi.js";

import type { AtlasTextures } from "./atlasTextures";
import type { AuthoredWalk } from "./walkerView";

interface Dancer {
  readonly sprite: Sprite;
  startX: number;
  startY: number;
  targetOffsetX: number;
  targetOffsetY: number;
  currentX: number;
  currentY: number;
  baseScale: number;
  phase: number;
  side: "left" | "right" | "back";
  row: number;
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
const CONFETTI_COUNT = 45;

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

  private readonly floorGfx = new Graphics();
  private readonly troupeContainer = new Container({
    label: "dancing-troupe",
    sortableChildren: true,
  });
  private readonly effectsContainer = new Container({
    label: "confetti-effects",
  });
  private readonly sanitarContainer = new Container({
    label: "dancing-sanitar-root",
    zIndex: 50,
  });
  private readonly sanitarSprite: Sprite;
  private readonly confettiGfx = new Graphics();

  private readonly characterPool: Texture[] = [];
  private readonly sanitarFrames: Texture[] = [];
  private readonly dancers: Dancer[] = [];
  private readonly confetti: ConfettiParticle[] = [];

  private sequenceActive = false;
  private frenzyActive = false;
  private elapsedSinceEnd = 0;
  private totalTime = 0;
  private entryTime = 0;
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

    this.root.addChild(this.floorGfx);
    this.root.addChild(this.troupeContainer);
    this.root.addChild(this.effectsContainer);
    this.effectsContainer.addChild(this.confettiGfx);
    this.troupeContainer.addChild(this.sanitarContainer);

    // Collect all available character textures
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

    // Assemble sanitar walk frames for dance shuffling
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
    this.sanitarContainer.position.set(width / 2, height * 0.52);
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
   * Tracks 20 seconds before launching the synchronized group dance.
   */
  startSequence(): void {
    if (this.sequenceActive) return;
    this.sequenceActive = true;
    this.elapsedSinceEnd = 0;
    this.frenzyActive = false;
  }

  /**
   * Immediately launches the character group dance and dancing sanitar.
   */
  triggerFrenzy(): void {
    this.sequenceActive = true;
    this.elapsedSinceEnd = FRENZY_DELAY_SECONDS;
    if (this.frenzyActive) return;
    this.frenzyActive = true;
    this.entryTime = 0;
    this.root.visible = true;
    this.spawnDanceTroupe();
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
      this.sanitarContainer.position.set(width / 2, height * 0.52);
    }
  }

  private spawnDanceTroupe(): void {
    this.cleanup();

    const centerX = this.width / 2;
    const centerY = this.height * 0.54;

    // Formation layout:
    // Left wing, Right wing, and Back row around center Sanitar
    const totalDancers = Math.min(16, Math.max(10, this.characterPool.length));

    // Form an arc / lineup of backup dancers
    for (let i = 0; i < totalDancers; i++) {
      const texture = this.characterPool[i % this.characterPool.length]!;
      const sprite = new Sprite({
        texture,
        anchor: { x: 0.5, y: 0.85 },
        roundPixels: true,
      });

      const isEven = i % 2 === 0;
      const rank = Math.floor(i / 2) + 1; // 1, 2, 3...
      const side: "left" | "right" | "back" =
        rank > 4 ? "back" : isEven ? "left" : "right";

      let targetOffsetX = 0;
      let targetOffsetY = 0;
      let startX = 0;
      let startY = centerY;

      if (side === "left") {
        targetOffsetX = -rank * 55 - 25;
        targetOffsetY = (rank % 2 === 0 ? 10 : -15) + (rank - 1) * 8;
        startX = -60 - Math.random() * 80;
        startY = centerY + (Math.random() - 0.5) * 100;
      } else if (side === "right") {
        targetOffsetX = rank * 55 + 25;
        targetOffsetY = (rank % 2 === 0 ? 10 : -15) + (rank - 1) * 8;
        startX = this.width + 60 + Math.random() * 80;
        startY = centerY + (Math.random() - 0.5) * 100;
      } else {
        // Back row arch
        const backIdx = i - 8;
        targetOffsetX = (backIdx - 2.5) * 65;
        targetOffsetY = -60 - Math.abs(backIdx - 2.5) * 10;
        startX = centerX + targetOffsetX * 3;
        startY = -60;
      }

      const baseScale = 2.6;
      sprite.scale.set(baseScale);
      sprite.position.set(startX, startY);
      sprite.zIndex = 10 + targetOffsetY;

      this.troupeContainer.addChild(sprite);
      this.dancers.push({
        sprite,
        startX,
        startY,
        targetOffsetX,
        targetOffsetY,
        currentX: startX,
        currentY: startY,
        baseScale,
        phase: i * 0.45,
        side,
        row: rank,
      });
    }

    // Spawn stage confetti
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      this.confetti.push({
        x: centerX + (Math.random() - 0.5) * (this.width * 0.7),
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 120,
        vy: -50 - Math.random() * 150,
        size: 3 + Math.random() * 6,
        color: DISCO_COLORS[i % DISCO_COLORS.length]!,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 8,
        alpha: 0.75 + Math.random() * 0.25,
      });
    }

    this.sanitarContainer.position.set(centerX, centerY);
  }

  private cleanup(): void {
    for (const dancer of this.dancers) {
      dancer.sprite.destroy();
    }
    this.dancers.length = 0;
    this.confetti.length = 0;
    this.confettiGfx.clear();
    this.floorGfx.clear();
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

    this.entryTime += delta;
    const entryProgress = Math.min(1, this.entryTime / 1.4);
    // Smooth ease-out entrance
    const ease = 1 - Math.pow(1 - entryProgress, 3);

    const centerX = this.width / 2;
    const centerY = this.height * 0.54;

    // Draw disco stage spotlight / dance floor glow
    this.floorGfx.clear();
    const glowPulse = 0.85 + 0.15 * Math.sin(this.totalTime * 8);
    this.floorGfx.ellipse(
      centerX,
      centerY + 18,
      280 * glowPulse,
      60 * glowPulse,
    );
    this.floorGfx.fill({ color: 0x221133, alpha: 0.45 });

    // --- 1. Update Dancing Troupe Characters ---
    for (const dancer of this.dancers) {
      const finalX = centerX + dancer.targetOffsetX;
      const finalY = centerY + dancer.targetOffsetY;

      // Move into formation during entrance
      dancer.currentX = dancer.startX + (finalX - dancer.startX) * ease;
      dancer.currentY = dancer.startY + (finalY - dancer.startY) * ease;

      if (entryProgress >= 1) {
        // Synchronized dance choreography to the music beat:
        // Rhythmic hop
        const hop = Math.abs(Math.sin(this.totalTime * 8 + dancer.phase)) * 14;
        // Sway side to side
        const sway = Math.sin(this.totalTime * 4 + dancer.phase) * 6;
        dancer.currentX = finalX + sway;
        dancer.currentY = finalY - hop;

        // Squash & stretch to the beat
        const bounce = Math.sin(this.totalTime * 12 + dancer.phase);
        const squash = 1 + 0.16 * Math.abs(bounce);
        const stretch = 1 - 0.12 * Math.abs(bounce);

        // Direction facing (face inward toward center sanitar, or dance sway)
        const facingCenter = dancer.targetOffsetX < 0 ? 1 : -1;
        const flipSway =
          Math.sin(this.totalTime * 4 + dancer.phase) > 0 ? 1 : -1;
        const facing = ease >= 1 ? flipSway * facingCenter : facingCenter;

        // Periodic group pirouette
        const barTime = this.totalTime % 3.6;
        const isSpinning = barTime > 2.8;
        if (isSpinning) {
          dancer.sprite.rotation += 12 * delta;
        } else {
          dancer.sprite.rotation =
            Math.sin(this.totalTime * 6 + dancer.phase) * 0.18;
        }

        dancer.sprite.scale.set(
          dancer.baseScale * stretch * facing,
          dancer.baseScale * squash,
        );
      }

      dancer.sprite.position.set(dancer.currentX, dancer.currentY);
      dancer.sprite.zIndex = 10 + Math.round(dancer.currentY);
    }

    // --- 2. Update Dancing Center Sanitar ---
    // Fast leg shuffle from authored assets ("ногами из ассетов перебирает")
    this.sanitarFrameTimer += delta;
    const frameInterval = 0.062; // ~16 fps rapid shuffle
    if (this.sanitarFrameTimer >= frameInterval) {
      this.sanitarFrameTimer -= frameInterval;
      this.sanitarFrameIndex =
        (this.sanitarFrameIndex + 1) % this.sanitarFrames.length;
      this.sanitarSprite.texture = this.sanitarFrames[this.sanitarFrameIndex]!;
    }

    // Spinning around ("и крутится")
    const spinSpeed = 3.8 + Math.sin(this.totalTime * 4) * 1.6;
    this.sanitarContainer.rotation += spinSpeed * delta;

    // Jumping & dance bounce in center
    const sanitarHop = Math.abs(Math.sin(this.totalTime * 12)) * 22;
    const sanitarSideStep = Math.sin(this.totalTime * 3) * 16;
    this.sanitarContainer.position.set(
      centerX + sanitarSideStep,
      centerY - sanitarHop,
    );

    // Center Sanitar scale & beat response
    const baseSanitarScale = 4.8;
    const sanitarBeat = Math.sin(this.totalTime * 14);
    const sanitarSquash = 1 + 0.22 * Math.abs(sanitarBeat);
    const sanitarStretch = 1 - 0.16 * Math.abs(sanitarBeat);
    const sanitarFlip = Math.sin(this.totalTime * 6) >= 0 ? 1 : -1;

    this.sanitarSprite.scale.set(
      baseSanitarScale * sanitarStretch * sanitarFlip,
      baseSanitarScale * sanitarSquash,
    );

    // --- 3. Update Confetti Particles Over Group ---
    this.confettiGfx.clear();
    for (const p of this.confetti) {
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy += 160 * delta; // Gentle gravity
      p.rotation += p.vRot * delta;

      // Wrap around near dance stage
      if (p.y > this.height * 0.75) {
        p.y = centerY - 160 - Math.random() * 60;
        p.x = centerX + (Math.random() - 0.5) * (this.width * 0.6);
        p.vy = -40 - Math.random() * 120;
      }

      this.confettiGfx.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      this.confettiGfx.fill({ color: p.color, alpha: p.alpha });
    }
  }

  destroy(): void {
    this.stop();
    this.root.destroy({ children: true });
  }
}
