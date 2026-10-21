/**
 * Module 9: Free-form Playground (`public/js/modules/playgroundLab.js`)
 * A raw JSON request editor for anything the guided labs don't cover:
 * - Validates the JSON as you type, Send (POST /v1/messages) or Stream (SSE) it
 * - Count input tokens before sending (exact in live mode, estimated in the simulator)
 * - Save / load / delete named prompt templates (persisted across restarts)
 */

import { renderMarkdown, bindMarkdownCopyButtons } from "../markdown.js";
import { estimateCost } from "../pricing.js";

export function renderPlaygroundConceptGuide() {
  return `
    <div class="space-y-4 text-xs leading-relaxed text-slate-300">
      <div class="p-3 rounded-lg bg-teal-500/10 border border-teal-500/30">
        <div class="font-semibold text-teal-300 mb-1">Free-form Playground</div>
        <p>Edit the exact JSON body sent to <code class="font-mono">POST /v1/messages</code>. Every field you add is passed through, so you can try parameters the guided labs don't expose.</p>
      </div>
      <ul class="space-y-1.5 text-[11px]">
        <li class="p-2 rounded bg-claude-card border border-claude-border"><strong class="text-white">Send vs. Stream:</strong> Stream adds <code class="font-mono">stream: true</code> and shows text as it arrives.</li>
        <li class="p-2 rounded bg-claude-card border border-claude-border"><strong class="text-white">Count tokens:</strong> calls <code class="font-mono">/v1/messages/count_tokens</code> in live mode (free, no generation). The simulator gives a rough estimate.</li>
        <li class="p-2 rounded bg-claude-card border border-claude-border"><strong class="text-white">Templates:</strong> save the current body under a name and load it later, here or in the Messages lab.</li>
      </ul>
    </div>
  `;
}

export function initPlaygroundLab(container, appState) {
  let jsonText = JSON.stringify(defaultPayload(), null, 2);
  let sendMode = "send"; // "send" | "stream"
  let parseError = null;
  let tokenInfo = null;
  let lastResult = null; // { kind: "message", data } | { kind: "stream", text, thinking, status, usage, stopReason }
  let streamController = null;

  function defaultPayload() {
    return {
      model: appState.getModel(),
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello, Claude! In two sentences, what can you help me with?" }]
    };
  }

  function parsePayload() {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The body must be a JSON object.");
      if (!Array.isArray(parsed.messages)) throw new Error('Missing a "messages" array.');
      parseError = null;
      return parsed;
    } catch (err) {
      parseError = err.message;
      return null;
    }
  }

  function syncDraft() {
    const payload = parsePayload();
    if (payload) appState.updateDraftPayload(payload);
  }

  function render() {
    const templates = appState.getTemplates();
    container.innerHTML = `
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-white">07. Free-form Playground</h2>
          <p class="text-xs text-slate-400">Write any request body as JSON, then send it, stream it, or count its tokens.</p>
        </div>
        <div class="flex items-center bg-claude-bg p-0.5 rounded-lg border border-claude-border text-xs" role="radiogroup" aria-label="Send mode">
          ${["send", "stream"]
            .map(
              (m) => `<button data-send-mode="${m}" role="radio" aria-checked="${sendMode === m}" class="px-3 py-1 rounded-md transition ${
                sendMode === m ? "bg-teal-500/20 text-teal-200 border border-teal-500/40" : "text-slate-400 hover:text-slate-200"
              }">${m === "send" ? "Send" : "Stream"}</button>`
            )
            .join("")}
        </div>
      </div>

      <!-- Templates -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-3 flex flex-wrap items-center gap-2 text-xs">
        <span class="text-slate-400">Templates</span>
        <select id="pg-template-select" aria-label="Saved templates" class="bg-claude-bg border border-claude-border rounded-lg px-2 py-1.5 text-slate-100 min-w-[160px]">
          ${
            templates.length
              ? templates.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join("")
              : `<option value="">No saved templates</option>`
          }
        </select>
        <button id="pg-template-load" class="px-2.5 py-1.5 rounded-lg bg-claude-card hover:bg-slate-800 border border-claude-border text-slate-200" ${templates.length ? "" : "disabled"}>Load</button>
        <button id="pg-template-delete" class="px-2.5 py-1.5 rounded-lg bg-claude-card hover:bg-slate-800 border border-claude-border text-slate-400" ${templates.length ? "" : "disabled"}>Delete</button>
        <span class="mx-1 h-5 w-px bg-claude-border"></span>
        <input id="pg-template-name" type="text" placeholder="Template name" aria-label="New template name" class="bg-claude-bg border border-claude-border rounded-lg px-2 py-1.5 text-slate-100 w-40" />
        <button id="pg-template-save" class="px-2.5 py-1.5 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 border border-teal-500/40 text-teal-200">Save current</button>
      </div>

      <!-- Editor -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-2">
        <div class="flex items-center justify-between">
          <label for="pg-json-input" class="text-xs font-semibold text-slate-300">Request body (JSON)</label>
          <div class="flex items-center gap-2">
            <button id="pg-format-btn" class="text-[11px] text-sky-400 hover:underline">Format</button>
            <button id="pg-reset-btn" class="text-[11px] text-slate-400 hover:underline">Reset</button>
          </div>
        </div>
        <textarea id="pg-json-input" spellcheck="false" rows="16" class="w-full bg-claude-bg border ${
          parseError ? "border-rose-500/60" : "border-claude-border"
        } rounded-lg px-3 py-2 font-mono text-xs text-slate-100 focus:outline-none focus:border-claude-accent resize-y">${escapeHtml(jsonText)}</textarea>
        <div id="pg-parse-status" class="text-[11px] ${parseError ? "text-rose-300" : "text-emerald-400"}">${
          parseError ? `Invalid JSON: ${escapeHtml(parseError)}` : "Valid request body"
        }</div>

        <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div class="flex items-center gap-2 text-xs">
            <button id="pg-count-btn" class="px-3 py-1.5 rounded-lg bg-claude-card hover:bg-slate-800 border border-claude-border text-slate-200">Count tokens</button>
            <span id="pg-token-info" class="text-slate-400 font-mono">${tokenInfoText()}</span>
          </div>
          <div class="flex items-center gap-2">
            <button id="pg-stop-btn" class="${streamController ? "" : "hidden"} px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-semibold">&#9632; Stop</button>
            <button id="pg-send-btn" class="px-4 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-xs transition disabled:opacity-50" ${
              parseError || streamController ? "disabled" : ""
            }>${sendMode === "send" ? "Send request" : "Start stream"} <span class="opacity-60 font-normal">Ctrl+Enter</span></button>
          </div>
        </div>
      </div>

      <div id="pg-result" class="${lastResult ? "" : "hidden"} bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">${renderResult()}</div>
    `;
    bindEvents();
    bindMarkdownCopyButtons(container);
  }

  function tokenInfoText() {
    if (!tokenInfo) return "";
    if (tokenInfo.error) return `Count failed: ${escapeHtml(tokenInfo.message || "error")}`;
    const cost = estimateCost(tokenInfo.model, { input_tokens: tokenInfo.input_tokens }).total;
    return `${tokenInfo.estimated ? "~" : ""}${tokenInfo.input_tokens.toLocaleString()} input tokens &bull; ~$${cost.toFixed(5)} input cost${
      tokenInfo.estimated ? " (simulator estimate)" : ""
    }`;
  }

  function renderResult() {
    if (!lastResult) return "";
    if (lastResult.kind === "stream") {
      const r = lastResult;
      return `
        <div class="flex items-center justify-between text-xs">
          <span class="font-mono text-teal-300">stream &bull; ${escapeHtml(r.status)}${r.stopReason ? ` &bull; stop_reason: "${escapeHtml(r.stopReason)}"` : ""}</span>
          <span class="font-mono text-slate-400">${r.usage ? `in ${r.usage.input_tokens || 0} / out ${r.usage.output_tokens || 0}` : ""}</span>
        </div>
        ${r.thinking ? `<details class="text-xs"><summary class="cursor-pointer text-purple-300">Thinking</summary><pre class="mt-1 whitespace-pre-wrap text-purple-100 font-mono text-[11px]">${escapeHtml(r.thinking)}</pre></details>` : ""}
        <div id="pg-stream-text" class="md-body p-3 rounded-lg bg-claude-bg border border-claude-border text-[13px] text-slate-100 leading-relaxed">${
          r.status === "streaming" ? `<span class="whitespace-pre-wrap">${escapeHtml(r.text)}</span>` : renderMarkdown(r.text)
        }</div>
      `;
    }

    const data = lastResult.data;
    if (data.error) {
      return `
        <div class="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200 space-y-1">
          <div class="font-semibold text-rose-300">${data.status ? `HTTP ${data.status}` : "No response"} &mdash; ${escapeHtml(data.errorType || "error")}</div>
          <div class="font-mono text-white">${escapeHtml(data.message || "Request failed")}</div>
        </div>`;
    }
    const res = data.response || {};
    const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const cost = estimateCost(res.model, res.usage || {}).total;
    return `
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span class="font-mono text-teal-300">${escapeHtml(res.model || "")} &bull; stop_reason: "${escapeHtml(res.stop_reason || "")}" &bull; ${Number(data.latencyMs) || 0}ms</span>
        <span class="font-mono text-slate-400">in ${res.usage?.input_tokens || 0} / out ${res.usage?.output_tokens || 0} &bull; $${cost.toFixed(6)}</span>
      </div>
      <div class="md-body p-3 rounded-lg bg-claude-bg border border-claude-border text-[13px] text-slate-100 leading-relaxed">${
        text ? renderMarkdown(text) : `<span class="text-slate-500">No text blocks in this response. See Raw Response in the inspector.</span>`
      }</div>
    `;
  }

  function bindEvents() {
    const input = container.querySelector("#pg-json-input");
    input.addEventListener("input", () => {
      jsonText = input.value;
      const wasValid = !parseError;
      syncDraft();
      // Update only the status line and button while typing so the cursor stays put
      const status = container.querySelector("#pg-parse-status");
      status.textContent = parseError ? `Invalid JSON: ${parseError}` : "Valid request body";
      status.className = `text-[11px] ${parseError ? "text-rose-300" : "text-emerald-400"}`;
      input.classList.toggle("border-rose-500/60", Boolean(parseError));
      input.classList.toggle("border-claude-border", !parseError);
      if (wasValid === Boolean(parseError)) {
        container.querySelector("#pg-send-btn").disabled = Boolean(parseError) || Boolean(streamController);
      }
    });

    container.querySelectorAll("[data-send-mode]").forEach((btn) =>
      btn.addEventListener("click", () => {
        sendMode = btn.dataset.sendMode;
        render();
      })
    );

    container.querySelector("#pg-format-btn").addEventListener("click", () => {
      const payload = parsePayload();
      if (payload) jsonText = JSON.stringify(payload, null, 2);
      render();
    });
    container.querySelector("#pg-reset-btn").addEventListener("click", () => {
      jsonText = JSON.stringify(defaultPayload(), null, 2);
      tokenInfo = null;
      syncDraft();
      render();
    });

    container.querySelector("#pg-count-btn").addEventListener("click", async (e) => {
      const payload = parsePayload();
      if (!payload) return;
      e.currentTarget.disabled = true;
      tokenInfo = await appState.countTokens(payload);
      render();
    });

    container.querySelector("#pg-send-btn").addEventListener("click", () => (sendMode === "send" ? send() : stream()));
    container.querySelector("#pg-stop-btn").addEventListener("click", () => streamController?.abort());

    // Templates
    const select = container.querySelector("#pg-template-select");
    container.querySelector("#pg-template-load").addEventListener("click", () => {
      const tpl = appState.getTemplates().find((t) => t.name === select.value);
      if (tpl) loadPayload(tpl.payload);
    });
    container.querySelector("#pg-template-delete").addEventListener("click", () => {
      if (!select.value || !confirm(`Delete the template "${select.value}"?`)) return;
      appState.deleteTemplate(select.value);
      render();
    });
    container.querySelector("#pg-template-save").addEventListener("click", () => {
      const name = container.querySelector("#pg-template-name").value;
      const payload = parsePayload();
      if (!payload) return appState.showToast("Fix the JSON before saving it as a template.", "error");
      if (!name.trim()) return appState.showToast("Give the template a name first.", "error");
      appState.saveTemplate(name, payload);
      appState.showToast(`Saved template "${name.trim()}"`, "success");
      render();
    });
  }

  async function send() {
    const payload = parsePayload();
    if (!payload) return;
    delete payload.stream;
    const btn = container.querySelector("#pg-send-btn");
    btn.disabled = true;
    btn.textContent = "Calling API...";
    const data = await appState.executeMessagesRequest(payload);
    lastResult = { kind: "message", data };
    render();
    container.querySelector("#pg-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function stream() {
    const payload = parsePayload();
    if (!payload) return;
    streamController = new AbortController();
    lastResult = { kind: "stream", text: "", thinking: "", status: "streaming", usage: null, stopReason: null };
    render();

    const outcome = await appState.executeSseStream(
      { ...payload, stream: true, _stream_delay_ms: 0 },
      (eventName, dataObj) => {
        const r = lastResult;
        if (eventName === "message_start") r.usage = { ...(dataObj.message?.usage || {}) };
        else if (eventName === "message_delta") {
          r.stopReason = dataObj.delta?.stop_reason || r.stopReason;
          if (dataObj.usage) r.usage = { ...(r.usage || {}), ...dataObj.usage };
        } else if (eventName === "content_block_delta") {
          if (dataObj.delta?.type === "text_delta") r.text += dataObj.delta.text;
          else if (dataObj.delta?.type === "thinking_delta") r.thinking += dataObj.delta.thinking;
        } else if (eventName === "error") {
          r.text += `\n\n[Error: ${dataObj.error?.message || "stream error"}]`;
        }
        const live = container.querySelector("#pg-stream-text span");
        if (live) live.textContent = r.text;
      },
      streamController.signal
    );

    streamController = null;
    lastResult.status = outcome.status === "completed" ? "completed" : outcome.status === "aborted" ? "stopped" : "failed";
    if (outcome.error) lastResult.text += `\n\n[${outcome.error}]`;
    render();
  }

  function loadPayload(payload) {
    jsonText = JSON.stringify(payload, null, 2);
    tokenInfo = null;
    syncDraft();
    render();
  }

  render();
  syncDraft();

  return {
    onShow: syncDraft,
    loadPayload,
    // Keep the editor's "model" in step with the top-bar model selector
    onModelChange() {
      const payload = parsePayload();
      if (!payload) return;
      payload.model = appState.getModel();
      jsonText = JSON.stringify(payload, null, 2);
      tokenInfo = null;
      syncDraft();
      render();
    }
  };
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
