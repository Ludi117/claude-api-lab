/**
 * Module 05: Model Context Protocol (MCP) Architecture Sandbox & Custom Server Inspector
 * Teaches & Inspects:
 * - How MCP uses JSON-RPC 2.0 between an MCP Host/Client (your app) and an MCP Server.
 * - Connect & inspect REAL Custom MCP Servers over `stdio` (e.g. `npx`, `node`, `python`, `uvx`)
 *   or `http` (Streamable HTTP / JSON-RPC URL), or import directly from `claude_desktop_config.json`!
 * - Inspect the 3 core MCP primitives (`tools/*`, `resources/*`, `prompts/*`), server `stderr` logs,
 *   side-by-side schema translation (`inputSchema` -> `input_schema`), and end-to-end Claude tool execution.
 */

import { syntaxHighlightJson } from "../codeGen.js";
import { renderMarkdown, bindMarkdownCopyButtons } from "../markdown.js";

const DEFAULT_CUSTOM_SERVERS = [
  {
    id: "mcp-memory",
    name: "MCP Official Memory Server (npx)",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: {}
  },
  {
    id: "mcp-everything",
    name: "MCP Everything Reference Server (npx)",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    env: {}
  }
];

export function renderMcpConceptGuide() {
  return `
    <div class="space-y-4 text-xs leading-relaxed text-slate-300">
      <div class="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
        <div class="font-semibold text-emerald-400 mb-1">What is Model Context Protocol (MCP)?</div>
        <p class="text-slate-300">
          MCP is an open JSON-RPC 2.0 standard created by Anthropic that acts as a universal "USB-C port" connecting AI applications (<strong>MCP Hosts</strong>) to local or remote data &amp; tool providers (<strong>MCP Servers</strong>).
        </p>
      </div>

      <div class="p-3 rounded-lg bg-sky-500/10 border border-sky-500/30 space-y-1.5">
        <div class="font-semibold text-sky-300">Inspect Custom MCP Servers</div>
        <p class="text-[11px] text-slate-300">
          Switch between the built-in demo server or connect to any real <strong>Stdio</strong> (<code class="font-mono">npx</code>, <code class="font-mono">node</code>, <code class="font-mono">python</code>, <code class="font-mono">uvx</code>) or <strong>HTTP</strong> MCP server! You can even paste your <code class="font-mono">claude_desktop_config.json</code> directly.
        </p>
      </div>

      <div class="space-y-2">
        <h4 class="font-semibold text-white uppercase tracking-wider text-[11px]">The 3 Core MCP Primitives</h4>
        <div class="space-y-1.5 text-[11px]">
          <div class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="text-amber-400 font-semibold">1. Tools (Model-Controlled)</span>
            <p class="text-slate-400 mt-0.5">Discovered via <code class="font-mono">tools/list</code> and mapped to Claude's <code class="font-mono">tools</code> parameter. Executed via <code class="font-mono">tools/call</code>.</p>
          </div>
          <div class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="text-sky-400 font-semibold">2. Resources (App-Controlled)</span>
            <p class="text-slate-400 mt-0.5">Read-only URIs fetched via <code class="font-mono">resources/read</code> and injected into <code class="font-mono">messages</code>.</p>
          </div>
          <div class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="text-purple-400 font-semibold">3. Prompts (User-Controlled)</span>
            <p class="text-slate-400 mt-0.5">Reusable prompt templates hydrated via <code class="font-mono">prompts/get</code>.</p>
          </div>
        </div>
      </div>

      <div class="p-2.5 rounded bg-claude-card border border-claude-border text-[11px] text-slate-400">
        <strong class="text-emerald-300">Key Schema Bridge:</strong> MCP uses camelCase <code class="font-mono text-white">inputSchema</code>, whereas the Claude Messages API expects snake_case <code class="font-mono text-white">input_schema</code>!
      </div>
    </div>
  `;
}

function buildSampleArgsFromSchema(schema) {
  if (!schema || typeof schema !== "object") return {};
  const props = schema.properties || {};
  const out = {};
  for (const [key, prop] of Object.entries(props)) {
    if (prop.default !== undefined) {
      out[key] = prop.default;
    } else if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      out[key] = prop.enum[0];
    } else if (prop.type === "number" || prop.type === "integer") {
      out[key] = 1;
    } else if (prop.type === "boolean") {
      out[key] = true;
    } else if (prop.type === "array") {
      out[key] = [];
    } else if (prop.type === "object") {
      out[key] = {};
    } else {
      out[key] = `sample_${key}`;
    }
  }
  return out;
}

export function initMcpLab(container, appState) {
  let savedServers = loadSavedServers();
  let selectedServerId = "builtin"; // "builtin" or custom server id
  let showAddModal = false;
  let addMode = "form"; // "form" | "json"
  let connecting = false;
  let customStatus = { connected: false, stderrLogs: [] };

  let activeRpcMethod = "initialize";
  let customRpcText = "";
  let rpcParseError = null;
  let lastRpcExchange = null;

  let discoveredTools = [];
  let discoveredResources = [];
  let discoveredPrompts = [];
  let selectedToolIdx = 0;

  let e2ePrompt = "Please triage production service 'auth-service' experiencing high P99 latency.";
  let endToEndResult = null;

  function loadSavedServers() {
    try {
      const raw = localStorage.getItem("CLAUDE_EXPLORER_MCP_SERVERS");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return structuredClone(DEFAULT_CUSTOM_SERVERS);
  }

  function persistSavedServers() {
    try {
      localStorage.setItem("CLAUDE_EXPLORER_MCP_SERVERS", JSON.stringify(savedServers));
    } catch {
      // ignore
    }
  }

  function isBuiltin() {
    return selectedServerId === "builtin";
  }

  function getSelectedCustomConfig() {
    return savedServers.find((s) => s.id === selectedServerId) || savedServers[0] || null;
  }

  function getDefaultRpcPresets() {
    const firstTool = discoveredTools[selectedToolIdx] || discoveredTools[0];
    const defaultCallParams = isBuiltin()
      ? { name: "get_service_health", arguments: { service_name: "auth-service" } }
      : firstTool
      ? { name: firstTool.name, arguments: buildSampleArgsFromSchema(firstTool.inputSchema) }
      : { name: "example_tool", arguments: {} };

    const firstResource = discoveredResources[0];
    const defaultReadParams = isBuiltin()
      ? { uri: "runbook://sre/redis-cluster-failover" }
      : firstResource
      ? { uri: firstResource.uri }
      : { uri: "file:///example" };

    const firstPrompt = discoveredPrompts[0];
    const defaultPromptParams = isBuiltin()
      ? {
          name: "incident-triage",
          arguments: { service_name: "auth-service", symptom: "P99 Latency Spike (412ms)" }
        }
      : firstPrompt
      ? { name: firstPrompt.name, arguments: {} }
      : { name: "example-prompt", arguments: {} };

    return {
      initialize: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "claude-workbench-host", version: "2.0.0" }
        }
      },
      "tools/list": {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      },
      "tools/call": {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: defaultCallParams
      },
      "resources/list": {
        jsonrpc: "2.0",
        id: 4,
        method: "resources/list",
        params: {}
      },
      "resources/read": {
        jsonrpc: "2.0",
        id: 5,
        method: "resources/read",
        params: defaultReadParams
      },
      "prompts/list": {
        jsonrpc: "2.0",
        id: 6,
        method: "prompts/list",
        params: {}
      },
      "prompts/get": {
        jsonrpc: "2.0",
        id: 7,
        method: "prompts/get",
        params: defaultPromptParams
      }
    };
  }

  function syncDraft() {
    const claudeTools =
      lastRpcExchange?.claudeBridgeTools ||
      discoveredTools.map((t) => ({
        name: t.name,
        description: t.description || "",
        input_schema: t.inputSchema || { type: "object", properties: {} }
      }));

    appState.updateDraftPayload({
      model: appState.getModel(),
      max_tokens: 1024,
      tools: claudeTools,
      messages: [
        {
          role: "user",
          content: e2ePrompt
        }
      ]
    });
  }

  async function sendRpcPayload(rpcObj) {
    const target = isBuiltin() ? "builtin" : "custom";
    const res = await fetch("/api/mcp/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        _mcpTarget: target,
        rpcRequest: rpcObj
      })
    });
    const data = await res.json();
    lastRpcExchange = data;
    if (data.status) {
      customStatus = data.status;
    }

    // Update discovered lists if applicable
    const result = data.rpcResponse?.result;
    if (Array.isArray(result?.tools)) {
      discoveredTools = result.tools;
      if (selectedToolIdx >= discoveredTools.length) selectedToolIdx = 0;
    }
    if (Array.isArray(result?.resources)) {
      discoveredResources = result.resources;
    }
    if (Array.isArray(result?.prompts)) {
      discoveredPrompts = result.prompts;
    }

    syncDraft();
    render();
    return data;
  }

  async function selectPresetMethod(methodKey) {
    activeRpcMethod = methodKey;
    const presets = getDefaultRpcPresets();
    const payload = presets[methodKey] || presets.initialize;
    customRpcText = JSON.stringify(payload, null, 2);
    rpcParseError = null;
    await sendRpcPayload(payload);
  }

  async function connectSelectedCustomServer() {
    const cfg = getSelectedCustomConfig();
    if (!cfg) return;
    connecting = true;
    render();

    try {
      const res = await fetch("/api/mcp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        customStatus = {
          connected: false,
          stderrLogs: data.stderrLogs || []
        };
        appState.showToast?.(data.error || "Failed to connect to custom MCP server", "error");
      } else {
        customStatus = data.status || { connected: true, stderrLogs: [] };
        lastRpcExchange = {
          target: "custom",
          rpcRequest: data.initRequest,
          rpcResponse: data.initResponse,
          claudeBridgeTools: customStatus.claudeBridgeTools || []
        };
        appState.showToast?.(`Connected to ${customStatus.serverInfo?.name || cfg.name}!`, "success");
        // Automatically fetch tools/list so the user immediately sees the custom server's tools
        await selectPresetMethod("tools/list");
        if (discoveredTools.length > 0) {
          e2ePrompt = `Use the ${discoveredTools[0].name} tool to help answer my request.`;
        }
      }
    } catch (err) {
      appState.showToast?.(err.message || "Error connecting to MCP server", "error");
    } finally {
      connecting = false;
      syncDraft();
      render();
    }
  }

  async function disconnectCustomServer() {
    await fetch("/api/mcp/disconnect", { method: "POST" });
    customStatus = { connected: false, stderrLogs: [] };
    discoveredTools = [];
    discoveredResources = [];
    discoveredPrompts = [];
    appState.showToast?.("Disconnected custom MCP server.");
    render();
  }

  function render() {
    const customCfg = getSelectedCustomConfig();
    const activeTool = discoveredTools[selectedToolIdx] || discoveredTools[0] || null;
    const claudeTranslatedTool = activeTool
      ? {
          name: activeTool.name,
          description: activeTool.description || "",
          input_schema: activeTool.inputSchema || { type: "object", properties: {} }
        }
      : null;

    container.innerHTML = `
      <!-- Header -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-white">05. MCP Protocol Sandbox &amp; Custom Server Inspector</h2>
          <p class="text-xs text-slate-400">Inspect the built-in <code class="text-emerald-300 font-mono">acme-engineering-mcp-server</code> or connect your own <strong>Stdio</strong> / <strong>HTTP</strong> MCP server to test JSON-RPC 2.0 &amp; Claude tool bridging.</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="toggle-add-mcp-btn" class="px-3 py-1.5 rounded-lg bg-claude-card hover:bg-slate-800 border border-claude-border text-xs font-medium text-emerald-300 transition">
            + Add / Import Custom MCP Server
          </button>
        </div>
      </div>

      <!-- Custom Server Manager & Connection Bar -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2 flex-1">
            <label for="mcp-server-select" class="text-xs font-semibold text-slate-300">Active MCP Server:</label>
            <select id="mcp-server-select" class="bg-claude-bg border border-claude-border rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400 min-w-[280px]">
              <option value="builtin" ${isBuiltin() ? "selected" : ""}>[Built-in] acme-engineering-mcp-server (Demo)</option>
              ${savedServers
                .map(
                  (s) =>
                    `<option value="${escapeHtml(s.id)}" ${selectedServerId === s.id ? "selected" : ""}>[${s.transport.toUpperCase()}] ${escapeHtml(s.name)}</option>`
                )
                .join("")}
            </select>

            ${
              !isBuiltin() && customCfg
                ? `
              <button id="connect-mcp-btn" class="px-3 py-1.5 rounded-lg ${
                customStatus.connected
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold"
              } text-xs transition" ${connecting ? "disabled" : ""}>
                ${connecting ? "Connecting..." : customStatus.connected ? "&#8635; Reconnect &amp; Handshake" : "&#9889; Connect &amp; Initialize"}
              </button>
              ${
                customStatus.connected
                  ? `<button id="disconnect-mcp-btn" class="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-xs transition">Disconnect</button>`
                  : ""
              }
              <button id="delete-custom-mcp-btn" class="px-2.5 py-1.5 rounded-lg bg-claude-bg hover:bg-slate-800 border border-claude-border text-slate-400 hover:text-rose-300 text-xs transition" title="Remove this custom server">Delete</button>
            `
                : ""
            }
          </div>

          <div class="flex items-center gap-2 text-[11px] font-mono">
            ${
              isBuiltin()
                ? `<span class="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">&#9679; Connected (In-Memory Demo &bull; v1.2.0)</span>`
                : customStatus.connected
                ? `<span class="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">&#9679; Connected: ${escapeHtml(
                    customStatus.serverInfo?.name || customCfg?.name || "Custom"
                  )} (${escapeHtml(customStatus.serverInfo?.version || "v1")})${customStatus.pid ? ` &bull; PID ${customStatus.pid}` : ""}</span>`
                : `<span class="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">&#9675; Disconnected (Click Connect &amp; Initialize)</span>`
            }
          </div>
        </div>

        ${
          !isBuiltin() && customCfg
            ? `
          <div class="p-2.5 rounded-lg bg-claude-bg border border-claude-border flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-300">
            <div>
              <span class="text-slate-400">${customCfg.transport === "http" ? "Endpoint URL:" : "Stdio Command:"}</span>
              <code class="text-emerald-300 ml-1">${
                customCfg.transport === "http"
                  ? escapeHtml(customCfg.url)
                  : `${escapeHtml(customCfg.command)} ${escapeHtml((customCfg.args || []).join(" "))}`
              }</code>
            </div>
            ${
              customStatus.capabilities
                ? `<div class="text-slate-400">Capabilities: <span class="text-sky-300">${escapeHtml(
                    Object.keys(customStatus.capabilities).join(", ") || "none"
                  )}</span></div>`
                : ""
            }
          </div>
        `
            : ""
        }

        ${
          !isBuiltin() && Array.isArray(customStatus.stderrLogs) && customStatus.stderrLogs.length > 0
            ? `
          <details class="text-xs bg-claude-bg border border-claude-border rounded-lg p-2.5">
            <summary class="cursor-pointer font-mono text-[11px] text-slate-300 flex items-center justify-between">
              <span>Server Process &amp; Stderr Logs (${customStatus.stderrLogs.length} lines)</span>
              <span class="text-slate-500">Click to toggle</span>
            </summary>
            <pre class="mt-2 p-2 rounded bg-claude-panel font-mono text-[11px] text-slate-300 max-h-40 overflow-y-auto whitespace-pre-wrap">${customStatus.stderrLogs
              .map((l) => `[${escapeHtml(l.timestamp)}] [${escapeHtml(l.source)}] ${escapeHtml(l.text)}`)
              .join("\n")}</pre>
          </details>
        `
            : ""
        }

        <!-- Add / Import Custom MCP Server Drawer -->
        ${
          showAddModal
            ? `
          <div class="p-4 rounded-xl bg-claude-bg border border-emerald-500/40 space-y-3 mt-2">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold text-emerald-300">Add or Import Custom MCP Server</div>
              <div class="flex items-center gap-1 text-[11px]">
                <button data-add-mode="form" class="px-2.5 py-1 rounded ${
                  addMode === "form" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "text-slate-400"
                }">Form Builder</button>
                <button data-add-mode="json" class="px-2.5 py-1 rounded ${
                  addMode === "json" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "text-slate-400"
                }">Paste claude_desktop_config.json</button>
              </div>
            </div>

            ${
              addMode === "form"
                ? `
              <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                <div>
                  <label class="block text-[11px] text-slate-400 mb-1">Server Display Name</label>
                  <input id="mcp-new-name" type="text" placeholder="My Custom MCP Server" class="w-full bg-claude-panel border border-claude-border rounded px-2.5 py-1.5 text-white font-mono text-xs" />
                </div>
                <div>
                  <label class="block text-[11px] text-slate-400 mb-1">Transport Type</label>
                  <select id="mcp-new-transport" class="w-full bg-claude-panel border border-claude-border rounded px-2.5 py-1.5 text-white font-mono text-xs">
                    <option value="stdio">stdio (Local Command: npx, node, python, uvx)</option>
                    <option value="http">http (Streamable HTTP / JSON-RPC URL)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] text-slate-400 mb-1">Command (stdio) or Endpoint URL (http)</label>
                  <input id="mcp-new-target" type="text" placeholder="npx   or   http://localhost:8080/mcp" class="w-full bg-claude-panel border border-claude-border rounded px-2.5 py-1.5 text-white font-mono text-xs" />
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label class="block text-[11px] text-slate-400 mb-1">Arguments (space or comma separated, for stdio)</label>
                  <input id="mcp-new-args" type="text" placeholder="-y @modelcontextprotocol/server-memory" class="w-full bg-claude-panel border border-claude-border rounded px-2.5 py-1.5 text-white font-mono text-xs" />
                </div>
                <div>
                  <label class="block text-[11px] text-slate-400 mb-1">Env Vars / HTTP Headers (optional JSON object)</label>
                  <input id="mcp-new-env" type="text" placeholder='{"API_KEY": "..."}' class="w-full bg-claude-panel border border-claude-border rounded px-2.5 py-1.5 text-white font-mono text-xs" />
                </div>
              </div>
            `
                : `
              <div class="space-y-1.5 text-xs">
                <label class="block text-[11px] text-slate-400">Paste a <code class="font-mono text-emerald-300">claude_desktop_config.json</code> or <code class="font-mono text-emerald-300">mcpServers</code> JSON snippet:</label>
                <textarea id="mcp-import-json" rows="6" spellcheck="false" class="w-full bg-claude-panel border border-claude-border rounded-lg p-2.5 font-mono text-xs text-slate-100" placeholder='{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}'></textarea>
              </div>
            `
            }

            <div class="flex items-center justify-end gap-2 pt-1">
              <button id="cancel-add-mcp-btn" class="px-3 py-1.5 rounded-lg border border-claude-border text-xs text-slate-300 hover:bg-slate-800">Cancel</button>
              <button id="save-add-mcp-btn" class="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs">Save &amp; Select Server</button>
            </div>
          </div>
        `
            : ""
        }
      </div>

      <!-- 1. Interactive MCP JSON-RPC 2.0 Wire Inspector & Request Composer -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-semibold uppercase tracking-wider text-slate-300">1. Interactive MCP JSON-RPC 2.0 Wire Inspector</span>
          <span class="text-[11px] font-mono text-emerald-400">
            Target: ${isBuiltin() ? "acme-engineering-mcp-server (Built-in)" : escapeHtml(customCfg?.name || "Custom Server")}
            ${lastRpcExchange?.latencyMs !== undefined ? ` &bull; ${lastRpcExchange.latencyMs}ms` : ""}
          </span>
        </div>

        <!-- Preset Method Buttons -->
        <div class="flex flex-wrap gap-1.5">
          ${Object.keys(getDefaultRpcPresets())
            .map(
              (m) => `
            <button data-rpc="${m}" class="rpc-method-btn px-3 py-1.5 rounded-lg font-mono text-xs border transition ${
                activeRpcMethod === m
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50 font-semibold"
                  : "bg-claude-bg text-slate-300 border-claude-border hover:bg-slate-800"
              }">
              ${m}
            </button>
          `
            )
            .join("")}
        </div>

        <!-- Editable JSON-RPC Request & Live Response -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-mono text-sky-400">MCP Client &rarr; MCP Server (Editable JSON-RPC Request)</span>
              <button id="send-custom-rpc-btn" class="px-2.5 py-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-sans font-semibold text-[11px] transition">
                Send JSON-RPC &rarr;
              </button>
            </div>
            <textarea id="mcp-rpc-editor" rows="9" spellcheck="false" class="w-full p-3 rounded-lg bg-claude-bg border ${
              rpcParseError ? "border-rose-500/60" : "border-claude-border"
            } font-mono text-xs text-slate-100 focus:outline-none focus:border-sky-400">${escapeHtml(
              customRpcText || JSON.stringify(lastRpcExchange?.rpcRequest || getDefaultRpcPresets().initialize, null, 2)
            )}</textarea>
            ${rpcParseError ? `<div class="text-[11px] text-rose-300 font-mono">${escapeHtml(rpcParseError)}</div>` : ""}
          </div>

          <div class="space-y-1.5">
            <div class="text-[11px] font-mono text-emerald-400">MCP Server &rarr; MCP Client (JSON-RPC 2.0 Response)</div>
            <pre class="p-3 rounded-lg bg-claude-bg border border-claude-border font-mono text-xs overflow-x-auto max-h-60 min-h-[196px]">${
              lastRpcExchange
                ? syntaxHighlightJson(lastRpcExchange.rpcResponse)
                : `<span class="text-slate-500">Click any JSON-RPC method above or click "Send JSON-RPC" to inspect the response.</span>`
            }</pre>
          </div>
        </div>
      </div>

      <!-- 2. Discovered Server Tools & Schema Translation Bridge -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">2. Discovered MCP Tools &amp; Claude API Schema Bridge (${discoveredTools.length} tools)</h3>
            <p class="text-[11px] text-slate-400">Click any discovered tool below to inspect how your MCP Host translates <code class="font-mono text-amber-300">inputSchema</code> &rarr; <code class="font-mono text-sky-300">input_schema</code> or populate <code class="font-mono">tools/call</code>.</p>
          </div>
          ${
            activeTool
              ? `<button id="test-selected-tool-btn" class="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-mono transition">
                  Test tools/call("${escapeHtml(activeTool.name)}") &rarr;
                </button>`
              : ""
          }
        </div>

        ${
          discoveredTools.length > 0
            ? `
          <div class="flex flex-wrap gap-1.5">
            ${discoveredTools
              .map(
                (t, idx) => `
              <button data-tool-idx="${idx}" class="px-2.5 py-1 rounded-lg font-mono text-xs border transition ${
                  idx === selectedToolIdx
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/50 font-semibold"
                    : "bg-claude-bg text-slate-300 border-claude-border hover:bg-slate-800"
                }">
                ${escapeHtml(t.name)}
              </button>
            `
              )
              .join("")}
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div class="p-3 rounded-lg bg-claude-bg border border-amber-500/30 space-y-1">
              <div class="text-[11px] font-mono text-amber-300 font-semibold">MCP Server Tool Definition (from tools/list)</div>
              <pre class="font-mono text-[11px] text-slate-300 overflow-x-auto max-h-56">${syntaxHighlightJson(activeTool)}</pre>
            </div>

            <div class="p-3 rounded-lg bg-claude-bg border border-sky-500/30 space-y-1">
              <div class="text-[11px] font-mono text-sky-300 font-semibold">Translated Anthropic Claude Tool (POST /v1/messages)</div>
              <pre class="font-mono text-[11px] text-slate-300 overflow-x-auto max-h-56">${syntaxHighlightJson(claudeTranslatedTool)}</pre>
            </div>
          </div>
        `
            : `<div class="p-4 rounded-lg bg-claude-bg border border-claude-border text-xs text-slate-400">No tools loaded yet. Click <code class="font-mono text-emerald-300">tools/list</code> above (or connect your custom MCP server) to inspect its tools.</div>`
        }
      </div>

      <!-- 3. End-to-End MCP Host <-> Claude API <-> MCP Server Execution -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">3. End-to-End Claude + MCP Server Execution Loop</h3>
            <p class="text-[11px] text-slate-400">Send a prompt to Claude with the active MCP server's bridged tools. When Claude emits <code class="font-mono">tool_use</code>, the workbench executes <code class="font-mono">tools/call</code> on the MCP server and returns the result to Claude.</p>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row gap-2">
          <input id="mcp-e2e-prompt-input" type="text" value="${escapeHtml(e2ePrompt)}" class="flex-1 bg-claude-bg border border-claude-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-400" placeholder="Ask Claude a question that uses the active MCP server's tools..." />
          <button id="run-mcp-e2e-btn" class="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition shadow-lg shadow-emerald-950/50 shrink-0">
            &#9889; Run End-to-End MCP + Claude Flow
          </button>
        </div>

        ${
          endToEndResult
            ? `
          <div class="space-y-2.5 text-xs pt-2 border-t border-claude-border">
            <div class="p-2.5 rounded bg-claude-bg border border-claude-border">
              <span class="font-mono text-amber-300 font-semibold">Step A (Claude Decision):</span> Claude inspected ${
                endToEndResult.toolsCount
              } bridged MCP tool(s) and returned <code class="font-mono">stop_reason: "tool_use"</code> for <code class="font-mono text-white">${escapeHtml(
                endToEndResult.toolUse.name
              )}(${escapeHtml(JSON.stringify(endToEndResult.toolUse.input))})</code>.
            </div>
            <div class="p-2.5 rounded bg-claude-bg border border-claude-border">
              <span class="font-mono text-emerald-300 font-semibold">Step B (MCP Server JSON-RPC tools/call):</span> Host executed <code class="font-mono">tools/call</code> on <strong>${escapeHtml(
                endToEndResult.serverLabel
              )}</strong> and received:
              <pre class="mt-1.5 p-2 rounded bg-claude-panel font-mono text-[11px] text-emerald-200 overflow-x-auto max-h-48">${escapeHtml(
                endToEndResult.mcpOutputText
              )}</pre>
            </div>
            <div class="p-2.5 rounded bg-claude-bg border border-claude-border">
              <span class="font-mono text-sky-300 font-semibold">Step C (Claude Final Response):</span>
              <div class="md-body mt-1 text-[13px] text-slate-100 leading-relaxed">${renderMarkdown(endToEndResult.finalText)}</div>
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;

    bindEvents();
    bindMarkdownCopyButtons(container);
  }

  function bindEvents() {
    // Toggle Add Server Drawer
    container.querySelector("#toggle-add-mcp-btn")?.addEventListener("click", () => {
      showAddModal = !showAddModal;
      render();
    });

    container.querySelector("#cancel-add-mcp-btn")?.addEventListener("click", () => {
      showAddModal = false;
      render();
    });

    container.querySelectorAll("[data-add-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        addMode = btn.dataset.addMode;
        render();
      });
    });

    // Save / Import Custom Server
    container.querySelector("#save-add-mcp-btn")?.addEventListener("click", () => {
      if (addMode === "json") {
        const rawText = container.querySelector("#mcp-import-json")?.value || "";
        try {
          const parsed = JSON.parse(rawText);
          const serversMap = parsed.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : parsed;
          let addedCount = 0;
          let lastAddedId = null;

          for (const [key, cfg] of Object.entries(serversMap)) {
            if (!cfg || typeof cfg !== "object") continue;
            const id = `custom-${key.toLowerCase().replace(/[^a-z0-9-_]/g, "-")}-${Date.now().toString().slice(-3)}`;
            if (cfg.url) {
              savedServers.push({
                id,
                name: key,
                transport: "http",
                url: String(cfg.url),
                headers: cfg.headers || {}
              });
              lastAddedId = id;
              addedCount++;
            } else if (cfg.command) {
              savedServers.push({
                id,
                name: key,
                transport: "stdio",
                command: String(cfg.command),
                args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
                env: cfg.env || {}
              });
              lastAddedId = id;
              addedCount++;
            }
          }

          if (addedCount === 0) {
            appState.showToast?.('Could not find any server with "command" or "url" in the JSON.', "error");
            return;
          }

          persistSavedServers();
          selectedServerId = lastAddedId;
          showAddModal = false;
          appState.showToast?.(`Imported ${addedCount} custom MCP server(s)!`, "success");
          connectSelectedCustomServer();
        } catch (err) {
          appState.showToast?.(`Invalid JSON: ${err.message}`, "error");
        }
        return;
      }

      // Form mode
      const name = container.querySelector("#mcp-new-name")?.value.trim() || "Custom MCP Server";
      const transport = container.querySelector("#mcp-new-transport")?.value || "stdio";
      const target = container.querySelector("#mcp-new-target")?.value.trim() || "";
      const argsRaw = container.querySelector("#mcp-new-args")?.value.trim() || "";
      const envRaw = container.querySelector("#mcp-new-env")?.value.trim() || "";

      if (!target) {
        appState.showToast?.(transport === "http" ? "Please enter an HTTP endpoint URL." : "Please enter a command (e.g. npx, node, python).", "error");
        return;
      }

      let envOrHeaders = {};
      if (envRaw) {
        try {
          envOrHeaders = JSON.parse(envRaw);
        } catch {
          appState.showToast?.("Env / Headers must be valid JSON (e.g. {\"KEY\": \"VAL\"}).", "error");
          return;
        }
      }

      const args = argsRaw
        ? argsRaw.includes(",")
          ? argsRaw.split(",").map((s) => s.trim()).filter(Boolean)
          : argsRaw.split(/\s+/).filter(Boolean)
        : [];

      const id = `custom-${Date.now()}`;
      const newEntry =
        transport === "http"
          ? { id, name, transport: "http", url: target, headers: envOrHeaders }
          : { id, name, transport: "stdio", command: target, args, env: envOrHeaders };

      savedServers.push(newEntry);
      persistSavedServers();
      selectedServerId = id;
      showAddModal = false;
      appState.showToast?.(`Added "${name}"`, "success");
      connectSelectedCustomServer();
    });

    // Server Dropdown Select
    container.querySelector("#mcp-server-select")?.addEventListener("change", async (e) => {
      selectedServerId = e.target.value;
      endToEndResult = null;
      if (isBuiltin()) {
        e2ePrompt = "Please triage production service 'auth-service' experiencing high P99 latency.";
        await selectPresetMethod("tools/list");
        await selectPresetMethod("initialize");
      } else {
        discoveredTools = [];
        discoveredResources = [];
        discoveredPrompts = [];
        render();
      }
    });

    container.querySelector("#connect-mcp-btn")?.addEventListener("click", connectSelectedCustomServer);
    container.querySelector("#disconnect-mcp-btn")?.addEventListener("click", disconnectCustomServer);

    container.querySelector("#delete-custom-mcp-btn")?.addEventListener("click", async () => {
      const cfg = getSelectedCustomConfig();
      if (!cfg) return;
      if (customStatus.connected) {
        await disconnectCustomServer();
      }
      savedServers = savedServers.filter((s) => s.id !== cfg.id);
      persistSavedServers();
      selectedServerId = "builtin";
      await selectPresetMethod("tools/list");
      await selectPresetMethod("initialize");
    });

    // Preset JSON-RPC Method Buttons
    container.querySelectorAll(".rpc-method-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectPresetMethod(btn.dataset.rpc);
      });
    });

    // Editable JSON-RPC Request Textarea & Send Button
    const rpcEditor = container.querySelector("#mcp-rpc-editor");
    rpcEditor?.addEventListener("input", () => {
      customRpcText = rpcEditor.value;
    });

    container.querySelector("#send-custom-rpc-btn")?.addEventListener("click", async () => {
      try {
        const parsed = JSON.parse(customRpcText || rpcEditor.value);
        rpcParseError = null;
        activeRpcMethod = parsed.method || activeRpcMethod;
        await sendRpcPayload(parsed);
      } catch (err) {
        rpcParseError = `Invalid JSON-RPC payload: ${err.message}`;
        render();
      }
    });

    // Tool selector pills & "Test tools/call" button
    container.querySelectorAll("[data-tool-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedToolIdx = Number(btn.dataset.toolIdx) || 0;
        render();
      });
    });

    container.querySelector("#test-selected-tool-btn")?.addEventListener("click", async () => {
      const tool = discoveredTools[selectedToolIdx] || discoveredTools[0];
      if (!tool) return;
      activeRpcMethod = "tools/call";
      const callPayload = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: tool.name,
          arguments:
            isBuiltin() && tool.name === "get_service_health"
              ? { service_name: "auth-service" }
              : buildSampleArgsFromSchema(tool.inputSchema)
        }
      };
      customRpcText = JSON.stringify(callPayload, null, 2);
      await sendRpcPayload(callPayload);
    });

    // End-to-End Prompt Input & Runner
    container.querySelector("#mcp-e2e-prompt-input")?.addEventListener("input", (e) => {
      e2ePrompt = e.target.value;
      syncDraft();
    });

    const e2eBtn = container.querySelector("#run-mcp-e2e-btn");
    e2eBtn?.addEventListener("click", async () => {
      if (!isBuiltin() && !customStatus.connected) {
        appState.showToast?.("Connect & initialize your custom MCP server first.", "error");
        return;
      }

      e2eBtn.disabled = true;
      e2eBtn.textContent = "Running MCP + Claude Bridge...";

      const target = isBuiltin() ? "builtin" : "custom";
      // 1. Fetch tools from active MCP server
      const listRes = await fetch("/api/mcp/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _mcpTarget: target,
          rpcRequest: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
        })
      }).then((r) => r.json());

      const rawMcpTools = listRes.rpcResponse?.result?.tools || discoveredTools;
      const claudeTools =
        listRes.claudeBridgeTools ||
        rawMcpTools.map((t) => ({
          name: t.name,
          description: t.description || "",
          input_schema: t.inputSchema || { type: "object", properties: {} }
        }));

      const fallbackTool = rawMcpTools[selectedToolIdx] || rawMcpTools[0] || {
        name: "get_service_health",
        inputSchema: { type: "object", properties: { service_name: { type: "string" } } }
      };

      // 2. Call Claude with bridged MCP tools
      const step1 = await appState.executeMessagesRequest({
        model: appState.getModel(),
        max_tokens: 1024,
        tools: claudeTools,
        messages: [{ role: "user", content: e2ePrompt }]
      });

      const toolUse = (step1.response?.content || []).find((b) => b.type === "tool_use") || {
        id: "toolu_mcp_01",
        name: fallbackTool.name,
        input: buildSampleArgsFromSchema(fallbackTool.inputSchema)
      };

      // 3. Forward tool call to active MCP Server via JSON-RPC `tools/call`
      const mcpCallRes = await fetch("/api/mcp/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _mcpTarget: target,
          rpcRequest: {
            jsonrpc: "2.0",
            id: 99,
            method: "tools/call",
            params: {
              name: toolUse.name,
              arguments: toolUse.input
            }
          }
        })
      }).then((r) => r.json());

      const mcpOutputText =
        mcpCallRes.rpcResponse?.result?.content?.[0]?.text ||
        JSON.stringify(mcpCallRes.rpcResponse?.result || mcpCallRes.rpcResponse, null, 2);

      // 4. Send MCP tool_result back to Claude
      const step2 = await appState.executeMessagesRequest({
        model: appState.getModel(),
        max_tokens: 1024,
        tools: claudeTools,
        messages: [
          { role: "user", content: e2ePrompt },
          { role: "assistant", content: [toolUse] },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: mcpOutputText
              }
            ]
          }
        ]
      });

      const finalText = (step2.response?.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      endToEndResult = {
        toolsCount: claudeTools.length,
        serverLabel: isBuiltin() ? "acme-engineering-mcp-server" : getSelectedCustomConfig()?.name || "Custom MCP Server",
        toolUse,
        mcpOutputText,
        finalText
      };

      render();
    });
  }

  // Initial load: populate built-in tools & initialize exchange
  (async () => {
    await selectPresetMethod("tools/list");
    await selectPresetMethod("initialize");
  })();

  return { onShow: syncDraft, onModelChange: syncDraft };
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
