import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { assertLocalModel, assertLocalVision, FakeLlm, OllamaLlm } from "../src/index.ts";

describe("ID images stay on this machine", () => {
  test("loopback Ollama with a local model is allowed", () => {
    expect(() => assertLocalVision("http://localhost:11434", "qwen3.5:9b")).not.toThrow();
    expect(() => assertLocalVision("http://127.0.0.1:11434", "qwen3.5:9b")).not.toThrow();
  });
  test("a remote host or an Ollama cloud model is refused", () => {
    expect(() => assertLocalVision("https://ollama.example.com", "qwen3.5:9b")).toThrow("local model");
    expect(() => assertLocalVision("http://localhost:11434", "qwen3-vl:235b-cloud")).toThrow("cloud model");
  });
});

describe("chat", () => {
  test("only goes to a local, non-cloud model", async () => {
    expect(() => assertLocalModel("https://ollama.example.com", "qwen3.5:9b", "Contract text")).toThrow("local model");
    expect(() => assertLocalModel("http://localhost:11434", "gpt-oss:120b-cloud", "Contract text")).toThrow(
      "cloud model",
    );
    const remote = new OllamaLlm({ url: "https://ollama.example.com", chatModel: "qwen3.5:9b" });
    await expect(remote.chat([{ role: "user", content: "hi" }])).rejects.toThrow("local model");
    await expect(new OllamaLlm({ url: "http://localhost:11434" }).chat([])).rejects.toThrow("CHAT_MODEL");
  });

  test("FakeLlm scripts chat answers and records the calls", async () => {
    const llm = new FakeLlm(
      () => new Error("unused"),
      undefined,
      () => ({ flags: [] }),
    );
    const r = await llm.chat([{ role: "user", content: "review" }], {
      schema: z.object({ flags: z.array(z.unknown()) }),
    });
    expect(r.parsed).toEqual({ flags: [] });
    expect(llm.chatCalls).toHaveLength(1);
  });
});
