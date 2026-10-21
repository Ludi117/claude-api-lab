/**
 * Model catalog + cost estimation for the UI (`public/js/pricing.js`).
 * The catalog comes from `src/models.js` via `GET /api/status`, so prices live in one place.
 */

let catalog = { models: [], cacheWriteMultiplier: 1.25, pricingAsOf: "", defaultModel: "claude-sonnet-5-5" };

const CACHE_WRITE_1H_MULTIPLIER = 2.0;

export function setModelCatalog(next) {
  if (next && Array.isArray(next.models)) catalog = next;
}

export function getModelCatalog() {
  return catalog;
}

export function getModelInfo(modelId) {
  return catalog.models.find((m) => m.id === modelId) || null;
}

/**
 * Cost of one response's `usage` in USD. Unknown models fall back to the default model's prices
 * (flagged with `knownModel: false` so the UI can say so).
 */
export function estimateCost(modelId, usage = {}) {
  const info = getModelInfo(modelId) || getModelInfo(catalog.defaultModel);
  const p = info?.pricing || { input: 0, output: 0, cacheRead: 0 };

  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens || 0;
  const write5m = Math.max(0, cacheWrite - write1h);

  const rates = {
    input: p.input,
    output: p.output,
    cacheRead: p.cacheRead,
    cacheWrite5m: p.input * catalog.cacheWriteMultiplier,
    cacheWrite1h: p.input * CACHE_WRITE_1H_MULTIPLIER
  };

  const costInput = (inTok / 1e6) * rates.input;
  const costCacheWrite = (write5m / 1e6) * rates.cacheWrite5m + (write1h / 1e6) * rates.cacheWrite1h;
  const costCacheRead = (cacheRead / 1e6) * rates.cacheRead;
  const costOutput = (outTok / 1e6) * rates.output;
  const total = costInput + costCacheWrite + costCacheRead + costOutput;
  const uncachedEquivalent = ((inTok + cacheWrite + cacheRead) / 1e6) * rates.input + costOutput;

  return {
    modelId: info?.id || modelId,
    knownModel: Boolean(getModelInfo(modelId)),
    rates,
    costInput,
    costCacheWrite,
    costCacheRead,
    costOutput,
    total,
    uncachedEquivalent
  };
}

export function formatUsd(value, digits = 6) {
  return `$${(value || 0).toFixed(digits)}`;
}
