import { describe, expect, test } from "bun:test";
import { checkOllamaUrl } from "../src/ollama-url.ts";

const ok = (u: string) => checkOllamaUrl(u).ok;

describe("checkOllamaUrl (S49 amendment): documents only go to a model on this machine or network", () => {
  test("loopback is accepted", () => {
    for (const u of [
      "http://localhost:11434",
      "http://127.0.0.1:11434",
      "http://127.8.9.10",
      "http://[::1]:11434",
      "http://LOCALHOST",
    ])
      expect(ok(u)).toBe(true);
  });
  test("private networks are accepted, and only their exact ranges", () => {
    for (const u of [
      "http://10.1.2.3:11434",
      "http://172.16.0.1",
      "http://172.31.255.255",
      "http://192.168.1.20:11434",
      "http://[fc00::1]",
      "http://[fd12:3456::1]",
    ])
      expect(ok(u)).toBe(true);
    for (const u of [
      "http://172.15.0.1",
      "http://172.32.0.1",
      "http://11.0.0.1",
      "http://192.169.1.1",
      "http://[fe00::1]",
    ])
      expect(ok(u)).toBe(false);
  });
  test("single-label, .local and .lan hostnames are accepted", () => {
    for (const u of ["http://ollama", "http://gpu-box:11434", "http://gpu.local", "http://box.lan:11434"])
      expect(ok(u)).toBe(true);
  });
  test("ollama.systemone (the project's own host name, named in the brief) is accepted, but not a lookalike", () => {
    expect(ok("http://ollama.systemone")).toBe(true);
    expect(ok("http://ollama.systemone:11434")).toBe(true);
    expect(ok("http://ollama.systemone.com")).toBe(false);
  });
  test("public hosts and addresses are refused, with a reason", () => {
    for (const u of [
      "https://api.example.com",
      "http://8.8.8.8:11434",
      "http://ollama.cloud.example.com",
      "http://localhost.evil.com",
      "http://127.0.0.1.evil.com",
      "http://[2001:4860:4860::8888]",
    ]) {
      const r = checkOllamaUrl(u);
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.reason).toContain("local");
    }
  });
  test("a URL that doesn't parse, or isn't http(s), is refused", () => {
    for (const u of ["", "not a url", "ftp://localhost", "localhost:11434"]) expect(ok(u)).toBe(false);
  });
});
