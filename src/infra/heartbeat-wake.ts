import { createSubsystemLogger } from "../logging/subsystem.js";

export type HeartbeatRunResult =
  | { status: "ran"; durationMs: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export type HeartbeatWakeHandler = (opts: { reason?: string }) => Promise<HeartbeatRunResult>;

const log = createSubsystemLogger("infra/heartbeat-wake");

let handler: HeartbeatWakeHandler | null = null;
let pendingReason: string | null = null;
let scheduled = false;
let running = false;
let timer: NodeJS.Timeout | null = null;
let retryCount = 0;

const DEFAULT_COALESCE_MS = 250;
const DEFAULT_RETRY_MS = 1_000;
const MAX_RETRIES = 10;

function schedule(coalesceMs: number) {
  if (timer) {
    return;
  }
  timer = setTimeout(async () => {
    timer = null;
    scheduled = false;
    const active = handler;
    if (!active) {
      return;
    }
    if (running) {
      scheduled = true;
      schedule(coalesceMs);
      return;
    }

    const reason = pendingReason;
    pendingReason = null;
    running = true;
    try {
      const res = await active({ reason: reason ?? undefined });
      if (res.status === "skipped" && res.reason !== "disabled") {
        // Transient skip (queue busy, quiet-hours, empty file, etc.) — retry
        // unless we've exhausted the retry budget.
        if (retryCount >= MAX_RETRIES) {
          log.warn(`heartbeat wake retries exhausted (${MAX_RETRIES}), reason: ${res.reason}`);
          retryCount = 0;
          return;
        }
        retryCount++;
        pendingReason = reason ?? "retry";
        schedule(DEFAULT_RETRY_MS);
      } else {
        retryCount = 0;
      }
    } catch {
      // Error is already logged by the heartbeat runner; schedule a retry.
      if (retryCount >= MAX_RETRIES) {
        log.warn(`heartbeat wake retries exhausted (${MAX_RETRIES}), reason: error`);
        retryCount = 0;
        return;
      }
      retryCount++;
      pendingReason = reason ?? "retry";
      schedule(DEFAULT_RETRY_MS);
    } finally {
      running = false;
      if (pendingReason || scheduled) {
        schedule(coalesceMs);
      }
    }
  }, coalesceMs);
  timer.unref?.();
}

export function setHeartbeatWakeHandler(next: HeartbeatWakeHandler | null) {
  handler = next;
  if (handler && pendingReason) {
    schedule(DEFAULT_COALESCE_MS);
  }
}

export function requestHeartbeatNow(opts?: { reason?: string; coalesceMs?: number }) {
  pendingReason = opts?.reason ?? pendingReason ?? "requested";
  schedule(opts?.coalesceMs ?? DEFAULT_COALESCE_MS);
}

export function hasHeartbeatWakeHandler() {
  return handler !== null;
}

export function hasPendingHeartbeatWake() {
  return pendingReason !== null || Boolean(timer) || scheduled;
}

export function resetHeartbeatWakeForTest() {
  handler = null;
  pendingReason = null;
  scheduled = false;
  running = false;
  if (timer) {
    clearTimeout(timer);
  }
  timer = null;
  retryCount = 0;
}
