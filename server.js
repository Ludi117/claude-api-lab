require("dotenv").config();
const express = require("express");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const { TOOL_DEFINITIONS, executeLocalTool } = require("./src/tools");
const {
  MCP_SERVER_INFO,
  MCP_TOOLS,
  MCP_RESOURCES,
  MCP_PROMPTS,
  handleMcpJsonRpc,
  convertMcpToolsToClaudeTools
} = require("./src/mcpDemoServer");
const {
  connectCustomMcpServer,
  disconnectCustomMcpServer,
  getActiveCustomMcpStatus,
  sendRpcToCustomMcpServer
} = require("./src/mcpClientManager");
const {
  buildSimulatedMessage,
  buildSimulatedSseEvents,
  resetSimulatorCache
} = require("./src/simulator");
const { publicModelCatalog, DEFAULT_MODEL_ID } = require("./src/models");

const app = express();
const PORT = process.env.PORT || 3000;

// The UI is served from this same origin, so no cross-origin access is needed.
// Leaving CORS closed stops other websites from calling these endpoints with your API key.
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

/**
 * Helper to strip internal UI simulation flags before sending to real Anthropic API
 * or displaying the clean canonical API payload.
 */
function sanitizeAnthropicPayload(raw = {}) {
  const clean = {
    model: raw.model || DEFAULT_MODEL_ID,
    max_tokens: raw.max_tokens !== undefined ? Number(raw.max_tokens) : 1024,
    messages: Array.isArray(raw.messages) ? raw.messages : [{ role: "user", content: "Hello Claude!" }]
  };

  if (raw.system && (typeof raw.system === "string" ? raw.system.trim() : raw.system.length > 0)) {
    clean.system = raw.system;
  }

  // Top-level cache_control (automatic breakpoint on last cacheable block)
  if (raw.cache_control && raw.cache_control.type === "ephemeral") {
    clean.cache_control = raw.cache_control;
  }

  // Thinking: supports `adaptive`, `enabled`, `disabled`, `between_tools`, plus `display: "summarized" | "omitted"`
  if (raw.thinking && raw.thinking.type) {
    if (raw.thinking.type === "adaptive") {
      clean.thinking = {
        type: "adaptive",
        ...(raw.thinking.display ? { display: raw.thinking.display } : {})
      };
    } else if (raw.thinking.type === "enabled") {
      clean.thinking = {
        type: "enabled",
        budget_tokens: Math.max(1024, Number(raw.thinking.budget_tokens || 1024)),
        ...(raw.thinking.display ? { display: raw.thinking.display } : {})
      };
      if (clean.max_tokens > 0 && clean.max_tokens <= clean.thinking.budget_tokens) {
        clean.max_tokens = clean.thinking.budget_tokens + 1024;
      }
    } else if (raw.thinking.type === "disabled" || raw.thinking.type === "between_tools") {
      clean.thinking = { type: raw.thinking.type };
    }
  }

  // Modern `output_config`: supports `effort` ("low" | "medium" | "high" | "xhigh" | "max") and `format` (`json_schema`)
  if (raw.output_config && typeof raw.output_config === "object" && Object.keys(raw.output_config).length > 0) {
    clean.output_config = raw.output_config;
  }

  if (raw.speed) {
    clean.speed = raw.speed;
  }

  if (raw.service_tier) {
    clean.service_tier = raw.service_tier;
  }

  if (raw.diagnostics && typeof raw.diagnostics === "object") {
    clean.diagnostics = raw.diagnostics;
  }

  if (raw.container) {
    clean.container = raw.container;
  }

  // Legacy `temperature` is only passed if explicitly provided by the user to test 400 Bad Request deprecation errors
  if (raw.temperature !== undefined && raw.temperature !== null && raw.temperature !== "") {
    clean.temperature = Number(raw.temperature);
  }

  if (Array.isArray(raw.stop_sequences) && raw.stop_sequences.length > 0) {
    clean.stop_sequences = raw.stop_sequences.filter((s) => typeof s === "string" && s.length > 0);
  }

  if (Array.isArray(raw.tools) && raw.tools.length > 0) {
    clean.tools = raw.tools;
  }

  if (raw.tool_choice && raw.tool_choice.type) {
    clean.tool_choice = raw.tool_choice;
  }

  if (raw.stream === true) {
    clean.stream = true;
  }

  return clean;
}

/**
 * Resolve API key & execution mode (Live vs Simulation)
 */
function resolveExecutionConfig(req) {
  const headerKey = req.headers["x-custom-api-key"]?.trim();
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  const requestedMode = req.headers["x-execution-mode"] || req.body?._mode || "auto";

  const apiKey = headerKey || envKey || "";
  const isLive = requestedMode === "live" && Boolean(apiKey);

  return {
    mode: isLive ? "live" : "simulation",
    hasEnvKey: Boolean(envKey),
    hasCustomKey: Boolean(headerKey),
    apiKey
  };
}

// 1. Status & Initial Metadata Endpoint
app.get("/api/status", (req, res) => {
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  res.json({
    status: "ok",
    hasEnvApiKey: Boolean(envKey),
    defaultMode: envKey ? "live" : "simulation",
    sampleTools: TOOL_DEFINITIONS,
    models: publicModelCatalog(),
    mcpServer: {
      info: MCP_SERVER_INFO,
      tools: MCP_TOOLS,
      resources: MCP_RESOURCES,
      prompts: MCP_PROMPTS,
      claudeFormattedTools: convertMcpToolsToClaudeTools(MCP_TOOLS)
    }
  });
});

// 2. Non-Streaming Messages Endpoint (`POST /api/messages`)
app.post("/api/messages", async (req, res) => {
  const startTime = Date.now();
  const config = resolveExecutionConfig(req);
  const cleanPayload = sanitizeAnthropicPayload(req.body);
  delete cleanPayload.stream;

  const inspectedRequest = {
    method: "POST",
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "x-api-key": config.mode === "live" ? "sk-ant-•••••••• (Live Key)" : "sk-ant-sim-•••••••• (Simulated)",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: cleanPayload
  };

  if (config.mode === "live") {
    try {
      const client = new Anthropic({ apiKey: config.apiKey });
      const response = await client.messages.create(cleanPayload);
      return res.json({
        mode: "live",
        latencyMs: Date.now() - startTime,
        inspectedRequest,
        response
      });
    } catch (err) {
      // Errors without an HTTP status (offline, DNS, timeouts) never reached the API: report 502, not 400
      const status = err.status || 502;
      return res.status(status).json({
        mode: "live",
        error: true,
        status,
        errorType: err.error?.error?.type || (err.status ? "api_error" : "connection_error"),
        message: err.message || "Anthropic API Error",
        details: err.error || null,
        inspectedRequest
      });
    }
  }

  // Simulation Mode
  const simPayload = { ...cleanPayload, _sim_cache_mode: req.body?._sim_cache_mode };
  const simulatedResult = buildSimulatedMessage(simPayload);

  if (simulatedResult._httpStatus === 400) {
    return res.status(400).json({
      mode: "simulation",
      error: true,
      status: 400,
      errorType: simulatedResult.error?.type || "invalid_request_error",
      latencyMs: Date.now() - startTime,
      message: `400 Bad Request: ${simulatedResult.error.message}`,
      details: simulatedResult,
      response: simulatedResult,
      inspectedRequest
    });
  }

  const simulatedDelay = simulatedResult.usage?.cache_read_input_tokens > 0 ? 160 : 380;
  await new Promise((r) => setTimeout(r, simulatedDelay));

  return res.json({
    mode: "simulation",
    latencyMs: Date.now() - startTime,
    inspectedRequest,
    response: simulatedResult
  });
});

// 3. Server-Sent Events (SSE) Streaming Endpoint (`POST /api/stream`)
app.post("/api/stream", async (req, res) => {
  const config = resolveExecutionConfig(req);
  // Optional slow-motion playback per SSE frame. Live streams default to real time (0ms);
  // the simulator defaults to 65ms so frames are visible arriving.
  const requestedDelay = Number(req.body?._stream_delay_ms ?? (config.mode === "live" ? 0 : 65));
  const delayMs = Number.isFinite(requestedDelay) ? Math.min(800, Math.max(0, requestedDelay)) : 0;
  const cleanPayload = sanitizeAnthropicPayload({ ...req.body, stream: true });

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const writeSseFrame = (eventName, dataObj) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
  };

  // Stop work (and billing, in live mode) as soon as the client disconnects or presses Stop
  let clientGone = false;
  const upstreamAbort = new AbortController();
  res.on("close", () => {
    clientGone = true;
    upstreamAbort.abort();
  });

  if (config.mode === "live") {
    try {
      const client = new Anthropic({ apiKey: config.apiKey });
      const stream = await client.messages.create(cleanPayload, { signal: upstreamAbort.signal });

      for await (const event of stream) {
        if (clientGone) break;
        writeSseFrame(event.type, event);
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      res.end();
      return;
    } catch (err) {
      if (clientGone) return;
      writeSseFrame("error", {
        type: "error",
        error: {
          type: "api_error",
          message: err.message || "Live streaming error"
        }
      });
      res.end();
      return;
    }
  }

  // Simulation Mode SSE Stream
  const simPayload = { ...cleanPayload, _sim_cache_mode: req.body?._sim_cache_mode };
  const { events } = buildSimulatedSseEvents(simPayload);

  for (const frame of events) {
    if (clientGone) break;
    writeSseFrame(frame.event, frame.data);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  res.end();
});

// 3b. Token Counting (`POST /api/count_tokens`): exact count via the API in live mode, rough estimate in simulation
app.post("/api/count_tokens", async (req, res) => {
  const config = resolveExecutionConfig(req);
  const clean = sanitizeAnthropicPayload(req.body);
  // count_tokens accepts the prompt-shaping fields only (no max_tokens, stream, sampling, etc.)
  const countPayload = { model: clean.model, messages: clean.messages };
  for (const key of ["system", "tools", "tool_choice", "thinking"]) {
    if (clean[key] !== undefined) countPayload[key] = clean[key];
  }

  if (config.mode === "live") {
    try {
      const client = new Anthropic({ apiKey: config.apiKey });
      const result = await client.messages.countTokens(countPayload);
      return res.json({ mode: "live", estimated: false, input_tokens: result.input_tokens, model: clean.model });
    } catch (err) {
      const status = err.status || 502;
      return res.status(status).json({ mode: "live", error: true, status, message: err.message || "Token count failed" });
    }
  }

  // Simulation: ~4 characters per token over the prompt-shaping fields
  const chars = JSON.stringify([countPayload.system ?? "", countPayload.messages, countPayload.tools ?? []]).length;
  return res.json({ mode: "simulation", estimated: true, input_tokens: Math.max(1, Math.round(chars / 4)), model: clean.model });
});

// 4. Local Tool Execution Endpoint (`POST /api/tools/execute`)
app.post("/api/tools/execute", (req, res) => {
  const { name, input, tool_use_id } = req.body || {};
  const output = executeLocalTool(name, input);

  const claudeToolResultMessage = {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: tool_use_id || "toolu_sim_example",
        content: JSON.stringify(output, null, 2)
      }
    ]
  };

  res.json({
    tool_name: name,
    raw_output: output,
    claudeToolResultMessage
  });
});

// 5. Reset Prompt Cache Simulator State (`POST /api/cache/reset`)
app.post("/api/cache/reset", (req, res) => {
  resetSimulatorCache();
  res.json({ reset: true, message: "Simulator ephemeral prompt cache cleared." });
});

// 6. Model Context Protocol (MCP) JSON-RPC 2.0 Sandbox & Custom Server Inspector Endpoints
app.get("/api/mcp/status", (req, res) => {
  res.json({
    builtin: {
      info: MCP_SERVER_INFO,
      toolsCount: MCP_TOOLS.length,
      claudeBridgeTools: convertMcpToolsToClaudeTools(MCP_TOOLS)
    },
    custom: getActiveCustomMcpStatus()
  });
});

app.post("/api/mcp/connect", async (req, res) => {
  try {
    const result = await connectCustomMcpServer(req.body || {});
    res.json({
      ok: true,
      ...result
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || "Failed to connect to custom MCP server",
      stderrLogs: err.stderrLogs || getActiveCustomMcpStatus().stderrLogs || []
    });
  }
});

app.post("/api/mcp/disconnect", async (req, res) => {
  const result = await disconnectCustomMcpServer();
  res.json(result);
});

app.post("/api/mcp/rpc", async (req, res) => {
  const body = req.body || {};
  const target = body._mcpTarget === "custom" ? "custom" : "builtin";
  const rpcRequest = body.rpcRequest || {
    jsonrpc: body.jsonrpc || "2.0",
    id: body.id !== undefined ? body.id : 1,
    method: body.method || "initialize",
    ...(body.params !== undefined ? { params: body.params } : {})
  };

  if (target === "custom") {
    try {
      const result = await sendRpcToCustomMcpServer(rpcRequest);
      return res.json({
        target: "custom",
        ...result
      });
    } catch (err) {
      return res.status(400).json({
        target: "custom",
        error: true,
        message: err.message || "Custom MCP JSON-RPC error",
        rpcRequest,
        rpcResponse: {
          jsonrpc: "2.0",
          id: rpcRequest.id ?? null,
          error: { code: -32000, message: err.message || "Custom MCP JSON-RPC error" }
        },
        status: getActiveCustomMcpStatus()
      });
    }
  }

  const start = Date.now();
  const rpcResponse = handleMcpJsonRpc(rpcRequest);

  res.json({
    target: "builtin",
    latencyMs: Date.now() - start,
    rpcRequest,
    rpcResponse,
    claudeBridgeTools: convertMcpToolsToClaudeTools(MCP_TOOLS)
  });
});

/**
 * Starts the embedded server on the given port (use 0 for an ephemeral OS-assigned port inside Electron)
 */
function startEmbeddedServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => {
      const actualPort = server.address().port;
      resolve({ server, port: actualPort, url: `http://127.0.0.1:${actualPort}` });
    });
    server.on("error", reject);
  });
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀 Claude API Explorer & Learning Workbench running at http://localhost:${PORT}`);
  });
}

module.exports = { app, startEmbeddedServer };
