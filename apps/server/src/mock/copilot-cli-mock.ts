type RawPhase =
  | "thinking"
  | "planning"
  | "searching"
  | "reading"
  | "editing"
  | "creating"
  | "running"
  | "approval"
  | "summarizing"
  | "completed"
  | "failed"
  | "idle";

interface MockCommand {
  type: "message" | "stop";
  id: string;
  content?: string;
}

const sessionId = process.env.SESSION_ID || "sess_mock";
const agentId = process.env.AGENT_ID || "default";
const agentRole = process.env.AGENT_ROLE || "general";

let queue: string[] = [];
let busy = false;
let stopRequested = false;
let timerHandles: NodeJS.Timeout[] = [];

function emit(payload: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      sessionId,
      agentId,
      agentRole,
      ...payload,
    })}\n`,
  );
}

function schedule(delay: number, fn: () => void): void {
  const handle = setTimeout(() => {
    timerHandles = timerHandles.filter((item) => item !== handle);
    fn();
  }, delay);
  timerHandles.push(handle);
}

function resetTimers(): void {
  for (const handle of timerHandles) {
    clearTimeout(handle);
  }
  timerHandles = [];
}

function nextPhase(phase: RawPhase, message?: string): void {
  emit({
    type: "assistant.intent",
    phase,
    message,
  });
}

function toolEvent(
  type: "tool.start" | "tool.progress" | "tool.complete" | "tool.failed",
  payload: Record<string, unknown>,
): void {
  emit({
    type,
    ...payload,
  });
}

function startRun(prompt: string): void {
  busy = true;
  stopRequested = false;
  const messageId = `msg_${Date.now()}`;
  const maybeAuth = /auth|登录|login/i.test(prompt);
  const changedFile = maybeAuth ? "src/auth/login.ts" : "src/features/console.tsx";
  const toolOneId = `tool_${Date.now()}_search`;
  const toolTwoId = `tool_${Date.now()}_read`;
  const toolThreeId = `tool_${Date.now()}_cmd`;

  emit({
    type: "run.started",
    phase: "planning",
    message: "Copilot CLI accepted the task",
  });
  emit({
    type: "assistant.start",
    phase: "thinking",
    messageId,
  });

  schedule(250, () => {
    nextPhase("thinking", "正在理解你的任务并建立执行计划");
    emit({
      type: "assistant.delta",
      phase: "thinking",
      messageId,
      content: "我先梳理当前问题范围，准备检查相关代码和运行日志。",
    });
  });

  schedule(700, () => {
    nextPhase("planning", "规划本轮操作");
    emit({
      type: "assistant.delta",
      phase: "planning",
      messageId,
      content: "\n接下来会先搜索关键实现，再读取目标文件，然后运行相关命令验证。",
    });
  });

  schedule(1100, () => {
    toolEvent("tool.start", {
      phase: "searching",
      tool: {
        id: toolOneId,
        name: "search_code",
        status: "running",
        summary: "搜索与任务相关的代码入口",
        inputSummary: prompt,
        startedAt: new Date().toISOString(),
      },
    });
  });

  schedule(1600, () => {
    toolEvent("tool.complete", {
      phase: "searching",
      tool: {
        id: toolOneId,
        name: "search_code",
        status: "completed",
        summary: "定位到认证与控制台相关实现",
        inputSummary: prompt,
        outputSummary: maybeAuth ? "匹配 src/auth/login.ts" : "匹配 src/features/console.tsx",
        startedAt: new Date(Date.now() - 500).toISOString(),
        endedAt: new Date().toISOString(),
      },
    });
    emit({
      type: "assistant.delta",
      phase: "searching",
      messageId,
      content: maybeAuth ? "\n已定位到认证模块入口文件。" : "\n已定位到需要修改的控制台组件。",
    });
  });

  schedule(1900, () => {
    toolEvent("tool.start", {
      phase: "reading",
      tool: {
        id: toolTwoId,
        name: "read_file",
        status: "running",
        summary: `读取 ${changedFile}`,
        inputSummary: changedFile,
        startedAt: new Date().toISOString(),
      },
    });
  });

  schedule(2400, () => {
    toolEvent("tool.complete", {
      phase: "reading",
      tool: {
        id: toolTwoId,
        name: "read_file",
        status: "completed",
        summary: `已读取 ${changedFile}`,
        inputSummary: changedFile,
        outputSummary: "发现边界条件未覆盖",
        startedAt: new Date(Date.now() - 500).toISOString(),
        endedAt: new Date().toISOString(),
      },
    });
    nextPhase("editing", `准备修改 ${changedFile}`);
    emit({
      type: "file.change",
      phase: "editing",
      file: {
        path: changedFile,
        changeType: "modified",
        summary: maybeAuth ? "补充登录错误处理与 token 校验" : "更新控制台的会话状态与流式渲染",
        patch: maybeAuth
          ? "@@ login\n- return token\n+ validate token and normalize auth errors"
          : "@@ console\n- setMessage(data)\n+ append streaming delta and update phase cards",
      },
    });
    emit({
      type: "assistant.delta",
      phase: "editing",
      messageId,
      content: maybeAuth
        ? "\n我会补齐登录异常分支，并统一 token 校验逻辑。"
        : "\n我会补齐事件流渲染，让状态、工具和日志保持一致更新。",
    });
  });

  schedule(2900, () => {
    toolEvent("tool.start", {
      phase: "running",
      tool: {
        id: toolThreeId,
        name: "run_command",
        status: "running",
        summary: maybeAuth ? "运行 auth 相关测试" : "运行前端构建检查",
        inputSummary: maybeAuth ? "npm test -- auth" : "npm run build",
        startedAt: new Date().toISOString(),
      },
    });
    emit({
      type: "log.stdout",
      phase: "running",
      log: {
        source: "stdout",
        content: maybeAuth ? "Running auth tests..." : "vite build started...",
      },
    });
  });

  schedule(3600, () => {
    emit({
      type: "log.stdout",
      phase: "running",
      log: {
        source: "stdout",
        content: maybeAuth ? "3 tests passed, 0 failed" : "build completed in 1.8s",
      },
    });
    toolEvent("tool.complete", {
      phase: "running",
      tool: {
        id: toolThreeId,
        name: "run_command",
        status: "completed",
        summary: maybeAuth ? "auth 测试通过" : "前端构建通过",
        inputSummary: maybeAuth ? "npm test -- auth" : "npm run build",
        outputSummary: maybeAuth ? "3 passed / 0 failed" : "vite build success",
        startedAt: new Date(Date.now() - 700).toISOString(),
        endedAt: new Date().toISOString(),
      },
    });
    nextPhase("summarizing", "整理本轮结果");
    emit({
      type: "assistant.delta",
      phase: "summarizing",
      messageId,
      content: "\n修改和验证已经完成，我正在整理结果摘要。",
    });
  });

  schedule(4200, () => {
    if (stopRequested) {
      return;
    }
    emit({
      type: "assistant.complete",
      phase: "completed",
      messageId,
      content: [
        "我已完成本轮处理。",
        maybeAuth ? "修复了登录流程中的异常处理和 token 校验逻辑。" : "补齐了控制台的事件流展示与状态同步。",
        `本轮变更文件：${changedFile}。`,
        maybeAuth ? "相关 auth 测试已通过。" : "构建检查已通过。",
      ].join(" "),
    });
    emit({
      type: "run.completed",
      phase: "completed",
      message: "Run completed",
    });
    busy = false;
    flushQueue();
  });
}

function stopRun(): void {
  stopRequested = true;
  resetTimers();
  emit({
    type: "run.stopped",
    phase: "idle",
    message: "Execution stopped by user",
  });
  busy = false;
  flushQueue();
}

function flushQueue(): void {
  if (busy) {
    return;
  }
  const nextPrompt = queue.shift();
  if (nextPrompt) {
    schedule(300, () => startRun(nextPrompt));
  }
}

process.stdin.setEncoding("utf8");
emit({
  type: "session.ready",
  phase: "idle",
  message: "Mock Copilot CLI runtime ready",
});

let buffer = "";
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    const command = JSON.parse(text) as MockCommand;
    if (command.type === "stop") {
      if (busy) {
        stopRun();
      }
      continue;
    }
    if (!command.content) {
      continue;
    }
    if (busy) {
      queue.push(command.content);
      emit({
        type: "assistant.intent",
        phase: "planning",
        message: "收到补充指令，当前轮执行结束后会继续处理",
        content: command.content,
      });
      continue;
    }
    startRun(command.content);
  }
});

process.stdin.on("end", () => {
  resetTimers();
  process.exit(0);
});
