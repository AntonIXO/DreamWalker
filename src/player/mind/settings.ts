import {
  DREAM_MODEL,
  DREAM_REASONING_EFFORT,
  type CodexAccountStatus,
  type DeviceLogin,
} from "../../shared/ai";

export type MindSettings = CodexAccountStatus;

export const DEFAULT_MIND_SETTINGS: MindSettings = {
  provider: "codex",
  state: "disconnected",
  email: null,
  planType: null,
  model: DREAM_MODEL,
  effort: DREAM_REASONING_EFFORT,
  modelAvailable: false,
  effortAvailable: false,
  primary: null,
  secondary: null,
  message: null,
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

export async function loadMindSettings(): Promise<MindSettings> {
  try {
    return await readJson<MindSettings>(
      await fetch("/api/codex/account", { cache: "no-store" }),
    );
  } catch (error) {
    return {
      ...DEFAULT_MIND_SETTINGS,
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function startDeviceLogin(): Promise<DeviceLogin> {
  return readJson<DeviceLogin>(
    await fetch("/api/codex/login", { method: "POST" }),
  );
}

export async function cancelDeviceLogin(loginId: string): Promise<void> {
  await readJson(
    await fetch("/api/codex/login/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginId }),
    }),
  );
}

export async function logoutMind(): Promise<MindSettings> {
  return readJson<MindSettings>(
    await fetch("/api/codex/logout", { method: "POST" }),
  );
}

export function describeMind(settings: MindSettings): string {
  if (settings.state === "connected") {
    return `${settings.model} · ${settings.effort} · ${settings.provider}`;
  }
  if (settings.state === "authorizing") return "ожидает подтверждения";
  if (settings.state === "incompatible") return settings.message ?? "модель недоступна";
  return "сон отвечает сам, без модели";
}
