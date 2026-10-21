import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

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
    "Use --output-path <rough/refined contract, requirements.md or stories.md> --facts <flat JSON> --attempt <positive integer> from the installed workspace",
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
const stage = basename(dirname(outputPath));
const entrypoints: Record<string, string> = {
  "rough-mockups": "ui-poc-rough-contract.md",
  "requirements-analysis": "requirements.md",
  "user-stories": "stories.md",
  "refined-mockups": "ui-poc-refined-contract.md",
};
if (entrypoints[stage] !== basename(outputPath))
  throw new Error("Expected a supported stage entry point");
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
  designSkill?: string;
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
  plan: (
    stage: string,
    facts: object,
    scope: string,
    designSkill?: string,
  ) => Plan;
  resolveDesignSkill: () => string;
  engineRecord: (output: string, stage: string) => { recordRoot: string };
  lockedEntrypoint: (
    skill: string,
    entrypoint: string,
  ) => { git_blob_sha: string; bytes: number };
  gitBlobHash: (bytes: Buffer) => string;
};
const context = { ...router.deriveEngineContext(outputPath, stage), attempt };
const engineStatePath = await confined(
  resolve(router.engineRecord(outputPath, stage).recordRoot, "aidlc-state.md"),
);
const plan = router.plan(
  stage,
  facts,
  context.scope,
  stage === "refined-mockups" ? router.resolveDesignSkill() : undefined,
);
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
  ...(plan.designSkill ? { designSkill: plan.designSkill } : {}),
};
// D's sensors do not replace the core question-file grammar. Use the installed
// validator rather than maintaining a second, potentially permissive parser.
const questionsPath = await confined(
  resolve(dirname(outputPath), `${stage}-questions.md`),
);
const core = (await import(
  pathToFileURL(await confined(".claude/tools/aidlc-lib.ts")).href
)) as {
  summaryConfirmationContentHash: (content: string) => string;
  summaryConfirmationAnswer: (content: string) => string | null;
  findStageBySlug: (slug: string) => { produces: string[] } | undefined;
  parseCheckboxes: (state: string) => Array<{ slug: string; state: string }>;
  checkSummaryConfirmationEvidence: (
    projectDir: string,
    stage: { produces: string[] },
    options: { stateContent: string; scope: string },
  ) => {
    ok: boolean;
    required?: boolean;
    message?: string;
    refusal?: { code: string };
  };
};
const stageDefinition = core.findStageBySlug(stage);
if (!stageDefinition?.produces.length)
  throw new Error("Installed core stage has no declared produces");
const questions = await readFile(questionsPath, "utf8");
const questionPreflight = {
  path: relative(workspace, questionsPath),
  contentHash: core.summaryConfirmationContentHash(questions),
  answer: core.summaryConfirmationAnswer(questions),
  confirmationReceiptVerified: false,
};
const engineState = await readFile(engineStatePath, "utf8");
const currentMark = core
  .parseCheckboxes(engineState)
  .find((item) => item.slug === stage)?.state;
const summaryAuthority = core.checkSummaryConfirmationEvidence(
  workspace,
  stageDefinition,
  {
    stateContent: engineState,
    scope: context.scope,
  },
);
const sensorChecks = [];
for (const name of stageDefinition.produces) {
  if (!/^[a-z][a-z0-9-]*$/.test(name))
    throw new Error("Unsupported installed produce name");
  const path = await confined(
    resolve(
      dirname(outputPath),
      `${name}${name === "traceability" ? ".json" : ".md"}`,
    ),
  );
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
  questionPreflight,
  summaryAuthority: {
    readyForReview: summaryAuthority.ok,
    required: summaryAuthority.required ?? true,
    ...(summaryAuthority.message ? { message: summaryAuthority.message } : {}),
    ...(summaryAuthority.refusal
      ? { code: summaryAuthority.refusal.code }
      : {}),
    approvalGranted: false,
  },
  facts,
  context,
  logIdentity: identity,
  bindingsToComputeAfterWriting: ["contextSha256", "factsSha256"],
  refreshAfterEngineStateChange: {
    readOnlyStateHash: [
      "bun",
      ".claude/tools/ui-poc-evidence.cjs",
      "hash",
      relative(workspace, engineStatePath),
    ],
    timing:
      "Opening/re-entering a gate changes state bytes. After the real gate report, and before answering its approval, hash the current state and refresh only context.engineStateSha256, log.context and contextSha256. Preserve stage/scope/recordId/unit/attempt, facts, events, actors and produced documents; rerun every full sensor. This grants no approval.",
  },
  hashActualWrittenFiles: [
    "bun",
    ".claude/tools/ui-poc-evidence.cjs",
    "hash",
    ...["ui-poc-routing-context.json", "ui-poc-routing-facts.json"].map(
      (name) => relative(workspace, resolve(dirname(outputPath), name)),
    ),
  ],
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
    skipped: {
      type: "skill-skipped",
      skill: "<invocation.skill>",
      condition: "<invocation.condition>",
      reason: "<nonempty explanation of the observed false condition>",
    },
    ...(plan.invocations.some((item) =>
      [...item.inputs, ...item.outputs].includes(
        "creator-confirmed-design-context-snapshot",
      ),
    )
      ? {
          designContext: [
            "schema=1",
            "creatorConfirmed from observed answer",
            "source.kind/path/sha256",
            "commonBrief.path/sha256",
            "audience",
            "useCases",
            "brandTone",
          ],
        }
      : {}),
    ...(plan.invocations.some((item) =>
      item.outputs.includes("accessibility-correction-report"),
    )
      ? {
          wcagReport: {
            schema: 1,
            pinnedSourcePreserved: true,
            sourceStatement: "18px+ or 14px bold",
            normalCssPx: 24,
            boldCssPx: 18.6667,
            normativeBasis: "WCAG 18pt or 14pt bold",
          },
        }
      : {}),
  },
  sensorChecks,
  reviewProtocol: {
    currentMark,
    request: [
      "bun",
      ".claude/tools/aidlc-log.ts",
      "review",
      "--stage",
      stage,
      "--reviewer",
      "aidlc-product-lead-agent",
      "--iteration",
      "<next iteration from original engine>",
    ],
    record:
      "Use the actual request's review file and returned recordVerdict command after the reviewer completes. Never invent a pending request or READY result.",
    gateAfterVerifiedReview: [
      "bun",
      ".claude/tools/aidlc.ts",
      "engine",
      "orchestrate",
      "report",
      "--stage",
      stage,
      "--result",
      currentMark === "revising" ? "revised" : "awaiting-approval",
    ],
    warning:
      "Do not run orchestrate next --stage to inspect or refresh the current stage: it is a REDO transition, invalidates the confirmed attempt, and requires a new genuine confirmation and all subsequent saves. Request the review directly after the current authority check passes; do not restart an already confirmed stage.",
    approvalRequiresFreshReply: true,
  },
  completion:
    "Not completion evidence. After the genuine summary-confirmation answer receipt, save every produced document through the ordinary Write tool even when a pre-confirmation draft has identical content: its write must descend from that confirmation. Record only actual reads/application required by the selected invocations, bind exact written bytes using the installed dedicated hash command, and require every declared full sensor to pass. Re-derive context if engine state changes. No approval or override is granted.",
};
const serialized = JSON.stringify(prepared, null, 2);
if (Buffer.byteLength(serialized) > 16 * 1024)
  throw new Error("Preparation exceeds bounded handoff size");
console.log(serialized);
