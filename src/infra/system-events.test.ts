import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { prependSystemEvents } from "../auto-reply/reply/session-updates.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { enqueueSystemEvent, peekSystemEvents, resetSystemEventsForTest } from "./system-events.js";

// Mock the subsystem logger to verify overflow warnings
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    info: vi.fn(),
    warn: warnSpy,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const cfg = {} as unknown as OpenClawConfig;
const mainKey = resolveMainSessionKey(cfg);

describe("system events (session routing)", () => {
  beforeEach(() => {
    resetSystemEventsForTest();
  });

  it("does not leak session-scoped events into main", async () => {
    enqueueSystemEvent("Discord reaction added: ✅", {
      sessionKey: "discord:group:123",
      contextKey: "discord:reaction:added:msg:user:✅",
    });

    expect(peekSystemEvents(mainKey)).toEqual([]);
    expect(peekSystemEvents("discord:group:123")).toEqual(["Discord reaction added: ✅"]);

    const main = await prependSystemEvents({
      cfg,
      sessionKey: mainKey,
      isMainSession: true,
      isNewSession: false,
      prefixedBodyBase: "hello",
    });
    expect(main).toBe("hello");
    expect(peekSystemEvents("discord:group:123")).toEqual(["Discord reaction added: ✅"]);

    const discord = await prependSystemEvents({
      cfg,
      sessionKey: "discord:group:123",
      isMainSession: false,
      isNewSession: false,
      prefixedBodyBase: "hi",
    });
    expect(discord).toMatch(/^System: \[[^\]]+\] Discord reaction added: ✅\n\nhi$/);
    expect(peekSystemEvents("discord:group:123")).toEqual([]);
  });

  it("requires an explicit session key", () => {
    expect(() => enqueueSystemEvent("Node: Mac Studio", { sessionKey: " " })).toThrow("sessionKey");
  });

  it("logs warning when queue overflows (21st event drops oldest)", () => {
    warnSpy.mockClear();
    const key = "overflow-test";
    for (let i = 1; i <= 20; i++) {
      enqueueSystemEvent(`event ${i}`, { sessionKey: key });
    }
    expect(warnSpy).not.toHaveBeenCalled();
    expect(peekSystemEvents(key)).toHaveLength(20);

    // 21st event triggers overflow
    enqueueSystemEvent("event 21", { sessionKey: key });
    expect(peekSystemEvents(key)).toHaveLength(20);
    expect(peekSystemEvents(key)[0]).toBe("event 2"); // first event dropped
    expect(peekSystemEvents(key)[19]).toBe("event 21");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "system event queue overflow: oldest event dropped",
      expect.objectContaining({ sessionKey: key }),
    );
  });
});
