import { Ollama } from "ollama";
import { z } from "zod";

/**
 * Model adapter (docs/architecture.md §6). Helpers get models only through this interface.
 * Decisions use `ollama.systemone()` (ollama npm ≥ 0.6.4); `chat` and `vision` use `ollama.chat`.
 */

/**
 * Context window for every Ollama call. Without it Ollama loads the model at its small default (4096 tokens), long
 * prompts such as a contract sample are cut off and the model answers with broken JSON. The copilot uses the same
 * size, so the loaded model is shared instead of reloaded between callers.
 */
export const MODEL_NUM_CTX = 16384;
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  parsed?: unknown;
  model: string;
  tokens?: number;
}

/** Decision questions. `choice` must include a `none` option; criteria `null` uses the key as text. */
export type SystemOneQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "noul"; instructions: string; criteria?: { false?: string; true?: string } }
  | { type: "score"; instructions: string; criteria: string[] };

export type SystemOneAnswer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };

export interface SystemOneResponse {
  answers: Record<string, SystemOneAnswer | undefined>;
  model: string;
  tokens?: number;
}

/** A model call that ran past its time limit and was cancelled. */
export class ModelTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`the model did not answer within ${Math.round(timeoutMs / 1000)} s`);
    this.name = "ModelTimeoutError";
  }
}

/** `interactive` work (KYC, copilot, customer agent) goes before `background` work (contract jobs). */
export type ModelPriority = "interactive" | "background";

/**
 * One local GPU: model calls take turns. Waiting calls go by priority, then arrival, so a queued
 * interactive call starts before any queued background one. A running call is never cancelled by
 * the gate; its own timeout bounds it.
 */
export class ModelGate {
  private active = 0;
  private waiting: { rank: number; seq: number; go: () => void }[] = [];
  private seq = 0;
  constructor(private readonly slots = 1) {}

  async run<T>(priority: ModelPriority, fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.slots) {
      await new Promise<void>((go) => {
        this.waiting.push({ rank: priority === "interactive" ? 0 : 1, seq: this.seq++, go });
      });
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.sort((a, b) => a.rank - b.rank || a.seq - b.seq).shift();
      if (next) next.go(); // the slot passes straight to the next call
      else this.active--;
    }
  }
}

export interface CallOpts {
  /** Cancel the model call after this long (the wait for the gate doesn't count). */
  timeoutMs?: number;
}

export interface Llm {
  /** The model that reads images, for logs (empty config means the chat model). */
  readonly visionModelName?: string | undefined;
  chat(messages: ChatMessage[], opts?: { schema?: z.ZodTypeAny } & CallOpts): Promise<ChatResult>;
  vision(images: Uint8Array[], prompt: string, schema: z.ZodTypeAny, opts?: CallOpts): Promise<unknown>;
  decide(state: string, questions: Record<string, SystemOneQuestion>): Promise<SystemOneResponse>;
  /** Listens to one short clip and answers in JSON shaped by `schema` (unvalidated). Local models only; audio is never kept. */
  audio(model: string, bytes: Uint8Array, prompt: string, schema: z.ZodTypeAny): Promise<unknown>;
}

export interface OllamaConfig {
  url: string;
  decisionModel?: string | undefined;
  chatModel?: string | undefined;
  /** Reads document images (KYC). Must support vision; empty means `chatModel`. */
  visionModel?: string | undefined;
  /** Shared by every adapter on this machine so calls take turns. Absent: no queueing. */
  gate?: ModelGate | undefined;
  /** Where this adapter's calls queue. Default `interactive`. */
  priority?: ModelPriority | undefined;
  /** Limit for a call that sets none of its own (the contract jobs use this). */
  defaultTimeoutMs?: number | undefined;
}

/** Local models through Ollama (decision D5). Tenant text never leaves the machine. */
export class OllamaLlm implements Llm {
  private readonly client: Ollama;
  constructor(private readonly cfg: OllamaConfig) {
    this.client = new Ollama({ host: cfg.url });
  }

  get visionModelName(): string | undefined {
    return this.cfg.visionModel || this.cfg.chatModel;
  }

  /** Waits for the gate, then runs `fn` with a client whose requests are cancelled at the timeout. */
  private async call<T>(timeoutMs: number | undefined, fn: (client: Ollama) => Promise<T>): Promise<T> {
    const limit = timeoutMs ?? this.cfg.defaultTimeoutMs;
    const go = async () => {
      if (!limit) return fn(this.client);
      const client = new Ollama({
        host: this.cfg.url,
        fetch: Object.assign(
          (input: string | Request | URL, init?: RequestInit) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(limit) }),
          { preconnect: fetch.preconnect },
        ),
      });
      try {
        return await fn(client);
      } catch (e) {
        if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
          throw new ModelTimeoutError(limit);
        throw e;
      }
    };
    return this.cfg.gate ? this.cfg.gate.run(this.cfg.priority ?? "interactive", go) : go();
  }

  async decide(state: string, questions: Record<string, SystemOneQuestion>): Promise<SystemOneResponse> {
    if (!this.cfg.decisionModel) throw new Error("DECISION_MODEL is not set");
    assertLocalModel(this.cfg.url, this.cfg.decisionModel, "Tenant and registry text");
    const decisionModel = this.cfg.decisionModel;
    const r = await this.call(undefined, (c) =>
      c.systemone({ model: decisionModel, state, questions, keep_alive: "10m" }),
    );
    return {
      answers: r.answers as Record<string, SystemOneAnswer>,
      model: r.model,
      tokens: (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0),
    };
  }

  /**
   * One chat turn (temperature 0, thinking off). With `schema`, the answer is constrained to that
   * JSON shape and returned in `parsed`, unvalidated: the calling helper Zod-parses it. Text that
   * reaches here may be personal or tenant-written, so it only goes to a local model.
   */
  async chat(messages: ChatMessage[], opts: { schema?: z.ZodTypeAny } & CallOpts = {}): Promise<ChatResult> {
    const model = this.cfg.chatModel;
    if (!model) throw new Error("CHAT_MODEL is not set");
    assertLocalModel(this.cfg.url, model, "Contract and tenant text");
    const r = await this.call(opts.timeoutMs, (c) =>
      c.chat({
        model,
        stream: false,
        think: false,
        keep_alive: "10m",
        ...(opts.schema ? { format: z.toJSONSchema(opts.schema, { io: "input" }) as object } : {}),
        options: { temperature: 0, num_ctx: MODEL_NUM_CTX },
        messages,
      }),
    );
    const text = r.message.content;
    let parsed: unknown;
    if (opts.schema) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("the chat model did not return JSON");
      }
    }
    return {
      text,
      ...(opts.schema ? { parsed } : {}),
      model: r.model,
      tokens: (r.prompt_eval_count ?? 0) + (r.eval_count ?? 0),
    };
  }

  /**
   * Reads images and answers in JSON shaped by `schema` (temperature 0, thinking off). Returns the
   * parsed JSON unvalidated: the calling helper Zod-parses it and retries or asks a person.
   * Images go only to the local Ollama server (D5); they are never sent to a cloud API.
   */
  async vision(images: Uint8Array[], prompt: string, schema: z.ZodTypeAny, opts: CallOpts = {}): Promise<unknown> {
    const model = this.cfg.visionModel || this.cfg.chatModel;
    if (!model) throw new Error("VISION_MODEL (or CHAT_MODEL) is not set");
    assertLocalVision(this.cfg.url, model);
    const r = await this.call(opts.timeoutMs, (c) =>
      c.chat({
        model,
        stream: false,
        think: false,
        keep_alive: "10m",
        format: z.toJSONSchema(schema, { io: "input" }) as object,
        options: { temperature: 0, num_ctx: MODEL_NUM_CTX },
        messages: [{ role: "user", content: prompt, images }],
      }),
    );
    try {
      return JSON.parse(r.message.content);
    } catch {
      throw new Error("the vision model did not return JSON");
    }
  }

  /**
   * Transcribes audio with a local audio-capable model (Ollama carries audio base64 in `images`).
   * Voice may hold personal data, so it only goes to a loopback Ollama (rule 8). The bytes are
   * sent and dropped: nothing here writes or logs them.
   */
  async audio(model: string, bytes: Uint8Array, prompt: string, schema: z.ZodTypeAny): Promise<unknown> {
    if (!model) throw new Error("VOICE_MODEL is not set");
    assertLocalModel(this.cfg.url, model, "Voice audio");
    const r = await this.call(undefined, (c) =>
      c.chat({
        model,
        stream: false,
        think: false,
        keep_alive: "10m",
        format: z.toJSONSchema(schema, { io: "input" }) as object,
        options: { temperature: 0, num_ctx: MODEL_NUM_CTX },
        messages: [{ role: "user", content: prompt, images: [Buffer.from(bytes).toString("base64")] }],
      }),
    );
    try {
      return JSON.parse(r.message.content);
    } catch {
      throw new Error("the voice model did not return JSON");
    }
  }
}

/**
 * ID images must not leave the machine (AGENTS rule 8): the vision model has to be a local
 * Ollama model on a loopback address, never an Ollama cloud model or a remote host.
 */
export function assertLocalVision(url: string, model: string): void {
  assertLocalModel(url, model, "ID images");
}

/** Personal data stays on this machine (AGENTS rule 8): loopback Ollama only, no cloud model tags. */
export function assertLocalModel(url: string, model: string, what: string): void {
  const host = new URL(url).hostname;
  // Loopback only: `localhost`, `::1`, or a literal 127.0.0.0/8 address (a name like 127.evil.com is not one).
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  const local =
    host === "localhost" || host === "::1" || host === "[::1]" || (!!octets && octets.every((o) => o >= 0 && o <= 255));
  if (!local) throw new Error(`${what} can only go to a local model; OLLAMA_URL points at ${host}`);
  if (/(^|[-:])cloud$/i.test(model)) throw new Error(`${what} can't go to a cloud model (${model})`);
}

/** Test double: returns scripted decisions, records the calls. */
export class FakeLlm implements Llm {
  calls: { state: string; questions: Record<string, SystemOneQuestion> }[] = [];
  visionCalls: { images: Uint8Array[]; prompt: string }[] = [];
  chatCalls: ChatMessage[][] = [];
  constructor(
    private readonly script: (state: string) => SystemOneResponse | Error,
    private readonly visionScript?: (images: Uint8Array[], prompt: string) => unknown,
    /** Returns the parsed JSON answer (or plain text) for a chat call. */
    private readonly chatScript?: (messages: ChatMessage[]) => unknown,
    /** Returns the parsed JSON answer for an audio call. */
    private readonly audioScript?: (bytes: Uint8Array, prompt: string) => unknown,
  ) {}
  audioCalls: { model: string; bytes: Uint8Array; prompt: string }[] = [];
  async audio(model: string, bytes: Uint8Array, prompt: string): Promise<unknown> {
    this.audioCalls.push({ model, bytes, prompt });
    if (!this.audioScript) throw new Error("FakeLlm.audio not scripted");
    const r = this.audioScript(bytes, prompt);
    if (r instanceof Error) throw r;
    return r;
  }
  async decide(state: string, questions: Record<string, SystemOneQuestion>): Promise<SystemOneResponse> {
    this.calls.push({ state, questions });
    const r = this.script(state);
    if (r instanceof Error) throw r;
    return r;
  }
  readonly visionModelName = "fake-vision";
  /** Cancels a scripted answer that outlasts `timeoutMs`, as the real adapter does. */
  private async within<T>(value: T | Promise<T>, timeoutMs?: number): Promise<T> {
    if (!timeoutMs) return value;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(value),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ModelTimeoutError(timeoutMs)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async chat(messages: ChatMessage[], opts: { schema?: z.ZodTypeAny } & CallOpts = {}): Promise<ChatResult> {
    this.chatCalls.push(messages);
    if (!this.chatScript) throw new Error("FakeLlm.chat not scripted");
    const r = this.chatScript(messages);
    if (r instanceof Error) throw r;
    const text = typeof r === "string" ? r : JSON.stringify(r);
    return { text, ...(opts.schema ? { parsed: typeof r === "string" ? undefined : r } : {}), model: "fake-chat" };
  }
  async vision(images: Uint8Array[], prompt: string, _schema?: z.ZodTypeAny, opts: CallOpts = {}): Promise<unknown> {
    this.visionCalls.push({ images, prompt });
    if (!this.visionScript) throw new Error("FakeLlm.vision not scripted");
    const r = await this.within(this.visionScript(images, prompt) as unknown, opts.timeoutMs);
    if (r instanceof Error) throw r;
    return r;
  }
}
