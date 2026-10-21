/**
 * Interactive JSON Tree Renderer & Official Anthropic API Parameter Tooltip Dictionary (`public/js/jsonTooltips.js`)
 * Renders JSON payloads with:
 * - Dotted-underline hoverable parameter keys that display an official API documentation popover card
 * - Collapsible `{...}` and `[...]` nodes so users can fold/unfold large schemas or arrays
 */

export const PARAMETER_TOOLTIPS = {
  // HTTP Headers
  "x-api-key": {
    type: "header string (required)",
    badge: "Auth Header",
    desc: "Your secret Anthropic API key (`sk-ant-...`). Passed in the `x-api-key` HTTP header on every request."
  },
  "anthropic-version": {
    type: "header string (required)",
    badge: "API Version",
    desc: "Specifies the Claude API version date (currently `\"2023-06-01\"`). Guarantees backwards-compatible wire schemas."
  },
  "content-type": {
    type: "header string",
    badge: "MIME Type",
    desc: "Request body format (`application/json`). Streaming responses return `text/event-stream`."
  },

  // Top-Level Request Body Parameters
  model: {
    type: "string (required)",
    badge: "Body Param",
    desc: "The model ID that will complete your prompt (e.g., `\"claude-sonnet-5-5\"`, `\"claude-opus-5-5\"`, `\"claude-haiku-5-5\"`, `\"claude-opus-4-7\"`)."
  },
  max_tokens: {
    type: "number (required, min: 0)",
    badge: "Body Param",
    desc: "The absolute maximum number of tokens to generate before stopping. Pro Tip: Set `max_tokens: 0` to pre-warm the prompt cache without generating a response!"
  },
  messages: {
    type: "array of MessageParam (required)",
    badge: "Stateless Context",
    desc: "Alternating `user` and `assistant` conversational turns. Because the API is 100% stateless, you pass the relevant conversation history on every call."
  },
  system: {
    type: "string | array of TextBlockParam",
    badge: "System Prompt",
    desc: "Top-level instructions setting Claude's role, tone, or persistent rules. Note: There is no `\"system\"` role inside `messages`—always use this top-level parameter!"
  },
  output_config: {
    type: "OutputConfig object",
    badge: "2026 Standard",
    desc: "Modern configuration object controlling response reasoning depth (`effort`) and constrained JSON schema formatting (`format`)."
  },
  effort: {
    type: "\"low\" | \"medium\" | \"high\" | \"xhigh\" | \"max\"",
    badge: "output_config",
    desc: "Controls how much effort and reasoning depth Claude puts into its response. Replaces legacy `temperature` and manual token budget tuning."
  },
  format: {
    type: "JSONOutputFormat object",
    badge: "Structured Output",
    desc: "Enforces native constrained decoding (`{ type: \"json_schema\", schema: {...} }`) so Claude's response is guaranteed to match your JSON Schema."
  },
  schema: {
    type: "JSON Schema object",
    badge: "JSON Schema",
    desc: "Standard JSON Schema object (`type: \"object\"`, `properties`, `required`, `additionalProperties: false`) enforced during token generation."
  },
  thinking: {
    type: "ThinkingConfigParam object",
    badge: "Reasoning",
    desc: "Configures Claude's internal reasoning scratchpad. Use `{ type: \"adaptive\" }` (recommended) or `{ type: \"enabled\", budget_tokens: N }`. Thinking tokens count toward `max_tokens`."
  },
  budget_tokens: {
    type: "number (min: 1024)",
    badge: "Thinking Budget",
    desc: "Maximum internal reasoning tokens when `thinking.type === \"enabled\"`. Must be >= 1024 and strictly less than `max_tokens`."
  },
  display: {
    type: "\"summarized\" | \"omitted\"",
    badge: "Thinking Visibility",
    desc: "Controls how thinking appears in the response. `\"summarized\"` returns reasoning text; `\"omitted\"` redacts the text for faster streaming while keeping `signature` for multi-turn continuity."
  },
  temperature: {
    type: "number (0.0 - 1.0) • DEPRECATED",
    badge: "Deprecated (>4.6)",
    isWarning: true,
    desc: "DEPRECATED: Models released after Claude Opus 4.6 (4.7, 4.8, 5, 5.5) reject any value other than `1.0` with an HTTP 400 error! Omit `temperature` and use `output_config.effort` instead."
  },
  top_k: {
    type: "number • DEPRECATED",
    badge: "Deprecated (>4.6)",
    isWarning: true,
    desc: "DEPRECATED: Models released after Claude Opus 4.6 do not accept `top_k`; any value is rejected with an HTTP 400 error."
  },
  top_p: {
    type: "number • DEPRECATED",
    badge: "Deprecated (>4.6)",
    isWarning: true,
    desc: "DEPRECATED: Models released after Claude Opus 4.6 reject `top_p < 0.99` with an HTTP 400 error."
  },
  tools: {
    type: "array of ToolUnion",
    badge: "Tools",
    desc: "Definitions of Client Tools (`{ name, description, input_schema, strict }`) or Anthropic Managed Server Tools (`web_search_20260318`, `web_fetch_20260318`, `code_execution_20250522`)."
  },
  tool_choice: {
    type: "ToolChoice object",
    badge: "Tool Routing",
    desc: "Controls how Claude uses tools: `{ type: \"auto\" }` (model decides), `{ type: \"any\" }` (must call a tool), `{ type: \"tool\", name }` (force specific tool), or `{ type: \"none\" }`."
  },
  input_schema: {
    type: "JSON Schema object",
    badge: "Tool Schema",
    desc: "Defines the JSON parameter shape that Claude will generate inside `tool_use.input`. Note: snake_case `input_schema` in Claude API vs camelCase `inputSchema` in MCP!"
  },
  strict: {
    type: "boolean",
    badge: "Constrained Tool",
    desc: "When `true`, guarantees via constrained decoding that Claude's `tool_use` inputs strictly validate against `input_schema`."
  },
  cache_control: {
    type: "{ type: \"ephemeral\", ttl?: \"5m\" | \"1h\" }",
    badge: "Prompt Caching",
    desc: "Places a prompt cache breakpoint. Can be set at the top level (auto-marks last cacheable block) or on individual `system`, `tools`, or `messages` content blocks. Saves 90% on cache hits!"
  },
  ttl: {
    type: "\"5m\" | \"1h\"",
    badge: "Cache Lifetime",
    desc: "Time-to-live for an ephemeral prompt cache breakpoint: `\"5m\"` (5 minutes, default) or `\"1h\"` (1 hour extended cache)."
  },
  stop_sequences: {
    type: "array of strings",
    badge: "Stop Control",
    desc: "Custom strings that cause Claude to immediately stop generating and return `stop_reason: \"stop_sequence\"`."
  },
  stream: {
    type: "boolean",
    badge: "SSE Streaming",
    desc: "When `true`, streams incremental response deltas via Server-Sent Events (`message_start`, `content_block_delta`, `message_delta`, `message_stop`)."
  },
  diagnostics: {
    type: "{ previous_message_id: string | null }",
    badge: "Cache Diagnostics",
    desc: "Pass the `id` (`msg_...`) of your previous request to diagnose why a prompt cache missed! Returns `diagnostics.cache_miss_reason` (`model_changed`, `system_changed`, `tools_changed`, `messages_changed`)."
  },
  previous_message_id: {
    type: "string | null",
    badge: "Diagnostics",
    desc: "The `msg_...` ID from the previous `/v1/messages` response to compare prompt cache prefixes against."
  },
  cache_miss_reason: {
    type: "CacheMissReason object | null",
    badge: "Diagnostics Output",
    desc: "Explains why the prompt cache prefix could not be reused from `previous_message_id` and reports `cache_missed_input_tokens`."
  },
  cache_missed_input_tokens: {
    type: "number",
    badge: "Diagnostics Metric",
    desc: "Approximate number of input tokens that would have been read from cache if the prefix had matched the previous request."
  },
  speed: {
    type: "\"standard\" | \"fast\"",
    badge: "Inference Speed",
    desc: "Selects `" + "fast" + "` high output-tokens-per-second inference mode or `" + "standard" + "`."
  },
  service_tier: {
    type: "\"auto\" | \"standard_only\" | \"priority\" | \"batch\"",
    badge: "Capacity Tier",
    desc: "Controls whether the request uses priority capacity or standard capacity."
  },

  // Content Blocks & Multimodal / Citations
  role: {
    type: "\"user\" | \"assistant\"",
    badge: "Turn Role",
    desc: "Conversational role of the message. Responses generated by Claude always have `role: \"assistant\"`."
  },
  content: {
    type: "string | array of ContentBlocks",
    badge: "Message Content",
    desc: "Ordered array of typed content blocks (`text`, `thinking`, `image`, `document`, `tool_use`, `tool_result`, `server_tool_use`)."
  },
  signature: {
    type: "string (cryptographic token)",
    badge: "Thinking Verification",
    desc: "Opaque cryptographic signature verifying that a `thinking` block was genuinely generated by Claude when passed back in multi-turn conversations."
  },
  tool_use_id: {
    type: "string (`toolu_...` or `srvtoolu_...`)",
    badge: "Tool Correlation ID",
    desc: "Links a `tool_result` block back to the exact `tool_use.id` emitted by Claude."
  },
  caller: {
    type: "{ type: \"direct\" | \"code_execution_...\" }",
    badge: "Tool Caller",
    desc: "Indicates whether the tool was invoked directly by the model (`direct`) or nested inside a server-side code execution turn."
  },
  citations: {
    type: "CitationsConfig | array of TextCitation",
    badge: "Grounded Citations",
    desc: "On a request `document` block (`{ enabled: true }`), instructs Claude to emit verifiable character/page citations (`char_location`, `page_location`) on response `text` blocks."
  },
  cited_text: {
    type: "string",
    badge: "Citation Quote",
    desc: "The exact verbatim text span from the source document backing Claude's statement. Not counted toward output tokens!"
  },
  start_char_index: {
    type: "number (0-indexed)",
    badge: "Citation Span",
    desc: "Starting character index of `cited_text` in the source document."
  },
  end_char_index: {
    type: "number",
    badge: "Citation Span",
    desc: "Exclusive ending character index of `cited_text` in the source document."
  },
  transformations: {
    type: "{ oversized_image: \"downsize\" | \"error\" }",
    badge: "Image Transform",
    desc: "Controls what the server does when an image exceeds maximum dimensions: `\"downsize\"` (default) scales it down; `\"error\"` rejects with HTTP 400 so you know the exact pixel limits."
  },
  oversized_image: {
    type: "\"downsize\" | \"error\"",
    badge: "Image Transform",
    desc: "`\"downsize\"` automatically scales oversized images; `\"error\"` returns a 400 error instead of silently downsizing."
  },

  // Response Metadata & Usage Fields
  id: {
    type: "string (`msg_...` or `toolu_...`)",
    badge: "Unique ID",
    desc: "Unique identifier for the Message (`msg_...`), Client Tool Use (`toolu_...`), or Server Tool Use (`srvtoolu_...`)."
  },
  stop_reason: {
    type: "\"end_turn\" | \"max_tokens\" | \"stop_sequence\" | \"tool_use\" | \"pause_turn\" | \"refusal\" | \"model_context_window_exceeded\"",
    badge: "Stop Reason",
    desc: "Explains why Claude stopped generating tokens. Crucial for branching your application logic (e.g., running a tool when `stop_reason === \"tool_use\"`)."
  },
  stop_sequence: {
    type: "string | null",
    badge: "Matched Sequence",
    desc: "If `stop_reason === \"stop_sequence\"`, contains the exact string from `stop_sequences` that triggered the stop."
  },
  stop_details: {
    type: "RefusalStopDetails | null",
    badge: "Policy Details",
    desc: "When `stop_reason === \"refusal\"`, provides structured policy category (`cyber`, `bio`, `general_harms`) and explanation."
  },
  usage: {
    type: "Usage object",
    badge: "Billing & Telemetry",
    desc: "Authoritative token counts for billing and rate limits. Total input tokens = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`."
  },
  input_tokens: {
    type: "number",
    badge: "Billing Metric",
    desc: "Standard uncached input tokens billed for this request (after the last cache breakpoint)."
  },
  cache_creation_input_tokens: {
    type: "number",
    badge: "Cache Write",
    desc: "Input tokens written into the ephemeral prompt cache on a cache miss."
  },
  cache_read_input_tokens: {
    type: "number",
    badge: "Cache Hit (-90%)",
    desc: "Input tokens read directly from the ephemeral prompt cache (billed at a 90% discount!)."
  },
  cache_creation: {
    type: "{ ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }",
    badge: "Cache TTL Split",
    desc: "Breaks down `cache_creation_input_tokens` by 5-minute TTL vs 1-hour TTL."
  },
  output_tokens: {
    type: "number",
    badge: "Billing Metric",
    desc: "Total generated output tokens billed for this request (includes both visible text and internal `thinking_tokens`)."
  },
  output_tokens_details: {
    type: "{ thinking_tokens: number }",
    badge: "Reasoning Telemetry",
    desc: "Read-only decomposition showing how many of the billed `output_tokens` were spent on internal reasoning (`thinking_tokens`)."
  },
  thinking_tokens: {
    type: "number",
    badge: "Reasoning Tokens",
    desc: "Number of output tokens the model generated as internal reasoning inside `output_tokens`."
  },
  server_tool_use: {
    type: "{ web_search_requests, web_fetch_requests }",
    badge: "Server Tool Count",
    desc: "Tracks how many managed server-side `web_search` and `web_fetch` calls were executed during this turn."
  }
};

/**
 * Renders an interactive, collapsible JSON tree where every recognized parameter key
 * has a hover tooltip explaining its official Anthropic API specification.
 */
export function renderInteractiveJsonTree(obj, indent = 0) {
  if (obj === null) return `<span class="text-slate-500">null</span>`;
  if (obj === undefined) return `<span class="text-slate-500">undefined</span>`;
  if (typeof obj === "boolean") return `<span class="json-boolean">${obj}</span>`;
  if (typeof obj === "number") return `<span class="json-number">${obj}</span>`;
  if (typeof obj === "string") {
    return `<span class="json-string">"${escapeHtml(obj)}"</span>`;
  }

  const pad = "  ".repeat(indent);
  const innerPad = "  ".repeat(indent + 1);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return `[]`;
    const nodeId = "jnode_" + Math.random().toString(36).slice(2, 9);
    const itemsHtml = obj
      .map((item, idx) => `${innerPad}${renderInteractiveJsonTree(item, indent + 1)}${idx < obj.length - 1 ? "," : ""}`)
      .join("\n");

    return `<span class="json-fold-trigger cursor-pointer select-none text-slate-400 hover:text-white" data-target="${nodeId}" title="Click to fold/unfold array">&#9662;</span>[<span id="${nodeId}_preview" class="hidden text-slate-500 text-[10px] px-1 cursor-pointer" data-target="${nodeId}">${obj.length} items...</span><span id="${nodeId}">\n${itemsHtml}\n${pad}</span>]`;
  }

  if (typeof obj === "object") {
    const keys = Object.keys(obj);
    if (keys.length === 0) return `{}`;
    const nodeId = "jnode_" + Math.random().toString(36).slice(2, 9);

    const lines = keys.map((key, idx) => {
      const valHtml = renderInteractiveJsonTree(obj[key], indent + 1);
      const comma = idx < keys.length - 1 ? "," : "";
      const tip = PARAMETER_TOOLTIPS[key];

      if (tip) {
        const keyCls = tip.isWarning
          ? "json-key-interactive text-rose-400 border-b border-dotted border-rose-400/80 cursor-help"
          : "json-key-interactive json-key border-b border-dotted border-sky-400/60 cursor-help";
        return `${innerPad}<span class="${keyCls}" data-param-key="${escapeHtml(key)}">"${escapeHtml(key)}"</span>: ${valHtml}${comma}`;
      }

      return `${innerPad}<span class="json-key">"${escapeHtml(key)}"</span>: ${valHtml}${comma}`;
    });

    return `<span class="json-fold-trigger cursor-pointer select-none text-slate-400 hover:text-white" data-target="${nodeId}" title="Click to fold/unfold object">&#9662;</span>{<span id="${nodeId}_preview" class="hidden text-slate-500 text-[10px] px-1 cursor-pointer" data-target="${nodeId}">${keys.length} fields...</span><span id="${nodeId}">\n${lines.join("\n")}\n${pad}</span>}`;
  }

  return escapeHtml(String(obj));
}

/**
 * Attaches global hover tooltip popover and fold/unfold click handlers to a container.
 */
export function bindInteractiveJsonEvents(container) {
  let popoverEl = document.getElementById("global-json-param-popover");
  if (!popoverEl) {
    popoverEl = document.createElement("div");
    popoverEl.id = "global-json-param-popover";
    popoverEl.className =
      "fixed z-50 hidden max-w-xs p-3 rounded-xl bg-claude-panel border border-claude-border shadow-2xl pointer-events-none text-xs font-sans transition-opacity duration-100";
    document.body.appendChild(popoverEl);
  }

  // Fold / Unfold click handlers
  container.querySelectorAll(".json-fold-trigger, [id$='_preview']").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetId = el.dataset.target;
      const bodySpan = document.getElementById(targetId);
      const previewSpan = document.getElementById(`${targetId}_preview`);
      const trigger = container.querySelector(`.json-fold-trigger[data-target="${targetId}"]`);
      if (!bodySpan || !previewSpan) return;

      const isHidden = bodySpan.classList.toggle("hidden");
      previewSpan.classList.toggle("hidden", !isHidden);
      if (trigger) {
        trigger.innerHTML = isHidden ? "&#9656;" : "&#9662;";
      }
    });
  });

  // Parameter hover tooltips
  container.querySelectorAll(".json-key-interactive").forEach((keyEl) => {
    keyEl.addEventListener("mouseenter", (e) => {
      const paramName = keyEl.dataset.paramKey;
      const info = PARAMETER_TOOLTIPS[paramName];
      if (!info) return;

      popoverEl.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="font-mono font-bold text-white text-xs">${escapeHtml(paramName)}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-mono ${
            info.isWarning
              ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
              : "bg-sky-500/20 text-sky-300 border border-sky-500/30"
          }">${escapeHtml(info.badge)}</span>
        </div>
        <div class="font-mono text-[10px] text-amber-300 mb-1.5">${escapeHtml(info.type)}</div>
        <p class="text-[11px] text-slate-200 leading-relaxed">${escapeHtml(info.desc)}</p>
      `;
      popoverEl.classList.remove("hidden");
      positionPopover(e, popoverEl);
    });

    keyEl.addEventListener("mousemove", (e) => {
      positionPopover(e, popoverEl);
    });

    keyEl.addEventListener("mouseleave", () => {
      popoverEl.classList.add("hidden");
    });
  });
}

function positionPopover(e, popoverEl) {
  const pad = 14;
  const rect = popoverEl.getBoundingClientRect();
  let left = e.clientX - rect.width - pad;
  let top = e.clientY + pad;

  if (left < 12) {
    left = e.clientX + pad;
  }
  if (top + rect.height > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - rect.height - 12);
  }

  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
