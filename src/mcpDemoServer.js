/**
 * In-Memory Model Context Protocol (MCP) Demo Server & Claude Bridge
 * Implements JSON-RPC 2.0 methods (`initialize`, `tools/list`, `resources/list`,
 * `resources/read`, `prompts/list`, `prompts/get`, `tools/call`) so users can
 * inspect the exact MCP wire protocol and see how MCP bridges to the Claude Messages API.
 */

const MCP_SERVER_INFO = {
  name: "acme-engineering-mcp-server",
  version: "1.2.0",
  protocolVersion: "2025-03-26"
};

const MCP_TOOLS = [
  {
    name: "search_runbooks",
    description: "Search internal SRE engineering runbooks and architecture docs by keyword.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query, e.g., 'redis latency', 'rate limits', or 'database failover'"
        },
        service: {
          type: "string",
          description: "Optional microservice filter (e.g., 'auth-service', 'billing-api')"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "get_service_health",
    description: "Check real-time telemetry, error rate, and P99 latency for a production service.",
    inputSchema: {
      type: "object",
      properties: {
        service_name: {
          type: "string",
          enum: ["api-gateway", "auth-service", "payment-worker", "vector-db"],
          description: "The production microservice name"
        }
      },
      required: ["service_name"]
    }
  },
  {
    name: "create_incident_note",
    description: "Append a timestamped diagnostic note to the active incident timeline.",
    inputSchema: {
      type: "object",
      properties: {
        incident_id: {
          type: "string",
          description: "Incident identifier, e.g. 'INC-2048'"
        },
        summary: {
          type: "string",
          description: "Diagnostic finding or mitigation step"
        }
      },
      required: ["incident_id", "summary"]
    }
  }
];

const MCP_RESOURCES = [
  {
    uri: "runbook://sre/redis-cluster-failover",
    name: "Redis Cluster Failover Runbook",
    description: "Step-by-step mitigation guide when cache cluster P99 latency exceeds 50ms.",
    mimeType: "text/markdown"
  },
  {
    uri: "config://production/rate-limits.json",
    name: "Production API Gateway Rate Limits",
    description: "Current token bucket and burst configurations across tiers.",
    mimeType: "application/json"
  }
];

const MCP_PROMPTS = [
  {
    name: "incident-triage",
    description: "Structured prompt template for triaging production alerts using MCP tools.",
    arguments: [
      {
        name: "service_name",
        description: "Name of the alerting service",
        required: true
      },
      {
        name: "symptom",
        description: "Observed alert symptom (e.g., '502 Bad Gateway spike')",
        required: true
      }
    ]
  }
];

function executeMcpTool(name, args = {}) {
  switch (name) {
    case "search_runbooks":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              query: args.query || "latency",
              matches: [
                {
                  id: "RB-104",
                  title: "Mitigating Connection Pool Exhaustion & Latency Spikes",
                  service: args.service || "auth-service",
                  snippet: "If P99 latency > 250ms and DB pool utilization is at 100%, scale read-replicas and cycle stale worker pods via `kubectl rollout restart`."
                },
                {
                  id: "RB-209",
                  title: "Anthropic API Prompt Caching Best Practices",
                  service: "ai-gateway",
                  snippet: "Place `cache_control: { type: 'ephemeral' }` at the end of static system instructions and tool definitions to reduce TTFT (Time To First Token) by up to 80%."
                }
              ]
            }, null, 2)
          }
        ],
        isError: false
      };

    case "get_service_health":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              service: args.service_name || "auth-service",
              status: "DEGRADED",
              p99_latency_ms: 412,
              error_rate_percent: 2.4,
              active_connections: 980,
              max_connections: 1000,
              recent_warning: "Connection pool saturation warning on primary replica"
            }, null, 2)
          }
        ],
        isError: false
      };

    case "create_incident_note":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              recorded: true,
              incident_id: args.incident_id || "INC-2048",
              summary: args.summary || "Investigated service telemetry.",
              recorded_at: new Date().toISOString()
            }, null, 2)
          }
        ],
        isError: false
      };

    default:
      return {
        content: [{ type: "text", text: `Unknown MCP tool: ${name}` }],
        isError: true
      };
  }
}

/**
 * Handles a standard JSON-RPC 2.0 request to the demo MCP server
 */
function handleMcpJsonRpc(rpcRequest) {
  const { jsonrpc = "2.0", id = 1, method, params = {} } = rpcRequest;

  switch (method) {
    case "initialize":
      return {
        jsonrpc,
        id,
        result: {
          protocolVersion: MCP_SERVER_INFO.protocolVersion,
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false }
          },
          serverInfo: {
            name: MCP_SERVER_INFO.name,
            version: MCP_SERVER_INFO.version
          }
        }
      };

    case "tools/list":
      return {
        jsonrpc,
        id,
        result: {
          tools: MCP_TOOLS
        }
      };

    case "resources/list":
      return {
        jsonrpc,
        id,
        result: {
          resources: MCP_RESOURCES
        }
      };

    case "resources/read": {
      const uri = params.uri || MCP_RESOURCES[0].uri;
      const content = uri.includes("rate-limits")
        ? JSON.stringify({ free_tier_rpm: 50, pro_tier_rpm: 1000, enterprise_rpm: 5000, prompt_cache_ttl_sec: 300 }, null, 2)
        : "# Redis Cluster Failover Runbook\n1. Verify replica lag < 10ms\n2. Promote replica via `redis-cli cluster failover`\n3. Confirm client connection pool recovery.";
      return {
        jsonrpc,
        id,
        result: {
          contents: [
            {
              uri,
              mimeType: uri.endsWith(".json") ? "application/json" : "text/markdown",
              text: content
            }
          ]
        }
      };
    }

    case "prompts/list":
      return {
        jsonrpc,
        id,
        result: {
          prompts: MCP_PROMPTS
        }
      };

    case "prompts/get": {
      const service = params.arguments?.service_name || "auth-service";
      const symptom = params.arguments?.symptom || "High P99 Latency (412ms)";
      return {
        jsonrpc,
        id,
        result: {
          description: "Incident triage prompt hydrated with user arguments",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Please triage production service '${service}' experiencing symptom: '${symptom}'. First check service health via get_service_health, then search runbooks for mitigation steps.`
              }
            }
          ]
        }
      };
    }

    case "tools/call": {
      const toolResult = executeMcpTool(params.name, params.arguments || {});
      return {
        jsonrpc,
        id,
        result: toolResult
      };
    }

    default:
      return {
        jsonrpc,
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      };
  }
}

/**
 * Converts MCP tool definitions (`inputSchema` camelCase) into
 * Anthropic Claude API tool definitions (`input_schema` snake_case).
 */
function convertMcpToolsToClaudeTools(mcpTools = MCP_TOOLS) {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema
  }));
}

module.exports = {
  MCP_SERVER_INFO,
  MCP_TOOLS,
  MCP_RESOURCES,
  MCP_PROMPTS,
  handleMcpJsonRpc,
  convertMcpToolsToClaudeTools,
  executeMcpTool
};
