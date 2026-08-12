import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";

import {
  DREAM_MODEL,
  DREAM_REASONING_EFFORT,
  type CodexAccountStatus,
  type CodexRateLimitWindow,
  type DeviceLogin,
} from "../shared/ai";

interface JsonRpcResponse {
  id: string | number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface AccountReadResult {
  account: {
    type?: string;
    email?: string | null;
    planType?: string | null;
  } | null;
}

interface ModelListResult {
  data?: Array<{
    id?: string;
    model?: string;
    supportedReasoningEfforts?: Array<{
      reasoningEffort?: string;
    }>;
  }>;
}

interface RateLimitsResult {
  rateLimits?: {
    primary?: unknown;
    secondary?: unknown;
  } | null;
}

const REQUEST_TIMEOUT_MS = 60_000;

const EMPTY_STATUS = (): CodexAccountStatus => ({
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
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function rateWindow(value: unknown): CodexRateLimitWindow | null {
  const record = asRecord(value);
  if (!record || typeof record.usedPercent !== "number") return null;
  return {
    usedPercent: record.usedPercent,
    windowDurationMins:
      typeof record.windowDurationMins === "number"
        ? record.windowDurationMins
        : null,
    resetsAt: typeof record.resetsAt === "number" ? record.resetsAt : null,
  };
}

/**
 * The community AI SDK provider deliberately exposes inference only. This tiny sibling
 * process owns the stable account RPCs, using the same CODEX_HOME as the provider.
 */
export class CodexAccountProcess {
  private process: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<string | number, PendingRequest>();
  private status: CodexAccountStatus = EMPTY_STATUS();
  private activeLoginId: string | null = null;

  constructor(
    private readonly options: {
      codexPath: string;
      codexHome: string;
      verbose?: boolean;
    },
  ) {
    mkdirSync(options.codexHome, { recursive: true });
  }

  snapshot(): CodexAccountStatus {
    return structuredClone(this.status);
  }

  async start(): Promise<void> {
    if (this.process) return;
    if (this.starting) return this.starting;
    this.starting = this.spawnAndInitialize();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async spawnAndInitialize(): Promise<void> {
    const child = spawn(this.options.codexPath, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CODEX_HOME: this.options.codexHome },
    });
    this.process = child;

    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        this.handle(JSON.parse(line) as JsonRpcResponse | JsonRpcNotification);
      } catch (error) {
        console.error("[codex-account] invalid JSONL:", error);
      }
    });

    createInterface({ input: child.stderr }).on("line", (line) => {
      if (this.options.verbose) console.error(`[codex-account] ${line}`);
    });

    child.on("exit", (code, signal) => {
      if (this.options.verbose) {
        console.error(
          `[codex-account] exited (${code ?? signal ?? "unknown"})`,
        );
      }
      this.closePending(new Error("Codex account process closed"));
      this.process = null;
      this.status = {
        ...EMPTY_STATUS(),
        state: "error",
        message: "Codex app-server остановился.",
      };
    });

    child.on("error", (error) => {
      this.closePending(error);
      this.process = null;
      this.status = {
        ...EMPTY_STATUS(),
        state: "error",
        message: error.message,
      };
    });

    await this.requestDirect("initialize", {
      clientInfo: {
        name: "dream-walker",
        title: "Dream Walker",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});
  }

  private handle(message: JsonRpcResponse | JsonRpcNotification): void {
    if ("id" in message) {
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timeout);
      this.pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message ?? "Codex RPC failed"));
      } else {
        request.resolve(message.result);
      }
      return;
    }

    if (message.method === "account/login/completed") {
      const params = asRecord(message.params);
      const succeeded = params?.success === true;
      this.activeLoginId = null;
      if (succeeded) {
        void this.refresh();
      } else {
        this.status = {
          ...this.status,
          state: "error",
          message:
            typeof params?.error === "string"
              ? params.error
              : "Авторизация не завершилась.",
        };
      }
    }

    if (message.method === "account/updated") void this.refresh();
    if (message.method === "account/rateLimits/updated") {
      void this.refreshRateLimits();
    }
  }

  private closePending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private notify(method: string, params?: unknown): void {
    if (!this.process) throw new Error("Codex account process is not running");
    this.process.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private requestDirect<T>(method: string, params?: unknown): Promise<T> {
    if (!this.process) {
      return Promise.reject(new Error("Codex account process is not running"));
    }
    const id = this.nextId++;
    const request = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex RPC ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
      this.process!.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.start();
    return this.requestDirect<T>(method, params);
  }

  async refresh(): Promise<CodexAccountStatus> {
    try {
      const account = await this.request<AccountReadResult>("account/read", {
        refreshToken: false,
      });
      if (!account.account || account.account.type !== "chatgpt") {
        this.status = {
          ...EMPTY_STATUS(),
          state: this.activeLoginId ? "authorizing" : "disconnected",
        };
        return this.snapshot();
      }

      const models = await this.request<ModelListResult>("model/list", {});
      const selected = (models.data ?? []).find(
        (model) => model.id === DREAM_MODEL || model.model === DREAM_MODEL,
      );
      const modelAvailable = selected !== undefined;
      const effortAvailable =
        selected?.supportedReasoningEfforts?.some(
          (effort) => effort.reasoningEffort === DREAM_REASONING_EFFORT,
        ) ?? false;

      this.status = {
        ...EMPTY_STATUS(),
        state: modelAvailable && effortAvailable ? "connected" : "incompatible",
        email: account.account.email ?? null,
        planType: account.account.planType ?? null,
        modelAvailable,
        effortAvailable,
        message:
          modelAvailable && effortAvailable
            ? null
            : `${DREAM_MODEL} · ${DREAM_REASONING_EFFORT} недоступна этому аккаунту.`,
      };
      await this.refreshRateLimits();
      return this.snapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = { ...this.status, state: "error", message };
      return this.snapshot();
    }
  }

  private async refreshRateLimits(): Promise<void> {
    if (
      this.status.state !== "connected" &&
      this.status.state !== "incompatible"
    ) {
      return;
    }
    try {
      const result = await this.request<RateLimitsResult>(
        "account/rateLimits/read",
        {},
      );
      this.status = {
        ...this.status,
        primary: rateWindow(result.rateLimits?.primary),
        secondary: rateWindow(result.rateLimits?.secondary),
      };
    } catch {
      // Rate-limit metadata is useful chrome, not a prerequisite for inference.
    }
  }

  async startDeviceLogin(): Promise<DeviceLogin> {
    if (this.activeLoginId) {
      throw new Error("Авторизация уже ожидает подтверждения.");
    }
    const result = await this.request<{
      loginId: string;
      verificationUrl: string;
      userCode: string;
    }>("account/login/start", { type: "chatgptDeviceCode" });
    this.activeLoginId = result.loginId;
    this.status = {
      ...EMPTY_STATUS(),
      state: "authorizing",
      message: "Ожидаю подтверждения в ChatGPT.",
    };
    return result;
  }

  async cancelLogin(loginId?: string): Promise<void> {
    const active = loginId ?? this.activeLoginId;
    if (!active) return;
    await this.request("account/login/cancel", { loginId: active });
    this.activeLoginId = null;
    this.status = EMPTY_STATUS();
  }

  async logout(): Promise<void> {
    await this.request("account/logout", {});
    this.activeLoginId = null;
    this.status = EMPTY_STATUS();
  }

  dispose(): void {
    this.closePending(new Error("Codex account process disposed"));
    this.process?.kill("SIGTERM");
    this.process = null;
  }
}
