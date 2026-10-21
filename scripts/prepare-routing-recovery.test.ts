import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const helper = fileURLToPath(
  new URL("./prepare-routing-recovery.ts", import.meta.url),
);
const lock = JSON.parse(
  await readFile(new URL("../aidlc.lock.json", import.meta.url), "utf8"),
) as { sha: string };
async function fixture(stage = "rough-mockups") {
  const root = await mkdtemp(join(tmpdir(), "routing-preparation-"));
  roots.push(root);
  const sources = {
    ".claude/tools/ui-poc-c-routing.cjs":
      "require('node:fs').writeFileSync('module-executed', 'yes'); throw Error('module must not execute');\n",
    ".claude/tools/ui-poc/c-stage-routing.json": "{}\n",
    ".claude/tools/aidlc-sensor-ui-poc-evidence.ts":
      "// isolated fixture, never invoked\n",
  };
  const composeOwned: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(sources)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
    composeOwned[path] = createHash("sha256").update(bytes).digest("hex");
  }
  const receipt = { sourceSha: lock.sha, composeOwned };
  await writeFile(
    join(root, ".claude/d-install-receipt.json"),
    JSON.stringify(receipt),
  );
  const output = `aidlc/spaces/default/intents/test/${stage === "rough-mockups" ? "ideation" : "inception"}/${stage}/${stage === "user-stories" ? "stories.md" : stage === "requirements-analysis" ? "requirements.md" : stage === "refined-mockups" ? "ui-poc-refined-contract.md" : "ui-poc-rough-contract.md"}`;
  await mkdir(dirname(join(root, output)), { recursive: true });
  await writeFile(join(root, output), "# fixture\n");
  await writeFile(
    join(root, dirname(output), "../..", "aidlc-state.md"),
    "# fixture engine state\n",
  );
  const facts = join(root, "facts.json");
  await writeFile(
    facts,
    JSON.stringify({
      design_context_missing: true,
      state_model_uncertainty: true,
    }),
  );
  const launch = async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        helper,
        "--output-path",
        output,
        "--facts",
        facts,
        "--attempt",
        "1",
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
  const run = async () => {
    const { code, stdout, stderr } = await launch();
    expect(code).not.toBe(0);
    expect(stdout).toBe("");
    expect(existsSync(join(root, "module-executed"))).toBe(false);
    return stderr;
  };
  return { root, output, facts, receipt, run, launch };
}

async function preflightFixture(coreSource: string, stage = "rough-mockups") {
  const f = await fixture(stage);
  // This fixture tests delegation/failure propagation, not a copy of core's
  // Markdown grammar. Live verification uses the original pinned validator.
  const router = ".claude/tools/ui-poc-c-routing.cjs";
  const source = `module.exports = {
    deriveEngineContext: (_,stage) => ({stage,scope:'ui-poc-requirements',recordId:'test',unit:null,engineStateSha256:'state'}),
    engineRecord: output => ({recordRoot:require('node:path').resolve(require('node:path').dirname(output),'../..')}),
    resolveDesignSkill: () => 'selected-design',
    plan: (stage,facts,scope,designSkill) => {
      if(stage==='refined-mockups' && designSkill!=='selected-design') throw Error('Selected design was ignored');
      return {pass:true,runtimeProfile:'requirements-c',comparisonTreatment:null,configSha256:'config',invocations:[],...(designSkill?{designSkill}:{})};
    }
  };`;
  await writeFile(join(f.root, router), source);
  f.receipt.composeOwned[router] = createHash("sha256")
    .update(source)
    .digest("hex");
  await writeFile(
    join(f.root, ".claude/d-install-receipt.json"),
    JSON.stringify(f.receipt),
  );
  const produces = {
    "rough-mockups": [
      "wireframes",
      "user-flow",
      "rough-mockups-questions",
      "ui-poc-rough-contract",
    ],
    "user-stories": [
      "stories",
      "personas",
      "user-stories-assessment",
      "traceability",
    ],
    "requirements-analysis": [
      "requirements",
      "requirements-analysis-questions",
    ],
    "refined-mockups": [
      "mockups",
      "interaction-spec",
      "design-system-mapping",
      "accessibility-checklist",
      "refined-mockups-questions",
      "ui-poc-refined-contract",
    ],
  }[stage];
  if (!produces) throw Error("Unsupported test fixture stage");
  await writeFile(
    join(f.root, ".claude/tools/aidlc-lib.ts"),
    `${coreSource}\nexport function parseCheckboxes() { return [{slug:"${stage}",state:"revising"}]; }\nexport function checkSummaryConfirmationEvidence(projectDir, stage, options) { if (!options.stateContent.includes("fixture engine state")) throw Error("Missing actual state"); return {ok:false,message:"assessment was saved before confirmation",refusal:{code:"SUMMARY_ARTIFACT_UNAUTHORIZED"}}; }\nexport function findStageBySlug() { return {produces:${JSON.stringify(produces)}}; }`,
  );
  await writeFile(
    join(f.root, dirname(f.output), `${stage}-questions.md`),
    "question bytes",
  );
  for (const name of produces)
    await writeFile(
      join(
        f.root,
        dirname(f.output),
        `${name}${name === "traceability" ? ".json" : ".md"}`,
      ),
      "question bytes",
    );
  if (stage === "refined-mockups") {
    const sourcePath = join(
      f.root,
      dirname(f.output),
      "../../inception/user-stories/stories.md",
    );
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "**AC1.1.1 — Original condition**\n");
    await writeFile(
      join(f.root, f.output),
      '```ui-poc-contract\n{"schema":2,"stage":"refined-mockups","mappings":[],"requiredMappings":[]}\n```\n',
    );
  }
  return f;
}

test("routing preparation rejects nested facts before loading an installed module", async () => {
  const f = await fixture();
  await writeFile(
    f.facts,
    JSON.stringify({
      explicit_conditions: {
        design_context_missing: true,
        state_model_uncertainty: true,
      },
    }),
  );
  expect(await f.run()).toContain("Facts must be a flat object");
});
test("routing preparation refuses changed installed code without executing it", async () => {
  const f = await fixture();
  const path = join(f.root, ".claude/tools/ui-poc-c-routing.cjs");
  await writeFile(path, `${await readFile(path, "utf8")}// tampered\n`);
  expect(await f.run()).toContain("Installed routing file changed");
});
test("routing preparation refuses an output symlink outside its workspace", async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "routing-outside-"));
  roots.push(outside);
  const path = join(outside, "contract.md");
  await writeFile(path, "# outside\n");
  await unlink(join(f.root, f.output));
  await symlink(path, join(f.root, f.output));
  expect(await f.run()).toContain("Path escapes workspace");
});
test("routing preparation rejects a different source pin before loading code", async () => {
  const f = await fixture();
  await writeFile(
    join(f.root, ".claude/d-install-receipt.json"),
    JSON.stringify({ ...f.receipt, sourceSha: "0".repeat(40) }),
  );
  expect(await f.run()).toContain("Installed source differs from app pin");
});

test("routing preparation propagates the core question validator rejection", async () => {
  const f = await preflightFixture(`
    export function summaryConfirmationContentHash(content) {
      if (content !== 'question bytes') throw Error('wrong input');
      throw Error('core rejected question structure');
    }
    export function summaryConfirmationAnswer() { throw Error('must not continue'); }
  `);
  const result = await f.launch();
  expect(result.code).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("core rejected question structure");
});

test("question structure success does not claim a confirmation receipt", async () => {
  const f = await preflightFixture(`
    export function summaryConfirmationContentHash(content) {
      if (content !== 'question bytes') throw Error('wrong input');
      return 'core-content-hash';
    }
    export function summaryConfirmationAnswer() { return ''; }
  `);
  const result = await f.launch();
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).questionPreflight).toEqual({
    path: join(dirname(f.output), "rough-mockups-questions.md"),
    contentHash: "core-content-hash",
    answer: "",
    confirmationReceiptVerified: false,
  });
});

for (const [stage, expected] of [
  ["requirements-analysis", 2],
  ["user-stories", 4],
  ["refined-mockups", 6],
] as const)
  test(`${stage} preparation uses core produces and the configured design choice`, async () => {
    const f = await preflightFixture(
      `
      export function summaryConfirmationContentHash() { return 'core-content-hash'; }
      export function summaryConfirmationAnswer() { return ''; }
    `,
      stage,
    );
    const result = await f.launch();
    expect(result.code).toBe(0);
    const prepared = JSON.parse(result.stdout);
    expect(prepared.context.stage).toBe(stage);
    const example = prepared.fileExamples.designContext;
    expect(example.creatorConfirmed).toBe(false);
    expect(example.source.kind).toBe("aidlc-questions");
    expect(example.source.path).toBe(prepared.questionPreflight.path);
    expect(example.source.sha256).toBe(
      createHash("sha256").update("question bytes").digest("hex"),
    );
    expect(example.commonBrief).toEqual({
      path: example.source.path,
      sha256: example.source.sha256,
    });
    expect(typeof example.useCases).toBe("string");
    expect(prepared.fileExamples.valueInput.kind).toBe("value");
    expect(prepared.fileExamples.instructions).toContain(
      "not evidence or approval",
    );
    expect(prepared.reviewProtocol.currentMark).toBe("revising");
    expect(prepared.reviewProtocol.gateAfterVerifiedReview.at(-1)).toBe(
      "revised",
    );
    expect(prepared.reviewProtocol.request).toContain("review");
    expect(prepared.summaryAuthority).toEqual({
      readyForReview: false,
      required: true,
      message: "assessment was saved before confirmation",
      code: "SUMMARY_ARTIFACT_UNAUTHORIZED",
      approvalGranted: false,
    });
    if (stage === "user-stories")
      expect(prepared.sensorChecks.at(-1).at(-1)).toEndWith(
        "traceability.json",
      );
    expect(prepared.sensorChecks).toHaveLength(expected);
    if (stage === "refined-mockups") {
      expect(prepared.formalAcCoverage).toMatchObject({
        pass: false,
        sourceACCount: 1,
        missing: ["AC1.1.1"],
        approvalGranted: false,
      });
      expect(prepared.formalAcCoverage.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(prepared.questionPreflight.path).toEndWith(`${stage}-questions.md`);
    expect(prepared.logIdentity.designSkill).toBe(
      stage === "refined-mockups" ? "selected-design" : undefined,
    );
  });
