import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestHeartbeatNow,
  resetHeartbeatWakeForTest,
  setHeartbeatWakeHandler,
  type HeartbeatRunResult,
} from "./heartbeat-wake.js";

describe("heartbeat-wake retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetHeartbeatWakeForTest();
  });

  afterEach(() => {
    resetHeartbeatWakeForTest();
    vi.useRealTimers();
  });

  async function flush(ms = 2_000) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("retries on quiet-hours skip", async () => {
    const handler = vi
      .fn<[], Promise<HeartbeatRunResult>>()
      .mockResolvedValueOnce({ status: "skipped", reason: "quiet-hours" })
      .mockResolvedValueOnce({ status: "ran", durationMs: 1 });

    setHeartbeatWakeHandler(handler);
    requestHeartbeatNow({ reason: "hook:wake" });

    // First call: coalesce delay (250ms)
    await flush(300);
    expect(handler).toHaveBeenCalledTimes(1);

    // Retry after 1s
    await flush(1_100);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("retries on empty-heartbeat-file skip", async () => {
    const handler = vi
      .fn<[], Promise<HeartbeatRunResult>>()
      .mockResolvedValueOnce({ status: "skipped", reason: "empty-heartbeat-file" })
      .mockResolvedValueOnce({ status: "ran", durationMs: 1 });

    setHeartbeatWakeHandler(handler);
    requestHeartbeatNow({ reason: "hook:wake" });

    await flush(300);
    expect(handler).toHaveBeenCalledTimes(1);

    await flush(1_100);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on disabled skip", async () => {
    const handler = vi
      .fn<[], Promise<HeartbeatRunResult>>()
      .mockResolvedValue({ status: "skipped", reason: "disabled" });

    setHeartbeatWakeHandler(handler);
    requestHeartbeatNow({ reason: "hook:wake" });

    await flush(300);
    expect(handler).toHaveBeenCalledTimes(1);

    // No retry should happen
    await flush(2_000);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("stops after MAX_RETRIES (10)", async () => {
    const handler = vi
      .fn<[], Promise<HeartbeatRunResult>>()
      .mockResolvedValue({ status: "skipped", reason: "requests-in-flight" });

    setHeartbeatWakeHandler(handler);
    requestHeartbeatNow({ reason: "hook:wake" });

    // 1 initial + 10 retries = 11 total calls
    // Initial at 250ms, then 10 retries at ~1s each
    await flush(300); // initial call
    for (let i = 0; i < 10; i++) {
      await flush(1_100);
    }

    expect(handler).toHaveBeenCalledTimes(11);

    // No more retries after exhaustion
    await flush(5_000);
    expect(handler).toHaveBeenCalledTimes(11);
  });

  it("resets retry counter on success", async () => {
    const handler = vi
      .fn<[], Promise<HeartbeatRunResult>>()
      .mockResolvedValueOnce({ status: "skipped", reason: "requests-in-flight" })
      .mockResolvedValueOnce({ status: "skipped", reason: "requests-in-flight" })
      .mockResolvedValueOnce({ status: "ran", durationMs: 1 })
      // Second wake cycle
      .mockResolvedValueOnce({ status: "skipped", reason: "requests-in-flight" })
      .mockResolvedValueOnce({ status: "ran", durationMs: 1 });

    setHeartbeatWakeHandler(handler);
    requestHeartbeatNow({ reason: "hook:wake" });

    await flush(300); // call 1
    await flush(1_100); // retry 1
    await flush(1_100); // retry 2 -> success, counter resets

    expect(handler).toHaveBeenCalledTimes(3);

    // New wake request — should retry from 0 again
    requestHeartbeatNow({ reason: "hook:wake" });
    await flush(300); // call 4
    await flush(1_100); // retry -> success

    expect(handler).toHaveBeenCalledTimes(5);
  });
});
