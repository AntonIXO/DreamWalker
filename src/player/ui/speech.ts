/**
 * Microphone → text, for talking to figures.
 *
 * Edge (and Chromium) expose Microsoft's speech-to-text as the Web Speech API:
 * `SpeechRecognition` / `webkitSpeechRecognition`. No Azure key, no server, no
 * quota — the browser sends the mic to the same recognizer the Edge UI uses.
 * Chrome speaks to Google's; Safari to Apple's. The game never sees the audio.
 *
 * The transcript is a draft, not a move. §3 makes the wording the turn, so a
 * misheard word has to land in the box where the player can still change it.
 */

import { getLocale } from "../../shared/i18n";

export type VoiceStatus =
  "unsupported" | "idle" | "listening" | "hearing" | "blocked" | "failed";

export interface VoiceHandlers {
  /** Live caption: whatever is in the box while they speak. */
  onCaption(text: string): void;
  /** A pause after a final phrase — the panel may send this as the utterance. */
  onUtterance(text: string): void;
  onStatus(status: VoiceStatus, detail?: string): void;
}

/** The subset of the Web Speech API this wrapper actually touches. */
export interface VoiceEngine {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onresult: ((ev: VoiceResultEvent) => void) | null;
  onspeechstart: ((ev: Event) => void) | null;
  onspeechend: ((ev: Event) => void) | null;
}

export interface VoiceResultEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

export type VoiceEngineCtor = new () => VoiceEngine;

export interface VoiceOptions {
  lang?: string;
  silenceMs?: number;
  maxLength?: number;
  createEngine?: () => VoiceEngine | null;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (id: unknown) => void;
}

const PREF_KEY = "dream-walker.voice";
export function defaultVoiceLang(): string {
  return getLocale() === "ru" ? "ru-RU" : "en-US";
}
const DEFAULT_SILENCE_MS = 1100;
const DEFAULT_MAX_LENGTH = 240;

export function speechRecognitionCtor(): VoiceEngineCtor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as unknown as {
    SpeechRecognition?: VoiceEngineCtor;
    webkitSpeechRecognition?: VoiceEngineCtor;
  };
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  );
}

export function voiceSupported(): boolean {
  return speechRecognitionCtor() !== null;
}

export function loadVoicePref(): boolean {
  try {
    return globalThis.localStorage?.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveVoicePref(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(PREF_KEY, "1");
    else globalThis.localStorage?.removeItem(PREF_KEY);
  } catch {
    // Private mode, locked storage — the toggle still works for this session.
  }
}

/** Glue typed prefix and spoken words without doubling spaces. */
export function joinSpeech(prefix: string, spoken: string): string {
  const left = prefix.trimEnd();
  const right = spoken.replace(/\s+/g, " ").trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

export function clipSpeech(
  text: string,
  maxLength = DEFAULT_MAX_LENGTH,
): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd();
}

export class VoiceInput {
  private engine: VoiceEngine | null = null;
  private wanted = false;
  private running = false;
  private prefix = "";
  private committed = "";
  private interim = "";
  /** Typed-over the live caption; ignore recognizer output until they speak again. */
  private dropResults = false;
  private silenceTimer: unknown = null;
  private restartTimer: unknown = null;
  private status: VoiceStatus;
  private readonly lang: string;
  private readonly silenceMs: number;
  private readonly maxLength: number;
  private readonly createEngine: () => VoiceEngine | null;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancelTimer: (id: unknown) => void;

  constructor(
    private readonly handlers: VoiceHandlers,
    options: VoiceOptions = {},
  ) {
    this.lang = options.lang ?? defaultVoiceLang();
    this.silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
    this.maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
    this.createEngine = options.createEngine ?? defaultEngine;
    this.schedule = options.schedule ?? defaultSchedule;
    this.cancelTimer = options.cancel ?? defaultCancel;
    this.status =
      options.createEngine || speechRecognitionCtor() ? "idle" : "unsupported";
  }

  get supported(): boolean {
    return this.status !== "unsupported";
  }

  /** True while we are trying to hear them, including the brief gap between restarts. */
  get active(): boolean {
    return this.wanted;
  }

  get currentStatus(): VoiceStatus {
    return this.status;
  }

  /**
   * Begin a dictation pass. `prefix` is whatever is already in the box — spoken
   * words append to it, so a typed start can finish out loud.
   */
  listen(prefix: string): void {
    if (!this.supported) return;
    if (this.wanted) return;
    this.prefix = prefix;
    this.committed = "";
    this.interim = "";
    this.dropResults = false;
    this.wanted = true;
    this.kick();
  }

  halt(): void {
    this.wanted = false;
    this.dropResults = false;
    this.clearSilence();
    this.clearRestart();
    if (this.engine) {
      try {
        this.engine.abort();
      } catch {
        // Already stopped.
      }
    }
    this.running = false;
    if (this.status !== "unsupported" && this.status !== "blocked") {
      this.setStatus("idle");
    }
  }

  /**
   * The player typed into the box while we were listening. Keep the recognizer
   * up (they may keep talking) but treat the field as the new prefix.
   */
  noteTyped(value: string): void {
    if (!this.wanted) return;
    this.prefix = value;
    this.committed = "";
    this.interim = "";
    this.dropResults = true;
    this.clearSilence();
  }

  destroy(): void {
    this.halt();
    this.unbind();
    this.engine = null;
  }

  private kick(): void {
    if (!this.wanted || this.running) return;
    this.clearRestart();
    const engine = this.ensureEngine();
    if (!engine) {
      this.wanted = false;
      this.setStatus("unsupported");
      return;
    }
    try {
      engine.start();
    } catch (error) {
      // InvalidStateError: already started; onend will catch us up.
      if (error instanceof DOMException && error.name === "InvalidStateError") {
        return;
      }
      this.wanted = false;
      this.setStatus("failed");
    }
  }

  private ensureEngine(): VoiceEngine | null {
    if (this.engine) return this.engine;
    const engine = this.createEngine();
    if (!engine) return null;
    engine.lang = this.lang;
    engine.continuous = true;
    engine.interimResults = true;
    engine.maxAlternatives = 1;
    // Edge Canary can run on-device; Russian is much better on the cloud
    // recognizer the stable browser already uses, so prefer that.
    if ("processLocally" in engine) engine.processLocally = false;
    engine.onstart = () => {
      this.running = true;
      if (this.wanted) this.setStatus("listening");
    };
    engine.onend = () => {
      this.running = false;
      if (!this.wanted) {
        if (this.status === "listening" || this.status === "hearing") {
          this.setStatus("idle");
        }
        return;
      }
      this.restartTimer = this.schedule(() => this.kick(), 80);
    };
    engine.onerror = (event) => this.handleError(event.error);
    engine.onresult = (event) => this.handleResult(event);
    engine.onspeechstart = () => {
      if (!this.wanted) return;
      this.dropResults = false;
      this.clearSilence();
      this.setStatus("hearing");
    };
    engine.onspeechend = () => {
      if (!this.wanted) return;
      if (this.status === "hearing") this.setStatus("listening");
      this.armSilence();
    };
    this.engine = engine;
    return engine;
  }

  private unbind(): void {
    if (!this.engine) return;
    this.engine.onstart = null;
    this.engine.onend = null;
    this.engine.onerror = null;
    this.engine.onresult = null;
    this.engine.onspeechstart = null;
    this.engine.onspeechend = null;
  }

  private handleError(error: string): void {
    if (error === "not-allowed" || error === "service-not-allowed") {
      this.wanted = false;
      this.setStatus("blocked", error);
      return;
    }
    if (error === "audio-capture") {
      this.wanted = false;
      this.setStatus("failed", error);
      return;
    }
    if (error === "network") {
      this.wanted = false;
      this.setStatus("failed", error);
      return;
    }
    if (error === "language-not-supported" && this.engine) {
      this.engine.lang = "";
      return;
    }
    // no-speech / aborted / no-match: the session ends and onend restarts us.
  }

  private handleResult(event: VoiceResultEvent): void {
    if (!this.wanted || this.dropResults) return;
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result) continue;
      const piece = result[0]?.transcript ?? "";
      if (result.isFinal) this.committed = joinSpeech(this.committed, piece);
      else interim += piece;
    }
    this.interim = interim.replace(/\s+/g, " ").trim();
    const caption = clipSpeech(this.caption(), this.maxLength);
    this.handlers.onCaption(caption);
    if (this.committed && !this.interim) this.armSilence();
    else this.clearSilence();
    if (caption.length >= this.maxLength && this.committed)
      this.fireUtterance();
  }

  private caption(): string {
    return joinSpeech(this.prefix, joinSpeech(this.committed, this.interim));
  }

  private armSilence(): void {
    this.clearSilence();
    if (!this.wanted || !this.committed.trim()) return;
    this.silenceTimer = this.schedule(
      () => this.fireUtterance(),
      this.silenceMs,
    );
  }

  private fireUtterance(): void {
    if (!this.wanted) return;
    const text = clipSpeech(
      joinSpeech(this.prefix, this.committed).trim(),
      this.maxLength,
    );
    this.clearSilence();
    if (!text) return;
    this.wanted = false;
    this.dropResults = false;
    this.committed = "";
    this.interim = "";
    if (this.engine) {
      try {
        this.engine.abort();
      } catch {
        // Ending the session is best-effort; we already have the words.
      }
    }
    this.handlers.onUtterance(text);
  }

  private setStatus(status: VoiceStatus, detail?: string): void {
    if (this.status === status && detail === undefined) return;
    this.status = status;
    this.handlers.onStatus(status, detail);
  }

  private clearSilence(): void {
    if (this.silenceTimer === null) return;
    this.cancelTimer(this.silenceTimer);
    this.silenceTimer = null;
  }

  private clearRestart(): void {
    if (this.restartTimer === null) return;
    this.cancelTimer(this.restartTimer);
    this.restartTimer = null;
  }
}

function defaultEngine(): VoiceEngine | null {
  const Ctor = speechRecognitionCtor();
  if (!Ctor) return null;
  return new Ctor();
}

function defaultSchedule(fn: () => void, ms: number): unknown {
  return setTimeout(fn, ms);
}

function defaultCancel(id: unknown): void {
  clearTimeout(id as ReturnType<typeof setTimeout>);
}
