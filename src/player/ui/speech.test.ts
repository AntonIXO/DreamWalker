import { describe, expect, test } from "bun:test";

import {
  clipSpeech,
  joinSpeech,
  VoiceInput,
  type VoiceEngine,
  type VoiceResultEvent,
  type VoiceStatus,
} from "./speech";

class FakeEngine implements VoiceEngine {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  processLocally?: boolean;
  onstart: ((ev: Event) => void) | null = null;
  onend: ((ev: Event) => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  onresult: ((ev: VoiceResultEvent) => void) | null = null;
  onspeechstart: ((ev: Event) => void) | null = null;
  onspeechend: ((ev: Event) => void) | null = null;
  started = false;

  start(): void {
    this.started = true;
    this.onstart?.(new Event("start"));
  }

  stop(): void {
    this.started = false;
    this.onend?.(new Event("end"));
  }

  abort(): void {
    this.started = false;
    this.onend?.(new Event("end"));
  }

  speak(
    parts: readonly { transcript: string; isFinal: boolean }[],
    resultIndex = 0,
  ): void {
    const results = parts.map((part) => {
      const alt = { transcript: part.transcript };
      return Object.assign([alt], {
        isFinal: part.isFinal,
        0: alt,
      });
    });
    this.onresult?.({ resultIndex, results });
  }

  error(code: string): void {
    this.onerror?.({ error: code });
    this.started = false;
    this.onend?.(new Event("end"));
  }
}

function attach(silenceMs = 40): {
  engine: FakeEngine;
  captions: string[];
  utterances: string[];
  statuses: VoiceStatus[];
  voice: VoiceInput;
  runDue: () => void;
} {
  const engine = new FakeEngine();
  const captions: string[] = [];
  const utterances: string[] = [];
  const statuses: VoiceStatus[] = [];
  const due: Array<() => void> = [];
  const voice = new VoiceInput(
    {
      onCaption: (text) => captions.push(text),
      onUtterance: (text) => utterances.push(text),
      onStatus: (status) => statuses.push(status),
    },
    {
      silenceMs,
      createEngine: () => engine,
      schedule: (fn) => {
        due.push(fn);
        return due.length;
      },
      cancel: (id) => {
        const index = (id as number) - 1;
        if (index >= 0) due[index] = () => {};
      },
    },
  );
  return {
    engine,
    captions,
    utterances,
    statuses,
    voice,
    runDue: () => {
      const batch = due.splice(0, due.length);
      for (const fn of batch) fn();
    },
  };
}

describe("joinSpeech", () => {
  test("glues prefix and spoken words once", () => {
    expect(joinSpeech("кто", "ты")).toBe("кто ты");
    expect(joinSpeech("кто ", " ты")).toBe("кто ты");
    expect(joinSpeech("", "  кто   ты ")).toBe("кто ты");
    expect(joinSpeech("уже сказано", "")).toBe("уже сказано");
  });

  test("clips to the dialogue cap", () => {
    expect(clipSpeech("abc", 3)).toBe("abc");
    expect(clipSpeech("abcd", 3)).toBe("abc");
  });
});

describe("VoiceInput", () => {
  test("streams interim captions then a final", () => {
    const { engine, captions, voice } = attach();
    voice.listen("");
    engine.speak([{ transcript: "кто", isFinal: false }]);
    engine.speak([{ transcript: "кто ты", isFinal: true }]);
    expect(captions).toEqual(["кто", "кто ты"]);
  });

  test("appends speech to a typed prefix", () => {
    const { engine, captions, voice } = attach();
    voice.listen("слушай,");
    engine.speak([{ transcript: "это про деньги", isFinal: true }]);
    expect(captions.at(-1)).toBe("слушай, это про деньги");
  });

  test("sends after silence once the phrase is final", () => {
    const { engine, utterances, voice, runDue } = attach();
    voice.listen("");
    engine.speak([{ transcript: "где Кирилл", isFinal: true }]);
    expect(utterances).toEqual([]);
    runDue();
    expect(utterances).toEqual(["где Кирилл"]);
  });

  test("does not send on interim-only silence", () => {
    const { engine, utterances, voice, runDue } = attach();
    voice.listen("");
    engine.speak([{ transcript: "мм", isFinal: false }]);
    runDue();
    expect(utterances).toEqual([]);
  });

  test("keeps typing as the new prefix and drops the old caption", () => {
    const { engine, captions, utterances, voice, runDue } = attach();
    voice.listen("");
    engine.speak([{ transcript: "не то", isFinal: false }]);
    voice.noteTyped("на самом деле");
    engine.speak([{ transcript: "не то слово", isFinal: true }]);
    expect(captions.at(-1)).toBe("не то");
    engine.onspeechstart?.(new Event("speechstart"));
    engine.speak([{ transcript: "про Турышева", isFinal: true }]);
    expect(captions.at(-1)).toBe("на самом деле про Турышева");
    runDue();
    expect(utterances).toEqual(["на самом деле про Турышева"]);
  });

  test("permission denied is blocked, not a failed listen loop", () => {
    const { engine, statuses, voice, runDue } = attach();
    voice.listen("");
    engine.error("not-allowed");
    runDue();
    expect(voice.active).toBe(false);
    expect(statuses).toContain("blocked");
    expect(engine.started).toBe(false);
  });

  test("no-speech restarts instead of failing", () => {
    const { engine, statuses, voice, runDue } = attach();
    voice.listen("");
    engine.error("no-speech");
    expect(voice.active).toBe(true);
    expect(statuses).not.toContain("failed");
    expect(statuses).not.toContain("blocked");
    runDue();
    expect(engine.started).toBe(true);
  });

  test("halt stops the restart loop", () => {
    const { engine, voice, runDue } = attach();
    voice.listen("");
    voice.halt();
    runDue();
    expect(voice.active).toBe(false);
    expect(engine.started).toBe(false);
  });

  test("forces a send when the box is full", () => {
    const engine = new FakeEngine();
    const utterances: string[] = [];
    const voice = new VoiceInput(
      {
        onCaption: () => {},
        onUtterance: (text) => utterances.push(text),
        onStatus: () => {},
      },
      {
        maxLength: 8,
        silenceMs: 10_000,
        createEngine: () => engine,
        schedule: () => 1,
        cancel: () => {},
      },
    );
    voice.listen("");
    engine.speak([{ transcript: "двенадцать", isFinal: true }]);
    expect(utterances).toEqual(["двенадца"]);
    expect(voice.active).toBe(false);
  });
});
