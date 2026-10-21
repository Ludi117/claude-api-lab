/**
 * Custom Model Context Protocol (MCP) Client Manager (`src/mcpClientManager.js`)
 * Supports inspecting real external MCP servers over:
 * 1. `stdio` transport (spawning local commands like `npx`, `node`, `python`, `uvx`)
 * 2. `http` transport (Streamable HTTP / JSON-RPC POST endpoints with JSON or SSE responses)
 */

const { spawn } = require("child_process");
const { convertMcpToolsToClaudeTools } = require("./mcpDemoServer");

const MAX_STDERR_LINES = 120;
const DEFAULT_RPC_TIMEOUT_MS = 25000;

class StdioMcpConnection {
  constructor(config) {
    this.id = config.id || "custom-stdio";
    this.name = config.name || config.command || "Custom Stdio MCP Server";
    this.transport = "stdio";
    this.command = String(config.command || "").trim();
    this.args = Array.isArray(config.args) ? config.args.map(String) : [];
    this.env = config.env && typeof config.env === "object" ? config.env : {};
    this.cwd = config.cwd ? String(config.cwd).trim() : process.cwd();

    this.proc = null;
    this.stdoutBuffer = "";
    this.stderrLogs = [];
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.nextRpcId = 1;
    this.connected = false;
    this.serverInfo = null;
    this.capabilities = null;
    this.protocolVersion = null;
    this.cachedTools = [];
  }

  appendLog(line, source = "stderr") {
    const clean = String(line || "").trimEnd();
    if (!clean) return;
    this.stderrLogs.push({
      timestamp: new Date().toLocaleTimeString(),
      source,
      text: clean
    });
    if (this.stderrLogs.length > MAX_STDERR_LINES) {
      this.stderrLogs = this.stderrLogs.slice(-MAX_STDERR_LINES);
    }
  }

  async connect() {
    if (!this.command) {
      throw new Error("Missing command for stdio MCP server.");
    }

    await this.disconnect();

    const isWin = process.platform === "win32";
    const mergedEnv = { ...process.env, ...this.env };

    // On Windows (Electron / Node 22+), .cmd shims like `npx` and `npm` require shell execution
    const safeArgs = isWin
      ? this.args.map((arg) => (/[\s"&|<>^]/.test(arg) && !/^".*"$/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      : this.args;

    this.appendLog(`$ ${this.command} ${this.args.join(" ")}`, "system");

    this.proc = spawn(this.command, safeArgs, {
      cwd: this.cwd || process.cwd(),
      env: mergedEnv,
      shell: isWin,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.connected = true;

    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk;
      let newlineIdx;
      while ((newlineIdx = this.stdoutBuffer.indexOf("\n")) !== -1) {
        const rawLine = this.stdoutBuffer.slice(0, newlineIdx).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
        if (!rawLine) continue;

        try {
          const msg = JSON.parse(rawLine);
          this.handleIncomingMessage(msg);
        } catch {
          // Non-JSON stdout line (some servers print banner messages to stdout)
          this.appendLog(rawLine, "stdout");
        }
      }
    });

    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) this.appendLog(line, "stderr");
      }
    });

    this.proc.on("error", (err) => {
      this.connected = false;
      this.appendLog(`Process error: ${err.message}`, "error");
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Stdio process error: ${err.message}`));
      }
      this.pending.clear();
    });

    this.proc.on("exit", (code, signal) => {
      this.connected = false;
      this.appendLog(`Process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`, "system");
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`MCP server exited before responding (code ${code ?? signal}). Check stderr logs.`));
      }
      this.pending.clear();
    });

    // Perform official MCP `initialize` handshake
    const initRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "claude-api-explorer-workbench", version: "2.0.0" }
      }
    };

    const initResponse = await this.sendRawRpc(initRequest);
    if (initResponse?.result) {
      this.serverInfo = initResponse.result.serverInfo || { name: this.name, version: "unknown" };
      this.capabilities = initResponse.result.capabilities || {};
      this.protocolVersion = initResponse.result.protocolVersion || "2025-03-26";
    }

    // Send `notifications/initialized` notification (no id, no response expected)
    this.sendNotification({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    });

    // Pre-fetch tools if supported so Claude bridge works immediately
    try {
      const toolsRes = await this.sendRawRpc({
        jsonrpc: "2.0",
        id: this.nextId(),
        method: "tools/list",
        params: {}
      });
      if (Array.isArray(toolsRes?.result?.tools)) {
        this.cachedTools = toolsRes.result.tools;
      }
    } catch {
      // Server may not implement tools/list; ignore
    }

    return {
      initRequest,
      initResponse,
      status: this.getStatus()
    };
  }

  nextId() {
    return this.nextRpcId++;
  }

  handleIncomingMessage(msg) {
    if (msg && msg.id !== undefined && this.pending.has(String(msg.id))) {
      const entry = this.pending.get(String(msg.id));
      clearTimeout(entry.timer);
      this.pending.delete(String(msg.id));
      entry.resolve(msg);
    } else if (msg && msg.method) {
      // Server-sent notification
      this.appendLog(`Notification: ${msg.method}`, "notification");
    }
  }

  sendNotification(notificationObj) {
    if (!this.proc || !this.connected || !this.proc.stdin.writable) return;
    try {
      this.proc.stdin.write(JSON.stringify(notificationObj) + "\n");
    } catch (err) {
      this.appendLog(`Failed to write notification: ${err.message}`, "error");
    }
  }

  sendRawRpc(rpcRequest, timeoutMs = DEFAULT_RPC_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.connected || !this.proc.stdin.writable) {
        return reject(new Error("Stdio MCP server is not running. Click Connect first."));
      }

      const reqId = rpcRequest.id !== undefined ? rpcRequest.id : this.nextId();
      const payload = {
        jsonrpc: "2.0",
        id: reqId,
        method: rpcRequest.method,
        ...(rpcRequest.params !== undefined ? { params: rpcRequest.params } : {})
      };

      // If notification (no response expected)
      if (String(payload.method || "").startsWith("notifications/")) {
        this.sendNotification({ jsonrpc: "2.0", method: payload.method, params: payload.params || {} });
        return resolve({ jsonrpc: "2.0", id: reqId, result: { acknowledged: true } });
      }

      const timer = setTimeout(() => {
        this.pending.delete(String(reqId));
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for JSON-RPC response to '${payload.method}'.`));
      }, timeoutMs);

      this.pending.set(String(reqId), {
        resolve: (msg) => {
          if (payload.method === "tools/list" && Array.isArray(msg?.result?.tools)) {
            this.cachedTools = msg.result.tools;
          }
          if (payload.method === "initialize" && msg?.result) {
            this.serverInfo = msg.result.serverInfo || this.serverInfo;
            this.capabilities = msg.result.capabilities || this.capabilities;
            this.protocolVersion = msg.result.protocolVersion || this.protocolVersion;
          }
          resolve(msg);
        },
        reject,
        timer
      });

      try {
        this.proc.stdin.write(JSON.stringify(payload) + "\n");
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(String(reqId));
        reject(err);
      }
    });
  }

  getStatus() {
    return {
      id: this.id,
      name: this.name,
      transport: "stdio",
      connected: this.connected,
      pid: this.proc?.pid || null,
      command: this.command,
      args: this.args,
      serverInfo: this.serverInfo,
      capabilities: this.capabilities,
      protocolVersion: this.protocolVersion,
      toolsCount: this.cachedTools.length,
      claudeBridgeTools: convertMcpToolsToClaudeTools(this.cachedTools),
      stderrLogs: this.stderrLogs
    };
  }

  async disconnect() {
    this.connected = false;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Disconnected by user"));
    }
    this.pending.clear();

    if (this.proc) {
      const p = this.proc;
      this.proc = null;
      try {
        p.stdin?.end();
        p.kill();
      } catch {
        // ignore
      }
    }
  }
}

class HttpMcpConnection {
  constructor(config) {
    this.id = config.id || "custom-http";
    this.name = config.name || config.url || "Custom HTTP MCP Server";
    this.transport = "http";
    this.url = String(config.url || "").trim();
    this.headers = config.headers && typeof config.headers === "object" ? config.headers : {};
    this.sessionId = null;
    this.connected = false;
    this.serverInfo = null;
    this.capabilities = null;
    this.protocolVersion = null;
    this.cachedTools = [];
    this.stderrLogs = [];
    this.nextRpcId = 1;
  }

  appendLog(line, source = "http") {
    this.stderrLogs.push({
      timestamp: new Date().toLocaleTimeString(),
      source,
      text: String(line || "")
    });
    if (this.stderrLogs.length > MAX_STDERR_LINES) {
      this.stderrLogs = this.stderrLogs.slice(-MAX_STDERR_LINES);
    }
  }

  nextId() {
    return this.nextRpcId++;
  }

  async connect() {
    if (!this.url || !/^https?:\/\//i.test(this.url)) {
      throw new Error("Please enter a valid http:// or https:// URL for the HTTP MCP server.");
    }

    this.appendLog(`POST ${this.url} (initialize)`, "system");

    const initRequest = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "claude-api-explorer-workbench", version: "2.0.0" }
      }
    };

    const initResponse = await this.sendRawRpc(initRequest);
    this.connected = true;

    if (initResponse?.result) {
      this.serverInfo = initResponse.result.serverInfo || { name: this.name, version: "remote" };
      this.capabilities = initResponse.result.capabilities || {};
      this.protocolVersion = initResponse.result.protocolVersion || "2025-03-26";
    }

    // Best-effort `notifications/initialized`
    try {
      await this.sendRawRpc({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {}
      });
    } catch {
      // Some stateless HTTP MCP servers ignore notifications
    }

    try {
      const toolsRes = await this.sendRawRpc({
        jsonrpc: "2.0",
        id: this.nextId(),
        method: "tools/list",
        params: {}
      });
      if (Array.isArray(toolsRes?.result?.tools)) {
        this.cachedTools = toolsRes.result.tools;
      }
    } catch {
      // ignore if tools/list is unsupported
    }

    return {
      initRequest,
      initResponse,
      status: this.getStatus()
    };
  }

  async sendRawRpc(rpcRequest, timeoutMs = DEFAULT_RPC_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const isNotification = String(rpcRequest.method || "").startsWith("notifications/");
    const payload = {
      jsonrpc: "2.0",
      ...(isNotification ? {} : { id: rpcRequest.id !== undefined ? rpcRequest.id : this.nextId() }),
      method: rpcRequest.method,
      ...(rpcRequest.params !== undefined ? { params: rpcRequest.params } : {})
    };

    const reqHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.headers
    };
    if (this.sessionId) {
      reqHeaders["Mcp-Session-Id"] = this.sessionId;
    }

    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const returnedSession = res.headers.get("mcp-session-id");
      if (returnedSession) {
        this.sessionId = returnedSession;
      }

      this.appendLog(`HTTP ${res.status} (${payload.method})`, res.ok ? "http" : "error");

      if (res.status === 202 || res.status === 204) {
        return { jsonrpc: "2.0", id: payload.id ?? null, result: { status: res.status, acknowledged: true } };
      }

      const contentType = res.headers.get("content-type") || "";
      const rawText = await res.text();

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 300)}`);
      }

      let parsed = null;
      if (contentType.includes("text/event-stream")) {
        // Extract JSON-RPC object from SSE `data:` lines
        const dataLines = rawText
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .filter(Boolean);
        for (const line of dataLines.reverse()) {
          try {
            parsed = JSON.parse(line);
            break;
          } catch {
            // continue
          }
        }
        if (!parsed) {
          throw new Error(`Could not parse JSON-RPC message from SSE stream: ${rawText.slice(0, 200)}`);
        }
      } else {
        parsed = JSON.parse(rawText);
      }

      if (payload.method === "tools/list" && Array.isArray(parsed?.result?.tools)) {
        this.cachedTools = parsed.result.tools;
      }
      if (payload.method === "initialize" && parsed?.result) {
        this.serverInfo = parsed.result.serverInfo || this.serverInfo;
        this.capabilities = parsed.result.capabilities || this.capabilities;
        this.protocolVersion = parsed.result.protocolVersion || this.protocolVersion;
      }

      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  getStatus() {
    return {
      id: this.id,
      name: this.name,
      transport: "http",
      connected: this.connected,
      url: this.url,
      sessionId: this.sessionId,
      serverInfo: this.serverInfo,
      capabilities: this.capabilities,
      protocolVersion: this.protocolVersion,
      toolsCount: this.cachedTools.length,
      claudeBridgeTools: convertMcpToolsToClaudeTools(this.cachedTools),
      stderrLogs: this.stderrLogs
    };
  }

  async disconnect() {
    this.connected = false;
    this.sessionId = null;
  }
}

// Active custom connection singleton (cleanly replaced when switching/reconnecting)
let activeCustomConnection = null;

async function connectCustomMcpServer(config = {}) {
  if (activeCustomConnection) {
    await activeCustomConnection.disconnect();
    activeCustomConnection = null;
  }

  const transport = config.transport === "http" ? "http" : "stdio";
  const conn = transport === "http" ? new HttpMcpConnection(config) : new StdioMcpConnection(config);
  activeCustomConnection = conn;

  try {
    return await conn.connect();
  } catch (err) {
    // Keep activeCustomConnection around so its stderrLogs can still be inspected on failure
    err.stderrLogs = conn.stderrLogs || [];
    throw err;
  }
}

async function disconnectCustomMcpServer() {
  if (activeCustomConnection) {
    await activeCustomConnection.disconnect();
    activeCustomConnection = null;
  }
  return { disconnected: true };
}

function getActiveCustomMcpStatus() {
  if (!activeCustomConnection) {
    return { connected: false, stderrLogs: [] };
  }
  return activeCustomConnection.getStatus();
}

async function sendRpcToCustomMcpServer(rpcRequest) {
  if (!activeCustomConnection || !activeCustomConnection.connected) {
    throw new Error("No custom MCP server is currently connected. Click 'Connect & Initialize' first.");
  }
  const start = Date.now();
  const rpcResponse = await activeCustomConnection.sendRawRpc(rpcRequest);
  return {
    latencyMs: Date.now() - start,
    rpcRequest,
    rpcResponse,
    status: activeCustomConnection.getStatus(),
    claudeBridgeTools: convertMcpToolsToClaudeTools(activeCustomConnection.cachedTools)
  };
}

process.on("exit", () => {
  if (activeCustomConnection) {
    activeCustomConnection.disconnect();
  }
});

module.exports = {
  connectCustomMcpServer,
  disconnectCustomMcpServer,
  getActiveCustomMcpStatus,
  sendRpcToCustomMcpServer
};
