/**
 * Module 4: Adaptive & Extended Thinking + Prompt Caching Lab
 * Aligned 1-to-1 with https://platform.claude.com/docs/en/api/messages/create:
 * 1. Thinking Configuration (`thinking`):
 *    - `{ type: "adaptive", display?: "summarized" | "omitted" }` + `output_config.effort` (`"low" | "medium" | "high" | "xhigh" | "max"`)
 *    - `{ type: "enabled", budget_tokens: N, display?: "summarized" | "omitted" }`
 *    - `{ type: "between_tools" }` | `{ type: "disabled" }`
 * 2. Prompt Caching (`cache_control: { type: "ephemeral", ttl?: "5m" | "1h" }`):
 *    - Top-level `cache_control` (automatically applies marker to last cacheable block) OR block-level `cache_control`
 *    - `max_tokens: 0` pre-warming support!
 *    - `usage.output_tokens_details.thinking_tokens` & `usage.cache_creation` (`ephemeral_5m_input_tokens` vs `ephemeral_1h_input_tokens`).
 */

const LARGE_ARCHITECTURE_DOC = `You are a Principal Cloud Architect reviewing requests against the Acme Corp Production Reference Architecture.
Below is the complete Reference Specification (cached via ephemeral prompt caching):
- Tier 1 Gateway: Envoy Proxy with token-bucket rate limiting (5,000 RPS global ceiling, 100 RPS per tenant).
- Tier 2 Auth Service: Stateless JWT verification backed by Redis Cluster (P99 target < 15ms).
- Tier 3 AI Orchestrator: Uses Anthropic Claude API with Prompt Caching enabled on system instructions and tool schemas.
- Database Topology: Primary PostgreSQL 17 instance with 2 read replicas and PgBouncer transaction pooling.
- Incident Escalation Policy: Any P99 latency > 250ms triggers automated read-replica scaling and runbook RB-104.`;

export function renderThinkingCacheConceptGuide() {
  return `
    <div class="space-y-3.5 text-xs leading-relaxed text-slate-300">
      <div class="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
        <div class="font-semibold text-purple-300 mb-1">Official <code class="font-mono">thinking</code> Spec</div>
        <ul class="space-y-1.5 text-[11px] text-slate-300">
          <li>&bull; <strong class="text-emerald-300"><code class="font-mono">type: "adaptive"</code>:</strong> Claude decides when and how much to think. Pair with <code class="font-mono">output_config.effort</code> (<code class="font-mono">low</code>, <code class="font-mono">medium</code>, <code class="font-mono">high</code>, <code class="font-mono">xhigh</code>, <code class="font-mono">max</code>).</li>
          <li>&bull; <strong class="text-purple-300"><code class="font-mono">type: "enabled"</code>:</strong> Manual <code class="font-mono">budget_tokens</code> (&ge;1024, &lt; <code class="font-mono">max_tokens</code>).</li>
          <li>&bull; <strong class="text-sky-300"><code class="font-mono">display: "summarized" | "omitted"</code>:</strong> Controls whether thinking text is returned or redacted (while still returning <code class="font-mono">signature</code> for multi-turn continuity).</li>
          <li>&bull; <strong class="text-amber-300"><code class="font-mono">usage.output_tokens_details.thinking_tokens</code>:</strong> Shows exact internal reasoning tokens billed inside <code class="font-mono">output_tokens</code>.</li>
        </ul>
      </div>

      <div class="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
        <div class="font-semibold text-emerald-300 mb-1">Official <code class="font-mono">cache_control</code> Features</div>
        <ul class="space-y-1.5 text-[11px] text-slate-300">
          <li>&bull; <strong class="text-white">Top-Level vs. Block-Level:</strong> Pass top-level <code class="font-mono">cache_control: { type: "ephemeral" }</code> to automatically mark the last cacheable block, or attach it to specific blocks.</li>
          <li>&bull; <strong class="text-white"><code class="font-mono">ttl: "5m" | "1h"</code>:</strong> Choose 5-minute (default) or 1-hour cache lifetime.</li>
          <li>&bull; <strong class="text-white"><code class="font-mono">max_tokens: 0</code> Pre-Warming:</strong> Set <code class="font-mono">max_tokens: 0</code> to populate the prompt cache without generating a response!</li>
        </ul>
      </div>
    </div>
  `;
}

export function initThinkingCacheLab(container, appState) {
  let state = {
    thinkingMode: "adaptive", // "adaptive" | "enabled" | "disabled"
    thinkingDisplay: "summarized", // "summarized" | "omitted"
    effort: "high", // "low" | "medium" | "high" | "xhigh" | "max"
    budgetTokens: 2048,
    maxTokens: 4096,
    enablePromptCache: true,
    useTopLevelCacheControl: false,
    cacheTtl: "5m", // "5m" | "1h"
    systemDoc: LARGE_ARCHITECTURE_DOC,
    userPrompt: "Our Auth Service P99 latency just hit 410ms. Based on the architecture spec, which tier is affected and what runbook triggers?",
    runsHistory: []
  };

  function buildPayload(simCacheOverride = null, customMaxTokens = null) {
    const cacheMarker = {
      type: "ephemeral",
      ...(state.cacheTtl === "1h" ? { ttl: "1h" } : { ttl: "5m" })
    };

    const payload = {
      model: appState.getModel(),
      max_tokens: customMaxTokens !== null ? customMaxTokens : Number(state.maxTokens),
      system: [
        {
          type: "text",
          text: state.systemDoc,
          ...(state.enablePromptCache && !state.useTopLevelCacheControl ? { cache_control: cacheMarker } : {})
        }
      ],
      messages: [{ role: "user", content: state.userPrompt }]
    };

    if (state.enablePromptCache && state.useTopLevelCacheControl) {
      payload.cache_control = cacheMarker;
    }

    if (state.thinkingMode === "adaptive") {
      payload.thinking = {
        type: "adaptive",
        display: state.thinkingDisplay
      };
      payload.output_config = { effort: state.effort };
    } else if (state.thinkingMode === "enabled") {
      payload.thinking = {
        type: "enabled",
        budget_tokens: Number(state.budgetTokens),
        display: state.thinkingDisplay
      };
    } else if (state.thinkingMode === "disabled") {
      payload.thinking = { type: "disabled" };
    }

    if (simCacheOverride) {
      payload._sim_cache_mode = simCacheOverride;
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
          <h2 class="text-base font-semibold text-white">04. Adaptive Thinking, <code class="text-purple-300 font-mono text-sm">display</code> &amp; Prompt Caching (<code class="text-emerald-300 font-mono text-sm">5m / 1h TTL</code>)</h2>
          <p class="text-xs text-slate-400">Configure <code class="text-purple-300 font-mono">thinking</code> (<code class="font-mono">adaptive</code> vs <code class="font-mono">enabled</code>, <code class="font-mono">display: "summarized" | "omitted"</code>) and test Prompt Caching including <code class="text-amber-300 font-mono">max_tokens: 0</code> cache pre-warming.</p>
        </div>
        <button id="clear-cache-btn" class="px-3 py-1.5 rounded-lg bg-claude-card hover:bg-slate-800 border border-claude-border text-xs text-slate-300 transition">
          Reset Ephemeral Cache State
        </button>
      </div>

      <!-- Configuration Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Left: Thinking Controls -->
        <div class="bg-claude-panel border border-purple-500/30 rounded-xl p-4 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold text-purple-300">Thinking Mode (<code class="font-mono">thinking.type</code>)</span>
            <select id="thinking-mode-select" aria-label="Thinking mode" class="bg-claude-bg border border-purple-500/40 rounded-lg px-2.5 py-1 text-xs font-mono text-purple-200 focus:outline-none">
              <option value="adaptive" ${state.thinkingMode === "adaptive" ? "selected" : ""}>type: "adaptive" (Recommended)</option>
              <option value="enabled" ${state.thinkingMode === "enabled" ? "selected" : ""}>type: "enabled" (Manual budget_tokens)</option>
              <option value="disabled" ${state.thinkingMode === "disabled" ? "selected" : ""}>type: "disabled"</option>
            </select>
          </div>

          ${
            state.thinkingMode !== "disabled"
              ? `
            <div class="flex items-center justify-between text-xs bg-claude-bg px-3 py-2 rounded-lg border border-claude-border">
              <span class="text-slate-300"><code class="text-purple-300 font-mono">thinking.display</code></span>
              <div class="flex items-center gap-1.5 font-mono">
                <button data-display="summarized" class="display-mode-btn px-2 py-0.5 rounded text-[11px] border ${
                  state.thinkingDisplay === "summarized"
                    ? "bg-purple-500/25 text-purple-200 border-purple-500/50"
                    : "text-slate-400 border-claude-border"
                }">"summarized"</button>
                <button data-display="omitted" class="display-mode-btn px-2 py-0.5 rounded text-[11px] border ${
                  state.thinkingDisplay === "omitted"
                    ? "bg-purple-500/25 text-purple-200 border-purple-500/50"
                    : "text-slate-400 border-claude-border"
                }">"omitted" (Redacted)</button>
              </div>
            </div>
          `
              : ""
          }

          ${
            state.thinkingMode === "adaptive"
              ? `
            <div class="p-3 rounded-lg bg-claude-bg border border-purple-500/20 space-y-2">
              <div class="flex justify-between text-xs">
                <span class="text-slate-300 font-medium"><code class="text-emerald-300 font-mono">output_config.effort</code></span>
                <span class="font-mono text-emerald-300 font-semibold">"${state.effort}"</span>
              </div>
              <div class="grid grid-cols-5 gap-1.5">
                ${["low", "medium", "high", "xhigh", "max"]
                  .map(
                    (eff) => `
                  <button data-effort="${eff}" class="effort-pill-btn py-1 rounded font-mono text-xs border transition ${
                      state.effort === eff
                        ? "bg-purple-500/25 text-purple-200 border-purple-500/60 font-semibold"
                        : "bg-claude-panel text-slate-400 border-claude-border hover:text-white"
                    }">
                    ${eff}
                  </button>
                `
                  )
                  .join("")}
              </div>
            </div>
          `
              : state.thinkingMode === "enabled"
              ? `
            <div>
              <div class="flex justify-between text-xs mb-1">
                <span class="text-slate-300"><code class="text-purple-300 font-mono">thinking.budget_tokens</code></span>
                <span id="budget-val-label" class="font-mono text-purple-300 font-semibold">${state.budgetTokens} tokens</span>
              </div>
              <input id="budget-slider" type="range" min="1024" max="8192" step="512" value="${state.budgetTokens}" class="w-full accent-purple-500 cursor-pointer" />
            </div>
          `
              : ""
          }

          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="text-slate-300"><code class="text-sky-300 font-mono">max_tokens</code></span>
              <span id="think-maxtok-label" class="font-mono text-sky-300 font-semibold">${state.maxTokens} tokens</span>
            </div>
            <input id="think-maxtok-slider" aria-label="max_tokens" type="range" min="2048" max="16384" step="512" value="${state.maxTokens}" class="w-full accent-sky-500 cursor-pointer" />
          </div>
        </div>

        <!-- Right: Prompt Caching Breakpoint Controls -->
        <div class="bg-claude-panel border border-emerald-500/30 rounded-xl p-4 space-y-3">
          <div class="flex items-center justify-between">
            <label class="flex items-center gap-2 cursor-pointer">
              <input id="cache-enable-chk" type="checkbox" ${state.enablePromptCache ? "checked" : ""} class="accent-emerald-500 rounded" />
              <span class="text-xs font-semibold text-emerald-300">Enable <code class="font-mono">cache_control: { type: "ephemeral" }</code></span>
            </label>
            <div class="flex items-center gap-1 font-mono text-[11px]">
              <button data-ttl="5m" class="ttl-btn px-2 py-0.5 rounded border ${
                state.cacheTtl === "5m" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "text-slate-400 border-claude-border"
              }">ttl: "5m"</button>
              <button data-ttl="1h" class="ttl-btn px-2 py-0.5 rounded border ${
                state.cacheTtl === "1h" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" : "text-slate-400 border-claude-border"
              }">ttl: "1h"</button>
            </div>
          </div>

          <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer bg-claude-bg px-3 py-1.5 rounded-lg border border-claude-border">
            <input id="toplevel-cache-chk" type="checkbox" ${state.useTopLevelCacheControl ? "checked" : ""} class="accent-emerald-500 rounded" />
            <span>Use <strong>Top-Level</strong> <code class="font-mono text-emerald-300">cache_control</code> (auto-marks last cacheable block)</span>
          </label>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Cached System Context Block (1,024+ token static prefix)</label>
            <textarea id="cache-doc-input" aria-label="Cached system context block" rows="3" class="w-full bg-claude-bg border border-claude-border rounded-lg p-2 text-xs text-slate-200 font-mono focus:outline-none">${escapeHtml(
              state.systemDoc
            )}</textarea>
          </div>
        </div>
      </div>

      <!-- Prompt & Pre-warm / Turn 1 / Turn 2 Action Buttons -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">User Question (Dynamic Suffix — Not Cached)</label>
          <input id="think-user-prompt" aria-label="User question" type="text" value="${escapeHtml(state.userPrompt)}" class="w-full bg-claude-bg border border-claude-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-claude-accent" />
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div class="text-[11px] text-slate-400">
            Test <strong>Pre-warm (<code class="font-mono">max_tokens: 0</code>)</strong>, <strong>Turn 1 (Cache Write)</strong>, and <strong>Turn 2 (Cache Hit)</strong>:
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button id="prewarm-cache-btn" class="px-3 py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 font-semibold text-xs transition" title="Sets max_tokens: 0 to populate cache without generating output">
              Pre-Warm Cache (<code class="font-mono">max_tokens: 0</code>)
            </button>
            <button id="run-turn1-btn" class="px-3.5 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-semibold text-xs transition">
              1. Run Turn 1 (Cache Write)
            </button>
            <button id="run-turn2-btn" class="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition shadow-lg shadow-emerald-950/50">
              2. Run Turn 2 (Cache Hit &mdash; 90% Saved)
            </button>
          </div>
        </div>
      </div>

      <!-- Results & Cache Comparison Table -->
      <div id="thinking-results-area" class="space-y-4">
        ${renderHistoryComparison()}
      </div>
    `;

    bindEvents();
    syncDraft();
  }

  function renderHistoryComparison() {
    if (state.runsHistory.length === 0) return "";

    const latest = state.runsHistory[state.runsHistory.length - 1];
    const msg = latest.response;
    const thinkingBlock = (msg.content || []).find((b) => b.type === "thinking");
    const textBlock = (msg.content || []).find((b) => b.type === "text");

    return `
      <!-- Cache & Token Comparison Table -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-2.5">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">Official <code class="font-mono text-sky-400">usage</code> &amp; <code class="font-mono text-purple-300">output_tokens_details</code> Telemetry</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs font-mono border-collapse">
            <thead>
              <tr class="border-b border-claude-border text-slate-400 text-[11px]">
                <th class="py-2 px-2">Run</th>
                <th class="py-2 px-2">Status</th>
                <th class="py-2 px-2">input_tokens</th>
                <th class="py-2 px-2 text-amber-300">cache_creation (5m/1h)</th>
                <th class="py-2 px-2 text-emerald-300">cache_read</th>
                <th class="py-2 px-2 text-purple-300">thinking_tokens</th>
                <th class="py-2 px-2 text-sky-300">output_tokens</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-claude-border/60">
              ${state.runsHistory
                .map((r, i) => {
                  const u = r.response.usage || {};
                  const isHit = (u.cache_read_input_tokens || 0) > 0;
                  const isWrite = (u.cache_creation_input_tokens || 0) > 0;
                  const isPrewarm = u.output_tokens === 0;
                  const ttlInfo = u.cache_creation?.ephemeral_1h_input_tokens > 0 ? "1h TTL" : "5m TTL";
                  return `
                  <tr class="bg-claude-bg/50">
                    <td class="py-2 px-2 font-semibold text-white">Run #${i + 1}</td>
                    <td class="py-2 px-2">
                      ${
                        isPrewarm
                          ? `<span class="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">PRE-WARM (max_tokens: 0)</span>`
                          : isHit
                          ? `<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">CACHE HIT (-90%)</span>`
                          : isWrite
                          ? `<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">CACHE WRITE (${ttlInfo})</span>`
                          : `<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-400">UNCACHED</span>`
                      }
                    </td>
                    <td class="py-2 px-2">${u.input_tokens || 0}</td>
                    <td class="py-2 px-2 text-amber-300 font-semibold">${u.cache_creation_input_tokens || 0}</td>
                    <td class="py-2 px-2 text-emerald-300 font-semibold">${u.cache_read_input_tokens || 0}</td>
                    <td class="py-2 px-2 text-purple-300">${u.output_tokens_details?.thinking_tokens ?? 0}</td>
                    <td class="py-2 px-2 text-sky-300 font-semibold">${u.output_tokens || 0}</td>
                  </tr>
                `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Thinking Trace + Output Block -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        ${
          thinkingBlock
            ? `
          <div class="bg-claude-panel border border-purple-500/40 rounded-xl p-4 space-y-2">
            <div class="flex items-center justify-between">
              <span class="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono text-xs font-semibold">content[0] &bull; type: "thinking"</span>
              <span class="text-[10px] font-mono text-slate-400 truncate max-w-[200px]" title="${escapeHtml(thinkingBlock.signature)}">signature: ${escapeHtml(
                (thinkingBlock.signature || "").slice(0, 20)
              )}...</span>
            </div>
            <pre class="p-3 rounded-lg bg-claude-bg border border-claude-border text-xs text-purple-100 font-mono whitespace-pre-wrap leading-relaxed">${
              thinkingBlock.thinking
                ? escapeHtml(thinkingBlock.thinking)
                : `<span class="text-slate-400 italic">[thinking content omitted because display: "omitted" was requested; cryptographic signature still returned for multi-turn continuity]</span>`
            }</pre>
          </div>
        `
            : ""
        }

        <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-2 ${thinkingBlock ? "" : "lg:col-span-2"}">
          <div class="flex items-center justify-between">
            <span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono text-xs font-semibold">Stop Reason: "${msg.stop_reason}"</span>
            <span class="text-xs font-mono text-slate-400">content blocks: ${(msg.content || []).length}</span>
          </div>
          <div class="p-3 rounded-lg bg-claude-bg border border-claude-border text-xs text-slate-100 whitespace-pre-wrap leading-relaxed">${
            textBlock
              ? escapeHtml(textBlock.text)
              : `<span class="text-purple-300 font-mono">max_tokens: 0 — Prompt cache populated without generating assistant output tokens!</span>`
          }</div>
        </div>
      </div>
    `;
  }

  function bindEvents() {
    container.querySelector("#thinking-mode-select").addEventListener("change", (e) => {
      state.thinkingMode = e.target.value;
      render();
    });

    container.querySelectorAll(".display-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.thinkingDisplay = btn.dataset.display;
        render();
      });
    });

    container.querySelectorAll(".effort-pill-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.effort = btn.dataset.effort;
        render();
      });
    });

    container.querySelectorAll(".ttl-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.cacheTtl = btn.dataset.ttl;
        render();
      });
    });

    container.querySelector("#toplevel-cache-chk").addEventListener("change", (e) => {
      state.useTopLevelCacheControl = e.target.checked;
      syncDraft();
    });

    const budgetSlider = container.querySelector("#budget-slider");
    const budgetLabel = container.querySelector("#budget-val-label");
    if (budgetSlider) {
      budgetSlider.addEventListener("input", (e) => {
        state.budgetTokens = Number(e.target.value);
        if (state.maxTokens <= state.budgetTokens) {
          state.maxTokens = state.budgetTokens + 1024;
          container.querySelector("#think-maxtok-slider").value = state.maxTokens;
          container.querySelector("#think-maxtok-label").textContent = `${state.maxTokens} tokens`;
        }
        budgetLabel.textContent = `${state.budgetTokens} tokens`;
        syncDraft();
      });
    }

    const maxTokSlider = container.querySelector("#think-maxtok-slider");
    const maxTokLabel = container.querySelector("#think-maxtok-label");
    maxTokSlider.addEventListener("input", (e) => {
      const minAllowed = state.thinkingMode === "enabled" ? state.budgetTokens + 512 : 2048;
      state.maxTokens = Math.max(minAllowed, Number(e.target.value));
      maxTokSlider.value = state.maxTokens;
      maxTokLabel.textContent = `${state.maxTokens} tokens`;
      syncDraft();
    });

    container.querySelector("#cache-enable-chk").addEventListener("change", (e) => {
      state.enablePromptCache = e.target.checked;
      syncDraft();
    });

    container.querySelector("#cache-doc-input").addEventListener("input", (e) => {
      state.systemDoc = e.target.value;
      syncDraft();
    });

    container.querySelector("#think-user-prompt").addEventListener("input", (e) => {
      state.userPrompt = e.target.value;
      syncDraft();
    });

    container.querySelector("#clear-cache-btn").addEventListener("click", async () => {
      await fetch("/api/cache/reset", { method: "POST" });
      state.runsHistory = [];
      render();
    });

    const runTurn = async (cacheMode, btn, customMaxTokens = null) => {
      const origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = "Calling API...";
      const payload = buildPayload(cacheMode, customMaxTokens);
      const result = await appState.executeMessagesRequest(payload);
      btn.disabled = false;
      btn.innerHTML = origHtml;

      if (result.response && !result.error) {
        state.runsHistory.push(result);
        render();
      }
    };

    container.querySelector("#prewarm-cache-btn").addEventListener("click", (e) => runTurn("write", e.currentTarget, 0));
    container.querySelector("#run-turn1-btn").addEventListener("click", (e) => runTurn("write", e.currentTarget));
    container.querySelector("#run-turn2-btn").addEventListener("click", (e) => {
      state.userPrompt = "Follow-up question on the same cached architecture doc: What is our Tier 1 Envoy global RPS limit?";
      runTurn("hit", e.currentTarget);
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
