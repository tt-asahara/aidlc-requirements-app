import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { refinedAcCoverage } from "./refined-ac-coverage";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--stories" || args[2] !== "--contract")
  throw new Error(
    "Use --stories <current stories.md> --contract <refined contract.md> within the workspace",
  );
const root = await realpath(process.cwd());
async function input(path: string) {
  const actual = await realpath(resolve(root, path));
  if (!actual.startsWith(root + sep)) throw new Error("Path escapes workspace");
  if ((await stat(actual)).size > 512 * 1024)
    throw new Error("AC coverage input exceeds 512 KiB");
  const bytes = await readFile(actual);
  if (bytes.length > 512 * 1024)
    throw new Error("AC coverage input exceeds 512 KiB");
  return {
    path: relative(root, actual),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    text: bytes.toString("utf8"),
  };
}
const stories = await input(args[1] as string);
const contract = await input(args[3] as string);
const result = {
  readOnly: true,
  source: { path: stories.path, sha256: stories.sha256 },
  contract: { path: contract.path, sha256: contract.sha256 },
  ...refinedAcCoverage(stories.text, contract.text),
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
