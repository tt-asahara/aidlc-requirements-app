import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
// Registry package metadata/notice files only; no dependency code executes.
export async function markdownNotices(destination) {
  const seen = new Set();
  await fs.mkdir(destination, { recursive: true });
  async function walk(name, from) {
    const req = createRequire(path.join(from, "package.json"));
    let file;
    try {
      file = req.resolve(`${name}/package.json`);
    } catch {
      let dir = path.dirname(req.resolve(name));
      for (let i = 0; i < 8; i++) {
        const candidate = path.join(dir, "package.json");
        try {
          if (JSON.parse(await fs.readFile(candidate)).name === name) {
            file = candidate;
            break;
          }
        } catch {}
        dir = path.dirname(dir);
      }
    }
    if (!file) throw new Error(`Package notice metadata missing: ${name}`);
    file = await fs.realpath(file);
    if (seen.has(file)) return;
    seen.add(file);
    if (seen.size > 180) throw new Error("notice dependency bound");
    const pkg = JSON.parse(await fs.readFile(file)),
      dir = path.dirname(file);
    const notice = (await fs.readdir(dir)).find((n) =>
      /^licen[sc]e(?:\.|$)/i.test(n),
    );
    if (!notice) throw new Error(`Package notice missing: ${name}`);
    const source = path.join(dir, notice);
    if ((await fs.stat(source)).size > 256 * 1024)
      throw new Error("notice size bound");
    await fs.copyFile(
      source,
      path.join(
        destination,
        `${name.replaceAll("/", "-")}-${pkg.version}-LICENSE`,
      ),
    );
    for (const dep of Object.keys(pkg.dependencies ?? {})) await walk(dep, dir);
  }
  for (const name of ["react", "react-dom", "react-markdown", "remark-gfm"])
    await walk(name, path.resolve("apps/desktop"));
  return seen.size;
}
