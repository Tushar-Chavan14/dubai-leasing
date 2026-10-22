import { Ollama } from "ollama";
import { z } from "zod";

/**
 * Model adapter (docs/architecture.md §6). Helpers get models only through this interface.
 * Decisions use `ollama.systemone()` (ollama npm ≥ 0.6.4); `chat` and `vision` use `ollama.chat`.
 */
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

export interface Llm {
  chat(messages: ChatMessage[], opts?: { schema?: z.ZodTypeAny }): Promise<ChatResult>;
  vision(images: Uint8Array[], prompt: string, schema: z.ZodTypeAny): Promise<unknown>;
  decide(state: string, questions: Record<string, SystemOneQuestion>): Promise<SystemOneResponse>;
}

export interface OllamaConfig {
  url: string;
  decisionModel?: string | undefined;
  chatModel?: string | undefined;
  /** Reads document images (KYC). Must support vision; empty means `chatModel`. */
  visionModel?: string | undefined;
}

/** Local models through Ollama (decision D5). Tenant text never leaves the machine. */
export class OllamaLlm implements Llm {
  private readonly client: Ollama;
  constructor(private readonly cfg: OllamaConfig) {
    this.client = new Ollama({ host: cfg.url });
  }

  async decide(state: string, questions: Record<string, SystemOneQuestion>): Promise<SystemOneResponse> {
    if (!this.cfg.decisionModel) throw new Error("DECISION_MODEL is not set");
    assertLocalModel(this.cfg.url, this.cfg.decisionModel, "Tenant and registry text");
    const r = await this.client.systemone({ model: this.cfg.decisionModel, state, questions, keep_alive: "10m" });
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
  async chat(messages: ChatMessage[], opts: { schema?: z.ZodTypeAny } = {}): Promise<ChatResult> {
    const model = this.cfg.chatModel;
    if (!model) throw new Error("CHAT_MODEL is not set");
    assertLocalModel(this.cfg.url, model, "Contract and tenant text");
    const r = await this.client.chat({
      model,
      stream: false,
      think: false,
      keep_alive: "10m",
      ...(opts.schema ? { format: z.toJSONSchema(opts.schema, { io: "input" }) as object } : {}),
      options: { temperature: 0 },
      messages,
    });
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
  async vision(images: Uint8Array[], prompt: string, schema: z.ZodTypeAny): Promise<unknown> {
    const model = this.cfg.visionModel || this.cfg.chatModel;
    if (!model) throw new Error("VISION_MODEL (or CHAT_MODEL) is not set");
    assertLocalVision(this.cfg.url, model);
    const r = await this.client.chat({
      model,
      stream: false,
      think: false,
      keep_alive: "10m",
      format: z.toJSONSchema(schema, { io: "input" }) as object,
      options: { temperature: 0 },
      messages: [{ role: "user", content: prompt, images }],
    });
    try {
      return JSON.parse(r.message.content);
    } catch {
      throw new Error("the vision model did not return JSON");
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
  const local = host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");
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
  ) {}
  async decide(state: string, questions: Record<string, SystemOneQuestion>): Promise<SystemOneResponse> {
    this.calls.push({ state, questions });
    const r = this.script(state);
    if (r instanceof Error) throw r;
    return r;
  }
  async chat(messages: ChatMessage[], opts: { schema?: z.ZodTypeAny } = {}): Promise<ChatResult> {
    this.chatCalls.push(messages);
    if (!this.chatScript) throw new Error("FakeLlm.chat not scripted");
    const r = this.chatScript(messages);
    if (r instanceof Error) throw r;
    const text = typeof r === "string" ? r : JSON.stringify(r);
    return { text, ...(opts.schema ? { parsed: typeof r === "string" ? undefined : r } : {}), model: "fake-chat" };
  }
  async vision(images: Uint8Array[], prompt: string): Promise<unknown> {
    this.visionCalls.push({ images, prompt });
    if (!this.visionScript) throw new Error("FakeLlm.vision not scripted");
    const r = this.visionScript(images, prompt);
    if (r instanceof Error) throw r;
    return r;
  }
}
