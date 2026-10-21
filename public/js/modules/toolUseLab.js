/**
 * Module 3: Tool Use (Function Calling) & Agentic Loop State Machine
 * Teaches the single most important concept in Claude Tool Use:
 * Claude does NOT execute functions on its servers. Instead:
 *   Step 1: You send `tools` schemas + user prompt.
 *   Step 2: Claude responds with `stop_reason: "tool_use"` and a `tool_use` content block (`id`, `name`, `input`).
 *   Step 3: YOUR application runs the function locally and sends a new `role: "user"` message containing a `tool_result` block with matching `tool_use_id`.
 *   Step 4: Claude synthesizes the final answer (`stop_reason: "end_turn"`).
 */

import { renderMarkdown, bindMarkdownCopyButtons } from "../markdown.js";

export function renderToolUseConceptGuide() {
  return `
    <div class="space-y-4 text-xs leading-relaxed text-slate-300">
      <div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <div class="font-semibold text-amber-400 mb-1">Golden Rule of Tool Use</div>
        <p class="text-slate-300">
          <strong>Claude never executes your tools directly.</strong> Claude only emits a structured <code class="font-mono text-amber-300">tool_use</code> JSON request and pauses with <code class="font-mono text-sky-300">stop_reason: "tool_use"</code>.
        </p>
      </div>

      <div class="space-y-2">
        <h4 class="font-semibold text-white uppercase tracking-wider text-[11px]">The 4-Step Agentic Loop</h4>
        <div class="space-y-1.5 text-[11px]">
          <div class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="text-emerald-400 font-semibold">Step 1 (User &rarr; Claude):</span> Pass <code class="font-mono">tools: [{ name, description, input_schema }]</code> and user prompt.
          </div>
          <div class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="text-amber-400 font-semibold">Step 2 (Claude &rarr; App):</span> Claude returns <code class="font-mono">stop_reason: "tool_use"</code> with a <code class="font-mono">tool_use</code> block (<code class="font-mono">id: "toolu_..."</code>).
          </div>
          <div class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="text-sky-400 font-semibold">Step 3 (App Executes &rarr; Claude):</span> Your code runs the function and appends a <code class="font-mono">role: "user"</code> turn containing <code class="font-mono">{ type: "tool_result", tool_use_id, content }</code>.
          </div>
          <div class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="text-purple-400 font-semibold">Step 4 (Claude &rarr; User):</span> Claude reads the <code class="font-mono">tool_result</code> and produces the final answer.
          </div>
        </div>
      </div>

      <div class="p-2.5 rounded bg-claude-card border border-claude-border text-[11px] text-slate-400">
        <strong class="text-slate-200">Tip:</strong> <code class="font-mono text-sky-300">tool_choice</code> lets you control whether Claude chooses automatically (<code class="font-mono">auto</code>), must call any tool (<code class="font-mono">any</code>), or must call a specific tool (<code class="font-mono">tool</code>).
      </div>
    </div>
  `;
}

export function initToolUseLab(container, appState) {
  const sampleTools = appState.getSampleTools();
  let state = {
    prompt: "What is the current weather in Tokyo, Japan and what should I pack?",
    toolChoice: "auto", // auto | any | get_weather | query_customer_db | calculate_cloud_cost
    pauseForInspection: true,
    currentPhase: 1, // 1: Ready, 2: Paused at tool_use, 3: Local tool executed, 4: Final answer received
    assistantToolUseMsg: null,
    detectedToolUseBlock: null,
    localToolOutputStr: "",
    finalAssistantMsg: null
  };

  function buildCurrentMessages() {
    const msgs = [{ role: "user", content: state.prompt }];
    if (state.assistantToolUseMsg) {
      msgs.push({
        role: "assistant",
        content: state.assistantToolUseMsg.content
      });
    }
    if (state.currentPhase >= 3 && state.detectedToolUseBlock) {
      msgs.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: state.detectedToolUseBlock.id,
            content: state.localToolOutputStr
          }
        ]
      });
    }
    return msgs;
  }

  function syncDraft() {
    const payload = {
      model: appState.getModel(),
      max_tokens: 1024,
      tools: sampleTools,
      messages: buildCurrentMessages()
    };
    if (state.toolChoice === "auto" || state.toolChoice === "any") {
      payload.tool_choice = { type: state.toolChoice };
    } else {
      payload.tool_choice = { type: "tool", name: state.toolChoice };
    }
    appState.updateDraftPayload(payload);
  }

  function render() {
    container.innerHTML = `
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-white">03. Tool Use &amp; Agentic Loop State Machine</h2>
          <p class="text-xs text-slate-400">Step through the tool loop interactively—pause at <code class="text-amber-300 font-mono">stop_reason: "tool_use"</code>, edit the local tool output, and send back <code class="text-emerald-300 font-mono">tool_result</code>.</p>
        </div>
        <div class="flex items-center gap-2">
          <button data-scenario="weather" class="scenario-btn px-2.5 py-1 rounded bg-claude-card hover:bg-slate-800 border border-claude-border text-xs text-slate-200">Weather Tool</button>
          <button data-scenario="customer" class="scenario-btn px-2.5 py-1 rounded bg-claude-card hover:bg-slate-800 border border-claude-border text-xs text-slate-200">Customer DB Tool</button>
          <button data-scenario="cost" class="scenario-btn px-2.5 py-1 rounded bg-claude-card hover:bg-slate-800 border border-claude-border text-xs text-slate-200">Cloud Cost Calculator</button>
        </div>
      </div>

      <!-- Visual 4-Step State Machine Stepper -->
      <div class="grid grid-cols-4 gap-2.5">
        ${[
          { step: 1, title: "1. Send Prompt + Tools", sub: "POST /v1/messages" },
          { step: 2, title: "2. Claude Emits tool_use", sub: 'stop_reason: "tool_use"' },
          { step: 3, title: "3. App Runs Local Function", sub: "Builds tool_result block" },
          { step: 4, title: "4. Final Synthesis", sub: 'stop_reason: "end_turn"' }
        ]
          .map(
            (item) => `
          <div class="p-3 rounded-xl border ${
            state.currentPhase === item.step
              ? "bg-amber-500/15 border-amber-500/50 text-amber-200"
              : state.currentPhase > item.step
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-claude-panel border-claude-border text-slate-400"
          }">
            <div class="text-xs font-semibold">${item.title}</div>
            <div class="text-[11px] font-mono opacity-80 mt-0.5">${item.sub}</div>
          </div>
        `
          )
          .join("")}
      </div>

      <!-- Step 1 Configuration Card -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="md:col-span-2">
            <label class="block text-xs font-semibold text-slate-300 mb-1">User Prompt</label>
            <input id="tool-prompt-input" aria-label="Tool use user prompt" type="text" value="${escapeHtml(state.prompt)}" class="w-full bg-claude-bg border border-claude-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-claude-accent" />
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1"><code class="text-sky-400 font-mono">tool_choice</code> Strategy</label>
            <select id="tool-choice-select" aria-label="tool_choice strategy" class="w-full bg-claude-bg border border-claude-border rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none">
              <option value="auto" ${state.toolChoice === "auto" ? "selected" : ""}>auto (Claude decides)</option>
              <option value="any" ${state.toolChoice === "any" ? "selected" : ""}>any (Must call a tool)</option>
              <option value="get_weather" ${state.toolChoice === "get_weather" ? "selected" : ""}>Force: get_weather</option>
              <option value="query_customer_db" ${state.toolChoice === "query_customer_db" ? "selected" : ""}>Force: query_customer_db</option>
              <option value="calculate_cloud_cost" ${state.toolChoice === "calculate_cloud_cost" ? "selected" : ""}>Force: calculate_cloud_cost</option>
            </select>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-claude-border">
          <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input id="pause-loop-chk" type="checkbox" ${state.pauseForInspection ? "checked" : ""} class="accent-amber-500 rounded" />
            <span><strong>Interactive Step-by-Step Mode:</strong> Pause at <code class="text-amber-300 font-mono">stop_reason: "tool_use"</code> so I can inspect &amp; edit the tool execution</span>
          </label>
          <div class="flex items-center gap-2">
            ${
              state.currentPhase > 1
                ? `<button id="reset-tool-loop-btn" class="px-3 py-1.5 rounded-lg border border-claude-border text-xs text-slate-300 hover:bg-slate-800">Reset Loop</button>`
                : ""
            }
            <button id="step1-send-btn" class="px-4 py-2 rounded-lg bg-claude-accent hover:bg-claude-accentHover text-white font-semibold text-xs transition shadow-lg shadow-orange-950/50">
              ${state.pauseForInspection ? "Step 1: Send Request to Claude &rarr;" : "Run Full Agentic Loop Automatically &rarr;"}
            </button>
          </div>
        </div>
      </div>

      <!-- Step 2 & 3 Interactive Inspection Panel (Shown once Claude emits tool_use) -->
      ${
        state.detectedToolUseBlock
          ? `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- Step 2: Claude's tool_use request -->
          <div class="bg-claude-panel border border-amber-500/40 rounded-xl p-4 space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-xs font-semibold">Step 2: Claude Paused (stop_reason: "tool_use")</span>
              <span class="font-mono text-[11px] text-slate-400">id: ${state.detectedToolUseBlock.id}</span>
            </div>
            <p class="text-xs text-slate-300">
              Claude wants your application to run <code class="text-amber-300 font-mono font-semibold">${state.detectedToolUseBlock.name}</code> with these JSON arguments:
            </p>
            <pre class="p-3 rounded-lg bg-claude-bg border border-claude-border font-mono text-xs text-amber-200 overflow-x-auto">${escapeHtml(
              JSON.stringify(state.detectedToolUseBlock, null, 2)
            )}</pre>
          </div>

          <!-- Step 3: Your Application's Local Execution & tool_result -->
          <div class="bg-claude-panel border border-sky-500/40 rounded-xl p-4 space-y-2.5 flex flex-col justify-between">
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono text-xs font-semibold">Step 3: Local Tool Output &rarr; tool_result</span>
                <span class="text-[11px] text-slate-400">Editable before sending to Claude!</span>
              </div>
              <p class="text-xs text-slate-300">
                Your server ran <code class="font-mono text-sky-300">${state.detectedToolUseBlock.name}()</code>. You can tweak the JSON below to see how Claude adapts its final answer:
              </p>
              <textarea id="editable-tool-result" rows="6" class="w-full bg-claude-bg border border-claude-border rounded-lg p-2.5 font-mono text-xs text-emerald-300 focus:outline-none focus:border-sky-400">${escapeHtml(
                state.localToolOutputStr
              )}</textarea>
            </div>

            <div class="pt-2 flex justify-end">
              <button id="step3-send-result-btn" class="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition shadow-lg shadow-sky-950/50">
                Step 3 &rarr; 4: Send tool_result Back to Claude
              </button>
            </div>
          </div>
        </div>
      `
          : ""
      }

      <!-- Step 4: Final Synthesized Response -->
      ${
        state.finalAssistantMsg
          ? `
        <div class="bg-claude-panel border border-emerald-500/40 rounded-xl p-4 space-y-2.5">
          <div class="flex items-center justify-between border-b border-claude-border pb-2">
            <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-xs font-semibold">Step 4: Final Answer (stop_reason: "${state.finalAssistantMsg.stop_reason}")</span>
            <span class="text-xs text-slate-400">Conversation array now has 4 turns (User &rarr; Assistant [tool_use] &rarr; User [tool_result] &rarr; Assistant)</span>
          </div>
          <div class="md-body p-3 rounded-lg bg-claude-bg border border-claude-border text-[13px] text-slate-100 leading-relaxed">${renderMarkdown(
            (state.finalAssistantMsg.content || [])
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("\n")
          )}</div>
        </div>
      `
          : ""
      }
    `;

    bindEvents();
    bindMarkdownCopyButtons(container);
    syncDraft();
  }

  function bindEvents() {
    container.querySelectorAll(".scenario-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sc = btn.dataset.scenario;
        state.currentPhase = 1;
        state.assistantToolUseMsg = null;
        state.detectedToolUseBlock = null;
        state.finalAssistantMsg = null;

        if (sc === "weather") {
          state.prompt = "What is the current weather in Tokyo, Japan and what should I pack?";
          state.toolChoice = "auto";
        } else if (sc === "customer") {
          state.prompt = "Look up customer alex.rivera@example.com and summarize their plan tier and recent orders.";
          state.toolChoice = "auto";
        } else if (sc === "cost") {
          state.prompt = "Calculate our monthly Claude API cost for 5,000 daily requests averaging 4,000 input tokens and 600 output tokens with an 85% prompt cache hit rate.";
          state.toolChoice = "auto";
        }
        render();
      });
    });

    const promptInput = container.querySelector("#tool-prompt-input");
    promptInput.addEventListener("input", (e) => {
      state.prompt = e.target.value;
      syncDraft();
    });

    const choiceSelect = container.querySelector("#tool-choice-select");
    choiceSelect.addEventListener("change", (e) => {
      state.toolChoice = e.target.value;
      syncDraft();
    });

    const pauseChk = container.querySelector("#pause-loop-chk");
    pauseChk.addEventListener("change", (e) => {
      state.pauseForInspection = e.target.checked;
      render();
    });

    const resetBtn = container.querySelector("#reset-tool-loop-btn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        state.currentPhase = 1;
        state.assistantToolUseMsg = null;
        state.detectedToolUseBlock = null;
        state.finalAssistantMsg = null;
        render();
      });
    }

    const step1Btn = container.querySelector("#step1-send-btn");
    step1Btn.addEventListener("click", async () => {
      state.currentPhase = 1;
      state.assistantToolUseMsg = null;
      state.detectedToolUseBlock = null;
      state.finalAssistantMsg = null;
      syncDraft();

      step1Btn.disabled = true;
      step1Btn.textContent = "Calling Claude...";

      const res1 = await appState.executeMessagesRequest(appState.getDraftPayload());
      if (res1.error || !res1.response) {
        step1Btn.disabled = false;
        step1Btn.textContent = "Retry Step 1";
        return;
      }

      const msg1 = res1.response;
      const toolUseBlock = (msg1.content || []).find((b) => b.type === "tool_use");

      if (!toolUseBlock) {
        // Claude answered directly without calling a tool
        state.currentPhase = 4;
        state.finalAssistantMsg = msg1;
        render();
        return;
      }

      // Execute local tool on backend to pre-populate the result
      const localExec = await appState.executeLocalToolCall({
        name: toolUseBlock.name,
        input: toolUseBlock.input,
        tool_use_id: toolUseBlock.id
      });

      state.assistantToolUseMsg = msg1;
      state.detectedToolUseBlock = toolUseBlock;
      state.localToolOutputStr = JSON.stringify(localExec.raw_output, null, 2);
      state.currentPhase = 3;

      if (!state.pauseForInspection) {
        // Automatically send Step 3 -> 4
        syncDraft();
        const res2 = await appState.executeMessagesRequest(appState.getDraftPayload());
        if (res2.response) {
          state.finalAssistantMsg = res2.response;
          state.currentPhase = 4;
        }
      }

      render();
    });

    const editableResult = container.querySelector("#editable-tool-result");
    if (editableResult) {
      editableResult.addEventListener("input", (e) => {
        state.localToolOutputStr = e.target.value;
        syncDraft();
      });
    }

    const step3Btn = container.querySelector("#step3-send-result-btn");
    if (step3Btn) {
      step3Btn.addEventListener("click", async () => {
        step3Btn.disabled = true;
        step3Btn.textContent = "Sending tool_result to Claude...";
        syncDraft();
        const res2 = await appState.executeMessagesRequest(appState.getDraftPayload());
        if (res2.response) {
          state.finalAssistantMsg = res2.response;
          state.currentPhase = 4;
        }
        render();
      });
    }
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
