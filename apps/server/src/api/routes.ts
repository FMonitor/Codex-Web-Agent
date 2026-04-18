import { Router } from "express";
import {
  createSessionSchema,
  sendMessageSchema,
} from "@copilot-console/shared";
import type { RuntimeName } from "@copilot-console/shared";
import type { SessionService } from "../sessions/service.js";

export function createApiRouter(
  sessions: SessionService,
  defaultWorkspacePath: string,
): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      runtimes: sessions.getRuntimeInfo(),
      defaultRuntime: sessions.getDefaultRuntime(),
      now: new Date().toISOString(),
    });
  });

  router.get("/bootstrap", (_req, res) => {
    res.json({
      defaultWorkspacePath,
      runtimes: sessions.getRuntimeInfo(),
      defaultRuntime: sessions.getDefaultRuntime(),
      currentSession: sessions.getCurrentSession(),
    });
  });

  router.get("/runtime-models", async (req, res, next) => {
    try {
      const runtime = typeof req.query.runtime === "string" ? (req.query.runtime as RuntimeName) : undefined;
      const profile = typeof req.query.profile === "string" ? req.query.profile : undefined;
      const models = await sessions.listRuntimeModels(runtime, profile);
      res.json({ runtime: sessions.getDefaultRuntime(runtime), profile: profile || null, models });
    } catch (error) {
      next(error);
    }
  });

  router.get("/sessions/current", (_req, res) => {
    const snapshot = sessions.getCurrentSession();
    if (!snapshot) {
      res.status(404).json({ error: "No active session" });
      return;
    }
    res.json(snapshot);
  });

  router.post("/sessions", async (req, res, next) => {
    try {
      const parsed = createSessionSchema.safeParse({
        ...req.body,
        workspacePath: req.body?.workspacePath || defaultWorkspacePath,
        runtime: sessions.getDefaultRuntime(req.body?.runtime),
      });
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const snapshot = await sessions.createSession(parsed.data);
      res.status(201).json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  router.get("/sessions/:sessionId", (req, res, next) => {
    try {
      res.json(sessions.getSession(req.params.sessionId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/:sessionId/messages", async (req, res, next) => {
    try {
      const parsed = sendMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await sessions.sendMessage(req.params.sessionId, parsed.data.content);
      res.json({ accepted: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/:sessionId/stop", async (req, res, next) => {
    try {
      await sessions.stopSession(req.params.sessionId);
      res.json({ accepted: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/sessions/:sessionId", async (req, res, next) => {
    try {
      await sessions.disposeSession(req.params.sessionId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/sessions/:sessionId/events", (req, res, next) => {
    try {
      const sessionId = req.params.sessionId;
      sessions.getSession(sessionId);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const send = (data: unknown) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      send(sessions.buildSnapshotEvent(sessionId));
      const unsubscribe = sessions.subscribe(sessionId, (event) => send(event));
      const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
      }, 15000);

      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
