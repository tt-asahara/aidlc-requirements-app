import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
export async function record(name, result) {
  const appCommit =
    result.appCommit ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const sourceDirty = !!execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim();
  const sourceDiffHash = sourceDirty
    ? createHash("sha256")
        .update(execFileSync("git", ["diff", "HEAD", "--no-ext-diff"]))
        .digest("hex")
    : null;
  const report = {
      at: new Date().toISOString(),
      ...result,
      appCommit,
      sourceDirty,
      sourceDiffHash,
    },
    directory = path.resolve("../evidence/v3");
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(
    directory,
    `${name}-${report.at.replaceAll(":", "-")}.json`,
  );
  const bytes = JSON.stringify(report, null, 2);
  await fs.writeFile(file, bytes, { mode: 0o600 });
  await fs.writeFile(path.join(directory, `${name}-current.json`), bytes, {
    mode: 0o600,
  });
  return report;
}
