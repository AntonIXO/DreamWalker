import { resolve } from "node:path";

export interface MemoryCandidate {
  id: string;
  text: string;
  sequence: number;
}

export interface MemoryRetrievalOptions {
  limit?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface MemoryRetrieval<T extends MemoryCandidate> {
  mode: "semantic" | "lexical";
  memories: T[];
}

/** The caller supplies only memories this character is allowed to know. */
export type MemoryEmbedder = (
  texts: string[],
) => Promise<readonly (readonly number[] | Float32Array)[]>;

interface RetrieverOptions {
  loadEmbedder?: () => Promise<MemoryEmbedder>;
  maxCandidates?: number;
  maxCacheEntries?: number;
  batchSize?: number;
  retryMs?: number;
}

export const SEMANTIC_MEMORY_MODEL =
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const MAX_TEXT_LENGTH = 1_200;
const DEFAULT_TIMEOUT_MS = 600;

/** Model files are downloaded once; player text never leaves this process. */
async function loadLocalEmbedder(): Promise<MemoryEmbedder> {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  const extractor = await pipeline(
    "feature-extraction",
    SEMANTIC_MEMORY_MODEL,
    {
      device: "cpu",
      dtype: "q8",
      cache_dir: resolve(".dreamwalker/models"),
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    },
  );
  return async (texts) => {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist() as number[][];
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  max: number,
) {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(0, Math.min(max, Math.floor(value)))
    : fallback;
}

function embeddingText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function terms(text: string): Set<string> {
  return new Set(
    (
      embeddingText(text)
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).filter((word) => word.length > 2),
  );
}

function lexicalScore(text: string, queryTerms: Set<string>): number {
  if (!queryTerms.size) return 0;
  const textTerms = terms(text);
  let matches = 0;
  for (const term of queryTerms) if (textTerms.has(term)) matches++;
  return matches / Math.sqrt(queryTerms.size * Math.max(1, textTerms.size));
}

function normalizedVector(
  values: readonly number[] | Float32Array,
): Float32Array {
  if (!values.length || values.length > 4_096)
    throw new Error("Invalid memory embedding dimensions");
  let norm = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error("Invalid memory embedding");
    norm += value * value;
  }
  if (!norm) throw new Error("Empty memory embedding");
  const scale = 1 / Math.sqrt(norm);
  return Float32Array.from(values, (value) => value * scale);
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let score = 0;
  for (let i = 0; i < a.length; i++) score += a[i]! * b[i]!;
  return score;
}

/** Timers and listeners are removed on every completion path. */
async function waitForVectors(
  job: Promise<void>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted || timeoutMs <= 0) return;
  await new Promise<void>((done) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      done();
    };
    const timer = setTimeout(finish, timeoutMs);
    signal?.addEventListener("abort", finish, { once: true });
    void job.then(finish, finish);
  });
}

/**
 * A process-local LRU of vectors, never a store of access permissions or truth.
 * Requests do not wait for downloads. One inference job and one replacing pending
 * batch bound work even when a model is slow or several NPCs speak together.
 */
export class SemanticMemoryRetriever {
  private readonly loadEmbedder: () => Promise<MemoryEmbedder>;
  private readonly maxCandidates: number;
  private readonly maxCacheEntries: number;
  private readonly batchSize: number;
  private readonly retryMs: number;
  private readonly vectors = new Map<string, Float32Array>();
  private embedder?: MemoryEmbedder;
  private loading?: Promise<boolean>;
  private activeJob?: Promise<void>;
  private pendingTexts?: string[];
  private retryAfter = 0;
  private dimensions?: number;

  constructor(options: RetrieverOptions = {}) {
    this.loadEmbedder = options.loadEmbedder ?? loadLocalEmbedder;
    this.maxCandidates = Math.max(
      1,
      boundedInteger(options.maxCandidates, 1_024, 1_024),
    );
    // A complete candidate set plus the query must fit for semantic ranking.
    this.maxCacheEntries = Math.max(
      this.maxCandidates + 1,
      boundedInteger(options.maxCacheEntries, 2_048, 8_192),
    );
    this.batchSize = Math.max(1, boundedInteger(options.batchSize, 16, 32));
    this.retryMs = boundedInteger(options.retryMs, 60_000, 600_000);
  }

  get status(): "cold" | "loading" | "ready" | "unavailable" {
    if (this.embedder) return "ready";
    if (this.loading) return "loading";
    return this.retryAfter > Date.now() ? "unavailable" : "cold";
  }

  /** Optional startup warmup; retrieval itself always starts this lazily. */
  warmup(): Promise<boolean> {
    if (this.embedder) return Promise.resolve(true);
    if (this.loading) return this.loading;
    if (Date.now() < this.retryAfter) return Promise.resolve(false);
    this.loading = Promise.resolve()
      .then(this.loadEmbedder)
      .then((embedder) => {
        this.embedder = embedder;
        this.retryAfter = 0;
        return true;
      })
      .catch(() => {
        this.retryAfter = Date.now() + this.retryMs;
        return false;
      })
      .finally(() => {
        this.loading = undefined;
        const pending = this.pendingTexts;
        this.pendingTexts = undefined;
        if (this.embedder && pending) this.queueVectors(pending);
      });
    return this.loading;
  }

  async retrieve<T extends MemoryCandidate>(
    candidates: T[],
    query: string,
    options: MemoryRetrievalOptions = {},
  ): Promise<MemoryRetrieval<T>> {
    const limit = boundedInteger(options.limit, 8, 24);
    const queryTerms = terms(query);
    // Index the entire bounded run archive: lexical or recent preselection would
    // permanently hide an old Russian episode from an English paraphrase query.
    const archive = [...candidates]
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, this.maxCandidates);
    const lexicalScores = new Map(
      archive.map((candidate) => [
        candidate,
        lexicalScore(candidate.text, queryTerms),
      ]),
    );
    // Eligibility belongs to the caller; a cached vector grants no knowledge.
    const ranked = [...archive].sort(
      (a, b) =>
        lexicalScores.get(b)! - lexicalScores.get(a)! ||
        b.sequence - a.sequence,
    );
    const fallback: MemoryRetrieval<T> = {
      mode: "lexical",
      memories: ranked.slice(0, limit),
    };
    if (!limit || !archive.length || options.signal?.aborted) return fallback;
    const queryText = embeddingText(query);
    if (!queryText) return fallback;
    const texts = [
      queryText,
      ...archive.map((item) => embeddingText(item.text)),
    ];
    if (!this.embedder) {
      this.pendingTexts = texts;
      void this.warmup();
      return fallback;
    }

    const job = this.queueVectors(texts);
    if (job)
      await waitForVectors(
        job,
        boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 2_000),
        options.signal,
      );
    if (options.signal?.aborted) return fallback;
    const queryVector = this.cached(queryText);
    if (!queryVector) return fallback;
    const candidateVectors = archive.map((candidate) =>
      this.cached(embeddingText(candidate.text)),
    );
    if (!candidateVectors.some(Boolean)) return fallback;

    // A new episode awaiting its vector must not disable semantic recall of the
    // rest of the archive. Unindexed episodes retain their lexical score until
    // the serialized background job reaches them.
    const scores = archive.map((candidate, index) => ({
      candidate,
      score: candidateVectors[index]
        ? cosine(queryVector, candidateVectors[index]!) +
          0.08 * lexicalScores.get(candidate)!
        : lexicalScores.get(candidate)!,
    }));
    scores.sort(
      (a, b) =>
        b.score - a.score || b.candidate.sequence - a.candidate.sequence,
    );
    return {
      mode: "semantic",
      memories: scores.slice(0, limit).map(({ candidate }) => candidate),
    };
  }

  private cached(text: string): Float32Array | undefined {
    const vector = this.vectors.get(text);
    if (vector) {
      this.vectors.delete(text);
      this.vectors.set(text, vector);
    }
    return vector;
  }

  private queueVectors(texts: string[]): Promise<void> | undefined {
    const missing = [...new Set(texts)].filter((text) => !this.cached(text));
    if (!missing.length) return undefined;
    if (this.activeJob) {
      this.pendingTexts = texts;
      return this.activeJob;
    }
    const embedder = this.embedder;
    if (!embedder) return undefined;
    this.activeJob = Promise.resolve()
      .then(async () => {
        for (let i = 0; i < missing.length; i += this.batchSize) {
          const batch = missing.slice(i, i + this.batchSize);
          const output = await embedder(batch);
          if (output.length !== batch.length)
            throw new Error("Memory embedding count mismatch");
          const vectors = output.map(normalizedVector);
          const dimensions = this.dimensions ?? vectors[0]!.length;
          if (vectors.some((vector) => vector.length !== dimensions))
            throw new Error("Memory embedding dimensions changed");
          this.dimensions = dimensions;
          for (let j = 0; j < batch.length; j++) {
            this.vectors.set(batch[j]!, vectors[j]!);
            while (this.vectors.size > this.maxCacheEntries) {
              this.vectors.delete(this.vectors.keys().next().value!);
            }
          }
        }
      })
      .catch(() => {
        // An unavailable native runtime or malformed embedding cannot break play.
        this.embedder = undefined;
        this.retryAfter = Date.now() + this.retryMs;
      })
      .finally(() => {
        this.activeJob = undefined;
        const pending = this.pendingTexts;
        this.pendingTexts = undefined;
        if (this.embedder && pending) this.queueVectors(pending);
      });
    return this.activeJob;
  }
}

const semanticMemory = new SemanticMemoryRetriever();

export function warmSemanticMemory(): Promise<boolean> {
  return semanticMemory.warmup();
}

export function retrieveMemories<T extends MemoryCandidate>(
  candidates: T[],
  query: string,
  options?: MemoryRetrievalOptions,
): Promise<MemoryRetrieval<T>> {
  return semanticMemory.retrieve(candidates, query, options);
}
