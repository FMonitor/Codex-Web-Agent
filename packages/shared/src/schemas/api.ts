import { z } from "zod";
import {
  CONSOLE_EVENT_TYPES,
  RUNTIME_PHASES,
  SESSION_STATUSES,
  TOOL_STATUSES,
} from "../constants/runtime.js";

export const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  workspacePath: z.string().trim().min(1),
  runtimeProfile: z.string().trim().min(1).max(80).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  sandboxMode: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
  agentId: z.string().trim().min(1).max(64).optional(),
  agentRole: z.string().trim().min(1).max(64).optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
});

export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export const toolStatusSchema = z.enum(TOOL_STATUSES);
export const runtimePhaseSchema = z.enum(RUNTIME_PHASES);
export const consoleEventTypeSchema = z.enum(CONSOLE_EVENT_TYPES);
