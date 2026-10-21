# Routing evidence recovery in the synthetic verification workspace

Keep the installed upstream pin, rules, credentials and ordinary gates unchanged.
This procedure prepares routing metadata through D's existing exports; it does not
add a runner, create a turn, approve a stage, or claim that a skill was applied.

From the trusted installed synthetic workspace, run the application helper:

```sh
bun /absolute/path/to/app/scripts/prepare-routing-recovery.ts \
  --output-path aidlc/spaces/default/intents/ROUND/ideation/rough-mockups/ui-poc-rough-contract.md \
  --facts /absolute/path/to/explicit-facts.json --attempt 2
```

The helper reads the app lock and installed receipt, checks routing tool bytes,
checks selected skill bytes against the source lock, and invokes the installed
`plan` and `deriveEngineContext`. It prints at most
16 KiB and writes no workspace evidence. A different source pin or altered
routing tool is an error. Run it only in the trusted installed verification
workspace, never against uploaded or arbitrary executable project content.

It also invokes the installed core `summaryConfirmationContentHash` and
`summaryConfirmationAnswer` on the actual stage questions file. The D sensors
alone do not check that grammar. Do not append arbitrary headings after
`Consolidated Summary Confirmation`; the core validator is authoritative.
Its digest validates structure, not the existence or freshness of an answer
receipt. After changing answers, use the ordinary decision/answer protocol:
clear the summary answer, present the new summary, wait for an explicit response,
then record that response through the original tools. Never reuse an old
confirmation for changed content. Rebind actual source hashes and routing context
afterward, preserving the actor and original application provenance, and repeat
all four sensors before requesting a fresh review of the current fingerprint.

Facts are an explicit, flat boolean object, for example:

```json
{"design_context_missing": true, "state_model_uncertainty": true}
```

These are declared conditions, not default answers. Determine their values from
the actual question/evidence; never flip a value just to avoid an obligation.
`explicit_conditions` is not a wrapper the router accepts. Keep old malformed
files before repairing them.

The execution context is `{stage, scope, recordId, unit, engineStateSha256,
attempt}`. The engine-derived fields come from the current output path and
state bytes. `attempt` is a positive audit label, not an authenticated engine
attempt ID. Re-derive after a state change. For `ui-poc-requirements`, the plan's
identity is `requirements-c` with `comparisonTreatment: null`; the UI contract's
Arm C does not turn this into a comparison trial.

The actual skill log needs the plan identity, exact context object and hashes of
the written context/facts files. Record `skill-read` for actual pinned bytes read,
then exactly one `skill-applied` per selected skill with every named input/output.
Inputs may be bounded values or file/hash references; outputs are actual files.
An explicit false conditional requires `skill-skipped` plus its observed reason.
Do not synthesize successful application events from a plan or file list.

A prior read may be referenced only when the captured full content is verified
against the current pinned bytes, with its original turn/tool provenance retained.
That proves a prior read, not a new application. Missing, changed or incomplete
reads must be performed. Reapply/review the bounded method against the current
artifacts and record what actually happened. Avoid a fork copying the entire
conversation and raw tool sources; use the bounded prepared metadata and targeted
file ranges instead.

Design Context is a separate JSON snapshot: `schema:1`, observed
`creatorConfirmed:true`, `source:{kind,path,sha256}`, `commonBrief:{path,sha256}`,
and nonempty `audience`, `useCases`, `brandTone`. Use the actual existing AI-DLC
question answers as provenance. Delegated synthetic-test answers do not establish
the real user's subjective design approval. Keep the common brief identical when
used again. A selected teach-impeccable output must precede and exactly match the
frontend-design input. Keep the pinned source unchanged; the separate WCAG report
records `18px+ or 14px bold` corrected to 24/18.6667 CSS px and the normative
`WCAG 18pt or 14pt bold` basis.

Hash actual written files through the installed dedicated
`bun .claude/tools/ui-poc-evidence.cjs hash ...` operation. The preparation helper
does not grant an interpreter or hashing permission to the model.

Before a formal review/gate, run the **complete** adapter on each engine produce:

```sh
bun .claude/tools/aidlc-sensor-ui-poc-evidence.ts --stage rough-mockups --output-path aidlc/spaces/default/intents/ROUND/ideation/rough-mockups/wireframes.md
bun .claude/tools/aidlc-sensor-ui-poc-evidence.ts --stage rough-mockups --output-path aidlc/spaces/default/intents/ROUND/ideation/rough-mockups/user-flow.md
bun .claude/tools/aidlc-sensor-ui-poc-evidence.ts --stage rough-mockups --output-path aidlc/spaces/default/intents/ROUND/ideation/rough-mockups/rough-mockups-questions.md
bun .claude/tools/aidlc-sensor-ui-poc-evidence.ts --stage rough-mockups --output-path aidlc/spaces/default/intents/ROUND/ideation/rough-mockups/ui-poc-rough-contract.md
```

`ui-poc-evidence.cjs` checks the UI contract portion; its PASS alone does not
establish routing verification. Require JSON `pass:true`/`findings_count:0` from
all four full adapters. A zero process exit code alone is insufficient. Preserve
findings and stop for missing context/application or renderer observations.
Never use a gate override or migrate legacy evidence just to pass.

An upstream recurrence fix would put these structural examples and complete
adapter commands into the rough/refined contribution and runtime contract. This
application procedure uses existing installed interfaces and does not change or
publish upstream source.
