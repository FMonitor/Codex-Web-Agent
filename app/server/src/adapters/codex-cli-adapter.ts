import type { CreateSessionInput, SessionSummary } from "@copilot-console/shared";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { CodexEventMapper, type CodexRawEvent } from "../mappers/codex-event-mapper.js";
import type { RuntimeAdapter, RuntimeEventListener } from "../runtime/runtime-adapter.js";
import { createId } from "../utils/ids.js";
import { nowIso } from "../utils/time.js";

interface CodexSessionState {
  session: SessionSummary;
  listeners: Set<RuntimeEventListener>;
  currentProcess: ChildProcessWithoutNullStreams | null;
  stdoutBuffer: string;
  threadId: string | null;
  queuedMessages: string[];
  stoppedByUser: boolean;
  mapper: CodexEventMapper;
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isCodexInstalled(): boolean {
  const result = spawnSync("codex", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

export class CodexCliAdapter implements RuntimeAdapter {
  readonly runtimeName = "codex-cli" as const;
  private readonly configuredCommand = process.env.CODEX_CLI_COMMAND?.trim() || "";
  private readonly defaultModel = process.env.CODEX_MODEL?.trim() || "";
  private readonly defaultProfile = process.env.CODEX_PROFILE?.trim() || "";
  private readonly defaultSandbox = process.env.CODEX_SANDBOX?.trim() || "workspace-write";
  private readonly configuredProfiles = [
    "openai-login",
    "custom-api",
    "custom-openai-auth",
  ].filter((value, index, array) => array.indexOf(value) === index);
  private readonly configuredModels = [
    process.env.CODEX_MODEL?.trim(),
    process.env.CODEX_DEFAULT_MODEL?.trim(),
    process.env.CODEX_OPENAI_MODEL?.trim(),
    process.env.CODEX_CUSTOM_API_MODEL?.trim(),
    process.env.CODEX_CUSTOM_OPENAI_AUTH_MODEL?.trim(),
    "gpt-5-codex",
    "gpt-5",
  ].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);
  private readonly sessions = new Map<string, CodexSessionState>();

  async createSession(input: CreateSessionInput & { id: string }): Promise<SessionSummary> {
    const timestamp = nowIso();
    const session: SessionSummary = {
      id: input.id,
      title: input.title?.trim() || "Codex CLI Session",
      status: "idle",
      workspacePath: input.workspacePath,
      createdAt: timestamp,
      updatedAt: timestamp,
      runtime: "codex-cli",
      agentId: input.agentId || "default",
      agentRole: input.agentRole || "general",
      currentPhase: "idle",
      runtimeProfile: input.runtimeProfile || this.defaultProfile || undefined,
      model: input.model || this.defaultModel || undefined,
      sandboxMode: input.sandboxMode || (this.defaultSandbox as SessionSummary["sandboxMode"]),
    };

    this.sessions.set(session.id, {
      session,
      listeners: new Set(),
      currentProcess: null,
      stdoutBuffer: "",
      threadId: null,
      queuedMessages: [],
      stoppedByUser: false,
      mapper: new CodexEventMapper(session),
    });

    return session;
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const state = this.getSessionState(sessionId);
    this.publish(state, {
      id: createId("evt"),
      sessionId,
      type: "assistant.intent",
      timestamp: nowIso(),
      agentId: state.session.agentId,
      agentRole: state.session.agentRole,
      phase: "planning",
      message: `用户消息已接收，准备转发到 Codex CLI: ${content.slice(0, 120)}`,
    });

    if (state.currentProcess) {
      state.queuedMessages.push(content);
      this.publish(state, {
        id: createId("evt"),
        sessionId,
        type: "assistant.intent",
        timestamp: nowIso(),
        agentId: state.session.agentId,
        agentRole: state.session.agentRole,
        phase: "planning",
        message: "Codex 当前正在执行，本条消息已排队，待当前 turn 完成后自动继续。",
      });
      return;
    }

    this.startRun(state, content);
  }

  async stopSession(sessionId: string): Promise<void> {
    const state = this.getSessionState(sessionId);
    state.stoppedByUser = true;
    state.queuedMessages = [];
    state.currentProcess?.kill("SIGTERM");
  }

  async subscribe(sessionId: string, listener: RuntimeEventListener): Promise<() => void> {
    const state = this.getSessionState(sessionId);
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  }

  async disposeSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return;
    }
    state.currentProcess?.kill("SIGTERM");
    this.sessions.delete(sessionId);
  }

  getRuntimeInfo() {
    if (this.configuredCommand) {
      return {
        runtime: this.runtimeName,
        command: this.configuredCommand,
        mode: "configured" as const,
        available: true,
        notes: "Using configured Codex CLI command. This can point to a local binary or docker exec wrapper.",
        profiles: this.configuredProfiles,
        models: this.configuredModels,
      };
    }

    const installed = isCodexInstalled();
    return {
      runtime: this.runtimeName,
      command: "codex",
      mode: "configured" as const,
      available: installed,
      notes: installed
        ? "Using the locally installed Codex CLI."
        : "Codex CLI is not installed locally. Configure CODEX_CLI_COMMAND or use the provided container setup.",
      profiles: this.configuredProfiles,
      models: this.configuredModels,
    };
  }

  async listModels(profile?: string): Promise<string[]> {
    const profileName = profile?.trim() || this.defaultProfile || "custom-api";
    const endpoint = this.getModelsEndpoint(profileName);
    if (!endpoint) {
      return this.configuredModels;
    }

    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        return this.configuredModels;
      }

      const payload = (await response.json()) as {
        data?: Array<{ id?: string }>;
        models?: string[];
      };

      const dynamicModels = Array.isArray(payload.data)
        ? payload.data.map((item) => item.id).filter((value): value is string => Boolean(value))
        : [];
      const fallbackModels = Array.isArray(payload.models)
        ? payload.models.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];

      return [...dynamicModels, ...fallbackModels, ...this.configuredModels].filter(
        (value, index, array) => array.indexOf(value) === index,
      );
    } catch {
      return this.configuredModels;
    }
  }

  private startRun(state: CodexSessionState, prompt: string): void {
    state.stoppedByUser = false;
    const args = this.buildArgs(state, prompt);
    this.publish(state, {
      id: createId("evt"),
      sessionId: state.session.id,
      type: "assistant.intent",
      timestamp: nowIso(),
      agentId: state.session.agentId,
      agentRole: state.session.agentRole,
      phase: "running",
      message: `开始执行 Codex CLI（profile=${state.session.runtimeProfile || "default"}, model=${state.session.model || "default"}）`,
    });
    const child = this.spawnCommand(args, state.session.workspacePath);
    child.stdin.end();
    state.currentProcess = child;
    state.stdoutBuffer = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      state.stdoutBuffer += chunk;
      const lines = state.stdoutBuffer.split("\n");
      state.stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const text = line.trim();
        if (!text) {
          continue;
        }
        try {
          const raw = JSON.parse(text) as CodexRawEvent;
          if (raw.type === "thread.started" && raw.thread_id) {
            state.threadId = raw.thread_id;
          }
          for (const event of state.mapper.map(raw)) {
            this.publish(state, event);
          }
        } catch {
          this.publish(state, {
            id: createId("evt"),
            sessionId: state.session.id,
            type: "log.stdout",
            timestamp: nowIso(),
            agentId: state.session.agentId,
            agentRole: state.session.agentRole,
            phase: "running",
            logEntry: {
              id: createId("log"),
              sessionId: state.session.id,
              source: "stdout",
              content: text,
              timestamp: nowIso(),
              agentId: state.session.agentId,
              agentRole: state.session.agentRole,
            },
          });
        }
      }
    });

    child.stderr.on("data", (chunk: string) => {
      const lines = chunk
        .toString()
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);

      for (const line of lines) {
        this.publish(state, {
          id: createId("evt"),
          sessionId: state.session.id,
          type: "log.stderr",
          timestamp: nowIso(),
          agentId: state.session.agentId,
          agentRole: state.session.agentRole,
          phase: "running",
          logEntry: {
            id: createId("log"),
            sessionId: state.session.id,
            source: "stderr",
            content: line,
            timestamp: nowIso(),
            agentId: state.session.agentId,
            agentRole: state.session.agentRole,
          },
        });

        if (line.includes("Reading additional input from stdin")) {
          this.publish(state, {
            id: createId("evt"),
            sessionId: state.session.id,
            type: "assistant.intent",
            timestamp: nowIso(),
            agentId: state.session.agentId,
            agentRole: state.session.agentRole,
            phase: "approval",
            message: "Codex 正在等待补充输入（stdin）。",
            status: "waiting_input",
          });
        }
      }
    });

    child.on("error", (error) => {
      state.currentProcess = null;
      this.publish(state, {
        id: createId("evt"),
        sessionId: state.session.id,
        type: "session.failed",
        timestamp: nowIso(),
        agentId: state.session.agentId,
        agentRole: state.session.agentRole,
        phase: "failed",
        message: `Failed to start Codex CLI: ${error.message}`,
        status: "failed",
      });
    });

    child.on("exit", (code, signal) => {
      state.currentProcess = null;
      if (state.stoppedByUser) {
        this.publish(state, {
          id: createId("evt"),
          sessionId: state.session.id,
          type: "session.stopped",
          timestamp: nowIso(),
          agentId: state.session.agentId,
          agentRole: state.session.agentRole,
          phase: "idle",
          message: "Codex execution stopped by user",
          status: "stopped",
          raw: { code, signal },
        });
        state.stoppedByUser = false;
        return;
      }

      if (code !== 0 && signal !== "SIGTERM") {
        this.publish(state, {
          id: createId("evt"),
          sessionId: state.session.id,
          type: "session.failed",
          timestamp: nowIso(),
          agentId: state.session.agentId,
          agentRole: state.session.agentRole,
          phase: "failed",
          message: `Codex process exited with code=${code ?? "null"} signal=${signal ?? "null"}`,
          status: "failed",
          raw: { code, signal },
        });
      }

      const nextPrompt = state.queuedMessages.shift();
      if (nextPrompt) {
        this.startRun(state, nextPrompt);
      }
    });
  }

  private buildArgs(state: CodexSessionState, prompt: string): string[] {
    const args = ["exec"];
    if (state.threadId) {
      args.push("resume", state.threadId);
    }
    args.push("--json", "--color", "never", "--cd", state.session.workspacePath);

    if (state.session.sandboxMode) {
      args.push("--sandbox", state.session.sandboxMode);
    }
    args.push("--skip-git-repo-check");
    if (state.session.runtimeProfile) {
      args.push("--profile", state.session.runtimeProfile);
    }
    if (state.session.model) {
      args.push("--model", state.session.model);
    }

    args.push(prompt);
    return args;
  }

  private spawnCommand(args: string[], cwd: string): ChildProcessWithoutNullStreams {
    if (this.configuredCommand) {
      const command = `${this.configuredCommand} ${args.map(quoteShellArg).join(" ")}`;
      return spawn(command, {
        cwd,
        shell: true,
        stdio: "pipe",
        env: process.env,
      });
    }

    return spawn("codex", args, {
      cwd,
      stdio: "pipe",
      env: process.env,
    });
  }

  private publish(state: CodexSessionState, event: Parameters<RuntimeEventListener>[0]): void {
    for (const listener of state.listeners) {
      listener(event);
    }
  }

  private getSessionState(sessionId: string): CodexSessionState {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Runtime session not found: ${sessionId}`);
    }
    return state;
  }

  private getModelsEndpoint(profile: string): string | null {
    const baseUrl = this.getProfileBaseUrl(profile);
    if (!baseUrl) {
      return null;
    }

    try {
      const url = new URL(baseUrl);
      url.pathname = `${url.pathname.replace(/\/$/, "")}/models`;
      url.search = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  private getProfileBaseUrl(profile: string): string | null {
    if (profile === "custom-api") {
      return process.env.CODEX_CUSTOM_API_BASE_URL?.trim() || "http://127.0.0.1:11434/v1";
    }

    if (profile === "custom-openai-auth") {
      return process.env.CODEX_CUSTOM_OPENAI_AUTH_BASE_URL?.trim() || null;
    }

    if (profile === "openai-login" && process.env.OPENAI_BASE_URL?.trim()) {
      return process.env.OPENAI_BASE_URL.trim();
    }

    return null;
  }
}
