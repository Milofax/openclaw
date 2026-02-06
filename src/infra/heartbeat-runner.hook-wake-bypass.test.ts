import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { telegramPlugin } from "../../extensions/telegram/src/channel.js";
import { setTelegramRuntime } from "../../extensions/telegram/src/runtime.js";
import { whatsappPlugin } from "../../extensions/whatsapp/src/channel.js";
import { setWhatsAppRuntime } from "../../extensions/whatsapp/src/runtime.js";
import * as replyModule from "../auto-reply/reply.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createPluginRuntime } from "../plugins/runtime/index.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";

// Avoid pulling optional runtime deps during isolated runs.
vi.mock("jiti", () => ({ createJiti: () => () => ({}) }));

beforeEach(() => {
  const runtime = createPluginRuntime();
  setTelegramRuntime(runtime);
  setWhatsAppRuntime(runtime);
  setActivePluginRegistry(
    createTestRegistry([
      { pluginId: "whatsapp", plugin: whatsappPlugin, source: "test" },
      { pluginId: "telegram", plugin: telegramPlugin, source: "test" },
    ]),
  );
});

describe("heartbeat-runner hook:wake bypass", () => {
  it("hook:wake reason bypasses empty-heartbeat-file skip", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hb-hook-"));
    const storePath = path.join(tmpDir, "sessions.json");
    const workspaceDir = path.join(tmpDir, "workspace");
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    try {
      await fs.mkdir(workspaceDir, { recursive: true });

      // Create effectively empty HEARTBEAT.md
      await fs.writeFile(
        path.join(workspaceDir, "HEARTBEAT.md"),
        "# HEARTBEAT.md\n\n## Tasks\n\n",
        "utf-8",
      );

      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: workspaceDir,
            heartbeat: { every: "5m", target: "whatsapp" },
          },
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = resolveMainSessionKey(cfg);

      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            [sessionKey]: {
              sessionId: "sid",
              updatedAt: Date.now(),
              lastChannel: "whatsapp",
              lastTo: "+1555",
            },
          },
          null,
          2,
        ),
      );

      replySpy.mockResolvedValue([{ text: "Processed hook event" }]);
      const sendWhatsApp = vi.fn().mockResolvedValue({ messageId: "m1", toJid: "jid" });

      const res = await runHeartbeatOnce({
        cfg,
        reason: "hook:wake",
        deps: {
          sendWhatsApp,
          getQueueSize: () => 0,
          nowMs: () => 0,
          webAuthExists: async () => true,
          hasActiveWebListener: () => true,
        },
      });

      // Should NOT skip — hook:wake bypasses the empty file check
      expect(res.status).toBe("ran");
      expect(replySpy).toHaveBeenCalled();
    } finally {
      replySpy.mockRestore();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("hook:{uuid} reason also bypasses empty-heartbeat-file skip", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hb-hook-"));
    const storePath = path.join(tmpDir, "sessions.json");
    const workspaceDir = path.join(tmpDir, "workspace");
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    try {
      await fs.mkdir(workspaceDir, { recursive: true });

      await fs.writeFile(
        path.join(workspaceDir, "HEARTBEAT.md"),
        "# HEARTBEAT.md\n\n## Tasks\n\n",
        "utf-8",
      );

      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: workspaceDir,
            heartbeat: { every: "5m", target: "whatsapp" },
          },
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = resolveMainSessionKey(cfg);

      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            [sessionKey]: {
              sessionId: "sid",
              updatedAt: Date.now(),
              lastChannel: "whatsapp",
              lastTo: "+1555",
            },
          },
          null,
          2,
        ),
      );

      replySpy.mockResolvedValue([{ text: "Hook agent result" }]);
      const sendWhatsApp = vi.fn().mockResolvedValue({ messageId: "m1", toJid: "jid" });

      const res = await runHeartbeatOnce({
        cfg,
        reason: "hook:550e8400-e29b-41d4-a716-446655440000",
        deps: {
          sendWhatsApp,
          getQueueSize: () => 0,
          nowMs: () => 0,
          webAuthExists: async () => true,
          hasActiveWebListener: () => true,
        },
      });

      expect(res.status).toBe("ran");
      expect(replySpy).toHaveBeenCalled();
    } finally {
      replySpy.mockRestore();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("interval reason does NOT bypass empty-heartbeat-file skip", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hb-hook-"));
    const storePath = path.join(tmpDir, "sessions.json");
    const workspaceDir = path.join(tmpDir, "workspace");
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    try {
      await fs.mkdir(workspaceDir, { recursive: true });

      await fs.writeFile(
        path.join(workspaceDir, "HEARTBEAT.md"),
        "# HEARTBEAT.md\n\n## Tasks\n\n",
        "utf-8",
      );

      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: workspaceDir,
            heartbeat: { every: "5m", target: "whatsapp" },
          },
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = resolveMainSessionKey(cfg);

      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            [sessionKey]: {
              sessionId: "sid",
              updatedAt: Date.now(),
              lastChannel: "whatsapp",
              lastTo: "+1555",
            },
          },
          null,
          2,
        ),
      );

      const sendWhatsApp = vi.fn().mockResolvedValue({ messageId: "m1", toJid: "jid" });

      const res = await runHeartbeatOnce({
        cfg,
        reason: "interval",
        deps: {
          sendWhatsApp,
          getQueueSize: () => 0,
          nowMs: () => 0,
          webAuthExists: async () => true,
          hasActiveWebListener: () => true,
        },
      });

      // Interval reason should still skip on empty file (existing behavior)
      expect(res.status).toBe("skipped");
      if (res.status === "skipped") {
        expect(res.reason).toBe("empty-heartbeat-file");
      }
      expect(replySpy).not.toHaveBeenCalled();
    } finally {
      replySpy.mockRestore();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
