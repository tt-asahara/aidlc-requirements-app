/** Published 2026-10-12, effective 2026-09-01. Standard regional CRIS, USD / 1M tokens.
 * https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/ap-northeast-1/index.json
 * Cache writes use the more expensive 1h rate even when the TTL is unknown.
 */
export const TOKYO_SONNET_46 = {
  model: "jp.anthropic.claude-sonnet-4-6",
  input: 3.3,
  output: 16.5,
  read: 0.33,
  write: 6.6,
  skus: [
    "VFYW9EGDPE5FR2S3",
    "DRJPH2YRDBQTJV8Q",
    "M9BWDC6MFPWWQAHV",
    "FQPPMSDUHM6QAWAJ",
  ],
};
export function upperTokenCost(modelUsage: unknown): number {
  if (!modelUsage || typeof modelUsage !== "object")
    throw new Error("Missing model usage");
  let cost = 0;
  for (const [model, usage] of Object.entries(modelUsage)) {
    if (model !== TOKYO_SONNET_46.model || !usage || typeof usage !== "object")
      throw new Error("Unpriced model");
    const row = usage as Record<string, unknown>;
    const count = (key: string) => {
      const n = row[key];
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
        throw new Error("Incomplete token counts");
      return n;
    };
    if (row.webSearchRequests !== undefined && row.webSearchRequests !== 0)
      throw new Error("Unpriced web search");
    cost +=
      (count("inputTokens") * TOKYO_SONNET_46.input +
        count("outputTokens") * TOKYO_SONNET_46.output +
        count("cacheReadInputTokens") * TOKYO_SONNET_46.read +
        count("cacheCreationInputTokens") * TOKYO_SONNET_46.write) /
      1_000_000;
  }
  return cost;
}
