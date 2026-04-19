import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { nanoid } from "nanoid";
import { nowIso } from "../utils/time.js";

export type ConsoleTabStatus = "idle" | "running";
export type ConsoleEntrySource = "stdout" | "stderr" | "system";

export interface ConsoleTabEntry {
  id: string;
  source: ConsoleEntrySource;
  content: string;
  timestamp: string;
}

export interface ConsoleTabSnapshot {
  id: string;
  cwd: string;
  status: ConsoleTabStatus;
  createdAt: string;
  updatedAt: string;
  entries: ConsoleTabEntry[];
}

export type ConsoleTabEvent =
  | { type: "snapshot"; snapshot: ConsoleTabSnapshot }
  | { type: "entry"; entry: ConsoleTabEntry }
  | { type: "status"; status: ConsoleTabStatus; updatedAt: string; message?: string; cwd?: string };

interface ConsoleTabState {
  id: string;
  cwd: string;
  status: ConsoleTabStatus;
  createdAt: string;
  updatedAt: string;
  entries: ConsoleTabEntry[];
  listeners: Set<(event: ConsoleTabEvent) => void>;
  process: ChildProcessWithoutNullStreams | null;
  stdoutBuffer: string;
  stderrBuffer: string;
}

const MAX_ENTRIES = 2000;
const DEFAULT_SHELL = process.env.SHELL?.trim() || "/bin/bash";

function dedupeLine(line: string): string {
  return line.replace(/\r/g, "").trimEnd();
}

export class ConsoleTabManager {
  private readonly tabs = new Map<string, ConsoleTabState>();

  createTab(cwd: string): ConsoleTabSnapshot {
    const timestamp = nowIso();
    const id = nanoid();
    const state: ConsoleTabState = {
      id,
      cwd,
      status: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
      entries: [],
      listeners: new Set(),
      process: null,
      stdoutBuffer: "",
      stderrBuffer: "",
    };

    this.tabs.set(id, state);
    return this.toSnapshot(state);
  }

  getTab(tabId: string): ConsoleTabSnapshot {
    const state = this.getState(tabId);
    return this.toSnapshot(state);
  }

  execute(tabId: string, command: string): void {
    const state = this.getState(tabId);
    const normalized = command.trim();
    if (!normalized) {
      throw new Error("Command cannot be empty");
    }
    if (state.process) {
      throw new Error("Console tab is already running a command");
    }

    const cwdMarker = `__CODEX_WEB_AGENT_CWD__${nanoid(10)}__`;
    const wrappedCommand = `${normalized}\nprintf '%s%s\\n' '${cwdMarker}' "$PWD"`;

    const child = spawn(DEFAULT_SHELL, ["-lc", wrappedCommand], {
      cwd: state.cwd,
      env: process.env,
      stdio: "pipe",
    });

    state.process = child;
    state.stdoutBuffer = "";
    state.stderrBuffer = "";
    this.setStatus(state, "running", `Running: ${normalized}`);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      state.stdoutBuffer += chunk;
      const lines = state.stdoutBuffer.split("\n");
      state.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const text = dedupeLine(line);
        if (!text) {
          continue;
        }
        if (this.consumeCwdMarker(state, text, cwdMarker)) {
          continue;
        }
        this.pushEntry(state, "stdout", text);
      }
    });

    child.stderr.on("data", (chunk: string) => {
      state.stderrBuffer += chunk;
      const lines = state.stderrBuffer.split("\n");
      state.stderrBuffer = lines.pop() || "";
      for (const line of lines) {
        const text = dedupeLine(line);
        if (text) {
          this.pushEntry(state, "stderr", text);
        }
      }
    });

    child.on("error", (error) => {
      this.pushEntry(state, "system", `Failed to execute command: ${error.message}`);
      state.process = null;
      this.flushRemainingBuffers(state, cwdMarker);
      this.setStatus(state, "idle");
    });

    child.on("exit", (code, signal) => {
      state.process = null;
      this.flushRemainingBuffers(state, cwdMarker);
      this.pushEntry(
        state,
        "system",
        `Process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`,
      );
      this.setStatus(state, "idle");
    });
  }

  stop(tabId: string): void {
    const state = this.getState(tabId);
    if (!state.process) {
      return;
    }

    this.pushEntry(state, "system", "Stopping process...");
    state.process.kill("SIGTERM");
  }

  clear(tabId: string): void {
    const state = this.getState(tabId);
    state.entries = [];
    state.updatedAt = nowIso();
    this.publish(state, {
      type: "snapshot",
      snapshot: this.toSnapshot(state),
    });
  }

  close(tabId: string): void {
    const state = this.tabs.get(tabId);
    if (!state) {
      return;
    }

    if (state.process) {
      state.process.kill("SIGTERM");
    }
    state.listeners.clear();
    this.tabs.delete(tabId);
  }

  subscribe(tabId: string, listener: (event: ConsoleTabEvent) => void): () => void {
    const state = this.getState(tabId);
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  }

  private getState(tabId: string): ConsoleTabState {
    const state = this.tabs.get(tabId);
    if (!state) {
      throw new Error(`Console tab not found: ${tabId}`);
    }
    return state;
  }

  private toSnapshot(state: ConsoleTabState): ConsoleTabSnapshot {
    return {
      id: state.id,
      cwd: state.cwd,
      status: state.status,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      entries: [...state.entries],
    };
  }

  private publish(state: ConsoleTabState, event: ConsoleTabEvent): void {
    for (const listener of state.listeners) {
      listener(event);
    }
  }

  private pushEntry(state: ConsoleTabState, source: ConsoleEntrySource, content: string): void {
    const entry: ConsoleTabEntry = {
      id: nanoid(),
      source,
      content,
      timestamp: nowIso(),
    };

    state.entries.push(entry);
    if (state.entries.length > MAX_ENTRIES) {
      state.entries.splice(0, state.entries.length - MAX_ENTRIES);
    }
    state.updatedAt = entry.timestamp;
    this.publish(state, { type: "entry", entry });
  }

  private setStatus(state: ConsoleTabState, status: ConsoleTabStatus, message?: string): void {
    state.status = status;
    state.updatedAt = nowIso();
    this.publish(state, {
      type: "status",
      status,
      updatedAt: state.updatedAt,
      message,
      cwd: state.cwd,
    });
  }

  private consumeCwdMarker(state: ConsoleTabState, line: string, marker: string): boolean {
    if (!line.startsWith(marker)) {
      return false;
    }

    const reportedCwd = line.slice(marker.length).trim();
    if (reportedCwd && reportedCwd !== state.cwd) {
      state.cwd = reportedCwd;
      state.updatedAt = nowIso();
      this.publish(state, {
        type: "status",
        status: state.status,
        updatedAt: state.updatedAt,
        cwd: state.cwd,
      });
    }
    return true;
  }

  private flushRemainingBuffers(state: ConsoleTabState, cwdMarker?: string): void {
    const stdoutRemain = dedupeLine(state.stdoutBuffer);
    if (stdoutRemain) {
      if (!cwdMarker || !this.consumeCwdMarker(state, stdoutRemain, cwdMarker)) {
        this.pushEntry(state, "stdout", stdoutRemain);
      }
    }
    const stderrRemain = dedupeLine(state.stderrBuffer);
    if (stderrRemain) {
      this.pushEntry(state, "stderr", stderrRemain);
    }
    state.stdoutBuffer = "";
    state.stderrBuffer = "";
  }
}
