/**
 * Module 06: Server-Side Tools (`web_search`, `code_execution`) & Cache Miss Diagnostics Lab (`public/js/modules/serverToolsDiagLab.js`)
 * Teaches:
 * 1. Client Tools vs. Server Tools:
 *    - Client Tools emit `type: "tool_use"` (`toolu_...`) and stop with `stop_reason: "tool_use"` so YOUR app runs the code.
 *    - Server Tools (`web_search_20260318`, `code_execution_20250522`) are executed by Anthropic's infrastructure! They emit `type: "server_tool_use"` (`srvtoolu_...`) followed immediately by `web_search_tool_result` or `code_execution_tool_result` in the SAME response turn (`stop_reason: "end_turn"`).
 * 2. Request-Level Cache Diagnostics (`diagnostics: { previous_message_id }`):
 *    - Pass the `id` (`msg_...`) of a previous response to diagnose why a prompt cache missed (`model_changed`, `system_changed`, `tools_changed`, `messages_changed`).
 */

export function renderServerToolsDiagConceptGuide() {
  return `
    <div class="space-y-3.5 text-xs leading-relaxed text-slate-300">
      <div class="p-3 rounded-lg bg-sky-500/10 border border-sky-500/30">
        <div class="font-semibold text-sky-300 mb-1">Client Tools vs. Server Tools</div>
        <p class="text-slate-300">
          The official Messages API supports two distinct categories of tools in <code class="font-mono">tools[]</code>:
        </p>
        <ul class="mt-2 space-y-1.5 text-[11px] text-slate-300">
          <li>&bull; <strong class="text-amber-300">Client Tools (<code class="font-mono">toolu_...</code>):</strong> Claude pauses (<code class="font-mono">stop_reason: "tool_use"</code>) and waits for your app to return a <code class="font-mono">tool_result</code>.</li>
          <li>&bull; <strong class="text-sky-300">Server Tools (<code class="font-mono">srvtoolu_...</code>):</strong> Built-in tools like <code class="font-mono">web_search_20260318</code> and <code class="font-mono">code_execution_20250522</code> run inside Anthropic's managed environment and return their results inside a <strong>single API call</strong>!</li>
        </ul>
      </div>

      <div class="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
        <div class="font-semibold text-purple-300 mb-1">Cache Miss Diagnostics (<code class="font-mono">diagnostics</code>)</div>
        <p class="text-slate-300">
          Ever wondered why your prompt cache missed? Pass <code class="font-mono text-purple-300">diagnostics: { previous_message_id: "msg_..." }</code> and the response will include <code class="font-mono">diagnostics.cache_miss_reason</code>:
        </p>
        <ul class="mt-1.5 space-y-0.5 text-[11px] font-mono text-slate-400">
          <li>&bull; "system_changed"</li>
          <li>&bull; "tools_changed"</li>
          <li>&bull; "model_changed"</li>
          <li>&bull; "messages_changed"</li>
        </ul>
      </div>
    </div>
  `;
}

export function initServerToolsDiagLab(container, appState) {
  let state = {
    enableWebSearch: true,
    enableCodeExec: true,
    userPrompt: "Search the latest Claude API server tool docs and calculate the mean and P99 spike of latencies [14.2, 18.5, 19.1, 412.0, 15.8].",
    baselineMsgId: null,
    mutationType: "system_changed", // "system_changed" | "tools_changed" | "model_changed"
    lastServerToolResponse: null,
    lastDiagResponse: null
  };

  function buildPayload(diagReasonOverride = null) {
    const tools = [];
    if (state.enableWebSearch) {
      tools.push({
        type: "web_search_20260318",
        name: "web_search",
        max_uses: 3
      });
    }
    if (state.enableCodeExec) {
      tools.push({
        type: "code_execution_20250522",
        name: "code_execution"
      });
    }

    const payload = {
      model: appState.getModel(),
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: "You are an SRE assistant with access to managed web_search and code_execution server tools.",
          cache_control: { type: "ephemeral" }
        }
      ],
      tools,
      messages: [{ role: "user", content: state.userPrompt }]
    };

    if (state.baselineMsgId) {
      payload.diagnostics = {
        previous_message_id: state.baselineMsgId
      };
    }

    if (diagReasonOverride) {
      payload._sim_diag_reason = diagReasonOverride;
    }

    return payload;
  }

  function syncDraft() {
    appState.updateDraftPayload(buildPayload());
  }

  function render() {
    container.innerHTML = `
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-white">06. Managed Server-Side Tools &amp; Cache Miss Diagnostics Lab</h2>
          <p class="text-xs text-slate-400">Test Anthropic-executed <code class="text-sky-300 font-mono">server_tool_use</code> (<code class="font-mono">srvtoolu_...</code>) and debug prompt cache misses with <code class="text-purple-300 font-mono">diagnostics.previous_message_id</code>.</p>
        </div>
      </div>

      <!-- Two-Column Sandbox: Server Tools vs Cache Diagnostics -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Left: Managed Server Tools -->
        <div class="bg-claude-panel border border-sky-500/30 rounded-xl p-4 space-y-3 flex flex-col justify-between">
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-sky-300">1. Managed Server Tools (<code class="font-mono">srvtoolu_...</code>)</span>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/15 text-sky-300">Single-Turn Execution</span>
            </div>

            <div class="space-y-2">
              <label class="flex items-center justify-between p-2.5 rounded-lg bg-claude-bg border border-claude-border cursor-pointer">
                <div class="flex items-center gap-2">
                  <input id="srv-websearch-chk" type="checkbox" ${state.enableWebSearch ? "checked" : ""} class="accent-sky-500 rounded" />
                  <div>
                    <div class="text-xs font-mono font-semibold text-white">web_search_20260318</div>
                    <div class="text-[11px] text-slate-400">Anthropic executes live web search &amp; returns <code class="font-mono">web_search_tool_result</code></div>
                  </div>
                </div>
                <span class="text-[10px] font-mono text-sky-400">max_uses: 3</span>
              </label>

              <label class="flex items-center justify-between p-2.5 rounded-lg bg-claude-bg border border-claude-border cursor-pointer">
                <div class="flex items-center gap-2">
                  <input id="srv-codeexec-chk" type="checkbox" ${state.enableCodeExec ? "checked" : ""} class="accent-emerald-500 rounded" />
                  <div>
                    <div class="text-xs font-mono font-semibold text-white">code_execution_20250522</div>
                    <div class="text-[11px] text-slate-400">Runs Python in Anthropic's sandboxed container &amp; returns <code class="font-mono">stdout</code></div>
                  </div>
                </div>
                <span class="text-[10px] font-mono text-emerald-400">Sandbox</span>
              </label>
            </div>
          </div>

          <div class="pt-2 border-t border-claude-border flex items-center justify-between gap-2">
            <button id="run-server-tools-btn" class="w-full py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition shadow-lg shadow-sky-950/50">
              &#9889; Execute Request with Managed Server Tools
            </button>
          </div>
        </div>

        <!-- Right: Prompt Cache Miss Diagnostics -->
        <div class="bg-claude-panel border border-purple-500/30 rounded-xl p-4 space-y-3 flex flex-col justify-between">
          <div class="space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-purple-300">2. Cache Miss Diagnostics (<code class="font-mono">diagnostics</code>)</span>
              <span class="text-[10px] font-mono text-slate-400">previous_message_id: ${state.baselineMsgId ? state.baselineMsgId.slice(0, 14) + "..." : "null"}</span>
            </div>

            <p class="text-xs text-slate-300 leading-relaxed">
              When a prompt cache unexpectedly misses, pass the prior turn's <code class="font-mono text-purple-300">id</code> in <code class="font-mono">diagnostics.previous_message_id</code> to get an exact root-cause diagnosis:
            </p>

            <div>
              <label class="block text-[11px] text-slate-400 mb-1">Simulate Prefix Divergence Cause:</label>
              <select id="diag-mutation-select" aria-label="Prefix divergence cause" class="w-full bg-claude-bg border border-claude-border rounded-lg px-3 py-2 text-xs font-mono text-white">
                <option value="system_changed" ${state.mutationType === "system_changed" ? "selected" : ""}>Mutate System Prompt &rarr; "system_changed"</option>
                <option value="tools_changed" ${state.mutationType === "tools_changed" ? "selected" : ""}>Mutate Tool Definitions &rarr; "tools_changed"</option>
                <option value="model_changed" ${state.mutationType === "model_changed" ? "selected" : ""}>Switch Model ID &rarr; "model_changed"</option>
              </select>
            </div>
          </div>

          <div class="pt-2 border-t border-claude-border">
            <button id="run-diag-btn" class="w-full py-2 rounded-lg bg-purple-500 hover:bg-purple-400 text-slate-950 font-semibold text-xs transition shadow-lg shadow-purple-950/50">
              &#128269; Run Cache Miss Diagnostics Check
            </button>
          </div>
        </div>
      </div>

      <!-- Server Tools & Diagnostics Output Cards -->
      ${renderOutputs()}
    `;

    bindEvents();
    syncDraft();
  }

  function renderOutputs() {
    let html = "";

    if (state.lastDiagResponse) {
      const diag = state.lastDiagResponse.diagnostics?.cache_miss_reason;
      if (diag) {
        html += `
          <div class="bg-claude-panel border border-purple-500/40 rounded-xl p-4 space-y-2">
            <div class="flex items-center justify-between">
              <span class="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono text-xs font-semibold">diagnostics.cache_miss_reason.type = "${diag.type}"</span>
              <span class="font-mono text-xs text-amber-300">cache_missed_input_tokens: ${diag.cache_missed_input_tokens}</span>
            </div>
            <p class="text-xs text-slate-300">
              The API compared your current request's prefix fingerprint against <code class="font-mono text-sky-300">${escapeHtml(
                state.baselineMsgId || "msg_prev"
              )}</code> and detected that <strong>${escapeHtml(diag.type)}</strong> invalidated <strong>${diag.cache_missed_input_tokens}</strong> cacheable tokens!
            </p>
          </div>
        `;
      }
    }

    if (state.lastServerToolResponse) {
      const blocks = state.lastServerToolResponse.content || [];
      html += `
        <div class="bg-claude-panel border border-sky-500/40 rounded-xl p-4 space-y-3">
          <div class="flex items-center justify-between border-b border-claude-border pb-2">
            <span class="text-xs font-semibold text-sky-300">Single-Turn Server Tool Execution Trace (${blocks.length} content blocks)</span>
            <span class="font-mono text-xs text-emerald-300">stop_reason: "${state.lastServerToolResponse.stop_reason}"</span>
          </div>
          <div class="space-y-2">
            ${blocks
              .map((b, i) => {
                if (b.type === "server_tool_use") {
                  return `
                    <div class="p-2.5 rounded-lg bg-claude-bg border border-sky-500/30 font-mono text-xs">
                      <div class="text-sky-300 font-semibold">content[${i}] &bull; type: "server_tool_use" &bull; name: "${b.name}" &bull; id: "${b.id}"</div>
                      <pre class="text-[11px] text-slate-300 mt-1 overflow-x-auto">${escapeHtml(JSON.stringify(b.input, null, 2))}</pre>
                    </div>
                  `;
                }
                if (b.type === "web_search_tool_result" || b.type === "code_execution_tool_result") {
                  return `
                    <div class="p-2.5 rounded-lg bg-claude-bg border border-emerald-500/30 font-mono text-xs">
                      <div class="text-emerald-300 font-semibold">content[${i}] &bull; type: "${b.type}" &bull; tool_use_id: "${b.tool_use_id}"</div>
                      <pre class="text-[11px] text-emerald-200 mt-1 overflow-x-auto">${escapeHtml(JSON.stringify(b.content, null, 2))}</pre>
                    </div>
                  `;
                }
                if (b.type === "text") {
                  return `
                    <div class="p-3 rounded-lg bg-claude-bg border border-claude-border text-xs text-slate-100 whitespace-pre-wrap leading-relaxed">${escapeHtml(
                      b.text
                    )}</div>
                  `;
                }
                return "";
              })
              .join("")}
          </div>
        </div>
      `;
    }

    return html;
  }

  function bindEvents() {
    container.querySelector("#srv-websearch-chk").addEventListener("change", (e) => {
      state.enableWebSearch = e.target.checked;
      syncDraft();
    });

    container.querySelector("#srv-codeexec-chk").addEventListener("change", (e) => {
      state.enableCodeExec = e.target.checked;
      syncDraft();
    });

    container.querySelector("#diag-mutation-select").addEventListener("change", (e) => {
      state.mutationType = e.target.value;
    });

    const srvBtn = container.querySelector("#run-server-tools-btn");
    srvBtn.addEventListener("click", async () => {
      srvBtn.disabled = true;
      srvBtn.textContent = "Running Server Tools...";
      const res = await appState.executeMessagesRequest(buildPayload());
      srvBtn.disabled = false;
      srvBtn.innerHTML = "&#9889; Execute Request with Managed Server Tools";
      if (res.response) {
        state.baselineMsgId = res.response.id;
        state.lastServerToolResponse = res.response;
        render();
      }
    });

    const diagBtn = container.querySelector("#run-diag-btn");
    diagBtn.addEventListener("click", async () => {
      diagBtn.disabled = true;
      diagBtn.textContent = "Diagnosing Cache Divergence...";
      if (!state.baselineMsgId) {
        state.baselineMsgId = "msg_sim_baseline_01";
      }
      const res = await appState.executeMessagesRequest(buildPayload(state.mutationType));
      diagBtn.disabled = false;
      diagBtn.innerHTML = "&#128269; Run Cache Miss Diagnostics Check";
      if (res.response) {
        state.lastDiagResponse = res.response;
        render();
      }
    });
  }

  render();

  return { onModelChange: syncDraft, onShow: syncDraft };
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
