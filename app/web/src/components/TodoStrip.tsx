import type { ConsoleEvent, SessionSnapshot } from "@copilot-console/shared";
import { ChevronDown, ListTodo } from "lucide-react";
import { useMemo, useState } from "react";

interface TodoStep {
  id: string;
  description: string;
  status: string;
}

interface TodoView {
  action: string;
  counts: Array<{ status: string; count: number }>;
  steps: TodoStep[];
}

interface RawTodoPayload {
  type?: string;
  steps?: Array<{ description?: string; status?: string }>;
  items?: Array<{ text?: string; completed?: boolean }>;
}

function normalizeTodoStatus(status?: string, completed?: boolean): string {
  if (completed === true) {
    return "completed";
  }

  const normalized = (status || "").trim().toLowerCase();
  if (!normalized) {
    return "pending";
  }

  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "done" ||
    normalized === "finished"
  ) {
    return "completed";
  }

  if (normalized === "in_progress" || normalized === "in-progress" || normalized.includes("progress")) {
    return "in_progress";
  }

  if (normalized === "pending" || normalized === "todo") {
    return "pending";
  }

  return normalized;
}

function parseTodoAction(message: string, rawType?: string): string | null {
  const actionMatch = message.match(/^(?:Todo 列表已|执行计划已)(创建|更新|完成|变更)/);
  if (actionMatch) {
    return actionMatch[1];
  }

  if (rawType === "item.started") {
    return "创建";
  }
  if (rawType === "item.updated") {
    return "更新";
  }
  if (rawType === "item.completed") {
    return "完成";
  }
  return null;
}

function parseTodoSteps(payload?: RawTodoPayload): TodoStep[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload.steps) && payload.steps.length > 0) {
    return payload.steps.map((step, index) => ({
      id: `step_${index}`,
      description: (step.description || "(未命名步骤)").trim(),
      status: normalizeTodoStatus(step.status),
    }));
  }

  if (Array.isArray(payload.items) && payload.items.length > 0) {
    return payload.items.map((item, index) => ({
      id: `item_${index}`,
      description: (item.text || "(未命名步骤)").trim(),
      status: normalizeTodoStatus(undefined, Boolean(item.completed)),
    }));
  }

  return [];
}

function summarizeCountsFromSteps(steps: TodoStep[]): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const step of steps) {
    const key = step.status || "pending";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

function buildCollapsedTodoText(todo: TodoView | null): string {
  if (!todo) {
    return "Todo: 0. 等待计划";
  }

  const total = todo.steps.length > 0
    ? todo.steps.length
    : todo.counts.reduce((sum, count) => sum + count.count, 0);

  const inProgress = todo.steps.find((step) => step.status === "in_progress");
  if (inProgress) {
    return `Todo: ${total}. 当前任务：${inProgress.description}`;
  }

  const nextPending = todo.steps.find((step) => step.status !== "completed");
  if (nextPending) {
    return `Todo: ${total}. 当前任务：${nextPending.description}`;
  }

  const latestCompleted = [...todo.steps].reverse().find((step) => step.status === "completed");
  if (latestCompleted) {
    return `Todo: ${total}. 最近完成：${latestCompleted.description}`;
  }

  return `Todo: ${total}. 已${todo.action}`;
}

function parseTodoCounts(message: string): Array<{ status: string; count: number }> {
  const completedRatio = message.match(/已完成\s*(\d+)\s*\/\s*(\d+)/);
  if (completedRatio) {
    const completed = Number(completedRatio[1]);
    const total = Number(completedRatio[2]);
    if (Number.isFinite(completed) && Number.isFinite(total) && total >= 0) {
      const pending = Math.max(0, total - completed);
      return [
        { status: "completed", count: completed },
        { status: "pending", count: pending },
      ].filter((item) => item.count > 0);
    }
  }

  const separatorIndex = message.search(/[:：]/);
  if (separatorIndex < 0) {
    return [];
  }

  const payload = message.slice(separatorIndex + 1);
  return payload
    .split("|")
    .map((part) => part.trim())
    .map((part) => {
      const matched = part.match(/^([^\s]+)\s+(\d+)$/);
      if (!matched) {
        return null;
      }
      return {
        status: matched[1],
        count: Number(matched[2]),
      };
    })
    .filter((item): item is { status: string; count: number } => Boolean(item));
}

function parseTodoEvent(event: ConsoleEvent): TodoView | null {
  if (event.type !== "assistant.intent") {
    return null;
  }

  const raw = event.raw as { type?: string; item?: RawTodoPayload } | undefined;
  const message = (event.message || event.content || "").trim();
  const isRawTodo = raw?.item?.type === "todo_list";
  const isPlanUpdate = raw?.item?.type === "plan_update";
  const action = parseTodoAction(message, raw?.type) || (isPlanUpdate ? "更新" : null);
  if (!action || (!isRawTodo && !isPlanUpdate && !message.includes("Todo 列表") && !message.includes("执行计划"))) {
    return null;
  }

  const steps = parseTodoSteps(raw?.item).map((step, index) => ({
    ...step,
    id: `${event.id}_${index}`,
  }));

  const countsFromMessage = parseTodoCounts(message);
  const counts = countsFromMessage.length > 0 ? countsFromMessage : summarizeCountsFromSteps(steps);

  return {
    action,
    counts,
    steps,
  };
}

export function TodoStrip({ snapshot }: { snapshot: SessionSnapshot | null }) {
  const [expanded, setExpanded] = useState(false);

  const todo = useMemo(() => {
    if (!snapshot) {
      return null;
    }

    for (let index = snapshot.timeline.length - 1; index >= 0; index -= 1) {
      const parsed = parseTodoEvent(snapshot.timeline[index]);
      if (parsed) {
        return parsed;
      }
    }

    return null;
  }, [snapshot]);

  if (!snapshot) {
    return null;
  }

  return (
    <section className={`todo-strip ${expanded ? "expanded" : "collapsed"}`}>
      <button
        type="button"
        className="todo-strip-head"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <span className="todo-strip-title-wrap">
          <ListTodo size={14} />
          <span className="todo-strip-title">Todo 列表</span>
        </span>
        <span className="todo-strip-meta" title={buildCollapsedTodoText(todo)}>
          {buildCollapsedTodoText(todo)}
        </span>
        <ChevronDown className="todo-strip-caret" size={14} />
      </button>

      {expanded ? (
        <div className="todo-strip-body">
          {todo?.steps.length ? (
            <ul className="todo-step-list">
              {todo.steps.map((step) => (
                <li key={step.id} className="todo-step-item">
                  <span className={`todo-step-status status-${step.status}`}>{step.status}</span>
                  <span className="todo-step-text">{step.description}</span>
                </li>
              ))}
            </ul>
          ) : todo?.counts.length ? (
            <div className="todo-count-list">
              {todo.counts.map((count) => (
                <span key={count.status} className="todo-count-chip">
                  {count.status}: {count.count}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">暂无 Todo 详情</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
