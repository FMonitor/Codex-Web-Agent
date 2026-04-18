import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CopilotCliAdapter } from "./adapters/copilot-cli-adapter.js";
import { CodexCliAdapter } from "./adapters/codex-cli-adapter.js";
import { createApiRouter } from "./api/routes.js";
import { EventBroker } from "./events/broker.js";
import { RuntimeRegistry } from "./runtime/runtime-registry.js";
import { SessionService } from "./sessions/service.js";
import { SessionStore } from "./sessions/store.js";

const port = Number(process.env.PORT || 8787);
const defaultWorkspacePath = process.env.DEFAULT_WORKSPACE_PATH || process.cwd();
const defaultRuntime = process.env.DEFAULT_RUNTIME === "copilot-cli" ? "copilot-cli" : "codex-cli";

const app = express();
const runtimes = new RuntimeRegistry([
  new CodexCliAdapter(),
  new CopilotCliAdapter(),
], defaultRuntime);
const store = new SessionStore();
const broker = new EventBroker();
const sessions = new SessionService(store, runtimes, broker);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/api", createApiRouter(sessions, defaultWorkspacePath));

const serverFile = fileURLToPath(import.meta.url);
const serverDir = dirname(serverFile);
const webDist = resolve(serverDir, "../../web/dist");

if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(resolve(webDist, "index.html"));
  });
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown server error";
  const status = message.includes("not found") ? 404 : 400;
  res.status(status).json({ error: message });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Copilot CLI Web Console server listening on http://0.0.0.0:${port}`);
  console.log(`Default runtime: ${sessions.getDefaultRuntime()}`);
  console.log(`Runtime inventory: ${JSON.stringify(sessions.getRuntimeInfo(), null, 2)}`);
  console.log(`Default workspace path: ${defaultWorkspacePath}`);
});
