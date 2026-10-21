/**
 * Module 10: Model Comparison (`public/js/modules/compareLab.js`)
 * Sends the same system prompt + user message to 2-3 models in parallel and shows
 * latency, token usage, estimated cost and the rendered answer side by side.
 * Every run is also saved to History, so any pair can be diffed in Module 08.
 */

import { renderMarkdown, bindMarkdownCopyButtons } from "../markdown.js";
import { estimateCost, getModelCatalog } from "../pricing.js";

const MAX_MODELS = 3;

export function renderCompareConceptGuide() {
  return `
    <div class="space-y-4 text-xs leading-relaxed text-slate-300">
      <div class="p-3 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30">
        <div class="font-semibold text-fuchsia-300 mb-1">Choosing a model</div>
        <p>The right model is the cheapest one that still gives answers you're happy with. Run your real prompt on a few candidates and compare quality, latency and cost together.</p>
      </div>
      <ul class="space-y-1.5 text-[11px]">
        <li class="p-2 rounded bg-claude-card border border-claude-border">Requests run in parallel, so latency is comparable.</li>
        <li class="p-2 rounded bg-claude-card border border-claude-border">Costs are estimates from list prices and the returned <code class="font-mono">usage</code>.</li>
      </ul>
    </div>
  `;
}

export function initCompareLab(container, appState) {
  const catalog = getModelCatalog().models;
  let config = {
    system: "You are a helpful assistant. Answer concisely.",
    prompt: "Explain the difference between a process and a thread, with one real-world analogy.",
    max_tokens: 1024,
    models: [appState.getModel(), ...catalog.map((m) => m.id).filter((id) => id !== appState.getModel())].slice(0, 2)
  };
  let results = []; // [{ model, data }]
  let running = false;

  function payloadFor(model) {
    const payload = {
      model,
      max_tokens: Number(config.max_tokens) || 1024,
      messages: [{ role: "user", content: config.prompt }]
    };
    if (config.system.trim()) payload.system = config.system;
    return payload;
  }

  function syncDraft() {
    appState.updateDraftPayload(payloadFor(config.models[0] || appState.getModel()));
  }

  function render() {
    container.innerHTML = `
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4">
        <h2 class="text-base font-semibold text-white">08. Model Comparison</h2>
        <p class="text-xs text-slate-400">Send the same prompt to up to ${MAX_MODELS} models at once and compare latency, tokens, cost and output.</p>
      </div>

      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
        <fieldset>
          <legend class="text-xs font-semibold text-slate-300 mb-1.5">Models (pick 2&ndash;${MAX_MODELS})</legend>
          <div class="flex flex-wrap gap-2">
            ${catalog
              .map((m) => {
                const checked = config.models.includes(m.id);
                const disabled = !checked && config.models.length >= MAX_MODELS;
                return `<label class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${
                  checked ? "bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-100" : "bg-claude-bg border-claude-border text-slate-300"
                } ${disabled ? "opacity-40 cursor-not-allowed" : ""}">
                  <input type="checkbox" data-model="${escapeHtml(m.id)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} class="accent-fuchsia-500" />
                  <span class="font-mono">${escapeHtml(m.id)}</span>
                  <span class="text-slate-500">$${m.pricing.input}/$${m.pricing.output}</span>
                </label>`;
              })
              .join("")}
          </div>
        </fieldset>

        <div>
          <label for="cmp-system-input" class="block text-xs font-semibold text-slate-300 mb-1">System prompt (optional)</label>
          <textarea id="cmp-system-input" rows="2" class="w-full bg-claude-bg border border-claude-border rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-claude-accent">${escapeHtml(config.system)}</textarea>
        </div>
        <div>
          <label for="cmp-prompt-input" class="block text-xs font-semibold text-slate-300 mb-1">User message</label>
          <textarea id="cmp-prompt-input" rows="3" class="w-full bg-claude-bg border border-claude-border rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-claude-accent">${escapeHtml(config.prompt)}</textarea>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <label class="flex items-center gap-2 text-xs text-slate-300">
            <span>max_tokens</span>
            <input id="cmp-maxtok-input" type="number" min="1" step="1" value="${Number(config.max_tokens)}" class="w-24 bg-claude-bg border border-claude-border rounded px-2 py-1 font-mono text-white" />
          </label>
          <button id="cmp-run-btn" class="px-4 py-2 rounded-lg bg-fuchsia-500 hover:bg-fuchsia-400 text-slate-950 font-semibold text-xs transition disabled:opacity-50" ${
            running || config.models.length < 2 || !config.prompt.trim() ? "disabled" : ""
          }>${running ? "Running..." : `Compare ${config.models.length} models`} <span class="opacity-60 font-normal">Ctrl+Enter</span></button>
        </div>
      </div>

      ${results.length ? renderResults() : ""}
    `;
    bindEvents();
    bindMarkdownCopyButtons(container);
  }

  function renderResults() {
    const ok = results.filter((r) => !r.data.error && r.data.response?.usage);
    const cheapest = ok.length ? Math.min(...ok.map((r) => r.cost)) : null;
    const fastest = ok.length ? Math.min(...ok.map((r) => r.latency)) : null;
    return `
      <div class="grid gap-4" style="grid-template-columns: repeat(${results.length}, minmax(0, 1fr));">
        ${results
          .map((r) => {
            if (r.data.error) {
              return `<div class="bg-claude-panel border border-rose-500/40 rounded-xl p-3.5 space-y-2 text-xs">
                <div class="font-mono font-semibold text-white">${escapeHtml(r.model)}</div>
                <div class="text-rose-300">${r.data.status ? `HTTP ${r.data.status}` : "No response"}: ${escapeHtml(r.data.message || "Request failed")}</div>
              </div>`;
            }
            const res = r.data.response;
            const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
            const badge = (label, cls) => `<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}">${label}</span>`;
            return `<div class="bg-claude-panel border border-claude-border rounded-xl p-3.5 space-y-2.5 min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="font-mono text-xs font-semibold text-white">${escapeHtml(r.model)}</span>
                ${r.cost === cheapest && ok.length > 1 ? badge("Cheapest", "bg-emerald-500/20 text-emerald-300") : ""}
                ${r.latency === fastest && ok.length > 1 ? badge("Fastest", "bg-sky-500/20 text-sky-300") : ""}
              </div>
              <div class="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                <div class="p-1.5 rounded bg-claude-bg border border-claude-border">Latency <strong class="text-white">${r.latency}ms</strong></div>
                <div class="p-1.5 rounded bg-claude-bg border border-claude-border">Cost <strong class="text-white">$${r.cost.toFixed(6)}</strong></div>
                <div class="p-1.5 rounded bg-claude-bg border border-claude-border">In <strong class="text-white">${res.usage.input_tokens || 0}</strong></div>
                <div class="p-1.5 rounded bg-claude-bg border border-claude-border">Out <strong class="text-white">${res.usage.output_tokens || 0}</strong></div>
              </div>
              <div class="text-[11px] text-slate-400 font-mono">stop_reason: "${escapeHtml(res.stop_reason || "")}"</div>
              <div class="md-body p-3 rounded-lg bg-claude-bg border border-claude-border text-[13px] text-slate-100 leading-relaxed">${renderMarkdown(text)}</div>
            </div>`;
          })
          .join("")}
      </div>
    `;
  }

  function bindEvents() {
    container.querySelectorAll("input[data-model]").forEach((chk) =>
      chk.addEventListener("change", () => {
        const id = chk.dataset.model;
        config.models = chk.checked ? [...config.models, id].slice(0, MAX_MODELS) : config.models.filter((m) => m !== id);
        render();
        syncDraft();
      })
    );
    const bindText = (sel, key) =>
      container.querySelector(sel).addEventListener("input", (e) => {
        config[key] = e.target.value;
        container.querySelector("#cmp-run-btn").disabled = running || config.models.length < 2 || !config.prompt.trim();
        syncDraft();
      });
    bindText("#cmp-system-input", "system");
    bindText("#cmp-prompt-input", "prompt");
    bindText("#cmp-maxtok-input", "max_tokens");
    container.querySelector("#cmp-run-btn").addEventListener("click", runComparison);
  }

  async function runComparison() {
    running = true;
    render();
    const models = [...config.models];
    const settled = await Promise.all(
      models.map(async (model) => {
        const started = performance.now();
        const data = await appState.executeMessagesRequest(payloadFor(model));
        const latency = Number(data.latencyMs) || Math.round(performance.now() - started);
        const usage = data.response?.usage || {};
        return { model, data, latency, cost: estimateCost(data.response?.model || model, usage).total };
      })
    );
    results = settled;
    running = false;
    render();
  }

  render();
  syncDraft();

  return { onShow: syncDraft };
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
