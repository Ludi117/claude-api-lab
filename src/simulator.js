/**
 * Spec-Accurate Anthropic Claude API & SSE Stream Simulator (v2.0)
 * Aligned 1-to-1 with https://platform.claude.com/docs/en/api/messages/create:
 * - Official Models: `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`, `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-sonnet-4-5`
 * - Exact `temperature`, `top_p`, `top_k` deprecation rule (HTTP 400 on models after Opus 4.6 if temperature != 1.0)
 * - `output_config`: `effort` ("low" | "medium" | "high" | "xhigh" | "max") and `format` (`json_schema`)
 * - `thinking`: `{ type: "adaptive", display }` & `{ type: "enabled", budget_tokens, display }`
 * - `cache_control`: Top-level & block-level (`ttl: "5m" | "1h"`), plus `max_tokens: 0` pre-warming
 * - NEW in v2.0:
 *   - Multimodal `image` (`transformations.oversized_image: "downsize" | "error"`) & `document` blocks with grounded `citations` (`char_location`)
 *   - Managed Server-Side Tools (`web_search_20260318`, `web_fetch_20260318`, `code_execution_20250522`) -> `server_tool_use` (`srvtoolu_...`) & result blocks
 *   - Request-level `diagnostics: { previous_message_id }` -> returns `diagnostics: { cache_miss_reason }` when prompt prefix changes!
 */

const crypto = require("crypto");
const { isPostOpus46Model } = require("./models");

const seenCacheChecksums = new Set();
const previousMessageFingerprints = new Map();

function resetSimulatorCache() {
  seenCacheChecksums.clear();
  previousMessageFingerprints.clear();
}

function estimateTokens(text = "") {
  const str = typeof text === "string" ? text : JSON.stringify(text);
  return Math.max(4, Math.ceil(str.length / 4));
}

function generateMsgId() {
  return "msg_sim_" + crypto.randomBytes(10).toString("hex");
}

function generateToolUseId() {
  return "toolu_sim_" + crypto.randomBytes(8).toString("hex");
}

function generateServerToolUseId() {
  return "srvtoolu_sim_" + crypto.randomBytes(8).toString("hex");
}

/**
 * Computes `diagnostics.cache_miss_reason` when `payload.diagnostics.previous_message_id` is supplied.
 */
function evaluateCacheDiagnostics(payload, currentMsgId) {
  const currentState = {
    model: payload.model || "claude-sonnet-5-5",
    systemStr: JSON.stringify(payload.system || ""),
    toolsStr: JSON.stringify(payload.tools || []),
    messagesPrefixStr: JSON.stringify((payload.messages || []).slice(0, Math.max(1, (payload.messages || []).length - 1))),
    estimatedPrefixTokens: estimateTokens(payload.system || "") + estimateTokens(payload.tools || []) + 1024
  };

  previousMessageFingerprints.set(currentMsgId, currentState);

  if (!payload.diagnostics || typeof payload.diagnostics !== "object") {
    return null;
  }

  const prevId = payload.diagnostics.previous_message_id;
  if (!prevId) {
    return null; // First turn opt-in (`previous_message_id: null`) returns `diagnostics: null`
  }

  // Allow explicit simulation override or automatic fingerprint comparison
  if (payload._sim_diag_reason) {
    return {
      cache_miss_reason: {
        type: payload._sim_diag_reason,
        cache_missed_input_tokens: currentState.estimatedPrefixTokens
      }
    };
  }

  const prevState = previousMessageFingerprints.get(prevId);
  if (!prevState) {
    return {
      cache_miss_reason: {
        type: "previous_message_not_found",
        cache_missed_input_tokens: currentState.estimatedPrefixTokens
      }
    };
  }

  if (prevState.model !== currentState.model) {
    return {
      cache_miss_reason: {
        type: "model_changed",
        cache_missed_input_tokens: prevState.estimatedPrefixTokens
      }
    };
  }

  if (prevState.systemStr !== currentState.systemStr) {
    return {
      cache_miss_reason: {
        type: "system_changed",
        cache_missed_input_tokens: prevState.estimatedPrefixTokens
      }
    };
  }

  if (prevState.toolsStr !== currentState.toolsStr) {
    return {
      cache_miss_reason: {
        type: "tools_changed",
        cache_missed_input_tokens: prevState.estimatedPrefixTokens
      }
    };
  }

  if (prevState.messagesPrefixStr !== currentState.messagesPrefixStr) {
    return {
      cache_miss_reason: {
        type: "messages_changed",
        cache_missed_input_tokens: prevState.estimatedPrefixTokens
      }
    };
  }

  return null; // No cache divergence detected!
}

function calculateUsageWithCache(payload, outputText = "", thinkingText = "", serverToolCounts = { web_search_requests: 0, web_fetch_requests: 0 }) {
  let regularInputTokens = 0;
  let cachedCandidateTokens = 0;
  let detectedTtl = "5m";
  const cacheFingerprints = [];

  if (payload.cache_control?.type === "ephemeral") {
    detectedTtl = payload.cache_control.ttl || "5m";
    cachedCandidateTokens += 1024;
    cacheFingerprints.push("toplevel:" + JSON.stringify(payload.system || "") + JSON.stringify((payload.messages || []).slice(0, -1)));
  }

  if (Array.isArray(payload.system)) {
    for (const block of payload.system) {
      const tok = estimateTokens(block.text || block);
      if (block.cache_control?.type === "ephemeral") {
        detectedTtl = block.cache_control.ttl || detectedTtl;
        cachedCandidateTokens += Math.max(tok, 1024);
        cacheFingerprints.push("sys:" + (block.text || "").slice(0, 120));
      } else {
        regularInputTokens += tok;
      }
    }
  } else if (typeof payload.system === "string" && payload.system.trim()) {
    regularInputTokens += estimateTokens(payload.system);
  }

  if (Array.isArray(payload.tools)) {
    for (const tool of payload.tools) {
      const tok = estimateTokens(tool);
      if (tool.cache_control?.type === "ephemeral") {
        detectedTtl = tool.cache_control.ttl || detectedTtl;
        cachedCandidateTokens += Math.max(tok, 512);
        cacheFingerprints.push("tool:" + tool.name);
      } else {
        regularInputTokens += tok;
      }
    }
  }

  if (Array.isArray(payload.messages)) {
    for (const msg of payload.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const tok = estimateTokens(block);
          if (block.cache_control?.type === "ephemeral") {
            detectedTtl = block.cache_control.ttl || detectedTtl;
            cachedCandidateTokens += Math.max(tok, 1024);
            cacheFingerprints.push("msg:" + JSON.stringify(block).slice(0, 120));
          } else {
            regularInputTokens += tok;
          }
        }
      } else {
        regularInputTokens += estimateTokens(msg.content);
      }
    }
  }

  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  if (cachedCandidateTokens > 0) {
    const fingerprintKey = cacheFingerprints.join("|");
    const forceHit = payload._sim_cache_mode === "hit";
    const forceWrite = payload._sim_cache_mode === "write";

    if (forceHit || (!forceWrite && seenCacheChecksums.has(fingerprintKey))) {
      cacheReadTokens = cachedCandidateTokens;
    } else {
      cacheCreationTokens = cachedCandidateTokens;
      seenCacheChecksums.add(fingerprintKey);
    }
  }

  const isPrewarmZeroMax = Number(payload.max_tokens) === 0;
  const thinkingTokens = isPrewarmZeroMax ? 0 : (thinkingText ? estimateTokens(thinkingText) : 0);
  const textOutTokens = isPrewarmZeroMax ? 0 : estimateTokens(outputText);
  const outputTokens = isPrewarmZeroMax ? 0 : (thinkingTokens + textOutTokens);

  return {
    input_tokens: Math.max(12, regularInputTokens),
    cache_creation_input_tokens: cacheCreationTokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation: {
      ephemeral_5m_input_tokens: detectedTtl === "5m" ? cacheCreationTokens : 0,
      ephemeral_1h_input_tokens: detectedTtl === "1h" ? cacheCreationTokens : 0
    },
    output_tokens: outputTokens,
    output_tokens_details: {
      thinking_tokens: thinkingTokens
    },
    server_tool_use: serverToolCounts,
    service_tier: payload.service_tier === "standard_only" ? "standard" : "standard",
    speed: payload.speed || "standard",
    inference_geo: payload.inference_geo || "global"
  };
}

function analyzeConversationState(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      lastRole: "user",
      lastUserText: "Hello Claude!",
      hasToolResult: false,
      prefillText: null,
      toolResults: [],
      documents: [],
      images: []
    };
  }

  const lastMsg = messages[messages.length - 1];
  let prefillText = null;

  if (lastMsg.role === "assistant") {
    if (typeof lastMsg.content === "string") {
      prefillText = lastMsg.content;
    } else if (Array.isArray(lastMsg.content) && lastMsg.content[0]?.type === "text") {
      prefillText = lastMsg.content[0].text;
    }
  }

  const toolResults = [];
  const documents = [];
  const images = [];
  let lastUserText = "";

  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === "document") {
          documents.push(block);
        } else if (block.type === "image") {
          images.push(block);
        }
      }
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      if (typeof m.content === "string") {
        if (!lastUserText) lastUserText = m.content;
      } else if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === "tool_result") {
            toolResults.push(block);
          } else if (block.type === "text" && !lastUserText) {
            lastUserText = block.text;
          }
        }
      }
      if (lastUserText || toolResults.length > 0) break;
    }
  }

  return {
    lastRole: lastMsg.role,
    lastUserText,
    hasToolResult: toolResults.length > 0,
    toolResults,
    prefillText,
    documents,
    images
  };
}

/**
 * Checks if any Server-Side Tools (`web_search_*`, `web_fetch_*`, `code_execution_*`) are attached
 */
function findServerTools(tools = []) {
  if (!Array.isArray(tools)) return [];
  return tools.filter(
    (t) =>
      (t.type && (t.type.startsWith("web_search") || t.type.startsWith("web_fetch") || t.type.startsWith("code_execution"))) ||
      t.name === "web_search" ||
      t.name === "web_fetch" ||
      t.name === "code_execution"
  );
}

function selectClientToolCallIfApplicable(payload, state) {
  if (!Array.isArray(payload.tools) || payload.tools.length === 0) return null;
  if (state.hasToolResult) return null;
  if (payload.tool_choice?.type === "none") return null;

  // Exclude server-side tools from client tool_use selection
  const clientTools = payload.tools.filter(
    (t) => !t.type || t.type === "custom"
  );
  if (clientTools.length === 0) return null;

  const text = (state.lastUserText || "").toLowerCase();

  if (payload.tool_choice?.type === "tool" && payload.tool_choice.name) {
    const forced = clientTools.find((t) => t.name === payload.tool_choice.name) || clientTools[0];
    return buildToolUseBlock(forced, text);
  }

  for (const tool of clientTools) {
    if (tool.name === "get_weather" && (text.includes("weather") || text.includes("temperature") || text.includes("tokyo") || text.includes("san francisco") || text.includes("forecast") || text.includes("pack"))) {
      return buildToolUseBlock(tool, text);
    }
    if (tool.name === "query_customer_db" && (text.includes("customer") || text.includes("order") || text.includes("account") || text.includes("@") || text.includes("billing"))) {
      return buildToolUseBlock(tool, text);
    }
    if (tool.name === "calculate_cloud_cost" && (text.includes("cost") || text.includes("price") || text.includes("token") || text.includes("budget") || text.includes("calculate"))) {
      return buildToolUseBlock(tool, text);
    }
    if (tool.name === "get_service_health" && (text.includes("health") || text.includes("triage") || text.includes("latency") || text.includes("auth-service") || text.includes("incident") || text.includes("502"))) {
      return buildToolUseBlock(tool, text);
    }
    if (tool.name === "search_runbooks" && (text.includes("runbook") || text.includes("mitigat") || text.includes("redis") || text.includes("failover"))) {
      return buildToolUseBlock(tool, text);
    }
  }

  return buildToolUseBlock(clientTools[0], text);
}

function buildToolUseBlock(tool, userText) {
  const id = generateToolUseId();
  let input = {};

  switch (tool.name) {
    case "get_weather": {
      let location = "Tokyo, Japan";
      if (userText.includes("san francisco")) location = "San Francisco, CA";
      else if (userText.includes("london")) location = "London, UK";
      else if (userText.includes("new york")) location = "New York, NY";
      else if (userText.includes("berlin")) location = "Berlin, Germany";
      input = { location, unit: userText.includes("fahrenheit") ? "fahrenheit" : "celsius" };
      break;
    }
    case "query_customer_db":
      input = { email: "alex.rivera@example.com", order_id: "ORD-9021" };
      break;
    case "calculate_cloud_cost":
      input = { daily_requests: 5000, avg_input_tokens: 4000, avg_output_tokens: 600, cache_hit_rate: 0.85 };
      break;
    case "get_service_health":
      input = { service_name: "auth-service" };
      break;
    case "search_runbooks":
      input = { query: "connection pool latency", service: "auth-service" };
      break;
    case "create_incident_note":
      input = { incident_id: "INC-2048", summary: "Identified connection pool saturation on auth-service." };
      break;
    default: {
      const props = tool.input_schema?.properties || {};
      for (const [key, schema] of Object.entries(props)) {
        input[key] = schema.type === "number" ? 42 : `sample_${key}`;
      }
    }
  }

  return {
    type: "tool_use",
    id,
    name: tool.name,
    input,
    caller: { type: "direct" }
  };
}

function buildThinkingBlock(payload, state, plannedTool) {
  if (!payload.thinking || (payload.thinking.type !== "enabled" && payload.thinking.type !== "adaptive")) {
    return null;
  }

  const isAdaptive = payload.thinking.type === "adaptive";
  const displayMode = payload.thinking.display || "summarized";
  const effort = payload.output_config?.effort || "high";
  const budget = payload.thinking.budget_tokens || 2048;

  let reasoning = `Let's analyze the user's request: "${(state.lastUserText || "").slice(0, 120)}".\n\n`;

  if (isAdaptive) {
    reasoning += `1. [Adaptive Thinking • effort: "${effort}"] Dynamically calibrating reasoning depth based on task complexity.\n`;
  } else {
    reasoning += `1. [Manual Extended Thinking • budget_tokens: ${budget}] Operating within explicit token budget.\n`;
  }

  if (plannedTool) {
    reasoning += `2. Reviewing available tools (${payload.tools.map((t) => t.name).join(", ")}).\n`;
    reasoning += `3. Selecting \`${plannedTool.name}\` and constructing schema-validated arguments: ${JSON.stringify(plannedTool.input)}.\n`;
  } else if (state.documents.length > 0 || state.images.length > 0) {
    reasoning += `2. Inspecting multimodal blocks (${state.documents.length} document(s), ${state.images.length} image(s)).\n`;
    reasoning += `3. Locating exact character spans to ground every claim with a \`char_location\` citation block.`;
  } else if (state.hasToolResult) {
    reasoning += `2. Parsing the \`tool_result\` block returned by the user's application.\n`;
    reasoning += `3. Synthesizing a grounded final answer from the tool execution output.`;
  } else if (payload.output_config?.format?.type === "json_schema") {
    reasoning += `2. Constrained decoding is active via \`output_config.format.type = "json_schema"\`.\n`;
    reasoning += `3. Mapping extracted entities strictly to the required JSON Schema properties (${Object.keys(payload.output_config.format.schema?.properties || {}).join(", ")}).`;
  } else {
    reasoning += `2. Evaluating architectural constraints and system instructions.\n`;
    reasoning += `3. Formulating a concise, accurate response.`;
  }

  return {
    type: "thinking",
    thinking: displayMode === "omitted" ? "" : reasoning,
    _raw_reasoning_for_token_count: reasoning,
    signature: "ErUBCkYICBgCIkD" + crypto.randomBytes(24).toString("base64")
  };
}

function buildSimulatedMessage(payload) {
  const model = payload.model || "claude-sonnet-5-5";
  const maxTokens = Number(payload.max_tokens ?? 1024);
  const state = analyzeConversationState(payload.messages);
  const msgId = generateMsgId();

  // 1. Check `temperature` deprecation on post-Opus 4.6 models
  if (payload.temperature !== undefined && Number(payload.temperature) !== 1.0 && isPostOpus46Model(model)) {
    return {
      _httpStatus: 400,
      type: "error",
      error: {
        type: "invalid_request_error",
        message: `\`temperature\` is deprecated for model '${model}'. Models released after Claude Opus 4.6 do not support setting temperature (only 1.0 is accepted for backwards compatibility; all other values are rejected with a 400 error). Use \`output_config.effort\` ("low" | "medium" | "high" | "xhigh" | "max") instead.`
      }
    };
  }

  // 2. Check Assistant Prefill deprecation on post-Opus 4.6 models
  if (state.prefillText !== null && isPostOpus46Model(model)) {
    return {
      _httpStatus: 400,
      type: "error",
      error: {
        type: "invalid_request_error",
        message: `Model '${model}' does not support assistant message prefill. The conversation must end with a user message. To constrain output format, use \`output_config: { format: { type: "json_schema", schema: ... } }\` instead.`
      }
    };
  }

  // 3. Check `image` oversized_image === "error" simulation if requested
  const oversizedErrImg = state.images.find((img) => img.transformations?.oversized_image === "error" && img._sim_oversized);
  if (oversizedErrImg) {
    return {
      _httpStatus: 400,
      type: "error",
      error: {
        type: "invalid_request_error",
        message: `Image dimensions (3840x2160) exceed the model's maximum allowed image dimensions (1568x1568) and \`transformations.oversized_image\` was set to "error" instead of "downsize".`
      }
    };
  }

  const diagnosticsObj = evaluateCacheDiagnostics(payload, msgId);

  // 4. `max_tokens: 0` cache pre-warming
  if (maxTokens === 0) {
    const usage = calculateUsageWithCache(payload, "", "");
    return {
      id: msgId,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: "max_tokens",
      stop_sequence: null,
      stop_details: null,
      diagnostics: diagnosticsObj,
      usage
    };
  }

  const serverTools = findServerTools(payload.tools);
  const plannedClientTool = serverTools.length === 0 ? selectClientToolCallIfApplicable(payload, state) : null;
  const thinkingBlock = buildThinkingBlock(payload, state, plannedClientTool);
  const rawReasoningText = thinkingBlock ? thinkingBlock._raw_reasoning_for_token_count : "";
  if (thinkingBlock) {
    delete thinkingBlock._raw_reasoning_for_token_count;
  }

  const contentBlocks = [];
  if (thinkingBlock) {
    contentBlocks.push(thinkingBlock);
  }

  let stopReason = "end_turn";
  let stopSequence = null;
  let mainText = "";
  const serverToolCounts = { web_search_requests: 0, web_fetch_requests: 0 };

  // Handle Server-Side Built-in Tools (`web_search_20260318`, `code_execution_20250522`, etc.)
  if (serverTools.length > 0) {
    for (const st of serverTools) {
      const srvId = generateServerToolUseId();
      if ((st.type && st.type.startsWith("web_search")) || st.name === "web_search") {
        serverToolCounts.web_search_requests += 1;
        contentBlocks.push({
          type: "server_tool_use",
          id: srvId,
          name: "web_search",
          input: { query: state.lastUserText.slice(0, 65) || "Anthropic Claude API server tools 2026" },
          caller: { type: "direct" }
        });
        contentBlocks.push({
          type: "web_search_tool_result",
          tool_use_id: srvId,
          content: [
            {
              type: "web_search_result",
              title: "Claude API Server-Side Tools & Managed Execution",
              url: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools",
              page_age: "2 days ago",
              encrypted_content: "eyJhbGciOiJBMjU2R0NNIiwidHlwIjoiSldUIn0..."
            }
          ]
        });
      } else if ((st.type && st.type.startsWith("code_execution")) || st.name === "code_execution") {
        contentBlocks.push({
          type: "server_tool_use",
          id: srvId,
          name: "code_execution",
          input: {
            code: "import statistics\nlatencies = [14.2, 18.5, 19.1, 412.0, 15.8]\nprint(f'Mean: {statistics.mean(latencies):.1f}ms, P99 spike: {max(latencies)}ms')"
          },
          caller: { type: "direct" }
        });
        contentBlocks.push({
          type: "code_execution_tool_result",
          tool_use_id: srvId,
          content: {
            type: "code_execution_result",
            return_code: 0,
            stdout: "Mean: 95.9ms, P99 spike: 412.0ms\n",
            stderr: "",
            content: []
          }
        });
      }
    }

    mainText = `### Server-Side Tool Execution Completed in Single Turn!\n\nNotice how **Server Tools** (\`server_tool_use\` with ID \`srvtoolu_...\`) differ from Client Tools:\n1. **Executed by Anthropic's Infrastructure:** Your application did *not* have to pause at \`stop_reason: "tool_use"\` or run local code—Anthropic's server executed the tool and appended the \`*_tool_result\` block automatically in the same response.\n2. **stop_reason is \`"end_turn"\`:** The entire search/code-execution loop finished inside a single HTTP call!`;
    contentBlocks.push({ type: "text", text: mainText });
  } else if (plannedClientTool) {
    mainText = `I'll check that for you using the \`${plannedClientTool.name}\` tool.`;
    contentBlocks.push({ type: "text", text: mainText });
    contentBlocks.push(plannedClientTool);
    stopReason = "tool_use";
  } else if (state.documents.length > 0 || state.images.length > 0) {
    // Grounded Citations & Vision response!
    const doc = state.documents[0];
    const docTitle = doc?.title || "Acme Cloud SLA & Architecture Spec";
    const docText = typeof doc?.source?.data === "string"
      ? doc.source.data
      : "Section 1: All Tier-1 production APIs guarantee 99.99% uptime with a maximum P99 latency of 45ms. Section 2: Ephemeral prompt caches default to a 5-minute TTL (5m) or optional 1-hour TTL (1h), reducing input token billing by 90%. Section 3: Oversized images exceeding 1568x1568 are downsized by default unless transformations.oversized_image is set to error.";

    const cite1Text = "All Tier-1 production APIs guarantee 99.99% uptime with a maximum P99 latency of 45ms.";
    const cite1Start = Math.max(0, docText.indexOf("All Tier-1"));
    const cite1End = cite1Start + cite1Text.length;

    const cite2Text = "Ephemeral prompt caches default to a 5-minute TTL (5m) or optional 1-hour TTL (1h), reducing input token billing by 90%.";
    const cite2Start = Math.max(0, docText.indexOf("Ephemeral prompt"));
    const cite2End = cite2Start + cite2Text.length;

    contentBlocks.push({
      type: "text",
      text: "According to the provided specification, Tier-1 production services must maintain a 99.99% uptime SLA and keep P99 latency under 45ms.",
      citations: [
        {
          type: "char_location",
          cited_text: cite1Text,
          document_index: 0,
          document_title: docTitle,
          start_char_index: cite1Start,
          end_char_index: cite1End
        }
      ]
    });

    contentBlocks.push({
      type: "text",
      text: " Furthermore, enabling ephemeral prompt caching provides a 5-minute (`5m`) or 1-hour (`1h`) TTL that reduces input token costs by 90%.",
      citations: [
        {
          type: "char_location",
          cited_text: cite2Text,
          document_index: 0,
          document_title: docTitle,
          start_char_index: cite2Start,
          end_char_index: cite2End
        }
      ]
    });

    if (state.images.length > 0) {
      const imgTransform = state.images[0].transformations?.oversized_image || "downsize";
      contentBlocks.push({
        type: "text",
        text: ` (Image block inspected with \`transformations.oversized_image: "${imgTransform}"\`.)`
      });
    }

    mainText = contentBlocks.filter((b) => b.type === "text").map((b) => b.text).join("");
  } else if (state.hasToolResult) {
    const rawResult = state.toolResults.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
    mainText = `Based on the tool execution result returned to me:\n\n\`\`\`json\n${rawResult}\n\`\`\`\n\nHere is the summary:\n- **Tool Call Lifecycle Completed:** Your application executed the tool locally and sent back a \`role: "user"\` message containing a \`tool_result\` content block linked by \`tool_use_id\`.\n- **Key Takeaways:** All metrics and fields from the external system have been incorporated into this final \`end_turn\` response.`;
    contentBlocks.push({ type: "text", text: mainText });
  } else if (payload.output_config?.format?.type === "json_schema") {
    const structuredResponse = {
      topic: "Anthropic Claude API Official Reference (2026)",
      key_changes: [
        "Models released after Claude Opus 4.6 (including Claude 4.7, 4.8, 5, and 5.5) deprecate temperature (only 1.0 accepted; other values return 400)",
        "output_config.effort supports 'low', 'medium', 'high', 'xhigh', and 'max'",
        "output_config.format (json_schema) provides native constrained decoding, replacing legacy assistant prefill",
        "max_tokens: 0 can be used to pre-warm the prompt cache without generating output tokens"
      ],
      recommended_effort: payload.output_config?.effort || "high",
      schema_enforced: true
    };
    mainText = JSON.stringify(structuredResponse, null, 2);
    contentBlocks.push({ type: "text", text: mainText });
  } else if (state.prefillText !== null) {
    mainText = `\n  "legacy_feature": "Assistant Prefilling",\n  "note": "Supported on Claude 4.6 and earlier, but returns a 400 error on post-Opus 4.6 models (4.7, 5.x). Use output_config.format (json_schema) instead!"\n}`;
    contentBlocks.push({ type: "text", text: mainText });
  } else {
    const effortInfo = payload.output_config?.effort ? `, \`output_config.effort: "${payload.output_config.effort}"\`` : "";
    const speedInfo = payload.speed ? `, \`speed: "${payload.speed}"\`` : "";
    mainText = `### How the Claude Messages API Processed This Request\n\n1. **Stateless Context (\`messages\`):** The API received **${(payload.messages || []).length} message turn(s)**${payload.system ? " plus a top-level `system` instruction" : ""}.\n2. **Model & Output Configuration:** Generated with \`model: "${model}"\`, \`max_tokens: ${maxTokens}\`${effortInfo}${speedInfo}. Per official docs, \`temperature\` is deprecated on models after Claude Opus 4.6 (any value other than \`1.0\` returns a \`400\` error).\n3. **Interactive Parameter Tooltips:** Hover over any key in the **HTTP Request** or **Raw Response** JSON viewer on the right to see official documentation tooltips!`;

    if (Array.isArray(payload.stop_sequences) && payload.stop_sequences.length > 0) {
      for (const seq of payload.stop_sequences) {
        if (seq && mainText.includes(seq)) {
          mainText = mainText.split(seq)[0];
          stopReason = "stop_sequence";
          stopSequence = seq;
          break;
        }
      }
    }

    if (maxTokens <= 45) {
      const words = mainText.split(" ");
      mainText = words.slice(0, Math.max(5, Math.floor(maxTokens * 0.65))).join(" ") + "...";
      stopReason = "max_tokens";
    }

    contentBlocks.push({ type: "text", text: mainText });
  }

  const usage = calculateUsageWithCache(
    payload,
    mainText + (plannedClientTool ? JSON.stringify(plannedClientTool.input) : ""),
    rawReasoningText,
    serverToolCounts
  );

  return {
    id: msgId,
    type: "message",
    role: "assistant",
    model,
    content: contentBlocks,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    stop_details: null,
    diagnostics: diagnosticsObj,
    usage
  };
}

function buildSimulatedSseEvents(payload) {
  const fullMsg = buildSimulatedMessage(payload);
  const events = [];

  if (fullMsg._httpStatus === 400) {
    events.push({
      event: "error",
      data: fullMsg
    });
    return { fullMsg, events };
  }

  events.push({
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: fullMsg.id,
        type: "message",
        role: "assistant",
        model: fullMsg.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: {
          input_tokens: fullMsg.usage.input_tokens,
          cache_creation_input_tokens: fullMsg.usage.cache_creation_input_tokens,
          cache_read_input_tokens: fullMsg.usage.cache_read_input_tokens,
          cache_creation: fullMsg.usage.cache_creation,
          output_tokens: 1,
          output_tokens_details: { thinking_tokens: 0 }
        }
      }
    }
  });

  events.push({
    event: "ping",
    data: { type: "ping" }
  });

  fullMsg.content.forEach((block, index) => {
    if (block.type === "thinking") {
      events.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index,
          content_block: { type: "thinking", thinking: "" }
        }
      });

      if (block.thinking) {
        const chunks = chunkString(block.thinking, 45);
        for (const chunk of chunks) {
          events.push({
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index,
              delta: { type: "thinking_delta", thinking: chunk }
            }
          });
        }
      }

      events.push({
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index,
          delta: { type: "signature_delta", signature: block.signature }
        }
      });

      events.push({
        event: "content_block_stop",
        data: { type: "content_block_stop", index }
      });
    } else if (block.type === "text") {
      events.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" }
        }
      });

      const chunks = chunkString(block.text, 28);
      for (const chunk of chunks) {
        events.push({
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index,
            delta: { type: "text_delta", text: chunk }
          }
        });
      }

      if (Array.isArray(block.citations)) {
        for (const citation of block.citations) {
          events.push({
            event: "content_block_delta",
            data: {
              type: "content_block_delta",
              index,
              delta: { type: "citations_delta", citation }
            }
          });
        }
      }

      events.push({
        event: "content_block_stop",
        data: { type: "content_block_stop", index }
      });
    } else if (block.type === "tool_use" || block.type === "server_tool_use") {
      events.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index,
          content_block: {
            type: block.type,
            id: block.id,
            name: block.name,
            input: {}
          }
        }
      });

      const jsonStr = JSON.stringify(block.input);
      const jsonChunks = chunkString(jsonStr, 18);
      for (const partial of jsonChunks) {
        events.push({
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index,
            delta: { type: "input_json_delta", partial_json: partial }
          }
        });
      }

      events.push({
        event: "content_block_stop",
        data: { type: "content_block_stop", index }
      });
    }
  });

  events.push({
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: {
        stop_reason: fullMsg.stop_reason,
        stop_sequence: fullMsg.stop_sequence,
        stop_details: null
      },
      usage: {
        input_tokens: fullMsg.usage.input_tokens,
        cache_creation_input_tokens: fullMsg.usage.cache_creation_input_tokens,
        cache_read_input_tokens: fullMsg.usage.cache_read_input_tokens,
        output_tokens: fullMsg.usage.output_tokens,
        output_tokens_details: fullMsg.usage.output_tokens_details
      }
    }
  });

  events.push({
    event: "message_stop",
    data: { type: "message_stop" }
  });

  return { fullMsg, events };
}

function chunkString(str, size) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks.length ? chunks : [""];
}

module.exports = {
  buildSimulatedMessage,
  buildSimulatedSseEvents,
  resetSimulatorCache
};
