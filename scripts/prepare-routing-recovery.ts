import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";

// Operator-only preparation in a trusted, installed synthetic workspace. This
// prints a bounded plan; it writes no evidence and makes no model/network call.
const args = process.argv.slice(2);
if (
  args.length !== 6 ||
  args[0] !== "--output-path" ||
  args[2] !== "--facts" ||
  args[4] !== "--attempt"
)
  throw new Error(
    "Use --output-path <rough contract> --facts <flat JSON> --attempt <positive integer> from the installed workspace",
  );
const attempt = Number(args[5]);
if (!Number.isSafeInteger(attempt) || attempt < 1)
  throw new Error("Invalid attempt");
const workspace = await realpath(process.cwd());
const confined = async (path: string) => {
  const actual = await realpath(resolve(workspace, path));
  if (!actual.startsWith(workspace + sep))
    throw new Error("Path escapes workspace");
  return actual;
};
const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const lock = JSON.parse(
  await readFile(new URL("../aidlc.lock.json", import.meta.url), "utf8"),
) as { sha: string };
const receipt = JSON.parse(
  await readFile(await confined(".claude/d-install-receipt.json"), "utf8"),
) as { sourceSha: string; composeOwned: Record<string, string> };
if (receipt.sourceSha !== lock.sha)
  throw new Error("Installed source differs from app pin");
const routerPath = ".claude/tools/ui-poc-c-routing.cjs";
const configPath = ".claude/tools/ui-poc/c-stage-routing.json";
const sensorPath = ".claude/tools/aidlc-sensor-ui-poc-evidence.ts";
for (const path of [routerPath, configPath, sensorPath])
  if (!receipt.composeOwned[path])
    throw new Error("Missing installed routing receipt entry");
for (const [path, hash] of Object.entries(receipt.composeOwned)) {
  if (path.startsWith(".claude/tools/ui-poc") || path === sensorPath) {
    if (sha(await readFile(await confined(path))) !== hash)
      throw new Error(`Installed routing file changed: ${path}`);
  }
}
const outputPath = await confined(args[1] as string);
if (!outputPath.endsWith(`${sep}rough-mockups${sep}ui-poc-rough-contract.md`))
  throw new Error("Expected the rough contract entry point");
const facts: unknown = JSON.parse(await readFile(args[3] as string, "utf8"));
if (
  !facts ||
  typeof facts !== "object" ||
  Array.isArray(facts) ||
  Object.values(facts).some((value) => typeof value !== "boolean")
)
  throw new Error(
    "Facts must be a flat object of explicit boolean conditions; nested summaries are not routing facts",
  );
interface Invocation {
  skill: string;
  decision: string;
  condition?: string;
  entrypoints: string[];
  inputs: string[];
  outputs: string[];
}
interface Plan {
  pass: boolean;
  findings?: string[];
  runtimeProfile: string;
  comparisonTreatment: string | null;
  configSha256: string;
  invocations: Invocation[];
}
const router = createRequire(import.meta.url)(await confined(routerPath)) as {
  deriveEngineContext: (
    output: string,
    stage: string,
  ) => {
    stage: string;
    scope: string;
    recordId: string;
    unit: string | null;
    engineStateSha256: string;
  };
  plan: (stage: string, facts: object, scope: string) => Plan;
  lockedEntrypoint: (
    skill: string,
    entrypoint: string,
  ) => { git_blob_sha: string; bytes: number };
  gitBlobHash: (bytes: Buffer) => string;
};
const stage = "rough-mockups";
const context = { ...router.deriveEngineContext(outputPath, stage), attempt };
const plan = router.plan(stage, facts, context.scope);
if (!plan.pass)
  throw new Error(plan.findings?.join("; ") ?? "Routing plan failed");
for (const invocation of plan.invocations.filter(
  (item) => item.decision === "use",
)) {
  for (const entrypoint of invocation.entrypoints) {
    const bytes = await readFile(await confined(entrypoint));
    const expected = router.lockedEntrypoint(invocation.skill, entrypoint);
    if (
      bytes.length !== expected.bytes ||
      router.gitBlobHash(bytes) !== expected.git_blob_sha
    )
      throw new Error(`Selected skill differs from source lock: ${entrypoint}`);
  }
}
const identity = {
  schema: 1,
  stage,
  runtimeProfile: plan.runtimeProfile,
  comparisonTreatment: plan.comparisonTreatment,
  configSha256: plan.configSha256,
};
const sensorChecks = [];
for (const name of [
  "wireframes.md",
  "user-flow.md",
  "rough-mockups-questions.md",
  "ui-poc-rough-contract.md",
]) {
  const path = await confined(resolve(dirname(outputPath), name));
  sensorChecks.push([
    "bun",
    sensorPath,
    "--stage",
    stage,
    "--output-path",
    relative(workspace, path),
  ]);
}
const prepared = {
  preparationOnly: true,
  modelUsed: false,
  installedSourceSha: receipt.sourceSha,
  selectedSkillPinsVerified: true,
  facts,
  context,
  logIdentity: identity,
  bindingsToComputeAfterWriting: ["contextSha256", "factsSha256"],
  invocations: plan.invocations.map(
    ({ skill, decision, condition, entrypoints, inputs, outputs }) => ({
      skill,
      decision,
      ...(condition ? { condition } : {}),
      entrypoints,
      inputs,
      outputs,
    }),
  ),
  eventRequirements: {
    read: [
      "type=skill-read",
      "skill",
      "entrypoint",
      "sha256 of actual pinned bytes read",
    ],
    applied: [
      "type=skill-applied",
      "skill",
      "inputs: named file/hash or bounded value",
      "outputs: named actual file/hash",
    ],
    skipped: ["type=skill-skipped", "skill", "condition", "observed reason"],
    designContext: [
      "schema=1",
      "creatorConfirmed from observed answer",
      "source.kind/path/sha256",
      "commonBrief.path/sha256",
      "audience",
      "useCases",
      "brandTone",
    ],
    wcagReport: {
      schema: 1,
      pinnedSourcePreserved: true,
      sourceStatement: "18px+ or 14px bold",
      normalCssPx: 24,
      boldCssPx: 18.6667,
      normativeBasis: "WCAG 18pt or 14pt bold",
    },
  },
  sensorChecks,
  completion:
    "Not completion evidence. Record only actual reads/application, bind exact written bytes using the installed dedicated hash command, and require all four full sensors to pass. Re-derive context if engine state changes. No approval or override is granted.",
};
const serialized = JSON.stringify(prepared, null, 2);
if (Buffer.byteLength(serialized) > 16 * 1024)
  throw new Error("Preparation exceeds bounded handoff size");
console.log(serialized);
