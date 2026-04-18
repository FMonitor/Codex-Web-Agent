import type { CreateSessionInput, SessionSummary } from "@copilot-console/shared";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapCopilotRawEvent, type CopilotRawEvent } from "../mappers/copilot-event-mapper.js";
import type { RuntimeAdapter, RuntimeEventListener } from "../runtime/runtime-adapter.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

interface ManagedRuntimeSession {
  session: SessionSummary;
  process: ChildProcessWithoutNullStreams;
  listeners: Set<RuntimeEventListener>;
  buffer: string;
}

function resolveMockCommand(): { command: string; args: string[] } {
  const currentFile = fileURLToPath(import.meta.url);
  const baseDir = dirname(currentFile);
  const builtMock = resolve(baseDir, "../mock/copilot-cli-mock.js");
  if (existsSync(builtMock)) {
    return { command: process.execPath, args: [builtMock] };
  }

  const sourceMock = resolve(baseDir, "../mock/copilot-cli-mock.ts");
  return {
    command: process.execPath,
    args: ["--import", "tsx", sourceMock],
  };
}

export class CopilotCliAdapter implements RuntimeAdapter {
  readonly runtimeName = "copilot-cli" as const;
  private sessions = new Map<string, ManagedRuntimeSession>();
  private readonly configuredCommand = process.env.COPILOT_CLI_COMMAND?.trim() || "";

  async createSession(input: CreateSessionInput & { id: string }): Promise<SessionSummary> {
    const timestamp = nowIso();
    const session: SessionSummary = {
      id: input.id,
      title: input.title?.trim() || "Copilot CLI Session",
      status: "idle",
      workspacePath: input.workspacePath,
      createdAt: timestamp,
      updatedAt: timestamp,
      runtime: "copilot-cli",
      agentId: input.agentId || "default",
      agentRole: input.agentRole || "general",
      currentPhase: "idle",
      runtimeProfile: input.runtimeProfile,
      model: input.model,
      sandboxMode: input.sandboxMode,
    };

    const runtime = this.spawnRuntime(session);
    this.sessions.set(session.id, runtime);
    return session;
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const runtime = this.getSession(sessionId);
    runtime.process.stdin.write(
      `${JSON.stringify({ type: "message", id: createId("cmd"), content })}\n`,
    );
  }

  async stopSession(sessionId: string): Promise<void> {
    const runtime = this.getSession(sessionId);
    runtime.process.stdin.write(`${JSON.stringify({ type: "stop", id: createId("cmd") })}\n`);
  }

  async subscribe(sessionId: string, listener: RuntimeEventListener): Promise<() => void> {
    const runtime = this.getSession(sessionId);
    runtime.listeners.add(listener);
    return () => {
      runtime.listeners.delete(listener);
    };
  }

  async disposeSession(sessionId: string): Promise<void> {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) {
      return;
    }
    runtime.process.kill("SIGTERM");
    this.sessions.delete(sessionId);
  }

  getRuntimeInfo() {
    if (this.configuredCommand) {
      return {
        runtime: this.runtimeName,
        command: this.configuredCommand,
        mode: "configured" as const,
        available: true,
        notes: "Using configured Copilot CLI bridge command.",
        profiles: [],
        models: [],
      };
    }
    const mock = resolveMockCommand();
    return {
      runtime: this.runtimeName,
      command: `${mock.command} ${mock.args.join(" ")}`,
      mode: "mock" as const,
      available: true,
      notes: "Bundled mock bridge is active because no Copilot CLI command is configured.",
      profiles: [],
      models: [],
    };
  }

  private spawnRuntime(session: SessionSummary): ManagedRuntimeSession {
    const runtimeInfo = this.getRuntimeInfo();
    const child = this.configuredCommand
      ? spawn(this.configuredCommand, {
          cwd: session.workspacePath,
          shell: true,
          stdio: "pipe",
          env: {
            ...process.env,
            SESSION_ID: session.id,
            AGENT_ID: session.agentId,
            AGENT_ROLE: session.agentRole,
          },
        })
      : spawn(resolveMockCommand().command, resolveMockCommand().args, {
          cwd: session.workspacePath,
          stdio: "pipe",
          env: {
            ...process.env,
            SESSION_ID: session.id,
            AGENT_ID: session.agentId,
            AGENT_ROLE: session.agentRole,
          },
        });

    const runtime: ManagedRuntimeSession = {
      session,
      process: child,
      listeners: new Set(),
      buffer: "",
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      runtime.buffer += chunk;
      const lines = runtime.buffer.split("\n");
      runtime.buffer = lines.pop() || "";
      for (const line of lines) {
        const text = line.trim();
        if (!text) {
          continue;
        }
        try {
          const raw = JSON.parse(text) as CopilotRawEvent;
          const event = mapCopilotRawEvent(session, raw);
          if (event) {
            runtime.listeners.forEach((listener) => listener(event));
          }
        } catch (error) {
          runtime.listeners.forEach((listener) =>
            listener({
              id: createId("evt"),
              sessionId: session.id,
              type: "log.stderr",
              timestamp: nowIso(),
              agentId: session.agentId,
              agentRole: session.agentRole,
              phase: "failed",
              message: "Failed to parse Copilot CLI event",
              logEntry: {
                id: createId("log"),
                sessionId: session.id,
                source: "stderr",
                content: `parse error: ${String(error)} | raw=${text}`,
                timestamp: nowIso(),
                agentId: session.agentId,
                agentRole: session.agentRole,
              },
              raw: {
                runtimeInfo,
                line: text,
              },
            }),
          );
        }
      }
    });

    child.stderr.on("data", (chunk: string) => {
      runtime.listeners.forEach((listener) =>
        listener({
          id: createId("evt"),
          sessionId: session.id,
          type: "log.stderr",
          timestamp: nowIso(),
          agentId: session.agentId,
          agentRole: session.agentRole,
          phase: "running",
          logEntry: {
            id: createId("log"),
            sessionId: session.id,
            source: "stderr",
            content: chunk.toString(),
            timestamp: nowIso(),
            agentId: session.agentId,
            agentRole: session.agentRole,
          },
        }),
      );
    });

    child.on("exit", (code, signal) => {
      runtime.listeners.forEach((listener) =>
        listener({
          id: createId("evt"),
          sessionId: session.id,
          type: code === 0 ? "session.completed" : "session.failed",
          timestamp: nowIso(),
          agentId: session.agentId,
          agentRole: session.agentRole,
          phase: code === 0 ? "completed" : "failed",
          message:
            code === 0
              ? "Runtime exited normally"
              : `Runtime exited with code=${code ?? "null"} signal=${signal ?? "null"}`,
          status: code === 0 ? "completed" : "failed",
          raw: { code, signal },
        }),
      );
    });

    return runtime;
  }

  private getSession(sessionId: string): ManagedRuntimeSession {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) {
      throw new Error(`Runtime session not found: ${sessionId}`);
    }
    return runtime;
  }
}
