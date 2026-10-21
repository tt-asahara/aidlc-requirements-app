import { expect, test } from "bun:test";
import { refinedAcCoverage } from "./refined-ac-coverage";

const ids = Array.from({ length: 45 }, (_, i) => `AC1.1.${i + 1}`);
const stories = ids.map((id) => `**${id} — 原本の条件**`).join("\n");
const mapping = (ac: string, state = "STATE-DEFAULT") => ({
  screen: "SCREEN-LIST",
  state,
  ac,
  asset: "one.html",
  check: "実操作で確認",
});
function contract(
  mappings = ids.map((id) => mapping(id)),
  required?: string[],
) {
  return `\`\`\`ui-poc-contract\n${JSON.stringify({
    schema: 2,
    stage: "refined-mockups",
    mappings,
    requiredMappings:
      required ?? mappings.map((m) => [m.screen, m.state, m.ac].join("/")),
  })}\n\`\`\``;
}
test("old six rough ACs cannot substitute for all 45 formal definitions", () => {
  const result = refinedAcCoverage(
    stories,
    contract(Array.from({ length: 6 }, (_, i) => mapping(`AC-ROUGH-${i}`))),
  );
  expect(result.pass).toBe(false);
  expect(result.missing).toEqual(ids);
  expect(result.unboundMappingACs).toHaveLength(6);
});
test("all ACs sharing HTML and one AC covering several states are preserved", () => {
  const result = refinedAcCoverage(
    stories,
    contract([
      ...ids.map((id) => mapping(id)),
      mapping(ids[0] as string, "STATE-SUCCESS"),
    ]),
  );
  expect(result).toMatchObject({
    pass: true,
    sourceACCount: 45,
    contractUniqueACCount: 45,
    mappingCount: 46,
    semanticTestsVerified: false,
    approvalGranted: false,
  });
});
test("missing and invented ACs and incomplete required inventory fail", () => {
  const result = refinedAcCoverage(
    stories,
    contract(
      [...ids.slice(1).map((id) => mapping(id)), mapping("AC9.9.9")],
      [],
    ),
  );
  expect(result.pass).toBe(false);
  expect(result.missing).toEqual([ids[0] as string]);
  expect(result.unboundMappingACs).toEqual(["AC9.9.9"]);
  expect(result.missingRequiredMappings).toHaveLength(45);
});
test("a formalACs extension and references cannot fill mappings", () => {
  const text = `${contract([])}\nformalACs: ${ids.join(",")}\n`;
  const source = `${stories}\n> **AC9.1.1 — quote**\n| **AC9.1.2 — table** |\n\`\`\`md\n**AC9.1.3 — code**\n\`\`\`\nReferences AC9.1.4`;
  expect(refinedAcCoverage(source, text)).toMatchObject({
    pass: false,
    sourceACCount: 45,
    missing: ids,
  });
});
test("ambiguous or unbounded input cannot produce verified coverage", () => {
  expect(() => refinedAcCoverage("# No definitions", contract())).toThrow(
    "No bounded",
  );
  expect(() =>
    refinedAcCoverage(`${stories}\n**AC1.1.1 — duplicate**`, contract()),
  ).toThrow("Duplicate");
  expect(() =>
    refinedAcCoverage(stories, `${contract()}\n${contract()}`),
  ).toThrow("one ui-poc-contract");
  expect(() =>
    refinedAcCoverage("x".repeat(512 * 1024 + 1), contract()),
  ).toThrow("512 KiB");
  expect(() =>
    refinedAcCoverage(
      stories,
      contract().replace('"ac":"AC1.1.1"', '"ac":["AC1.1.1"]'),
    ),
  ).toThrow("one AC string");
});
test("duplicate and unknown required mapping keys fail", () => {
  const maps = ids.map((id) => mapping(id));
  const keys = maps.map((m) => [m.screen, m.state, m.ac].join("/"));
  expect(
    refinedAcCoverage(
      stories,
      contract([...maps, maps[0] as ReturnType<typeof mapping>]),
    ).pass,
  ).toBe(false);
  const result = refinedAcCoverage(
    stories,
    contract(maps, [...keys, keys[0] as string, "SCREEN-X/STATE-X/AC1.1.1"]),
  );
  expect(result).toMatchObject({
    pass: false,
    duplicateRequiredMappings: true,
    unknownRequiredMappings: ["SCREEN-X/STATE-X/AC1.1.1"],
  });
});
