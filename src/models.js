/**
 * Single source of truth for the models the app offers (`src/models.js`).
 * Served to the UI via `GET /api/status`, and used by the simulator and the local cost tool.
 *
 * Pricing is USD per 1M tokens, Anthropic first-party API list prices as of 2026-10.
 * Cache writes (5-minute TTL) are billed at 1.25x input; cache reads use the listed `cacheRead` rate.
 */
const PRICING_AS_OF = "2026-10";

const MODELS = [
  {
    id: "claude-sonnet-5-5",
    label: "claude-sonnet-5-5 (Latest)",
    pricing: { input: 2.0, output: 10.0, cacheRead: 0.2 },
    thinking: "adaptive"
  },
  {
    id: "claude-opus-5-5",
    label: "claude-opus-5-5 (Latest)",
    pricing: { input: 4.0, output: 20.0, cacheRead: 0.2 },
    thinking: "adaptive"
  },
  {
    id: "claude-haiku-5-5",
    label: "claude-haiku-5-5 (Fastest)",
    // Prompts up to 100K tokens; longer prompts are billed at $0.50 / $2.50
    pricing: { input: 0.1, output: 0.5, cacheRead: 0.01 },
    thinking: "adaptive"
  },
  {
    id: "claude-fable-5-1",
    label: "claude-fable-5-1 (Frontier)",
    pricing: { input: 10.0, output: 50.0, cacheRead: 0.25 },
    thinking: "adaptive"
  },
  {
    id: "claude-opus-4-7",
    label: "claude-opus-4-7 (Post-4.6 Strict)",
    pricing: { input: 5.0, output: 25.0, cacheRead: 0.5 },
    thinking: "adaptive"
  },
  {
    id: "claude-sonnet-4-6",
    label: "claude-sonnet-4-6",
    pricing: { input: 3.0, output: 15.0, cacheRead: 0.3 },
    thinking: "adaptive"
  },
  {
    id: "claude-sonnet-4-5",
    label: "claude-sonnet-4-5 (Legacy 4.5)",
    pricing: { input: 3.0, output: 15.0, cacheRead: 0.3 },
    thinking: "budget"
  }
];

const CACHE_WRITE_MULTIPLIER = 1.25;
const DEFAULT_MODEL_ID = MODELS[0].id;

function findModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

// Models released after Opus 4.6 (4.7, 4.8, 5.x) reject `temperature` and trailing assistant prefill
function isPostOpus46Model(model = "") {
  const match = model.match(/-(\d+)-(\d+)$/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 4 || (major === 4 && minor >= 7);
}

function publicModelCatalog() {
  return {
    pricingAsOf: PRICING_AS_OF,
    cacheWriteMultiplier: CACHE_WRITE_MULTIPLIER,
    defaultModel: DEFAULT_MODEL_ID,
    models: MODELS.map((m) => ({ ...m, strict: isPostOpus46Model(m.id) }))
  };
}

module.exports = {
  MODELS,
  PRICING_AS_OF,
  CACHE_WRITE_MULTIPLIER,
  DEFAULT_MODEL_ID,
  findModel,
  isPostOpus46Model,
  publicModelCatalog
};
