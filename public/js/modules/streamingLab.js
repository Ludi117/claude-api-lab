/**
 * Module 2: Streaming & Server-Sent Events (SSE) Visualizer
 * Shows every raw SSE frame in real time (`message_start`, `content_block_start`,
 * `content_block_delta` [text_delta, thinking_delta, input_json_delta], `content_block_stop`,
 * `message_delta`, `message_stop`) with adjustable playback speed so learners can watch deltas assemble.
 */

export function renderStreamingConceptGuide() {
  return `
    <div class="space-y-4 text-xs leading-relaxed text-slate-300">
      <div class="p-3 rounded-lg bg-sky-500/10 border border-sky-500/30">
        <div class="font-semibold text-sky-400 mb-1">How Anthropic SSE Streaming Works</div>
        <p class="text-slate-300">
          When you pass <code class="text-sky-300 font-mono">stream: true</code>, Claude responds with <code class="font-mono">Content-Type: text/event-stream</code> and pushes a deterministic state machine of events.
        </p>
      </div>

      <div class="space-y-1.5">
        <h4 class="font-semibold text-white uppercase tracking-wider text-[11px]">SSE Event Lifecycle</h4>
        <ol class="space-y-1.5 text-[11px]">
          <li class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="font-mono text-emerald-400 font-semibold">1. message_start</span>
            <p class="text-slate-400 mt-0.5">Contains message metadata (<code class="font-mono">id</code>, <code class="font-mono">model</code>) and initial <code class="font-mono">input_tokens</code> usage.</p>
          </li>
          <li class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="font-mono text-sky-400 font-semibold">2. content_block_start</span>
            <p class="text-slate-400 mt-0.5">Announces a new block at <code class="font-mono">index</code> (<code class="font-mono">thinking</code>, <code class="font-mono">text</code>, or <code class="font-mono">tool_use</code>).</p>
          </li>
          <li class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="font-mono text-amber-400 font-semibold">3. content_block_delta</span>
            <p class="text-slate-400 mt-0.5">Streams incremental chunks: <code class="font-mono">text_delta</code>, <code class="font-mono">thinking_delta</code>, or <code class="font-mono">input_json_delta</code>.</p>
          </li>
          <li class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="font-mono text-purple-400 font-semibold">4. content_block_stop</span>
            <p class="text-slate-400 mt-0.5">Marks completion of the content block at <code class="font-mono">index</code>.</p>
          </li>
          <li class="p-2 rounded bg-claude-card border border-claude-border">
            <span class="font-mono text-rose-400 font-semibold">5. message_delta &amp; message_stop</span>
            <p class="text-slate-400 mt-0.5">Delivers final <code class="font-mono">stop_reason</code> and cumulative <code class="font-mono">output_tokens</code>.</p>
          </li>
        </ol>
      </div>
    </div>
  `;
}

export function initStreamingLab(container, appState) {
  let streamConfig = {
    prompt: "Explain how Server-Sent Events reduce perceived latency in AI applications.",
    includeThinking: true,
    includeToolCall: false,
    delayMs: 90 // Slow-motion default so user can clearly watch frames arrive
  };

  let capturedFrames = [];
  let activeStreamController = null;

  function syncDraft() {
    const payload = {
      model: appState.getModel(),
      max_tokens: 2048,
      stream: true,
      messages: [{ role: "user", content: streamConfig.prompt }]
    };
    if (streamConfig.includeThinking) {
      // Current models take adaptive thinking (budget_tokens is a 400 on 4.7+); legacy models need a budget
      payload.thinking =
        appState.getModelInfo()?.thinking === "budget"
          ? { type: "enabled", budget_tokens: 1024 }
          : { type: "adaptive", display: "summarized" };
    }
    if (streamConfig.includeToolCall) {
      payload.tools = appState.getSampleTools().slice(0, 1);
    }
    appState.updateDraftPayload(payload);
  }

  function render() {
    container.innerHTML = `
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-white">02. Server-Sent Events (SSE) Streaming Visualizer</h2>
          <p class="text-xs text-slate-400">Watch raw SSE frames arrive over the wire and see how <code class="text-amber-300 font-mono">thinking_delta</code>, <code class="text-sky-300 font-mono">text_delta</code>, and <code class="text-emerald-300 font-mono">input_json_delta</code> assemble into blocks.</p>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-slate-300 flex items-center gap-1.5 bg-claude-bg px-2.5 py-1.5 rounded-lg border border-claude-border">
            <span>Playback Speed:</span>
            <select id="sse-speed-select" class="bg-transparent font-mono text-xs text-sky-400 focus:outline-none">
              <option value="0" class="bg-claude-panel" ${streamConfig.delayMs === 0 ? "selected" : ""}>Real-time (no delay)</option>
              <option value="25" class="bg-claude-panel" ${streamConfig.delayMs === 25 ? "selected" : ""}>Fast (25ms/frame)</option>
              <option value="90" class="bg-claude-panel" ${streamConfig.delayMs === 90 ? "selected" : ""}>Visual (90ms/frame)</option>
              <option value="240" class="bg-claude-panel" ${streamConfig.delayMs === 240 ? "selected" : ""}>Slow-Mo (240ms/frame)</option>
            </select>
          </label>
        </div>
      </div>

      <!-- Controls Card -->
      <div class="bg-claude-panel border border-claude-border rounded-xl p-4 space-y-3">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">User Prompt</label>
          <input id="sse-prompt-input" aria-label="Streaming user prompt" type="text" value="${escapeHtml(streamConfig.prompt)}" class="w-full bg-claude-bg border border-claude-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-claude-accent" />
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div class="flex items-center gap-4 text-xs">
            <label class="flex items-center gap-2 cursor-pointer text-slate-200">
              <input id="sse-thinking-chk" type="checkbox" ${streamConfig.includeThinking ? "checked" : ""} class="accent-purple-500 rounded" />
              <span>Include <code class="text-purple-400 font-mono">thinking_delta</code> block</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-slate-200">
              <input id="sse-tool-chk" type="checkbox" ${streamConfig.includeToolCall ? "checked" : ""} class="accent-amber-500 rounded" />
              <span>Include <code class="text-amber-400 font-mono">input_json_delta</code> (Tool Use stream)</span>
            </label>
          </div>

          <div class="flex items-center gap-2">
            <button id="stop-stream-btn" class="hidden px-4 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-semibold text-xs transition">
              &#9632; Stop
            </button>
            <button id="start-stream-btn" class="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-2 transition shadow-lg shadow-sky-950/50">
              <span>&#9654; Start Live SSE Stream</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Two-Column Live Stream Reconstruction vs Frame Log -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Left: Live Reconstructed Content Blocks -->
        <div class="bg-claude-panel border border-claude-border rounded-xl p-4 flex flex-col space-y-3">
          <div class="flex items-center justify-between border-b border-claude-border pb-2">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">Assembled Content Blocks</h3>
            <span id="stream-status-pill" class="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">Idle</span>
          </div>

          <!-- Thinking Block Preview -->
          <div id="live-thinking-box" class="hidden p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 space-y-1">
            <div class="text-[11px] font-mono text-purple-300 flex items-center justify-between">
              <span>content[0] &bull; type: "thinking"</span>
              <span id="thinking-sig-badge" class="text-[10px] text-slate-400">streaming...</span>
            </div>
            <pre id="live-thinking-text" class="text-xs text-purple-100 whitespace-pre-wrap font-mono leading-relaxed"></pre>
          </div>

          <!-- Text Block Preview -->
          <div id="live-text-box" class="p-3 rounded-lg bg-claude-bg border border-claude-border space-y-1 min-h-[120px]">
            <div class="text-[11px] font-mono text-sky-400">type: "text"</div>
            <div id="live-text-output" class="text-xs text-slate-100 whitespace-pre-wrap leading-relaxed">Click "Start Live SSE Stream" above to watch tokens arrive in real time...</div>
          </div>

          <!-- Tool JSON Delta Preview -->
          <div id="live-tool-box" class="hidden p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-1">
            <div class="text-[11px] font-mono text-amber-300" id="live-tool-header">type: "tool_use" (streaming partial_json)</div>
            <pre id="live-tool-json" class="text-xs text-amber-200 font-mono whitespace-pre-wrap"></pre>
          </div>
        </div>

        <!-- Right: Raw SSE Wire Frame Timeline -->
        <div class="bg-claude-panel border border-claude-border rounded-xl p-4 flex flex-col h-[400px]">
          <div class="flex items-center justify-between border-b border-claude-border pb-2 mb-2 shrink-0">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">Raw SSE Frame Timeline (<span id="sse-frame-count">0</span> frames)</h3>
            <span class="text-[10px] text-slate-400">Click any frame to inspect JSON</span>
          </div>
          <div id="sse-frames-list" class="flex-1 overflow-y-auto space-y-1.5 pr-1 font-mono text-[11px]">
            <div class="text-slate-500 text-xs p-3 text-center">No SSE frames captured yet.</div>
          </div>
        </div>
      </div>
    `;

    bindEvents();
    syncDraft();
  }

  function bindEvents() {
    const promptInput = container.querySelector("#sse-prompt-input");
    promptInput.addEventListener("input", (e) => {
      streamConfig.prompt = e.target.value;
      syncDraft();
    });

    const thinkChk = container.querySelector("#sse-thinking-chk");
    thinkChk.addEventListener("change", (e) => {
      streamConfig.includeThinking = e.target.checked;
      syncDraft();
    });

    const toolChk = container.querySelector("#sse-tool-chk");
    toolChk.addEventListener("change", (e) => {
      streamConfig.includeToolCall = e.target.checked;
      if (streamConfig.includeToolCall && !streamConfig.prompt.toLowerCase().includes("weather")) {
        streamConfig.prompt = "What is the weather in Tokyo and what should I pack?";
        promptInput.value = streamConfig.prompt;
      }
      syncDraft();
    });

    const speedSel = container.querySelector("#sse-speed-select");
    speedSel.addEventListener("change", (e) => {
      streamConfig.delayMs = Number(e.target.value);
    });

    const startBtn = container.querySelector("#start-stream-btn");
    startBtn.addEventListener("click", () => runStream(startBtn));

    container.querySelector("#stop-stream-btn").addEventListener("click", () => {
      activeStreamController?.abort();
    });
  }

  async function runStream(startBtn) {
    const stopBtn = container.querySelector("#stop-stream-btn");
    activeStreamController = new AbortController();
    stopBtn.classList.remove("hidden");
    startBtn.disabled = true;
    startBtn.innerHTML = `<span class="animate-spin inline-block w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full"></span><span>Streaming SSE...</span>`;

    capturedFrames = [];
    const framesList = container.querySelector("#sse-frames-list");
    const frameCountEl = container.querySelector("#sse-frame-count");
    const statusPill = container.querySelector("#stream-status-pill");
    const thinkingBox = container.querySelector("#live-thinking-box");
    const thinkingText = container.querySelector("#live-thinking-text");
    const thinkingSigBadge = container.querySelector("#thinking-sig-badge");
    const textOutput = container.querySelector("#live-text-output");
    const toolBox = container.querySelector("#live-tool-box");
    const toolJson = container.querySelector("#live-tool-json");
    const toolHeader = container.querySelector("#live-tool-header");

    framesList.innerHTML = "";
    thinkingText.textContent = "";
    textOutput.textContent = "";
    toolJson.textContent = "";
    thinkingBox.classList.add("hidden");
    toolBox.classList.add("hidden");
    statusPill.textContent = "STREAMING";
    statusPill.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 animate-pulse";

    const payload = {
      ...appState.getDraftPayload(),
      _stream_delay_ms: streamConfig.delayMs
    };

    let finalUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    let stopReason = null;

    const outcome = await appState.executeSseStream(payload, (eventName, dataObj) => {
      capturedFrames.push({ event: eventName, data: dataObj });
      frameCountEl.textContent = capturedFrames.length;

      // Render frame item in timeline
      const item = document.createElement("div");
      item.className = `sse-frame-item p-2 rounded bg-claude-bg border border-claude-border hover:border-sky-500/50 cursor-pointer flex items-center justify-between gap-2`;
      const badgeColor = getEventBadgeColor(eventName, dataObj?.delta?.type);
      const summary = getEventSummary(eventName, dataObj);

      item.innerHTML = `
        <div class="flex items-center gap-2 truncate">
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${badgeColor}">${eventName}</span>
          <span class="text-slate-300 truncate">${escapeHtml(summary)}</span>
        </div>
        <span class="text-[10px] text-slate-500 shrink-0">#${capturedFrames.length}</span>
      `;
      item.addEventListener("click", () => {
        appState.setInspectorResponse({
          selected_sse_frame: capturedFrames.length,
          event: eventName,
          data: dataObj,
          all_frames_count: capturedFrames.length
        });
      });
      framesList.appendChild(item);
      framesList.scrollTop = framesList.scrollHeight;

      // Update live reconstructed blocks
      if (eventName === "message_start" && dataObj.message?.usage) {
        finalUsage = { ...finalUsage, ...dataObj.message.usage };
      } else if (eventName === "content_block_start") {
        const blk = dataObj.content_block;
        if (blk?.type === "thinking") {
          thinkingBox.classList.remove("hidden");
        } else if (blk?.type === "tool_use") {
          toolBox.classList.remove("hidden");
          toolHeader.textContent = `type: "tool_use" • name: "${blk.name}" • id: "${blk.id}"`;
        }
      } else if (eventName === "content_block_delta") {
        const d = dataObj.delta;
        if (d?.type === "thinking_delta") {
          thinkingBox.classList.remove("hidden");
          thinkingText.textContent += d.thinking;
        } else if (d?.type === "signature_delta") {
          thinkingSigBadge.textContent = `signature verified (${d.signature.slice(0, 12)}...)`;
        } else if (d?.type === "text_delta") {
          textOutput.textContent += d.text;
        } else if (d?.type === "input_json_delta") {
          toolBox.classList.remove("hidden");
          toolJson.textContent += d.partial_json;
        }
      } else if (eventName === "message_delta") {
        stopReason = dataObj.delta?.stop_reason;
        if (dataObj.usage?.output_tokens) {
          finalUsage.output_tokens = dataObj.usage.output_tokens;
        }
      } else if (eventName === "message_stop") {
        statusPill.textContent = `COMPLETED (${stopReason || "end_turn"})`;
        statusPill.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
      } else if (eventName === "error") {
        statusPill.textContent = `ERROR (${dataObj.error?.type || "error"})`;
        statusPill.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40";
        textOutput.textContent += `\n[${dataObj.error?.message || "Stream error"}]`;
      }
    }, activeStreamController.signal);

    activeStreamController = null;
    stopBtn.classList.add("hidden");

    if (outcome.status !== "completed") {
      statusPill.textContent = outcome.status === "aborted" ? "STOPPED" : "FAILED";
      statusPill.className = "text-[11px] font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40";
      if (outcome.error) {
        textOutput.textContent += `\n[${outcome.error}]`;
      }
    }

    appState.setInspectorResponse({
      stream_completed: outcome.status === "completed",
      total_sse_events: capturedFrames.length,
      stop_reason: stopReason,
      usage: finalUsage,
      events_preview: capturedFrames.slice(0, 12)
    });

    startBtn.disabled = false;
    startBtn.innerHTML = `<span>&#9654; Start Live SSE Stream</span>`;
  }

  render();

  return { onModelChange: syncDraft, onShow: syncDraft };
}

function getEventBadgeColor(eventName, deltaType) {
  if (eventName === "message_start" || eventName === "message_stop") {
    return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
  }
  if (eventName === "content_block_start" || eventName === "content_block_stop") {
    return "bg-sky-500/20 text-sky-300 border border-sky-500/30";
  }
  if (eventName === "content_block_delta") {
    if (deltaType === "thinking_delta" || deltaType === "signature_delta") {
      return "bg-purple-500/20 text-purple-300 border border-purple-500/30";
    }
    if (deltaType === "input_json_delta") {
      return "bg-amber-500/20 text-amber-300 border border-amber-500/30";
    }
    return "bg-orange-500/20 text-orange-300 border border-orange-500/30";
  }
  return "bg-slate-800 text-slate-300";
}

function getEventSummary(eventName, dataObj) {
  if (eventName === "message_start") return `id: ${dataObj.message?.id || "msg"}`;
  if (eventName === "content_block_start") return `index ${dataObj.index}: ${dataObj.content_block?.type}`;
  if (eventName === "content_block_delta") {
    const d = dataObj.delta || {};
    if (d.type === "text_delta") return `text_delta: "${d.text}"`;
    if (d.type === "thinking_delta") return `thinking_delta: "${d.thinking}"`;
    if (d.type === "input_json_delta") return `input_json_delta: ${d.partial_json}`;
    if (d.type === "signature_delta") return `signature_delta: ${d.signature?.slice(0, 16)}...`;
  }
  if (eventName === "content_block_stop") return `index ${dataObj.index} closed`;
  if (eventName === "message_delta") return `stop_reason: "${dataObj.delta?.stop_reason}"`;
  return eventName;
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
