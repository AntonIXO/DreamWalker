import { beforeEach, describe, expect, test } from "bun:test";

import {
  MUSIC_PREF_KEY,
  Soundtrack,
  masterGain,
  musicEnabled,
  saveMusicEnabled,
} from "./soundtrack";

const store = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    data,
  };
};

class MockAudioParam {
  value: number;
  scheduled: Array<{ type: string; value: number; time: number }> = [];

  constructor(initial = 1) {
    this.value = initial;
  }

  cancelScheduledValues(time: number) {
    this.scheduled = this.scheduled.filter((s) => s.time < time);
  }

  setValueAtTime(val: number, time: number) {
    this.value = val;
    this.scheduled.push({ type: "set", value: val, time });
  }

  linearRampToValueAtTime(val: number, time: number) {
    this.value = val;
    this.scheduled.push({ type: "ramp", value: val, time });
  }
}

class MockGainNode {
  readonly gain: MockAudioParam;
  destination: unknown = null;

  constructor(initialGain = 1) {
    this.gain = new MockAudioParam(initialGain);
  }

  connect(dest: unknown) {
    this.destination = dest;
  }

  disconnect() {
    this.destination = null;
  }
}

class MockBufferSourceNode {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  startOffset = 0;
  startTime = 0;
  destination: unknown = null;

  connect(dest: unknown) {
    this.destination = dest;
  }

  disconnect() {
    this.destination = null;
  }

  start(when = 0, offset = 0) {
    this.started = true;
    this.startTime = when;
    this.startOffset = offset;
  }

  stop() {
    this.stopped = true;
  }
}

class MockAudioContext {
  currentTime = 0;
  state: "running" | "suspended" | "closed" = "running";
  destination = {};
  gainNodes: MockGainNode[] = [];
  bufferSources: MockBufferSourceNode[] = [];

  createGain() {
    const node = new MockGainNode(1);
    this.gainNodes.push(node);
    return node;
  }

  createBufferSource() {
    const node = new MockBufferSourceNode();
    this.bufferSources.push(node);
    return node;
  }

  async decodeAudioData() {
    return { duration: 120, numberOfChannels: 2, sampleRate: 44100 };
  }

  async resume() {
    this.state = "running";
  }

  async suspend() {
    this.state = "suspended";
  }

  async close() {
    this.state = "closed";
  }
}

describe("soundtrack prefs", () => {
  test("music is on until the player stores a zero", () => {
    expect(musicEnabled(store())).toBe(true);
    expect(musicEnabled(store({ [MUSIC_PREF_KEY]: "1" }))).toBe(true);
    expect(musicEnabled(store({ [MUSIC_PREF_KEY]: "0" }))).toBe(false);
  });

  test("a missing store still plays", () => {
    expect(musicEnabled(null)).toBe(true);
    expect(musicEnabled(undefined)).toBe(true);
  });

  test("the toggle writes 1 or 0", () => {
    const memory = store();
    saveMusicEnabled(memory, false);
    expect(memory.data[MUSIC_PREF_KEY]).toBe("0");
    saveMusicEnabled(memory, true);
    expect(memory.data[MUSIC_PREF_KEY]).toBe("1");
  });
});

describe("masterGain", () => {
  test("mute wins over duck", () => {
    expect(masterGain(false, false)).toBe(0);
    expect(masterGain(false, true)).toBe(0);
  });

  test("dialogue ducks instead of cutting", () => {
    expect(masterGain(true, false)).toBe(1);
    expect(masterGain(true, true)).toBeGreaterThan(0);
    expect(masterGain(true, true)).toBeLessThan(1);
  });
});

describe("Soundtrack playback lifecycle and single-track guarantee", () => {
  let mockCtx: MockAudioContext;

  beforeEach(() => {
    mockCtx = new MockAudioContext();
    const env = globalThis as unknown as {
      AudioContext: unknown;
      window: unknown;
      document: unknown;
      fetch: unknown;
    };
    env.AudioContext = function () {
      return mockCtx;
    };
    env.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    env.document = {
      hidden: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      createElement: () => ({
        setAttribute: () => {},
        addEventListener: () => {},
        remove: () => {},
      }),
    };
    env.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
  });

  test("load starts initial menu bed", async () => {
    const soundtrack = new Soundtrack(store());
    await soundtrack.load();

    expect(soundtrack.currentBed).toBe("menu");
    expect(soundtrack.isStingPlaying).toBe(false);
    expect(mockCtx.bufferSources.length).toBe(1);
    expect(mockCtx.bufferSources[0].started).toBe(true);
    expect(mockCtx.bufferSources[0].loop).toBe(true);

    soundtrack.destroy();
  });

  test("switching beds stops previous bed and starts new bed", async () => {
    const soundtrack = new Soundtrack(store());
    await soundtrack.load();

    const menuSource = mockCtx.bufferSources[0];
    expect(menuSource.stopped).toBe(false);

    // Switch to game bed
    soundtrack.setBed("game");

    expect(soundtrack.currentBed).toBe("game");
    expect(menuSource.stopped).toBe(true); // Previous bed stopped

    // New game bed source started
    const gameSource = mockCtx.bufferSources[1];
    expect(gameSource.started).toBe(true);
    expect(gameSource.stopped).toBe(false);

    soundtrack.destroy();
  });

  test("playing kill track pauses game bed, and finishing kill track resumes game bed from paused position", async () => {
    const soundtrack = new Soundtrack(store());
    await soundtrack.load();
    soundtrack.setBed("game");

    const gameSource = mockCtx.bufferSources[1];
    expect(gameSource.started).toBe(true);
    expect(gameSource.stopped).toBe(false);

    // Advance time by 15 seconds
    mockCtx.currentTime = 15;

    // Trigger kill track
    soundtrack.play("kill");

    expect(soundtrack.isStingPlaying).toBe(true);
    expect(gameSource.stopped).toBe(true); // Game bed paused

    // Kill cue source is playing
    const killSource = mockCtx.bufferSources[2];
    expect(killSource.started).toBe(true);
    expect(killSource.stopped).toBe(false);
    expect(killSource.loop).toBe(false);

    // Advance time during kill track
    mockCtx.currentTime = 45;

    // Kill track finishes
    killSource.onended?.();

    expect(soundtrack.isStingPlaying).toBe(false);

    // Game bed resumed with previous offset of 15 seconds
    const resumedGameSource = mockCtx.bufferSources[3];
    expect(resumedGameSource.started).toBe(true);
    expect(resumedGameSource.startOffset).toBe(15);
    expect(resumedGameSource.stopped).toBe(false);

    soundtrack.destroy();
  });

  test("consecutive kills cancel earlier kill track and resume bed only after final kill finishes", async () => {
    const soundtrack = new Soundtrack(store());
    await soundtrack.load();
    soundtrack.setBed("game");

    mockCtx.currentTime = 10;
    soundtrack.play("kill");
    const firstKillSource = mockCtx.bufferSources[2];

    mockCtx.currentTime = 20;
    // Second kill triggered while first is still playing
    soundtrack.play("kill");

    expect(firstKillSource.stopped).toBe(true);
    const secondKillSource = mockCtx.bufferSources[3];
    expect(secondKillSource.started).toBe(true);
    expect(soundtrack.isStingPlaying).toBe(true);

    mockCtx.currentTime = 50;
    secondKillSource.onended?.();

    expect(soundtrack.isStingPlaying).toBe(false);
    const resumedGameSource = mockCtx.bufferSources[4];
    expect(resumedGameSource.started).toBe(true);
    expect(resumedGameSource.startOffset).toBe(10); // Offset preserved from initial pause

    soundtrack.destroy();
  });

  test("switching beds while kill track is playing stops kill track and starts new bed", async () => {
    const soundtrack = new Soundtrack(store());
    await soundtrack.load();
    soundtrack.setBed("game");

    soundtrack.play("kill");
    const killSource = mockCtx.bufferSources[2];
    expect(soundtrack.isStingPlaying).toBe(true);

    // Transition to finale
    soundtrack.setBed("finale");

    expect(killSource.stopped).toBe(true);
    expect(soundtrack.isStingPlaying).toBe(false);
    expect(soundtrack.currentBed).toBe("finale");

    const finaleSource = mockCtx.bufferSources[3];
    expect(finaleSource.started).toBe(true);
    expect(finaleSource.stopped).toBe(false);

    soundtrack.destroy();
  });
});
