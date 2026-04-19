import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number.parseInt(process.env.PORT || "11434", 10);
const upstreamBaseUrl = (process.env.UPSTREAM_BASE_URL || "").trim().replace(/\/$/, "");
const upstreamApiKey = (process.env.UPSTREAM_API_KEY || "").trim();

function describeError(error) {
  if (!error || typeof error !== "object") {
    return "Unknown proxy error";
  }
  const message = error instanceof Error ? error.message : String(error);
  const cause = "cause" in error && error.cause && typeof error.cause === "object" ? error.cause : null;
  const causeCode = cause && "code" in cause ? cause.code : null;
  const causeMessage = cause && "message" in cause ? cause.message : null;
  return [message, causeCode, causeMessage].filter(Boolean).join(": ");
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function sseStart(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
}

function sseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sseDone(res) {
  res.write("data: [DONE]\n\n");
  res.end();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function extractText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (!item || typeof item !== "object") {
          return "";
        }
        if (typeof item.text === "string") {
          return item.text;
        }
        if (typeof item.output_text === "string") {
          return item.output_text;
        }
        if (typeof item.output === "string") {
          return item.output;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") {
      return value.text;
    }
    if (typeof value.output === "string") {
      return value.output;
    }
  }
  return "";
}

function mapResponsesInputToMessages(input, instructions) {
  const messages = [];
  const systemParts = [];

  if (instructions) {
    const text = extractText(instructions);
    if (text) {
      systemParts.push(text);
    }
  }

  const items = Array.isArray(input) ? input : [{ role: "user", content: extractText(input) }];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    if ((item.type === "message" || item.role) && item.role) {
      const contentText = extractText(item.content);
      if (item.role === "developer" || item.role === "system") {
        if (contentText) {
          systemParts.push(contentText);
        }
        continue;
      }

      messages.push({
        role: item.role,
        content: contentText,
      });
      continue;
    }

    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: item.call_id || item.id || `call_${randomUUID()}`,
            type: "function",
            function: {
              name: item.name || "tool",
              arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {}),
            },
          },
        ],
      });
      continue;
    }

    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id || item.id || `call_${randomUUID()}`,
        content: extractText(item.output),
      });
    }
  }

  if (systemParts.length > 0) {
    messages.unshift({
      role: "system",
      content: systemParts.join("\n\n"),
    });
  }

  return messages;
}

function mapTools(tools) {
  if (!Array.isArray(tools)) {
    return undefined;
  }

  const mapped = tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") {
        return null;
      }
      if (tool.type !== "function" && tool.type !== "custom") {
        return null;
      }
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || tool.input_schema || {
            type: "object",
            properties: {},
          },
        },
      };
    })
    .filter(Boolean);

  return mapped.length > 0 ? mapped : undefined;
}

function createResponseState(model) {
  return {
    responseId: `resp_${randomUUID()}`,
    createdAt: Math.floor(Date.now() / 1000),
    model,
    output: [],
    textItem: null,
    toolItems: new Map(),
    usage: undefined,
  };
}

function buildResponseObject(state, status, incompleteDetails) {
  return {
    id: state.responseId,
    object: "response",
    created_at: state.createdAt,
    status,
    model: state.model,
    output: state.output,
    incomplete_details: incompleteDetails || null,
    usage: state.usage,
  };
}

function ensureTextItem(state, res) {
  if (state.textItem) {
    return state.textItem;
  }

  const item = {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    status: "in_progress",
    content: [
      {
        type: "output_text",
        text: "",
        annotations: [],
      },
    ],
  };
  state.textItem = item;
  state.output.push(item);
  const outputIndex = state.output.length - 1;

  sseEvent(res, {
    type: "response.output_item.added",
    response_id: state.responseId,
    output_index: outputIndex,
    item,
  });
  sseEvent(res, {
    type: "response.content_part.added",
    response_id: state.responseId,
    output_index: outputIndex,
    item_id: item.id,
    content_index: 0,
    part: item.content[0],
  });
  return item;
}

function ensureToolItem(state, res, index, name, callId) {
  const existing = state.toolItems.get(index);
  if (existing) {
    if (name && !existing.item.name) {
      existing.item.name = name;
    }
    if (callId && !existing.item.call_id) {
      existing.item.call_id = callId;
    }
    return existing;
  }

  const item = {
    id: `fc_${randomUUID()}`,
    type: "function_call",
    status: "in_progress",
    call_id: callId || `call_${randomUUID()}`,
    name: name || "",
    arguments: "",
  };
  state.output.push(item);
  const entry = { item, outputIndex: state.output.length - 1 };
  state.toolItems.set(index, entry);

  sseEvent(res, {
    type: "response.output_item.added",
    response_id: state.responseId,
    output_index: entry.outputIndex,
    item,
  });

  return entry;
}

function finishTextItem(state, res) {
  if (!state.textItem || state.textItem.status === "completed") {
    return;
  }
  const outputIndex = state.output.findIndex((item) => item.id === state.textItem.id);
  const text = state.textItem.content[0].text;
  state.textItem.status = "completed";

  sseEvent(res, {
    type: "response.output_text.done",
    response_id: state.responseId,
    output_index: outputIndex,
    item_id: state.textItem.id,
    content_index: 0,
    text,
  });
  sseEvent(res, {
    type: "response.content_part.done",
    response_id: state.responseId,
    output_index: outputIndex,
    item_id: state.textItem.id,
    content_index: 0,
    part: state.textItem.content[0],
  });
  sseEvent(res, {
    type: "response.output_item.done",
    response_id: state.responseId,
    output_index: outputIndex,
    item: state.textItem,
  });
}

function finishToolItems(state, res) {
  for (const entry of state.toolItems.values()) {
    if (entry.item.status === "completed") {
      continue;
    }
    entry.item.status = "completed";
    sseEvent(res, {
      type: "response.function_call_arguments.done",
      response_id: state.responseId,
      output_index: entry.outputIndex,
      item_id: entry.item.id,
      call_id: entry.item.call_id,
      arguments: entry.item.arguments,
    });
    sseEvent(res, {
      type: "response.output_item.done",
      response_id: state.responseId,
      output_index: entry.outputIndex,
      item: entry.item,
    });
  }
}

async function proxyModels(res) {
  if (!upstreamBaseUrl) {
    json(res, 503, { error: "UPSTREAM_BASE_URL is not configured" });
    return;
  }

  const upstreamUrl = `${upstreamBaseUrl}/models`;
  const headers = { Accept: "application/json" };
  if (upstreamApiKey) {
    headers.Authorization = `Bearer ${upstreamApiKey}`;
  }

  const upstreamResponse = await fetch(upstreamUrl, { headers });
  const payload = await upstreamResponse.text();
  res.writeHead(upstreamResponse.status, {
    "Content-Type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function buildChatPayload(body) {
  const payload = {
    model: body.model,
    messages: mapResponsesInputToMessages(body.input, body.instructions),
    tools: mapTools(body.tools),
    stream: true,
  };

  if (typeof body.temperature === "number") {
    payload.temperature = body.temperature;
  }
  if (typeof body.top_p === "number") {
    payload.top_p = body.top_p;
  }
  if (typeof body.max_output_tokens === "number") {
    payload.max_tokens = body.max_output_tokens;
  }
  if (body.tool_choice) {
    payload.tool_choice = body.tool_choice;
  }

  return payload;
}

async function streamChatAsResponses(reqBody, res) {
  if (!upstreamBaseUrl) {
    sseStart(res);
    sseEvent(res, {
      type: "error",
      error: {
        message: "UPSTREAM_BASE_URL is not configured",
        type: "invalid_request_error",
      },
    });
    sseDone(res);
    return;
  }

  const state = createResponseState(reqBody.model);
  sseStart(res);
  sseEvent(res, {
    type: "response.created",
    response: buildResponseObject(state, "in_progress"),
  });
  sseEvent(res, {
    type: "response.in_progress",
    response: buildResponseObject(state, "in_progress"),
  });

  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (upstreamApiKey) {
    headers.Authorization = `Bearer ${upstreamApiKey}`;
  }

  const chatPayload = buildChatPayload(reqBody);
  const upstreamResponse = await fetch(`${upstreamBaseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(chatPayload),
  });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const text = await upstreamResponse.text().catch(() => "");
      sseEvent(res, {
        type: "error",
        error: {
        message: text || `Upstream request failed with ${upstreamResponse.status}`,
        type: "server_error",
      },
    });
    sseEvent(res, {
      type: "response.failed",
      response: buildResponseObject(state, "failed"),
    });
    sseDone(res);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  let finishReason = null;

  const handleChunk = (payload) => {
    const choice = payload?.choices?.[0];
    const delta = choice?.delta || {};
    if (payload?.usage) {
      state.usage = payload.usage;
    }
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      const item = ensureTextItem(state, res);
      item.content[0].text += delta.content;
      const outputIndex = state.output.findIndex((entry) => entry.id === item.id);
      sseEvent(res, {
        type: "response.output_text.delta",
        response_id: state.responseId,
        output_index: outputIndex,
        item_id: item.id,
        content_index: 0,
        delta: delta.content,
      });
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const toolCall of delta.tool_calls) {
        const index = typeof toolCall.index === "number" ? toolCall.index : 0;
        const entry = ensureToolItem(
          state,
          res,
          index,
          toolCall.function?.name,
          toolCall.id,
        );
        if (toolCall.function?.name) {
          entry.item.name = toolCall.function.name;
        }
        if (toolCall.id) {
          entry.item.call_id = toolCall.id;
        }
        if (typeof toolCall.function?.arguments === "string" && toolCall.function.arguments.length > 0) {
          entry.item.arguments += toolCall.function.arguments;
          sseEvent(res, {
            type: "response.function_call_arguments.delta",
            response_id: state.responseId,
            output_index: entry.outputIndex,
            item_id: entry.item.id,
            call_id: entry.item.call_id,
            delta: toolCall.function.arguments,
          });
        }
      }
    }
  };

  let streamError = null;

  try {
    for await (const chunk of upstreamResponse.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const eventBlock of events) {
        const lines = eventBlock
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const dataLines = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());
        if (dataLines.length === 0) {
          continue;
        }
        const data = dataLines.join("\n");
        if (data === "[DONE]") {
          sawDone = true;
          continue;
        }
        try {
          handleChunk(JSON.parse(data));
        } catch {
          continue;
        }
      }
    }

    if (buffer.trim()) {
      const lastData = buffer
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (lastData && lastData !== "[DONE]") {
        try {
          handleChunk(JSON.parse(lastData));
        } catch {
          // ignore trailing parse errors
        }
      }
    }
  } catch (error) {
    streamError = error;
  }

  finishTextItem(state, res);
  finishToolItems(state, res);

  const finalStatus = streamError
    ? "failed"
    : finishReason === "length"
      ? "incomplete"
      : "completed";
  sseEvent(res, {
    type: "response.completed",
    response: buildResponseObject(
      state,
      finalStatus,
      streamError
        ? { reason: "stream_error" }
        : finishReason === "length"
          ? { reason: "max_output_tokens" }
          : null,
    ),
  });

  if (!sawDone) {
    sseDone(res);
    return;
  }
  sseDone(res);
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    res.end();
    return;
  }

  try {
    if (req.url === "/health") {
      json(res, 200, { ok: true, upstreamBaseUrl: upstreamBaseUrl || null });
      return;
    }

    if (req.method === "GET" && req.url === "/v1/models") {
      await proxyModels(res);
      return;
    }

    if (req.method === "POST" && req.url === "/v1/responses") {
      const body = await readJsonBody(req);
      await streamChatAsResponses(body, res);
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    if (!res.headersSent) {
      json(res, 500, { error: describeError(error) });
      return;
    }

    try {
      sseEvent(res, {
        type: "error",
        error: {
          message: describeError(error),
          type: "server_error",
        },
      });
      sseDone(res);
    } catch {
      res.end();
    }
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`responses-compat-proxy listening on :${port}`);
});
