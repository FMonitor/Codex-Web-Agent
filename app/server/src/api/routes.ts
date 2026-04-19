import { Router } from "express";
import {
  createSessionSchema,
  sendMessageSchema,
} from "@copilot-console/shared";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import type { RuntimeName } from "@copilot-console/shared";
import { ConsoleTabManager } from "../console/tab-manager.js";
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
const MAX_TEXT_FILE_SIZE = 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".yaml", ".yml", ".toml", ".ini", ".env", ".xml", ".html", ".css", ".scss", ".less", ".sh", ".py", ".go", ".rs", ".java", ".cs", ".cpp", ".c", ".h", ".hpp", ".sql", ".log",
]);

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".txt": "plaintext",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".ini": "ini",
  ".xml": "xml",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".sh": "shell",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".sql": "sql",
  ".log": "plaintext",
};

const TEXT_BASENAME_LANGUAGE_MAP: Record<string, string> = {
  Dockerfile: "dockerfile",
  dockerfile: "dockerfile",
  Makefile: "makefile",
  makefile: "makefile",
};

function isPathInside(parent: string, child: string): boolean {
  if (parent === child) {
    return true;
  }
  return child.startsWith(`${parent}/`);
}

function hasNullByte(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

function guessLanguage(path: string): string {
  const name = basename(path);
  if (TEXT_BASENAME_LANGUAGE_MAP[name]) {
    return TEXT_BASENAME_LANGUAGE_MAP[name];
  }

  const extension = extname(path).toLowerCase();
  return LANGUAGE_MAP[extension] || "plaintext";
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
  const consoleTabs = new ConsoleTabManager();

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

  router.get("/workspace-file", async (req, res, next) => {
    try {
      const rootPath = resolve(defaultWorkspacePath);
      const inputPath = typeof req.query.path === "string" ? req.query.path.trim() : "";
      if (!inputPath) {
        res.status(400).json({ error: "path query is required" });
        return;
      }

      const targetPath = resolve(rootPath, inputPath);
      if (!isPathInside(rootPath, targetPath)) {
        res.status(400).json({ error: "Requested path is outside the workspace root" });
        return;
      }

      const stat = await lstat(targetPath);
      if (stat.isDirectory()) {
        res.json({
          path: inputPath,
          supported: false,
          reason: "Directory preview is not supported",
        });
        return;
      }

      if (stat.size > MAX_TEXT_FILE_SIZE) {
        res.json({
          path: inputPath,
          supported: false,
          reason: `File is larger than ${MAX_TEXT_FILE_SIZE} bytes`,
        });
        return;
      }

      const contentBuffer = await readFile(targetPath);
      if (hasNullByte(contentBuffer)) {
        res.json({
          path: inputPath,
          supported: false,
          reason: "Binary file is not supported",
        });
        return;
      }

      res.json({
        path: inputPath,
        supported: true,
        language: guessLanguage(targetPath),
        content: contentBuffer.toString("utf8"),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/workspace-file", async (req, res, next) => {
    try {
      const rootPath = resolve(defaultWorkspacePath);
      const inputPath = typeof req.body?.path === "string" ? req.body.path.trim() : "";
      const content = typeof req.body?.content === "string" ? req.body.content : "";

      if (!inputPath) {
        res.status(400).json({ error: "path is required" });
        return;
      }

      const targetPath = resolve(rootPath, inputPath);
      if (!isPathInside(rootPath, targetPath)) {
        res.status(400).json({ error: "Requested path is outside the workspace root" });
        return;
      }

      const targetDir = dirname(targetPath);
      await mkdir(targetDir, { recursive: true });

      await writeFile(targetPath, content, "utf8");

      res.json({
        path: inputPath,
        saved: true,
        size: Buffer.byteLength(content, "utf8"),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/console/tabs", async (req, res, next) => {
    try {
      const rootPath = resolve(defaultWorkspacePath);
      const inputCwd = typeof req.body?.cwd === "string" ? req.body.cwd.trim() : "";
      const requestedCwd = inputCwd
        ? (inputCwd.startsWith("/") ? resolve(inputCwd) : resolve(rootPath, inputCwd))
        : rootPath;

      if (!isPathInside(rootPath, requestedCwd)) {
        res.status(400).json({ error: "Requested cwd is outside the workspace root" });
        return;
      }

      const cwdStat = await lstat(requestedCwd);
      if (!cwdStat.isDirectory()) {
        res.status(400).json({ error: "cwd must be a directory" });
        return;
      }

      const tab = consoleTabs.createTab(requestedCwd);
      res.status(201).json(tab);
    } catch (error) {
      next(error);
    }
  });

  router.get("/console/tabs/:tabId", (req, res, next) => {
    try {
      res.json(consoleTabs.getTab(req.params.tabId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/console/tabs/:tabId/exec", (req, res, next) => {
    try {
      const command = typeof req.body?.command === "string" ? req.body.command : "";
      consoleTabs.execute(req.params.tabId, command);
      res.json({ accepted: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/console/tabs/:tabId/stop", (req, res, next) => {
    try {
      consoleTabs.stop(req.params.tabId);
      res.json({ accepted: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/console/tabs/:tabId", (req, res, next) => {
    try {
      consoleTabs.close(req.params.tabId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/console/tabs/:tabId/events", (req, res, next) => {
    try {
      const tabId = req.params.tabId;
      const snapshot = consoleTabs.getTab(tabId);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const send = (data: unknown) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      send({ type: "snapshot", snapshot });
      const unsubscribe = consoleTabs.subscribe(tabId, (event) => send(event));
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
