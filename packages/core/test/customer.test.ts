import { describe, expect, test } from "bun:test";
import { ChannelReply, ChannelUpdate, CustomerEmail, LoginCode, WebChatInput } from "../src/index.ts";

const card = {
  unitId: "0190a000-0000-7000-8000-000000000001",
  code: "A-101",
  building: "Tower A",
  community: "Marina",
  bedrooms: 1,
  bathrooms: 1,
  areaSqft: 800,
  furnished: false,
  rent: "AED 80,000",
  photoUrl: null,
};
const uuid = "0190a000-0000-7000-8000-000000000002";

describe("customer types", () => {
  test("CustomerEmail trims and lowercases", () => {
    expect(CustomerEmail.parse(" Sam@Example.COM ")).toBe("sam@example.com");
    expect(CustomerEmail.safeParse("nope").success).toBe(false);
  });

  test("LoginCode is exactly six digits", () => {
    expect(LoginCode.safeParse("123456").success).toBe(true);
    expect(LoginCode.safeParse("12345").success).toBe(false);
    expect(LoginCode.safeParse("12a456").success).toBe(false);
  });

  test("WebChatInput", () => {
    expect(WebChatInput.safeParse({ kind: "text", clientMessageId: uuid, text: "hi" }).success).toBe(true);
    expect(WebChatInput.safeParse({ kind: "callback", clientMessageId: uuid, data: "x" }).success).toBe(true);
    expect(WebChatInput.safeParse({ kind: "text", clientMessageId: "1", text: "hi" }).success).toBe(false);
  });

  test("ChannelUpdate accepts web updates and keeps Telegram validation", () => {
    const web = { channel: "web", kind: "text", updateId: uuid, chatId: uuid, from: { id: uuid }, text: "hi" };
    expect(ChannelUpdate.safeParse(web).success).toBe(true);
    expect(ChannelUpdate.safeParse({ ...web, updateId: "abc" }).success).toBe(false);
    const tg = { ...web, channel: "telegram", updateId: "12", chatId: "5", from: { id: "5" } };
    expect(ChannelUpdate.safeParse(tg).success).toBe(true);
    expect(ChannelUpdate.safeParse({ ...tg, updateId: "abc" }).success).toBe(false);
    expect(ChannelUpdate.safeParse({ ...tg, updateId: uuid }).success).toBe(false);
  });

  test("ChannelReply cards max 5", () => {
    const ok = ChannelReply.safeParse({ text: "x", cards: Array(5).fill(card) });
    expect(ok.success).toBe(true);
    expect(ChannelReply.safeParse({ text: "x", cards: Array(6).fill(card) }).success).toBe(false);
  });
});
