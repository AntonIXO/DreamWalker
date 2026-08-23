/**
 * Looping beds plus the few one-shots the player actually hears. Rooms author
 * a *description* of sound, not a file — the catalog is copy. Switching beds
 * is a GainNode crossfade, never a cut, and never HTMLAudio: `loop` on an
 * <audio> MP3 clicks at the encoder delay; BufferSource.loop does not.
 *
 * Cues (a kill sting) sit on their own bus so the «Музыка» mute does not eat
 * them. A kill has no words; the sting is the sound of that.
 */

export type Bed = "menu" | "game" | "finale";
export type Cue = "kill";

const BED_URLS: Record<Bed, string> = {
  menu: new URL("../../assets/soundtrack/main-menu.mp3", import.meta.url).href,
  game: new URL("../../assets/soundtrack/game.mp3", import.meta.url).href,
  finale: new URL(
    "../../assets/soundtrack/Пациента разъебало.mp3",
    import.meta.url,
  ).href,
};

const CUE_URLS: Record<Cue, string> = {
  kill: new URL("../../assets/soundtrack/someone-killed.mp3", import.meta.url)
    .href,
};

export const MUSIC_PREF_KEY = "dream-walker.music";
const BED_GAIN = 0.46;
const CUE_GAIN = 0.78;
const DUCKED_MASTER = 0.28;
const FADE_SECONDS = 1.55;

export interface MusicStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Music on unless the player has explicitly stored `"0"`. */
export function musicEnabled(store: MusicStore | null | undefined): boolean {
  try {
    return store?.getItem(MUSIC_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveMusicEnabled(
  store: MusicStore | null | undefined,
  enabled: boolean,
): void {
  try {
    store?.setItem(MUSIC_PREF_KEY, enabled ? "1" : "0");
  } catch {
    // Private mode — the toggle still works for this session.
  }
}

/** Master gain after mute and dialogue-duck. Beds fade separately. */
export function masterGain(enabled: boolean, ducked: boolean): number {
  if (!enabled) return 0;
  return ducked ? DUCKED_MASTER : 1;
}

interface Voice {
  readonly gain: GainNode;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  startedAt: number;
  offset: number;
  pausedAt: number;
}

export class Soundtrack {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly cueBus: GainNode;
  private readonly voices: Record<Bed, Voice>;
  private readonly cues: Record<Cue, AudioBuffer | null> = { kill: null };
  private cueSource: AudioBufferSourceNode | null = null;
  private sting = false;
  private readonly unlockEvents = [
    "pointerdown",
    "pointerup",
    "keydown",
    "keyup",
    "click",
  ] as const;
  private bed: Bed = "menu";
  private enabled: boolean;
  private ducked = false;
  private chrome: HTMLButtonElement | null = null;
  private readonly onEnabled: ((enabled: boolean) => void) | null;

  constructor(
    private readonly store: MusicStore | null = globalThis.localStorage,
    onEnabled?: (enabled: boolean) => void,
  ) {
    this.enabled = musicEnabled(store);
    this.onEnabled = onEnabled ?? null;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = masterGain(this.enabled, false);
    this.master.connect(this.ctx.destination);
    this.cueBus = this.ctx.createGain();
    this.cueBus.gain.value = CUE_GAIN;
    this.cueBus.connect(this.ctx.destination);
    this.voices = {
      menu: this.makeVoice(),
      game: this.makeVoice(),
      finale: this.makeVoice(),
    };

    for (const event of this.unlockEvents) {
      window.addEventListener(event, this.unlock, { capture: true });
    }
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  get currentBed(): Bed {
    return this.bed;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get isStingPlaying(): boolean {
    return this.sting;
  }

  /** Fetch and decode beds and cues. Safe to call once at boot; play waits on unlock. */
  async load(): Promise<void> {
    await Promise.all([this.loadBeds(), this.loadCues()]);
    if (!this.sting) {
      this.startVoice(this.voices[this.bed], 0);
      this.rampBed(this.bed, BED_GAIN, 0.6);
    }
    this.rampMaster(masterGain(this.enabled, this.ducked), 0.4);
    void this.ctx.resume().catch(() => {
      /* Autoplay policy: unlock() retries on the first gesture. */
    });
  }

  setBed(bed: Bed): void {
    if (this.bed === bed) {
      if (!this.sting) {
        this.startVoice(this.voices[bed]);
        this.rampBed(bed, BED_GAIN, FADE_SECONDS);
      }
      return;
    }

    // Changing beds stops any currently playing one-shot cue
    this.stopCue();

    this.bed = bed;

    // Immediately silence and stop all other bed voices so only one track plays at a time
    (Object.keys(this.voices) as Bed[]).forEach((other) => {
      if (other !== bed) {
        const voice = this.voices[other];
        this.ramp(voice.gain.gain, 0, 0.05);
        this.stopVoice(voice, false);
      }
    });

    const targetVoice = this.voices[bed];
    targetVoice.pausedAt = 0;
    this.startVoice(targetVoice, 0);
    this.rampBed(bed, BED_GAIN, bed === "finale" ? 0.2 : FADE_SECONDS);
  }

  /**
   * One-shot kill track. When triggered, the active bed is paused immediately
   * so only one music track plays at a time. When the kill track finishes,
   * the active bed resumes playback from where it was paused.
   */
  play(cue: Cue): void {
    const buffer = this.cues[cue];
    if (!buffer) return;
    void this.ctx.resume().catch(() => {
      /* Kill is itself a gesture; unlock() will catch a stubborn context. */
    });

    this.stopCue();
    this.pauseCurrentBed();
    this.sting = true;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.cueBus);
    source.onended = () => {
      if (this.cueSource !== source) return;
      this.cueSource = null;
      this.sting = false;
      this.resumeCurrentBed(1.2);
    };
    source.start();
    this.cueSource = source;
  }

  setDucked(ducked: boolean): void {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    this.rampMaster(masterGain(this.enabled, ducked), 0.28);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    saveMusicEnabled(this.store, enabled);
    this.rampMaster(masterGain(enabled, this.ducked), 0.35);
    this.syncChrome();
    this.onEnabled?.(enabled);
    if (enabled) void this.ctx.resume();
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /**
   * Corner mute. Lives on the UI layer, not the HUD, so it stays clickable
   * while a panel has taken the keyboard.
   */
  attachChrome(parent: HTMLElement): void {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "music-toggle";
    button.addEventListener("click", () => this.toggle());
    parent.appendChild(button);
    this.chrome = button;
    this.syncChrome();
  }

  destroy(): void {
    for (const event of this.unlockEvents) {
      window.removeEventListener(event, this.unlock, { capture: true });
    }
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stopCue();
    (Object.keys(this.voices) as Bed[]).forEach((id) => {
      this.stopVoice(this.voices[id], false);
    });
    this.chrome?.remove();
    this.chrome = null;
    void this.ctx.close();
  }

  private async loadBeds(): Promise<void> {
    await Promise.all(
      (Object.keys(BED_URLS) as Bed[]).map(async (id) => {
        this.voices[id].buffer = await decodeUrl(this.ctx, BED_URLS[id], id);
      }),
    );
  }

  private async loadCues(): Promise<void> {
    await Promise.all(
      (Object.keys(CUE_URLS) as Cue[]).map(async (id) => {
        try {
          this.cues[id] = await decodeUrl(this.ctx, CUE_URLS[id], id);
        } catch (error) {
          console.error("[soundtrack]", error);
        }
      }),
    );
  }

  private stopCue(): void {
    if (!this.cueSource) return;
    const source = this.cueSource;
    this.cueSource = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.disconnect();
    this.sting = false;
  }

  private makeVoice(): Voice {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    return {
      gain,
      buffer: null,
      source: null,
      startedAt: 0,
      offset: 0,
      pausedAt: 0,
    };
  }

  private startVoice(voice: Voice, offset = 0): void {
    if (voice.source || !voice.buffer) return;
    const duration = voice.buffer.duration;
    const safeOffset =
      duration > 0 ? ((offset % duration) + duration) % duration : 0;
    const source = this.ctx.createBufferSource();
    source.buffer = voice.buffer;
    source.loop = true;
    source.connect(voice.gain);
    source.start(0, safeOffset);
    voice.source = source;
    voice.startedAt = this.ctx.currentTime;
    voice.offset = safeOffset;
  }

  private stopVoice(voice: Voice, savePosition = false): void {
    if (!voice.source) return;
    if (savePosition && voice.buffer && voice.buffer.duration > 0) {
      const elapsed = Math.max(0, this.ctx.currentTime - voice.startedAt);
      voice.pausedAt = (voice.offset + elapsed) % voice.buffer.duration;
    }
    const source = voice.source;
    voice.source = null;
    try {
      source.stop();
    } catch {
      // Ignore if already stopped
    }
    source.disconnect();
  }

  private pauseCurrentBed(): void {
    const voice = this.voices[this.bed];
    this.ramp(voice.gain.gain, 0, 0.05);
    this.stopVoice(voice, true);
  }

  private resumeCurrentBed(fadeSeconds = 1.2): void {
    if (this.sting) return;
    const voice = this.voices[this.bed];
    const offset = voice.pausedAt || 0;
    voice.pausedAt = 0;
    this.startVoice(voice, offset);
    this.rampBed(this.bed, BED_GAIN, fadeSeconds);
  }

  private rampBed(bed: Bed, target: number, seconds: number): void {
    this.ramp(this.voices[bed].gain.gain, target, seconds);
  }

  private rampMaster(target: number, seconds: number): void {
    this.ramp(this.master.gain, target, seconds);
  }

  private ramp(param: AudioParam, target: number, seconds: number): void {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + Math.max(0.02, seconds));
  }

  private readonly unlock = (): void => {
    void this.ctx
      .resume()
      .then(() => {
        if (this.ctx.state === "suspended") return;
        if (!this.sting) {
          const voice = this.voices[this.bed];
          this.startVoice(voice, voice.pausedAt);
          this.rampBed(this.bed, BED_GAIN, 0.45);
        }
        this.rampMaster(masterGain(this.enabled, this.ducked), 0.3);
        for (const event of this.unlockEvents) {
          window.removeEventListener(event, this.unlock, { capture: true });
        }
      })
      .catch(() => {
        /* Gesture was not accepted as an unlock; keep listening. */
      });
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) void this.ctx.suspend();
    else if (this.enabled) void this.ctx.resume();
  };

  private syncChrome(): void {
    if (!this.chrome) return;
    this.chrome.setAttribute("aria-pressed", this.enabled ? "true" : "false");
    this.chrome.setAttribute(
      "aria-label",
      this.enabled ? "Выключить музыку" : "Включить музыку",
    );
    this.chrome.title = this.enabled ? "Музыка" : "Музыка выключена";
    this.chrome.textContent = this.enabled ? "♪" : "♩";
  }
}

async function decodeUrl(
  ctx: AudioContext,
  url: string,
  id: string,
): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`soundtrack ${id}: ${response.status}`);
  }
  const raw = await response.arrayBuffer();
  return ctx.decodeAudioData(raw);
}
