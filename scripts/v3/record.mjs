import fs from "node:fs/promises";
import path from "node:path";
export async function record(name, result) {
  const report = { at: new Date().toISOString(), ...result },
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
