// Operator preflight only. Set coverage is separate from native contract/hash
// validation, semantic UI tests, summary authority and formal stage approval.
export function refinedAcCoverage(stories: string, contractMarkdown: string) {
  if (
    [stories, contractMarkdown].some(
      (text) => Buffer.byteLength(text) > 512 * 1024,
    )
  )
    throw new Error("AC coverage input exceeds 512 KiB");
  const definitions: string[] = [];
  let fence: string | undefined;
  for (const line of stories.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      continue;
    }
    if (fence) continue;
    // These are definitions, not references inside Given/When/Then, quotes or
    // tables. Unrecognized source formats remain unverified, never empty PASS.
    const definition = /^\*\*(AC\d+\.\d+\.\d+)\s+[—–-]\s+.+\*\*\s*$/.exec(line);
    if (definition) definitions.push(definition[1] as string);
  }
  if (!definitions.length || definitions.length > 2000)
    throw new Error("No bounded, recognized formal AC definitions");
  if (new Set(definitions).size !== definitions.length)
    throw new Error("Duplicate formal AC definitions");
  const blocks = [
    ...contractMarkdown.matchAll(
      /^```ui-poc-contract[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm,
    ),
  ];
  if (blocks.length !== 1)
    throw new Error("Expected one ui-poc-contract block");
  const contract = JSON.parse(blocks[0]?.[1] ?? "") as {
    schema?: unknown;
    stage?: unknown;
    mappings?: unknown;
    requiredMappings?: unknown;
  };
  if (contract.schema !== 2 || contract.stage !== "refined-mockups")
    throw new Error("Expected current refined schema 2 contract");
  if (
    !Array.isArray(contract.mappings) ||
    contract.mappings.length > 4000 ||
    !Array.isArray(contract.requiredMappings) ||
    contract.requiredMappings.length > 4000
  )
    throw new Error("Invalid or excessive mapping inventory");
  const keys: string[] = [],
    acs: string[] = [];
  for (const item of contract.mappings) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.ac !== "string" ||
      typeof item.screen !== "string" ||
      typeof item.state !== "string"
    )
      throw new Error("Mapping needs one AC string and screen/state strings");
    acs.push(item.ac);
    keys.push([item.screen, item.state, item.ac].join("/"));
  }
  const source = new Set(definitions),
    mapped = new Set(acs),
    keySet = new Set(keys);
  const required = contract.requiredMappings;
  if (required.some((key) => typeof key !== "string"))
    throw new Error("Invalid required mapping key");
  const requiredSet = new Set(required as string[]);
  const missing = definitions.filter((id) => !mapped.has(id));
  const unboundMappingACs = [...mapped].filter((id) => !source.has(id));
  const missingRequiredMappings = keys.filter((key) => !requiredSet.has(key));
  const unknownRequiredMappings = [...requiredSet].filter(
    (key) => !keySet.has(key),
  );
  const duplicateMappingKeys = keys.length !== keySet.size;
  const duplicateRequiredMappings = required.length !== requiredSet.size;
  return {
    sourceACCount: definitions.length,
    contractUniqueACCount: mapped.size,
    mappingCount: keys.length,
    missing,
    unboundMappingACs,
    missingRequiredMappings,
    unknownRequiredMappings,
    duplicateMappingKeys,
    duplicateRequiredMappings,
    pass:
      !missing.length &&
      !unboundMappingACs.length &&
      !missingRequiredMappings.length &&
      !unknownRequiredMappings.length &&
      !duplicateMappingKeys &&
      !duplicateRequiredMappings,
    semanticTestsVerified: false,
    approvalGranted: false,
  };
}
