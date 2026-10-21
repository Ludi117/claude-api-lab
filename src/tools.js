/**
 * Sample Local Tools & JSON Schemas for the Tool Use & Agentic Loop Lab
 * Remember: Claude NEVER executes code directly. Claude returns a `tool_use` content block
 * with `stop_reason: "tool_use"`, and YOUR application runs these functions and returns a `tool_result`.
 */

const { findModel, DEFAULT_MODEL_ID, PRICING_AS_OF } = require("./models");

const TOOL_DEFINITIONS = [
  {
    name: "get_weather",
    description: "Get the current weather and forecast for a given city location. Use this whenever the user asks about weather, temperature, or packing recommendations.",
    input_schema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The city and state/country, e.g. 'San Francisco, CA' or 'Tokyo, Japan'"
        },
        unit: {
          type: "string",
          enum: ["celsius", "fahrenheit"],
          description: "The temperature unit to use. Defaults to celsius."
        }
      },
      required: ["location"]
    }
  },
  {
    name: "query_customer_db",
    description: "Query the internal customer & order SQLite database by customer email or order ID. Returns account tier, recent orders, and billing status.",
    input_schema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "Customer email address to look up"
        },
        order_id: {
          type: "string",
          description: "Optional specific order ID (e.g., 'ORD-9021')"
        }
      },
      required: ["email"]
    }
  },
  {
    name: "calculate_cloud_cost",
    description: "Calculate estimated monthly Anthropic API token cost given daily request volume and average input/output tokens per request.",
    input_schema: {
      type: "object",
      properties: {
        daily_requests: {
          type: "number",
          description: "Number of API calls per day"
        },
        avg_input_tokens: {
          type: "number",
          description: "Average input tokens per request"
        },
        avg_output_tokens: {
          type: "number",
          description: "Average output tokens per request"
        },
        cache_hit_rate: {
          type: "number",
          description: "Fraction of input tokens served from prompt cache (0.0 to 1.0)"
        },
        model: {
          type: "string",
          description: "Model ID to price against (defaults to the app's default model)"
        }
      },
      required: ["daily_requests", "avg_input_tokens", "avg_output_tokens"]
    }
  }
];

/**
 * Executes a tool locally on the server (simulating your backend application logic).
 */
function executeLocalTool(name, input = {}) {
  switch (name) {
    case "get_weather": {
      const loc = (input.location || "San Francisco, CA").toLowerCase();
      const unit = input.unit || "celsius";
      let tempC = 19;
      let condition = "Partly Cloudy with coastal breeze";
      let humidity = "68%";

      if (loc.includes("tokyo")) {
        tempC = 22;
        condition = "Clear skies";
        humidity = "54%";
      } else if (loc.includes("london") || loc.includes("munich") || loc.includes("berlin")) {
        tempC = 13;
        condition = "Light rain showers";
        humidity = "82%";
      } else if (loc.includes("new york")) {
        tempC = 17;
        condition = "Crisp autumn sunshine";
        humidity = "49%";
      }

      const temperature = unit === "fahrenheit" ? Math.round(tempC * 1.8 + 32) : tempC;
      return {
        location: input.location || "San Francisco, CA",
        temperature,
        unit,
        condition,
        humidity,
        wind_kph: 14,
        timestamp: new Date().toISOString()
      };
    }

    case "query_customer_db": {
      const email = input.email || "alex.rivera@example.com";
      return {
        customer_id: "CUST-48210",
        email,
        name: "Alex Rivera",
        plan_tier: "Enterprise Pro",
        account_status: "Active",
        recent_orders: [
          {
            order_id: input.order_id || "ORD-9021",
            date: "2026-10-14",
            item: "Annual API Enterprise Seat License (25x)",
            amount_usd: 4500.00,
            status: "Delivered"
          },
          {
            order_id: "ORD-8814",
            date: "2026-09-02",
            item: "Dedicated Throughput Add-on",
            amount_usd: 1200.00,
            status: "Active"
          }
        ]
      };
    }

    case "calculate_cloud_cost": {
      const reqs = Number(input.daily_requests || 1000);
      const inTok = Number(input.avg_input_tokens || 2000);
      const outTok = Number(input.avg_output_tokens || 500);
      const cacheRate = Math.min(1, Math.max(0, Number(input.cache_hit_rate ?? 0)));

      const model = findModel(input.model) || findModel(DEFAULT_MODEL_ID);
      const price = model.pricing;
      const monthlyReqs = reqs * 30;
      const totalInM = (monthlyReqs * inTok) / 1_000_000;
      const totalOutM = (monthlyReqs * outTok) / 1_000_000;

      const uncachedInCost = totalInM * (1 - cacheRate) * price.input;
      const cachedInCost = totalInM * cacheRate * price.cacheRead;
      const outputCost = totalOutM * price.output;
      const totalMonthlyUsd = Number((uncachedInCost + cachedInCost + outputCost).toFixed(2));
      const baselineWithoutCacheUsd = Number((totalInM * price.input + outputCost).toFixed(2));

      return {
        model_pricing_basis: `${model.id} ($${price.input}/M input, $${price.cacheRead}/M cache read, $${price.output}/M output; list prices as of ${PRICING_AS_OF})`,
        monthly_requests: monthlyReqs,
        monthly_input_tokens_millions: Number(totalInM.toFixed(2)),
        monthly_output_tokens_millions: Number(totalOutM.toFixed(2)),
        cache_hit_rate: cacheRate,
        estimated_monthly_cost_usd: totalMonthlyUsd,
        baseline_without_cache_usd: baselineWithoutCacheUsd,
        monthly_savings_from_cache_usd: Number((baselineWithoutCacheUsd - totalMonthlyUsd).toFixed(2))
      };
    }

    default:
      return {
        status: "executed_custom_tool",
        tool_name: name,
        received_arguments: input,
        note: "Simulated local execution of custom user-defined tool."
      };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeLocalTool
};
