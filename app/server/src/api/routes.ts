import { Router } from "express";
import {
  createSessionSchema,
  sendMessageSchema,
} from "@copilot-console/shared";
import { lstat, readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import type { RuntimeName } from "@copilot-console/shared";
import type { SessionService } from "../sessions/service.js";

interface WorkspaceTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceTreeNode[];
  truncated?: boolean;
}

const MAX_TREE_DEPTH = 4;
const MAX_ENTRIES_PER_DIR = 120;

function isPathInside(parent: string, child: string): boolean {
  if (parent === child) {
    return true;
  }
  return child.startsWith(`${parent}/`);
}

async function buildWorkspaceTree(
  absolutePath: string,
  rootPath: string,
  depth: number,
): Promise<WorkspaceTreeNode> {
  const stat = await lstat(absolutePath);
  const relativePath = relative(rootPath, absolutePath) || ".";
  const node: WorkspaceTreeNode = {
    name: basename(absolutePath) || absolutePath,
    path: relativePath,
    type: stat.isDirectory() ? "directory" : "file",
  };

  if (!stat.isDirectory() || depth <= 0) {
    return node;
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  const sorted = entries
    .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) {
        return -1;
      }
      if (!a.isDirectory() && b.isDirectory()) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_ENTRIES_PER_DIR);

  node.children = await Promise.all(
    sorted.map((entry) =>
      buildWorkspaceTree(resolve(absolutePath, entry.name), rootPath, depth - 1),
    ),
  );

  if (entries.length > MAX_ENTRIES_PER_DIR) {
    node.truncated = true;
  }

  return node;
}

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

  router.get("/sessions", (_req, res) => {
    res.json({ sessions: sessions.listSessions() });
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

  router.get("/workspace-tree", async (req, res, next) => {
    try {
      const rootPath = resolve(defaultWorkspacePath);
      const inputPath = typeof req.query.path === "string" ? req.query.path.trim() : "";
      const requestedDepth = typeof req.query.depth === "string" ? Number(req.query.depth) : 2;
      const depth = Number.isFinite(requestedDepth)
        ? Math.max(1, Math.min(MAX_TREE_DEPTH, requestedDepth))
        : 2;

      const targetPath = inputPath ? resolve(rootPath, inputPath) : rootPath;
      if (!isPathInside(rootPath, targetPath)) {
        res.status(400).json({ error: "Requested path is outside the workspace root" });
        return;
      }

      const tree = await buildWorkspaceTree(targetPath, rootPath, depth);
      res.json({
        rootPath,
        requestedPath: inputPath || ".",
        depth,
        tree,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
