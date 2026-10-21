/**
 * Module 1: Messages API, Modern `output_config`, & Breaking Changes Lab (2026 Spec)
 * Teaches:
 * - Stateless `messages` array & top-level `system` parameter
 * - 2026 Breaking Change #1: `temperature`, `top_p`, and `top_k` are DEPRECATED on Claude 4.6/4.7+ and return HTTP 400!
 *   Instead, modern models use `output_config: { effort: "low" | "medium" | "high" | "max" }`.
 * - 2026 Breaking Change #2: Assistant Prefill (`role: "assistant"` at end of messages) is DEPRECATED on Claude 4.6/4.7+ and returns HTTP 400!
 *   Instead, modern models use Native Structured Outputs (`output_config: { format: { type: "json_schema", schema: ... } }`).
 */

import { renderMarkdown, bindMarkdownCopyButtons } from "../markdown.js";

const SAMPLE_JSON_SCHEMA = {
  type: "object",
  properties: {
    topic: { type: "string" },
    key_changes: {
      type: "array",
      items: { type: "string" }
    },
    recommended_effort: {
      type: "string",
      enum: ["low", "medium", "high", "xhigh", "max"]
    },
    schema_enforced: { type: "boolean" }
  },
  required: ["topic", "key_changes", "recommended_effort", "schema_enforced"],
  additionalProperties: false
};

const PRESETS = {
  modernMultiTurn: {
    system: "You are a concise staff backend engineer who explains distributed systems using clear analogies.",
    effort: "high",
    structuredJsonSchema: false,
    injectDeprecatedTemp: false,
    legacyTempValue: 0.7,
    max_tokens: 1024,
    stop_sequences: [],
    messages: [
      { role: "user", content: "Why is the Claude Messages API stateless?" },
      {
        role: "assistant",
        content: "Because the server doesn't store your past chat turns in a session database—you send the full conversation array on every request, giving your app full control over context compaction, branching, and caching!"
      },
      { role: "user", content: "How does that help when building multi-step workflows?" }
    ]
  },
  structuredOutputs: {
    system: "Extract structured API migration notes matching the provided JSON schema.",
    effort: "medium",
    structuredJsonSchema: true,
    injectDeprecatedTemp: false,
    legacyTempValue: 0.2,
    max_tokens: 1024,
    stop_sequences: [],
    messages: [
      {
        role: "user",
        content: "Summarize the official Claude API parameter changes (temperature deprecation after Opus 4.6, assistant prefill removal, and output_config) as structured JSON."
      }
    ]
  },
  deprecated400Demo: {
    system: "Test what happens when legacy wrappers send `temperature != 1.0` or Assistant Prefill to post-Opus 4.6 models (Claude 4.7, 5, 5.5).",
    effort: "none",
    structuredJsonSchema: false,
    injectDeprecatedTemp: true,
    legacyTempValue: 0.7,
    max_tokens: 512,
    stop_sequences: [],
    messages: [
      {
        role: "user",
        content: "Why did my LangChain / SDK wrapper fail with 400 Bad Request after upgrading to claude-sonnet-5-5 or claude-opus-4-7?"
      }
    ]
  }
};

export function renderMessagesConceptGuide() {
  return `
    <div class="space-y-3.5 text-xs leading-relaxed text-slate-300">
      <div class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
        <div class="font-semibold text-rose-300 mb-1">&#9888; Official Spec: Post-Opus 4.6 Breaking Changes</div>
        <ul class="space-y-1.5 text-[11px] text-slate-300">
          <li>
            1. <strong class="text-white"><code class="font-mono text-rose-300">temperature</code> Deprecated:</strong> Models released after Claude Opus 4.6 (<code class="font-mono">4.7</code>, <code class="font-mono">4.8</code>, <code class="font-mono">5</code>, <code class="font-mono">5.5</code>) reject any <code class="font-mono">temperature &ne; 1.0</code> with a <strong>400 error</strong> (<code class="font-mono">1.0</code> is only accepted for backwards compatibility). <code class="font-mono">top_k</code> is always rejected.
          </li>
          <li>
            2. <strong class="text-white">Prefill Not Supported:</strong> Ending <code class="font-mono">messages[]</code> with <code class="font-mono">role: "assistant"</code> returns a <strong>400 error</strong> on modern models. Use <code class="font-mono text-sky-300">output_config.format</code> (<code class="font-mono">json_schema</code>) instead.
          </li>
        </ul>
      </div>

      <div class="space-y-1.5">
        <h4 class="font-semibold text-white uppercase tracking-wider text-[11px]">Modern Body Parameters</h4>
        <div class="p-2.5 rounded bg-claude-card border border-claude-border space-y-1 text-[11px]">
          <div><span class="font-mono text-emerald-400">output_config.effort</span>: <code class="font-mono">"low" | "medium" | "high" | "xhigh" | "max"</code></div>
          <div><span class="font-mono text-purple-400">output_config.format</span>: <code class="font-mono">{ type: "json_schema", schema }</code></div>
          <div><span class="font-mono text-sky-400">max_tokens</span>: Set to <code class="font-mono">0</code> to pre-warm prompt cache without generating output!</div>
        </div>
      </div>

      <div class="space-y-1.5">
        <h4 class="font-semibold text-white uppercase tracking-wider text-[11px]">All 7 Official <code class="font-mono text-amber-300">stop_reason</code> Values</h4>
        <ul class="space-y-0.5 text-[11px] text-slate-300 font-mono">
          <li>&bull; <span class="text-emerald-400">"end_turn"</span> <span class="font-sans text-slate-400">(natural stop)</span></li>
          <li>&bull; <span class="text-amber-400">"max_tokens"</span> <span class="font-sans text-slate-400">(hit ceiling)</span></li>
          <li>&bull; <span class="text-purple-400">"stop_sequence"</span> <span class="font-sans text-slate-400">(custom string)</span></li>
          <li>&bull; <span class="text-sky-400">"tool_use"</span> <span class="font-sans text-slate-400">(tool invoked)</span></li>
          <li>&bull; <span class="text-orange-300">"pause_turn"</span> <span class="font-sans text-slate-400">(paused long turn)</span></li>
          <li>&bull; <span class="text-rose-400">"refusal"</span> <span class="font-sans text-slate-400">(policy classifier)</span></li>
          <li>&bull; <span class="text-slate-400">"model_context_window_exceeded"</span></li>
        </ul>
      </div>
    </div>
  `;
}

export function initMessagesLab(container, appState) {
  let localState = structuredClone(PRESETS.modernMultiTurn);

  // Map a request payload (e.g. a saved template) onto this lab's editable fields
  function stateFromPayload(payload = {}) {
    const system = Array.isArray(payload.system)
      ? payload.system.map((b) => b.text || "").join("\n")
      : String(payload.system || "");
    return {
      system,
      effort: payload.output_config?.effort || "none",
      structuredJsonSchema: Boolean(payload.output_config?.format),
      injectDeprecatedTemp: payload.temperature !== undefined,
      legacyTempValue: payload.temperature ?? 0.7,
      max_tokens: Number(payload.max_tokens) || 1024,
      stop_sequences: Array.isArray(payload.stop_sequences) ? payload.stop_sequences : [],
      messages: Array.isArray(payload.messages) && payload.messages.length ? structuredClone(payload.messages) : [{ role: "user", content: "" }]
    };
  }
  let lastResult = null;
  let showRaw = false;

  function syncPayloadToInspector() {
    const payload = {
      model: appState.getModel(),
      max_tokens: Number(localState.max_tokens),
      messages: localState.messages
    };
    if (localState.system.trim()) {
      payload.system = localState.system;
    }

    const outputConfig = {};
    if (localState.effort && localState.effort !== "none") {
      outputConfig.effort = localState.effort;
    }
    if (localState.structuredJsonSchema) {
      outputConfig.format = {
        type: "json_schema",
        schema: SAMPLE_JSON_SCHEMA
      };
    }
    if (Object.keys(outputConfig).length > 0) {
      payload.output_config = outputConfig;
    }

    if (localState.injectDeprecatedTemp) {
      payload.temperature = Number(localState.legacyTempValue);
    }

    if (localState.stop_sequences.length > 0) {
      payload.stop_sequences = localState.stop_sequences;
    }
    appState.updateDraftPayload(payload);
  }

  function render() {
    const currentModel = appState.getModel();
    // `strict` comes from src/models.js: 4.7+ and 5.x reject temperature / trailing prefill
    const isModern = Boolean(appState.getModelInfo(currentModel)?.strict);
    const lastIsAssistant = localState.messages[localState.messages.length - 1]?.role === "assistant";

    container.innerHTML = `
      <!-- Header & Quick Presets -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-white flex items-center gap-2">
            <span>01. Messages API, <code class="text-emerald-400 font-mono text-sm">output_config</code> &amp; 2026 Breaking Changes</span>
          </h2>
          <p class="text-xs text-slate-400">Explore modern <code class="text-emerald-300 font-mono">output_config.effort</code>, native <code class="text-sky-300 font-mono">json_schema</code> Structured Outputs, and why <code class="text-rose-300 font-mono">temperature</code> throws HTTP 400 on 4.6/4.7+.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[11px] text-slate-400">Presets:</span>
          <button data-preset="modernMultiTurn" class="preset-btn px-2.5 py-1 rounded bg-claude-card hover:bg-slate-800 border border-claude-border text-xs text-slate-200 transition">Modern Multi-Turn</button>
          <button data-preset="structuredOutputs" class="preset-btn px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs text-emerald-300 transition">Structured JSON (<code class="font-mono">output_config.format</code>)</button>
          <button data-preset="deprecated400Demo" class="preset-btn px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs text-rose-300 transition">Test Deprecated <code class="font-mono">temperature</code> (400 Error)</button>
        </div>
        <div class="w-full flex flex-wrap items-center gap-2 pt-2 border-t border-claude-border">
          <span class="text-[11px] text-slate-400">My templates:</span>
          <select id="msg-template-select" aria-label="Load a saved template" class="bg-claude-bg border border-claude-border rounded px-2 py-1 text-xs text-slate-100 min-w-[150px]">
            <option value="">${appState.getTemplates().length ? "Choose a template to load..." : "No saved templates"}</option>
            ${appState
              .getTemplates()
              .map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`)
              .join("")}
          </select>
          <input id="msg-template-name" type="text" placeholder="Template name" aria-label="New template name" class="bg-claude-bg border border-claude-border rounded px-2 py-1 text-xs text-slate-100 w-36" />
          <button id="msg-template-save" class="px-2.5 py-1 rounded bg-claude-card hover:bg-slate-800 border border-claude-border text-xs text-slate-200 transition">Save current</button>
        </div>
      </div>

      <!-- Parameters Bar -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- System Prompt & Structured Output Toggle -->
        <div class="md:col-span-2 bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-xs font-semibold text-slate-200">
                Top-Level <code class="text-sky-400 font-mono">system</code> Parameter
              </label>
              <span class="text-[11px] text-slate-400">Passed outside <code class="font-mono">messages[]</code></span>
            </div>
            <textarea id="msg-system-input" aria-label="System prompt" rows="2" class="w-full bg-claude-bg border border-claude-border rounded-lg p-2.5 text-xs text-slate-100 focus:outline-none focus:border-claude-accent" placeholder="Optional system instructions...">${escapeHtml(localState.system)}</textarea>
          </div>

          <!-- Native Structured Output (Replaces Legacy Assistant Prefill) -->
          <div class="p-2.5 rounded-lg bg-claude-bg border border-emerald-500/30 flex items-center justify-between gap-3">
            <div>
              <label class="flex items-center gap-2 text-xs font-semibold text-emerald-300 cursor-pointer">
                <input id="structured-json-chk" type="checkbox" ${localState.structuredJsonSchema ? "checked" : ""} class="accent-emerald-500 rounded" />
                <span>Enable Native Structured Output (<code class="font-mono">output_config.format.type = "json_schema"</code>)</span>
              </label>
              <p class="text-[11px] text-slate-400 mt-0.5">Replaces legacy <code class="font-mono">{"role": "assistant", "content": "{"}</code> prefilling with constrained decoding.</p>
            </div>
            <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 shrink-0">2026 Standard</span>
          </div>
        </div>

        <!-- Modern output_config.effort & Legacy Deprecated temperature tester -->
        <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
          <!-- Modern Effort Control -->
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="text-slate-200 font-semibold"><code class="text-emerald-400 font-mono">output_config.effort</code></span>
              <span class="text-[10px] font-mono text-emerald-400">Replaces temperature</span>
            </div>
            <select id="msg-effort-select" aria-label="output_config.effort" class="w-full bg-claude-bg border border-claude-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none">
              <option value="none" ${localState.effort === "none" ? "selected" : ""}>Omit (Model Default)</option>
              <option value="low" ${localState.effort === "low" ? "selected" : ""}>"low" (Fast &amp; concise)</option>
              <option value="medium" ${localState.effort === "medium" ? "selected" : ""}>"medium" (Balanced)</option>
              <option value="high" ${localState.effort === "high" ? "selected" : ""}>"high" (Thorough analysis)</option>
              <option value="xhigh" ${localState.effort === "xhigh" ? "selected" : ""}>"xhigh" (Extended deep analysis)</option>
              <option value="max" ${localState.effort === "max" ? "selected" : ""}>"max" (Maximum capability)</option>
            </select>
          </div>

          <!-- max_tokens slider -->
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="text-slate-300 font-medium"><code class="text-sky-400 font-mono">max_tokens</code> <span class="text-rose-400">*</span></span>
              <span id="max-tok-label" class="font-mono text-claude-accent">${localState.max_tokens}</span>
            </div>
            <input id="msg-maxtok-slider" aria-label="max_tokens" type="range" min="25" max="4096" step="25" value="${localState.max_tokens}" class="w-full accent-orange-500 cursor-pointer" />
          </div>

          <!-- Legacy Deprecated temperature toggle -->
          <div class="pt-2 border-t border-claude-border">
            <label class="flex items-center justify-between text-xs cursor-pointer">
              <span class="text-rose-300 font-medium flex items-center gap-1.5">
                <input id="deprecated-temp-chk" type="checkbox" ${localState.injectDeprecatedTemp ? "checked" : ""} class="accent-rose-500 rounded" />
                <span>Send legacy <code class="font-mono">temperature: ${localState.legacyTempValue}</code></span>
              </span>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">Deprecated</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Messages Array Builder -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">Stateless <code class="text-sky-400 font-mono">messages[]</code> Array (${localState.messages.length} turns)</h3>
            <p class="text-[11px] text-slate-400">On Claude 4.6/4.7+, the conversation must end with a <code class="font-mono text-emerald-300">user</code> message.</p>
          </div>
          <div class="flex items-center gap-2">
            <button id="add-user-turn-btn" class="px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-medium transition">+ User Turn</button>
            <button id="add-assistant-turn-btn" class="px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-medium transition" title="Deprecated on Claude 4.6/4.7+">+ Trailing Assistant Prefill (Legacy)</button>
          </div>
        </div>

        <div id="messages-list" class="space-y-2.5">
          ${localState.messages
            .map(
              (m, idx) => `
            <div class="flex items-start gap-2.5 bg-claude-bg border ${
              m.role === "user" ? "border-emerald-500/30" : "border-amber-500/30"
            } rounded-lg p-3">
              <button data-idx="${idx}" class="role-toggle-btn shrink-0 px-2 py-1 rounded text-[11px] font-mono uppercase font-semibold ${
                m.role === "user"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
              }" title="Click to toggle role">
                ${m.role}
              </button>
              <textarea data-idx="${idx}" aria-label="Message ${idx + 1} (${m.role}) content" rows="2" class="msg-content-input flex-1 bg-transparent text-xs text-slate-100 font-sans focus:outline-none resize-y">${escapeHtml(
                typeof m.content === "string" ? m.content : JSON.stringify(m.content)
              )}</textarea>
              ${
                localState.messages.length > 1
                  ? `<button data-idx="${idx}" class="remove-msg-btn text-slate-500 hover:text-rose-400 text-sm px-1" title="Remove turn">&times;</button>`
                  : ""
              }
            </div>
          `
            )
            .join("")}
        </div>

        <div class="pt-2 flex items-center justify-between border-t border-claude-border">
          <div class="text-[11px] text-slate-400">
            ${
              localState.injectDeprecatedTemp && isModern
                ? `<span class="text-rose-400 font-medium">&#9888; Warning:</span> <code class="font-mono">temperature</code> is enabled while targeting <code class="font-mono">${currentModel}</code> — API will reject with <strong>400 Bad Request</strong>!`
                : lastIsAssistant && isModern
                ? `<span class="text-rose-400 font-medium">&#9888; Warning:</span> Trailing <code class="font-mono">assistant</code> prefill on <code class="font-mono">${currentModel}</code> will reject with <strong>400 Bad Request</strong>! Switch to a Legacy model in top bar or use <code class="font-mono">output_config.format</code>.`
                : `Ready to send <code class="font-mono text-sky-400">${localState.messages.length}</code> message turn(s) to <code class="font-mono text-white">${currentModel}</code>.`
            }
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span id="msg-token-info" class="text-[11px] font-mono text-slate-400"></span>
            <button id="msg-count-btn" class="px-3 py-2 rounded-lg bg-claude-card hover:bg-slate-800 border border-claude-border text-xs text-slate-200 transition">Count tokens</button>
            <button id="send-messages-btn" class="px-4 py-2 rounded-lg bg-claude-accent hover:bg-claude-accentHover text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-orange-950/50 transition">
              <span>Send POST /v1/messages</span>
              <span>&rarr;</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Response Output Card -->
      <div id="messages-response-area" class="bg-claude-panel border border-claude-border rounded-xl p-4 hidden space-y-3">
        <!-- Populated on response -->
      </div>
    `;

    bindEvents();
    syncPayloadToInspector();
  }

  function bindEvents() {
    container.querySelector("#msg-template-select").addEventListener("change", (e) => {
      const tpl = appState.getTemplates().find((t) => t.name === e.target.value);
      if (!tpl) return;
      localState = stateFromPayload(tpl.payload);
      lastResult = null;
      render();
      appState.showToast(`Loaded template "${tpl.name}"`);
    });
    container.querySelector("#msg-template-save").addEventListener("click", () => {
      const name = container.querySelector("#msg-template-name").value.trim();
      if (!name) return appState.showToast("Give the template a name first.", "error");
      appState.saveTemplate(name, appState.getDraftPayload());
      appState.showToast(`Saved template "${name}"`, "success");
      render();
    });
    container.querySelector("#msg-count-btn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const info = container.querySelector("#msg-token-info");
      btn.disabled = true;
      const result = await appState.countTokens(appState.getDraftPayload());
      btn.disabled = false;
      info.textContent = result.error
        ? `Count failed: ${result.message || "error"}`
        : `${result.estimated ? "~" : ""}${result.input_tokens.toLocaleString()} input tokens${result.estimated ? " (estimate)" : ""}`;
    });

    container.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.preset;
        if (PRESETS[key]) {
          localState = structuredClone(PRESETS[key]);
          render();
        }
      });
    });

    const sysInput = container.querySelector("#msg-system-input");
    sysInput.addEventListener("input", (e) => {
      localState.system = e.target.value;
      syncPayloadToInspector();
    });

    const structChk = container.querySelector("#structured-json-chk");
    structChk.addEventListener("change", (e) => {
      localState.structuredJsonSchema = e.target.checked;
      syncPayloadToInspector();
    });

    const effortSel = container.querySelector("#msg-effort-select");
    effortSel.addEventListener("change", (e) => {
      localState.effort = e.target.value;
      syncPayloadToInspector();
    });

    const depTempChk = container.querySelector("#deprecated-temp-chk");
    depTempChk.addEventListener("change", (e) => {
      localState.injectDeprecatedTemp = e.target.checked;
      render();
    });

    const maxTokSlider = container.querySelector("#msg-maxtok-slider");
    const maxTokLabel = container.querySelector("#max-tok-label");
    maxTokSlider.addEventListener("input", (e) => {
      localState.max_tokens = Number(e.target.value);
      maxTokLabel.textContent = localState.max_tokens;
      syncPayloadToInspector();
    });

    container.querySelectorAll(".msg-content-input").forEach((ta) => {
      ta.addEventListener("input", (e) => {
        const idx = Number(ta.dataset.idx);
        localState.messages[idx].content = e.target.value;
        syncPayloadToInspector();
      });
    });

    container.querySelectorAll(".role-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        localState.messages[idx].role = localState.messages[idx].role === "user" ? "assistant" : "user";
        render();
      });
    });

    container.querySelectorAll(".remove-msg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        localState.messages.splice(idx, 1);
        render();
      });
    });

    container.querySelector("#add-user-turn-btn").addEventListener("click", () => {
      localState.messages.push({ role: "user", content: "Can you give me a quick example?" });
      render();
    });

    container.querySelector("#add-assistant-turn-btn").addEventListener("click", () => {
      localState.messages.push({ role: "assistant", content: "{" });
      render();
    });

    const sendBtn = container.querySelector("#send-messages-btn");
    sendBtn.addEventListener("click", async () => {
      sendBtn.disabled = true;
      sendBtn.innerHTML = `<span class="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span><span>Calling API...</span>`;

      const payload = appState.getDraftPayload();
      const result = await appState.executeMessagesRequest(payload);
      sendBtn.disabled = false;
      sendBtn.innerHTML = `<span>Send POST /v1/messages</span><span>&rarr;</span>`;

      lastResult = result;
      renderResponseCard(result);
      container.querySelector("#messages-response-area")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function renderResponseCard(result) {
    const area = container.querySelector("#messages-response-area");
    area.classList.remove("hidden");

    if (result.error) {
      const status = result.status ?? 400;
      const errorType = result.errorType || (status === 400 ? "invalid_request_error" : "api_error");
      // Only the 400s this lab provokes on purpose (temperature / prefill) get the breaking-change hint
      const isBreakingChange = status === 400 && (localState.injectDeprecatedTemp || localState.messages.at(-1)?.role === "assistant");
      const hint = isBreakingChange
        ? `Uncheck the deprecated <code class="font-mono">temperature</code> checkbox (or remove trailing <code class="font-mono">assistant</code> prefill), or switch the top-bar Model selector to a legacy model (<code class="font-mono">claude-sonnet-4-5</code>) to see how older models handled it.`
        : status === 0 || errorType === "connection_error"
        ? "The request never reached the API. Check your internet connection, or restart the app if the local server stopped."
        : status === 401
        ? "The API key was rejected. Open <strong>API Key</strong> in the top bar and check it."
        : status === 429
        ? "Rate limited. Wait a moment and try again."
        : "Check the message above and the request in the inspector.";
      area.innerHTML = `
        <div class="p-3.5 rounded-lg bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-rose-300 uppercase tracking-wider">${
              status ? `HTTP ${status}` : "No response"
            } — ${escapeHtml(errorType)}${isBreakingChange ? " (Breaking Change Caught!)" : ""}</span>
            <span class="font-mono text-[11px] px-2 py-0.5 rounded bg-rose-500/20">Status: ${status || "n/a"}</span>
          </div>
          <div class="font-mono text-white bg-claude-bg p-2.5 rounded border border-rose-500/30">${escapeHtml(result.message || "Request failed")}</div>
          <div class="text-[11px] text-slate-300"><strong>How to fix:</strong> ${hint}</div>
        </div>
      `;
      return;
    }

    const res = result.response;
    const textContent = (res.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    area.innerHTML = `
      <div class="flex items-center justify-between border-b border-claude-border pb-2.5">
        <div class="flex items-center gap-2">
          <span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-xs font-semibold">role: "${res.role}"</span>
          <span class="px-2 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-xs">stop_reason: "${res.stop_reason}"</span>
          ${
            localState.structuredJsonSchema
              ? `<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-xs">output_config.format: json_schema</span>`
              : ""
          }
        </div>
        <button id="append-to-history-btn" class="px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-medium transition">
          + Append Response to Conversation History
        </button>
      </div>

      <div class="flex justify-end -mb-1">
        <button id="toggle-raw-btn" class="text-[11px] text-sky-400 hover:underline">${showRaw ? "Show rendered Markdown" : "Show raw text"}</button>
      </div>
      ${
        showRaw || localState.structuredJsonSchema
          ? `<div class="p-3 rounded-lg bg-claude-bg border border-claude-border text-xs text-slate-100 whitespace-pre-wrap leading-relaxed font-mono">${escapeHtml(textContent)}</div>`
          : `<div class="md-body p-3 rounded-lg bg-claude-bg border border-claude-border text-[13px] text-slate-100 leading-relaxed">${renderMarkdown(textContent)}</div>`
      }
    `;
    bindMarkdownCopyButtons(area);
    area.querySelector("#toggle-raw-btn")?.addEventListener("click", () => {
      showRaw = !showRaw;
      renderResponseCard(result);
    });

    const appendBtn = area.querySelector("#append-to-history-btn");
    if (appendBtn) {
      appendBtn.addEventListener("click", () => {
        localState.messages.push({ role: "assistant", content: textContent });
        localState.messages.push({ role: "user", content: "Follow-up question: Can you elaborate on point 1?" });
        lastResult = null;
        render();
      });
    }
  }

  render();

  // Re-render so model-specific warnings match the current model, keeping the last response visible
  function refresh() {
    render();
    if (lastResult) renderResponseCard(lastResult);
  }

  return { onModelChange: refresh, onShow: refresh };
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
