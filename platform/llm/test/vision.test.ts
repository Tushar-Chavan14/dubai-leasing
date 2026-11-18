import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { assertLocalModel, assertLocalVision, FakeLlm, ModelGate, OllamaLlm } from "../src/index.ts";

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
    for (const url of ["http://127.evil.com:11434", "http://127.0.0.1.evil.com", "http://128.0.0.1"])
      expect(() => assertLocalModel(url, "qwen3.5:9b", "Contract text")).toThrow("local model");
    for (const url of ["http://127.0.0.1:11434", "http://127.1.2.3", "http://localhost", "http://[::1]:11434"])
      expect(() => assertLocalModel(url, "qwen3.5:9b", "Contract text")).not.toThrow();
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

describe("ModelGate", () => {
  test("queued interactive calls go before queued background ones; one call runs at a time", async () => {
    const gate = new ModelGate(1);
    const order: string[] = [];
    let release!: () => void;
    const running = gate.run("background", () => new Promise<void>((r) => (release = r)));
    const bg = gate.run("background", async () => void order.push("background"));
    const ia = gate.run("interactive", async () => void order.push("interactive 1"));
    const ib = gate.run("interactive", async () => void order.push("interactive 2"));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await Promise.all([running, bg, ia, ib]);
    expect(order).toEqual(["interactive 1", "interactive 2", "background"]);
  });
  test("a failing call frees the slot", async () => {
    const gate = new ModelGate(1);
    await expect(gate.run("interactive", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await gate.run("interactive", async () => 5)).toBe(5);
  });
});
