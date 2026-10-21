/**
 * Main Application Controller v2.0 (`public/js/app.js`)
 * Coordinates:
 * - 8 Interactive API Learning Modules (Messages, SSE Streaming, Tool Use, Extended Thinking & Cache, MCP Sandbox & Custom Server Inspector, Server Tools & Cache Diagnostics, Free-form Playground, Model Comparison)
 * - Execution Mode (Simulator vs Live Anthropic API)
 * - Right-hand "Under the Hood" Inspector with Interactive Hover Parameter Tooltips & Collapsible JSON Nodes
 * - Desktop UI Features: Frameless Window Controls, Draggable Resizable Split Panes, Ctrl+K Command Palette, and 3 Themes
 */

import { generateSdkCode } from "./codeGen.js";
import { setModelCatalog, getModelCatalog, getModelInfo, estimateCost } from "./pricing.js";
import { renderInteractiveJsonTree, bindInteractiveJsonEvents, PARAMETER_TOOLTIPS } from "./jsonTooltips.js";
import { initMessagesLab, renderMessagesConceptGuide } from "./modules/messagesLab.js";
import { initStreamingLab, renderStreamingConceptGuide } from "./modules/streamingLab.js";
import { initToolUseLab, renderToolUseConceptGuide } from "./modules/toolUseLab.js";
import { initThinkingCacheLab, renderThinkingCacheConceptGuide } from "./modules/thinkingCache.js";
import { initMcpLab, renderMcpConceptGuide } from "./modules/mcpLab.js";
import { initServerToolsDiagLab, renderServerToolsDiagConceptGuide } from "./modules/serverToolsDiagLab.js";
import { initPlaygroundLab, renderPlaygroundConceptGuide } from "./modules/playgroundLab.js";
import { initCompareLab, renderCompareConceptGuide } from "./modules/compareLab.js";

/**
 * Settings persistence: the desktop app stores settings via Electron (they survive restarts even though the
 * embedded server's port changes each launch); the browser version falls back to localStorage.
 */
const settingsStore = window.electronAPI?.settings ?? {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null || value === "") localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // storage unavailable; setting just won't persist
    }
  }
};

/**
 * Larger persisted documents (prompt templates). The desktop app writes them to JSON files
 * in its user-data folder; the browser version uses localStorage.
 */
const dataStore = window.electronAPI?.dataStore ?? {
  read(name) {
    try {
      return JSON.parse(localStorage.getItem(`CLAUDE_EXPLORER_STORE_${name}`) || "null");
    } catch {
      return null;
    }
  },
  write(name, value) {
    try {
      localStorage.setItem(`CLAUDE_EXPLORER_STORE_${name}`, JSON.stringify(value));
    } catch {
      if (Array.isArray(value) && value.length > 1) this.write(name, value.slice(Math.ceil(value.length / 2)));
    }
  }
};

const state = {
  activeModule: "messages",
  mode: "simulation", // "simulation" | "live"
  model: "claude-sonnet-5-5",
  theme: settingsStore.get("CLAUDE_EXPLORER_THEME") || "midnight",
  customApiKey: settingsStore.get("CLAUDE_EXPLORER_API_KEY") || "",
  hasEnvApiKey: false,
  sampleTools: [],
  mcpMetadata: null,
  draftPayload: {},
  lastResponse: null,
  lastLatencyMs: null,
  templates: (() => {
    const stored = dataStore.read("templates");
    return Array.isArray(stored) ? stored.filter((t) => t && t.name && t.payload) : [];
  })(),
  sessionSpend: { usd: 0, requests: 0, inputTokens: 0, outputTokens: 0 },
  activeInspectorTab: "request", // "request" | "response" | "tokens" | "code"
  activeCodeLang: "python" // "python" | "typescript" | "curl"
};

const MODULE_CATALOG = [
  { id: "messages", title: "01. Messages & Structured JSON", desc: "Roles, Effort levels, JSON Schema, Deprecation Guardrails" },
  { id: "streaming", title: "02. SSE Streaming Inspector", desc: "Real-time Server-Sent Events & Delta Accumulator" },
  { id: "tools", title: "03. Tool Use & Agentic Loop", desc: "Client tool_use -> tool_result state machine" },
  { id: "thinking", title: "04. Thinking & Prompt Caching", desc: "Adaptive/Manual Thinking, Cache TTLs & 0-Token Prewarm" },
  { id: "mcp", title: "05. MCP Protocol Sandbox", desc: "Custom Stdio/HTTP MCP Servers, JSON-RPC 2.0 & Claude Bridge" },
  { id: "servertools", title: "06. Server Tools & Diagnostics", desc: "Managed web_search, code_execution & cache_miss_reason" },
  { id: "playground", title: "07. Free-form Playground", desc: "Raw JSON request editor, token counting, templates" },
  { id: "compare", title: "08. Model Comparison", desc: "Same prompt on 2-3 models: latency, tokens, cost, output" }
];

const appStateInterface = {
  getModel: () => state.model,
  getModelInfo: (modelId = state.model) => getModelInfo(modelId),
  getMode: () => state.mode,
  getSampleTools: () => state.sampleTools,
  getDraftPayload: () => state.draftPayload,
  showToast: (message, kind) => showToast(message, kind),

  // Prompt templates: named request payloads, persisted across restarts
  getTemplates: () => state.templates,
  saveTemplate(name, payload) {
    const cleanName = String(name || "").trim().slice(0, 80);
    if (!cleanName) return false;
    const clean = { ...payload };
    delete clean._sim_cache_mode;
    delete clean._stream_delay_ms;
    state.templates = state.templates.filter((t) => t.name !== cleanName);
    state.templates.push({ name: cleanName, savedAt: new Date().toISOString(), payload: structuredClone(clean) });
    state.templates.sort((a, b) => a.name.localeCompare(b.name));
    dataStore.write("templates", state.templates);
    return true;
  },
  deleteTemplate(name) {
    state.templates = state.templates.filter((t) => t.name !== name);
    dataStore.write("templates", state.templates);
  },

  // Load any request payload into the Playground lab's JSON editor
  openInPlayground(payload) {
    switchModule("playground");
    mountedLabs.playground?.hooks?.loadPayload?.(structuredClone(payload));
  },

  async countTokens(payload) {
    const headers = { "Content-Type": "application/json", "x-execution-mode": state.mode };
    if (state.customApiKey) headers["x-custom-api-key"] = state.customApiKey;
    try {
      const res = await fetch("/api/count_tokens", { method: "POST", headers, body: JSON.stringify(payload) });
      return await res.json();
    } catch (err) {
      return { error: true, message: `Could not reach the local server: ${err.message}` };
    }
  },

  updateDraftPayload(payload) {
    state.draftPayload = payload;
    renderInspector();
  },

  setInspectorResponse(resObj, latencyMs = null) {
    state.lastResponse = resObj;
    if (latencyMs !== null) state.lastLatencyMs = latencyMs;
    renderInspector();
  },

  async executeMessagesRequest(payload) {
    const start = performance.now();
    state.draftPayload = payload;
    renderInspector();

    const headers = {
      "Content-Type": "application/json",
      "x-execution-mode": state.mode
    };
    if (state.customApiKey) {
      headers["x-custom-api-key"] = state.customApiKey;
    }

    let data;
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      data = await res.json().catch(() => ({ error: true, status: res.status, message: `HTTP ${res.status} with a non-JSON body` }));
    } catch (err) {
      data = { error: true, status: 0, errorType: "connection_error", message: `Could not reach the local server: ${err.message}` };
    }

    state.lastLatencyMs = data.latencyMs || Math.round(performance.now() - start);
    state.lastResponse = data.response || data;
    if (data.mode === "live" && data.response?.usage) {
      trackSpend(data.response.model || payload.model, data.response.usage);
    }

    if (data.error) {
      showToast(data.message || "Request failed", "error");
    }
    showInspectorTab("response");
    return data;
  },

  /**
   * Streams SSE frames to `onEventCallback`. Pass an AbortSignal to let the user stop the stream;
   * aborting closes the connection, which also cancels the upstream Anthropic request on the server.
   * Resolves to { status: "completed" | "aborted" | "failed", error? } instead of throwing.
   */
  async executeSseStream(payload, onEventCallback, signal = undefined) {
    const start = performance.now();
    state.draftPayload = payload;
    renderInspector();

    const headers = {
      "Content-Type": "application/json",
      "x-execution-mode": state.mode
    };
    if (state.customApiKey) {
      headers["x-custom-api-key"] = state.customApiKey;
    }

    const streamUsage = {};
    let streamModel = payload.model;
    const sniffUsage = (eventName, dataObj) => {
      if (eventName === "message_start") {
        Object.assign(streamUsage, dataObj.message?.usage || {});
        streamModel = dataObj.message?.model || streamModel;
      } else if (eventName === "message_delta" && dataObj.usage) {
        Object.assign(streamUsage, dataObj.usage);
      }
      onEventCallback(eventName, dataObj);
    };

    let outcome = { status: "completed" };
    try {
      await readSseStream(headers, payload, sniffUsage, signal);
    } catch (err) {
      outcome =
        err.name === "AbortError"
          ? { status: "aborted" }
          : { status: "failed", error: err.message || "Stream connection failed" };
    }

    state.lastLatencyMs = Math.round(performance.now() - start);
    if (state.mode === "live" && (streamUsage.input_tokens || streamUsage.output_tokens)) {
      trackSpend(streamModel, streamUsage);
    }
    renderInspector();
    return outcome;
  },

  async executeLocalToolCall(toolCall) {
    const res = await fetch("/api/tools/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toolCall)
    });
    return res.json();
  }
};

async function readSseStream(headers, payload, onEventCallback, signal) {
  const response = await fetch("/api/stream", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} from /api/stream`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const rawFrame of frames) {
      if (!rawFrame.trim()) continue;
      let eventName = "message";
      let dataStr = "";

      for (const line of rawFrame.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataStr += line.slice(5).trim();
        }
      }

      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr);
          onEventCallback(eventName, parsed);
        } catch {
          // ignore malformed chunk
        }
      }
    }
  }
}

function showInspectorTab(tabName) {
  state.activeInspectorTab = tabName;
  document.querySelectorAll(".inspector-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tabName));
  renderInspector();
}

// Small non-blocking notification (bottom-right); kind: "info" | "success" | "error"
function showToast(message, kind = "info") {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.className = "fixed bottom-4 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none";
    document.body.appendChild(host);
  }
  const palette = {
    info: "bg-claude-card border-claude-border text-slate-100",
    success: "bg-emerald-950 border-emerald-500/50 text-emerald-200",
    error: "bg-rose-950 border-rose-500/50 text-rose-200"
  };
  const toast = document.createElement("div");
  toast.className = `toast px-3.5 py-2 rounded-lg border shadow-xl text-xs max-w-sm ${palette[kind] || palette.info}`;
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => toast.classList.add("toast-leave"), kind === "error" ? 5000 : 2200);
  setTimeout(() => toast.remove(), kind === "error" ? 5400 : 2600);
}

// Ctrl+Enter runs the active lab's main action (first visible, enabled button in this list)
const PRIMARY_ACTIONS = {
  messages: ["#send-messages-btn"],
  streaming: ["#start-stream-btn"],
  tools: ["#step3-send-result-btn", "#step1-send-btn"],
  thinking: ["#run-turn1-btn"],
  mcp: ["#run-mcp-e2e-btn"],
  servertools: ["#run-server-tools-btn"],
  playground: ["#pg-send-btn"],
  compare: ["#cmp-run-btn"]
};

const KEYBOARD_SHORTCUTS = [
  ["Ctrl+Enter", "Run the active lab's main action"],
  ["Esc", "Stop a running stream / close dialogs"],
  ["Ctrl+K", "Command palette"],
  ["Ctrl+B", "Toggle left sidebar"],
  ["Ctrl+J", "Toggle inspector"]
];

function bindGlobalShortcuts() {
  window.addEventListener("keydown", (e) => {
    const labEl = document.querySelector(`[data-lab="${state.activeModule}"]`);
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      const button = (PRIMARY_ACTIONS[state.activeModule] || [])
        .map((sel) => labEl?.querySelector(sel))
        .find((btn) => btn && !btn.disabled && btn.offsetParent !== null);
      if (button) {
        e.preventDefault();
        button.click();
      }
    } else if (e.key === "Escape") {
      const stopBtn = labEl?.querySelector("#stop-stream-btn:not(.hidden), #pg-stop-btn:not(.hidden)");
      if (stopBtn) stopBtn.click();
    }
  });
}

// Collapsible concept guide in the left sidebar (state remembered across launches)
function bindConceptGuideToggle() {
  const btn = document.getElementById("toggle-concept-guide-btn");
  const guide = document.getElementById("concept-guide-container");
  if (!btn || !guide) return;
  const apply = (collapsed) => {
    guide.hidden = collapsed;
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.querySelector("[data-chevron]").textContent = collapsed ? "▸" : "▾";
  };
  apply(settingsStore.get("CLAUDE_EXPLORER_GUIDE_COLLAPSED") === "1");
  btn.addEventListener("click", () => {
    const collapsed = !guide.hidden;
    apply(collapsed);
    settingsStore.set("CLAUDE_EXPLORER_GUIDE_COLLAPSED", collapsed ? "1" : null);
  });
}

// Live-mode spend for this app session, shown in the titlebar, with an optional soft limit
function trackSpend(modelId, usage) {
  const spend = state.sessionSpend;
  const limit = Number(settingsStore.get("CLAUDE_EXPLORER_SPEND_LIMIT")) || 0;
  const wasUnderLimit = !limit || spend.usd < limit;
  spend.usd += estimateCost(modelId, usage).total;
  spend.requests += 1;
  spend.inputTokens += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  spend.outputTokens += usage.output_tokens || 0;
  if (limit && wasUnderLimit && spend.usd >= limit) {
    showToast(`Live spend this session passed your $${limit.toFixed(2)} limit.`, "error");
  }
  renderSpendMeter();
}

function renderSpendMeter() {
  const meter = document.getElementById("spend-meter-btn");
  if (!meter) return;
  const { usd, requests, inputTokens, outputTokens } = state.sessionSpend;
  const limit = Number(settingsStore.get("CLAUDE_EXPLORER_SPEND_LIMIT")) || 0;
  const over = limit > 0 && usd >= limit;
  meter.querySelector("[data-spend]").textContent = `$${usd.toFixed(usd < 1 ? 4 : 2)}${limit ? ` / $${limit.toFixed(2)}` : ""}`;
  meter.classList.toggle("text-rose-300", over);
  meter.classList.toggle("border-rose-500/50", over);
  meter.title =
    `Live API spend this session (estimated from list prices): ${requests} request(s), ` +
    `${inputTokens.toLocaleString()} input / ${outputTokens.toLocaleString()} output tokens. Click to set a soft limit or reset.`;
}

function bindSpendMeter() {
  const meter = document.getElementById("spend-meter-btn");
  const popover = document.getElementById("spend-popover");
  const input = document.getElementById("spend-limit-input");
  if (!meter || !popover) return;
  meter.addEventListener("click", () => {
    input.value = settingsStore.get("CLAUDE_EXPLORER_SPEND_LIMIT") || "";
    popover.classList.toggle("hidden");
    if (!popover.classList.contains("hidden")) input.focus();
  });
  document.getElementById("spend-limit-save-btn").addEventListener("click", () => {
    const value = Number(input.value);
    settingsStore.set("CLAUDE_EXPLORER_SPEND_LIMIT", value > 0 ? String(value) : null);
    popover.classList.add("hidden");
    renderSpendMeter();
    showToast(value > 0 ? `Soft limit set to $${value.toFixed(2)}` : "Spend limit removed");
  });
  document.getElementById("spend-reset-btn").addEventListener("click", () => {
    state.sessionSpend = { usd: 0, requests: 0, inputTokens: 0, outputTokens: 0 };
    popover.classList.add("hidden");
    renderSpendMeter();
  });
  renderSpendMeter();
}

async function bootstrap() {
  applyTheme(state.theme);

  try {
    const res = await fetch("/api/status");
    const status = await res.json();
    state.hasEnvApiKey = Boolean(status.hasEnvApiKey);
    state.sampleTools = status.sampleTools || [];
    state.mcpMetadata = status.mcpServer || null;
    setModelCatalog(status.models);
    populateModelSelect();

    if (state.hasEnvApiKey || state.customApiKey) {
      setMode("live");
    } else {
      setMode("simulation");
    }
  } catch (err) {
    console.error("Failed to fetch initial server status:", err);
  }

  bindGlobalControls();
  bindDesktopWindowControls();
  bindResizablePanes();
  bindCommandPalette();
  bindGlobalShortcuts();
  bindConceptGuideToggle();
  bindSpendMeter();
  switchModule("messages");
}

// Rebuild the model dropdown from the server's catalog (src/models.js) so labels and prices stay in sync
function populateModelSelect() {
  const select = document.getElementById("global-model-select");
  const { models } = getModelCatalog();
  if (!select || models.length === 0) return;
  select.innerHTML = models
    .map(
      (m) =>
        `<option value="${escapeHtml(m.id)}" class="bg-claude-panel" title="$${m.pricing.input} / $${m.pricing.output} per 1M input / output tokens">${escapeHtml(m.label)}</option>`
    )
    .join("");
  if (!models.some((m) => m.id === state.model)) state.model = models[0].id;
  select.value = state.model;
}

function applyTheme(themeName) {
  state.theme = themeName;
  document.body.dataset.theme = themeName;
  settingsStore.set("CLAUDE_EXPLORER_THEME", themeName);
  const select = document.getElementById("theme-select");
  if (select && select.value !== themeName) {
    select.value = themeName;
  }
}

function setMode(newMode) {
  if (newMode === "live" && !state.hasEnvApiKey && !state.customApiKey) {
    openApiKeyModal();
    return;
  }

  state.mode = newMode;
  const simBtn = document.getElementById("mode-sim-btn");
  const liveBtn = document.getElementById("mode-live-btn");
  const liveDot = document.getElementById("live-dot");
  const keyLabel = document.getElementById("api-key-status-label");

  if (state.mode === "live") {
    liveBtn.className = "px-2 py-0.5 rounded font-medium transition-all bg-orange-500/20 text-claude-accent border border-orange-500/40 flex items-center gap-1";
    simBtn.className = "px-2 py-0.5 rounded font-medium transition-all text-slate-400 hover:text-slate-200 flex items-center gap-1";
    liveDot.className = "w-1.5 h-1.5 rounded-full bg-claude-accent animate-pulse";
  } else {
    simBtn.className = "px-2 py-0.5 rounded font-medium transition-all bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1";
    liveBtn.className = "px-2 py-0.5 rounded font-medium transition-all text-slate-400 hover:text-slate-200 flex items-center gap-1";
    liveDot.className = "w-1.5 h-1.5 rounded-full bg-slate-500";
  }

  keyLabel.textContent = state.customApiKey
    ? "Key (Custom)"
    : state.hasEnvApiKey
    ? "Key (.env)"
    : "API Key";

  renderInspector();
}

function openApiKeyModal() {
  const modal = document.getElementById("api-key-modal");
  const input = document.getElementById("custom-api-key-input");
  input.value = state.customApiKey;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function closeApiKeyModal() {
  const modal = document.getElementById("api-key-modal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function bindDesktopWindowControls() {
  const controlsContainer = document.getElementById("desktop-window-controls");
  if (!window.electronAPI) {
    if (controlsContainer) controlsContainer.style.display = "none";
    return;
  }

  document.getElementById("win-min-btn")?.addEventListener("click", () => {
    window.electronAPI.minimizeWindow();
  });
  document.getElementById("win-max-btn")?.addEventListener("click", () => {
    window.electronAPI.maximizeWindow();
  });
  document.getElementById("win-close-btn")?.addEventListener("click", () => {
    window.electronAPI.closeWindow();
  });
}

function bindResizablePanes() {
  const leftPane = document.getElementById("left-sidebar-pane");
  const rightPane = document.getElementById("right-inspector-pane");
  const leftResizer = document.getElementById("left-resizer");
  const rightResizer = document.getElementById("right-resizer");
  const toggleLeftBtn = document.getElementById("toggle-left-pane-btn");
  const toggleRightBtn = document.getElementById("toggle-right-pane-btn");

  const toggleLeft = () => {
    const isHidden = leftPane.classList.toggle("hidden");
    leftResizer.classList.toggle("hidden", isHidden);
  };

  const toggleRight = () => {
    const isHidden = rightPane.classList.toggle("hidden");
    rightResizer.classList.toggle("hidden", isHidden);
  };

  toggleLeftBtn?.addEventListener("click", toggleLeft);
  toggleRightBtn?.addEventListener("click", toggleRight);

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      toggleLeft();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
      e.preventDefault();
      toggleRight();
    }
  });

  let isDraggingLeft = false;
  leftResizer?.addEventListener("mousedown", (e) => {
    isDraggingLeft = true;
    leftResizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  });

  let isDraggingRight = false;
  rightResizer?.addEventListener("mousedown", (e) => {
    isDraggingRight = true;
    rightResizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (isDraggingLeft && leftPane) {
      const maxLeft = Math.max(520, Math.floor(window.innerWidth * 0.5));
      const newWidth = Math.max(200, Math.min(maxLeft, e.clientX));
      leftPane.style.width = `${newWidth}px`;
    } else if (isDraggingRight && rightPane) {
      const leftWidth = leftPane && !leftPane.classList.contains("hidden") ? leftPane.offsetWidth : 0;
      const maxRight = Math.max(720, window.innerWidth - leftWidth - 220);
      const newWidth = Math.max(260, Math.min(maxRight, window.innerWidth - e.clientX));
      rightPane.style.width = `${newWidth}px`;
    }
  });

  window.addEventListener("mouseup", () => {
    if (isDraggingLeft || isDraggingRight) {
      isDraggingLeft = false;
      isDraggingRight = false;
      leftResizer?.classList.remove("dragging");
      rightResizer?.classList.remove("dragging");
      document.body.style.cursor = "";
    }
  });
}

function bindCommandPalette() {
  const modal = document.getElementById("cmd-palette-modal");
  const input = document.getElementById("cmd-palette-input");
  const resultsContainer = document.getElementById("cmd-palette-results");
  const openBtn = document.getElementById("open-cmd-palette-btn");

  const openPalette = () => {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    input.value = "";
    renderPaletteResults("");
    setTimeout(() => input.focus(), 20);
  };

  const closePalette = () => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  };

  openBtn?.addEventListener("click", openPalette);

  document.getElementById("close-cmd-palette-btn")?.addEventListener("click", closePalette);

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (modal.classList.contains("hidden")) {
        openPalette();
      } else {
        closePalette();
      }
    } else if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      closePalette();
    }
  });

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closePalette();
  });

  input?.addEventListener("input", () => {
    renderPaletteResults(input.value.trim());
  });

  function renderPaletteResults(query) {
    const q = query.toLowerCase();

    const matchingModules = MODULE_CATALOG.filter(
      (m) => !q || m.title.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
    );

    const matchingParams = Object.entries(PARAMETER_TOOLTIPS).filter(
      ([key, meta]) =>
        !q ||
        key.toLowerCase().includes(q) ||
        meta.title.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q)
    );

    let html = "";

    if (matchingModules.length > 0) {
      html += `<div class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Interactive Labs</div>`;
      html += matchingModules
        .map(
          (m) => `
        <button data-jump-module="${m.id}" class="w-full text-left px-3 py-2 rounded-lg hover:bg-claude-bg flex items-center justify-between group transition">
          <div>
            <div class="text-xs font-semibold text-white group-hover:text-claude-accent">${m.title}</div>
            <div class="text-[11px] text-slate-400">${m.desc}</div>
          </div>
          <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-claude-bg border border-claude-border text-slate-400">Jump &rarr;</span>
        </button>
      `
        )
        .join("");
    }

    if (matchingParams.length > 0) {
      html += `<div class="px-2.5 py-1 mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Anthropic API Parameters (${matchingParams.length})</div>`;
      html += matchingParams
        .slice(0, 20)
        .map(
          ([key, meta]) => `
        <div class="px-3 py-2 rounded-lg hover:bg-claude-bg border border-transparent hover:border-claude-border transition">
          <div class="flex items-center justify-between gap-2">
            <code class="text-xs font-mono font-bold text-sky-400">"${key}"</code>
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded ${
              meta.status === "Deprecated on 4.7+"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
            }">${meta.type} &bull; ${meta.status}</span>
          </div>
          <div class="text-[11px] text-slate-300 mt-1 leading-relaxed">${meta.description}</div>
        </div>
      `
        )
        .join("");
    }

    const matchingShortcuts = KEYBOARD_SHORTCUTS.filter(
      ([keys, desc]) => !q || "keyboard shortcuts".includes(q) || keys.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
    );
    if (matchingShortcuts.length > 0) {
      html += `<div class="px-2.5 py-1 mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Keyboard Shortcuts</div>`;
      html += matchingShortcuts
        .map(
          ([keys, desc]) => `
        <div class="px-3 py-1.5 flex items-center justify-between text-xs">
          <span class="text-slate-300">${desc}</span>
          <kbd class="font-mono text-[11px] px-1.5 py-0.5 rounded bg-claude-bg border border-claude-border text-slate-200">${keys}</kbd>
        </div>`
        )
        .join("");
    }

    if (!html) {
      html = `<div class="p-6 text-center text-xs text-slate-500">No matching labs or API parameters found for "${escapeHtml(query)}".</div>`;
    }

    resultsContainer.innerHTML = html;

    resultsContainer.querySelectorAll("[data-jump-module]").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchModule(btn.dataset.jumpModule);
        closePalette();
      });
    });
  }
}

function bindGlobalControls() {
  document.querySelectorAll(".module-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchModule(btn.dataset.module);
    });
  });

  document.getElementById("theme-select")?.addEventListener("change", (e) => {
    applyTheme(e.target.value);
  });

  document.getElementById("mode-sim-btn").addEventListener("click", () => setMode("simulation"));
  document.getElementById("mode-live-btn").addEventListener("click", () => setMode("live"));

  document.getElementById("global-model-select").addEventListener("change", (e) => {
    state.model = e.target.value;
    notifyModelChange();
  });

  document.querySelectorAll(".inspector-tab").forEach((tab) => {
    tab.addEventListener("click", () => showInspectorTab(tab.dataset.tab));
  });

  document.getElementById("api-key-modal-btn").addEventListener("click", openApiKeyModal);
  document.getElementById("close-key-modal-btn").addEventListener("click", closeApiKeyModal);
  document.getElementById("save-key-btn").addEventListener("click", () => {
    const val = document.getElementById("custom-api-key-input").value.trim();
    state.customApiKey = val;
    if (val) {
      settingsStore.set("CLAUDE_EXPLORER_API_KEY", val);
      setMode("live");
      showToast("API key saved. Live mode is on.", "success");
    } else {
      settingsStore.set("CLAUDE_EXPLORER_API_KEY", null);
      setMode("simulation");
    }
    closeApiKeyModal();
  });
  document.getElementById("clear-key-btn").addEventListener("click", () => {
    state.customApiKey = "";
    settingsStore.set("CLAUDE_EXPLORER_API_KEY", null);
    document.getElementById("custom-api-key-input").value = "";
    setMode("simulation");
    closeApiKeyModal();
    showToast("API key removed. Back to the simulator.");
  });
}

const LAB_REGISTRY = {
  messages: { init: initMessagesLab, guide: renderMessagesConceptGuide },
  streaming: { init: initStreamingLab, guide: renderStreamingConceptGuide },
  tools: { init: initToolUseLab, guide: renderToolUseConceptGuide },
  thinking: { init: initThinkingCacheLab, guide: renderThinkingCacheConceptGuide },
  mcp: { init: initMcpLab, guide: renderMcpConceptGuide },
  servertools: { init: initServerToolsDiagLab, guide: renderServerToolsDiagConceptGuide },
  playground: { init: initPlaygroundLab, guide: renderPlaygroundConceptGuide },
  compare: { init: initCompareLab, guide: renderCompareConceptGuide }
};

const mountedLabs = {};

function switchModule(moduleName) {
  const lab = LAB_REGISTRY[moduleName];
  if (!lab) return;
  state.activeModule = moduleName;

  document.querySelectorAll(".module-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.module === moduleName);
  });

  document.getElementById("concept-guide-container").innerHTML = lab.guide();

  for (const [name, mounted] of Object.entries(mountedLabs)) {
    mounted.el.hidden = name !== moduleName;
  }

  const existing = mountedLabs[moduleName];
  if (existing) {
    existing.hooks?.onShow?.();
    return;
  }

  const el = document.createElement("div");
  el.className = "space-y-5";
  el.dataset.lab = moduleName;
  document.getElementById("module-playground").appendChild(el);
  mountedLabs[moduleName] = { el, hooks: null };
  mountedLabs[moduleName].hooks = lab.init(el, appStateInterface);
}

function notifyModelChange() {
  mountedLabs[state.activeModule]?.hooks?.onModelChange?.();
}

function renderInspector() {
  const container = document.getElementById("inspector-content");
  const badge = document.getElementById("inspector-latency-badge");

  badge.textContent = state.lastLatencyMs
    ? `${state.mode === "live" ? "LIVE" : "SIM"} • ${state.lastLatencyMs}ms`
    : state.mode === "live"
    ? "LIVE MODE"
    : "SIMULATOR";

  const cleanBody = { ...state.draftPayload };
  delete cleanBody._sim_cache_mode;
  delete cleanBody._stream_delay_ms;

  if (state.activeInspectorTab === "request") {
    const headersObj = {
      "x-api-key": state.mode === "live" ? "sk-ant-api03-••••••••" : "sk-ant-sim-••••••••",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    };

    container.innerHTML = `
      <div class="space-y-3">
        <div class="p-2.5 rounded-lg bg-claude-bg border border-claude-border">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[11px] font-semibold text-emerald-400">POST https://api.anthropic.com/v1/messages</span>
            <span class="text-[10px] text-slate-400">HTTP/1.1</span>
          </div>
          <pre class="text-[11px] text-slate-300 overflow-x-auto leading-relaxed">${renderInteractiveJsonTree(headersObj)}</pre>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Interactive JSON Request Body</span>
            <button id="copy-req-json-btn" class="text-[11px] text-sky-400 hover:underline font-sans">Copy JSON</button>
          </div>
          <pre class="p-3 rounded-lg bg-claude-bg border border-claude-border text-[11px] leading-relaxed overflow-x-auto">${renderInteractiveJsonTree(
            cleanBody
          )}</pre>
        </div>
      </div>
    `;

    bindInteractiveJsonEvents(container);

    container.querySelector("#copy-req-json-btn")?.addEventListener("click", (e) => {
      navigator.clipboard.writeText(JSON.stringify(cleanBody, null, 2));
      e.target.textContent = "Copied!";
      setTimeout(() => (e.target.textContent = "Copy JSON"), 1200);
    });
    return;
  }

  if (state.activeInspectorTab === "response") {
    if (!state.lastResponse) {
      container.innerHTML = `<div class="p-6 text-center text-slate-500 text-xs font-sans">Send a request in the playground to inspect the interactive JSON response or SSE frame payload here.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Interactive Response Payload</span>
          <button id="copy-res-json-btn" class="text-[11px] text-sky-400 hover:underline font-sans">Copy JSON</button>
        </div>
        <pre class="p-3 rounded-lg bg-claude-bg border border-claude-border text-[11px] leading-relaxed overflow-x-auto">${renderInteractiveJsonTree(
          state.lastResponse
        )}</pre>
      </div>
    `;

    bindInteractiveJsonEvents(container);

    container.querySelector("#copy-res-json-btn")?.addEventListener("click", (e) => {
      navigator.clipboard.writeText(JSON.stringify(state.lastResponse, null, 2));
      e.target.textContent = "Copied!";
      setTimeout(() => (e.target.textContent = "Copy JSON"), 1200);
    });
    return;
  }

  if (state.activeInspectorTab === "tokens") {
    const usage = state.lastResponse?.usage || {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      output_tokens_details: { thinking_tokens: 0 },
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }
    };

    const inTok = usage.input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const outTok = usage.output_tokens || 0;
    const thinkTok = usage.output_tokens_details?.thinking_tokens || 0;
    const ttl5m = usage.cache_creation?.ephemeral_5m_input_tokens || 0;
    const ttl1h = usage.cache_creation?.ephemeral_1h_input_tokens || 0;

    const costModelId = state.lastResponse?.model || state.draftPayload?.model || state.model;
    const cost = estimateCost(costModelId, usage);
    const { costInput, costCacheWrite, costCacheRead, costOutput, uncachedEquivalent } = cost;
    const totalCost = cost.total;
    const rate = (n) => `$${Number(n.toFixed(3))}`;

    container.innerHTML = `
      <div class="space-y-3 font-sans">
        <div class="p-3 rounded-lg bg-claude-bg border border-claude-border space-y-2">
          <div class="text-xs font-semibold text-white">Token Accounting (<code class="font-mono text-sky-400">response.usage</code>)</div>
          <div class="grid grid-cols-2 gap-2 text-xs font-mono">
            <div class="p-2 rounded bg-claude-panel border border-claude-border">
              <div class="text-[10px] text-slate-400">input_tokens</div>
              <div class="text-sm font-bold text-white">${inTok}</div>
            </div>
            <div class="p-2 rounded bg-claude-panel border border-claude-border">
              <div class="text-[10px] text-slate-400">output_tokens (total)</div>
              <div class="text-sm font-bold text-sky-300">${outTok}</div>
            </div>
            <div class="p-2 rounded bg-claude-panel border border-purple-500/30 col-span-2 flex items-center justify-between">
              <div>
                <div class="text-[10px] text-purple-300">output_tokens_details.thinking_tokens</div>
                <div class="text-[10px] text-slate-400 font-sans">Internal reasoning subset of output_tokens</div>
              </div>
              <div class="text-sm font-bold text-purple-300">${thinkTok}</div>
            </div>
            <div class="p-2 rounded bg-claude-panel border border-amber-500/30">
              <div class="text-[10px] text-amber-300">cache_creation_input</div>
              <div class="text-sm font-bold text-amber-300">${cacheWrite} <span class="text-[10px] font-normal text-slate-400">(5m:${ttl5m} / 1h:${ttl1h})</span></div>
            </div>
            <div class="p-2 rounded bg-claude-panel border border-emerald-500/30">
              <div class="text-[10px] text-emerald-300">cache_read_input</div>
              <div class="text-sm font-bold text-emerald-300">${cacheRead}</div>
            </div>
          </div>
        </div>

        <div class="p-3 rounded-lg bg-claude-bg border border-claude-border space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-white">Estimated Cost Breakdown</span>
            <span class="text-[10px] font-mono text-slate-400">${escapeHtml(cost.modelId)}${cost.knownModel ? "" : " (default rates)"} &bull; list prices ${escapeHtml(getModelCatalog().pricingAsOf)}</span>
          </div>
          <div class="space-y-1 text-xs font-mono">
            <div class="flex justify-between text-slate-300">
              <span>Standard Input (${rate(cost.rates.input)} / 1M):</span>
              <span>$${costInput.toFixed(6)}</span>
            </div>
            <div class="flex justify-between text-amber-300">
              <span>Cache Write (${rate(cost.rates.cacheWrite5m)} / 1M at 5m):</span>
              <span>$${costCacheWrite.toFixed(6)}</span>
            </div>
            <div class="flex justify-between text-emerald-300">
              <span>Cache Read (${rate(cost.rates.cacheRead)} / 1M):</span>
              <span>$${costCacheRead.toFixed(6)}</span>
            </div>
            <div class="flex justify-between text-purple-300">
              <span>Output Tokens (${rate(cost.rates.output)} / 1M):</span>
              <span>$${costOutput.toFixed(6)}</span>
            </div>
            <div class="pt-1.5 border-t border-claude-border flex justify-between font-bold text-white">
              <span>Total Request Cost:</span>
              <span>$${totalCost.toFixed(6)}</span>
            </div>
            ${
              cacheRead > 0
                ? `<div class="flex justify-between text-emerald-400 text-[11px]">
                    <span>Saved via Prompt Cache:</span>
                    <span>$${Math.max(0, uncachedEquivalent - totalCost).toFixed(6)}</span>
                  </div>`
                : ""
            }
          </div>
        </div>
      </div>
    `;
    return;
  }

  if (state.activeInspectorTab === "code") {
    const snippet = generateSdkCode(state.draftPayload, state.activeCodeLang);
    container.innerHTML = `
      <div class="space-y-2.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1">
            ${["python", "typescript", "curl"]
              .map(
                (lang) => `
              <button data-lang="${lang}" class="code-lang-btn px-2.5 py-1 rounded text-[11px] font-mono uppercase transition ${
                  state.activeCodeLang === lang
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold"
                    : "bg-claude-bg text-slate-400 border border-claude-border hover:text-white"
                }">
                ${lang}
              </button>
            `
              )
              .join("")}
          </div>
          <button id="copy-sdk-code-btn" class="text-[11px] text-sky-400 hover:underline font-sans">Copy Snippet</button>
        </div>

        <pre class="p-3 rounded-lg bg-claude-bg border border-claude-border text-[11px] text-slate-200 leading-relaxed overflow-x-auto whitespace-pre">${escapeHtml(
          snippet
        )}</pre>
      </div>
    `;

    container.querySelectorAll(".code-lang-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeCodeLang = btn.dataset.lang;
        renderInspector();
      });
    });

    container.querySelector("#copy-sdk-code-btn")?.addEventListener("click", (e) => {
      navigator.clipboard.writeText(snippet);
      e.target.textContent = "Copied!";
      setTimeout(() => (e.target.textContent = "Copy Snippet"), 1200);
    });
  }
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

bootstrap();
