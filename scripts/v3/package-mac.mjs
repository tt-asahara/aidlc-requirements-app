import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("This package target is macOS arm64");
const require = createRequire(path.resolve("apps/desktop/package.json"));
const electron = require("electron"),
  pty = path.dirname(require.resolve("node-pty/package.json"));
const { stdout } = await exec("git", ["rev-parse", "--short=12", "HEAD"]);
const revision = stdout.trim(),
  out = path.resolve(".cache/v3-mac", `${revision}-${Date.now()}`),
  bundle = path.join(out, "AI-DLC Workbench.app");
await fs.mkdir(out, { recursive: true });
await exec("/usr/bin/ditto", [path.resolve(electron, "../../.."), bundle]);
const app = path.join(bundle, "Contents/Resources/app");
await fs.mkdir(app, { recursive: true });
const { stdout: bunPath } = await exec("bun", ["-p", "process.execPath"]);
const bunExecutable = await fs.realpath(bunPath.trim());
const { stdout: bunVersion } = await exec(bunExecutable, ["--version"]);
if (bunVersion.trim() !== "1.3.14")
  throw new Error("Pinned harness runtime Bun 1.3.14 required");
await fs.mkdir(path.join(app, "vendor/bin"), { recursive: true });
await fs.copyFile(bunExecutable, path.join(app, "vendor/bin/bun"));
await fs.chmod(path.join(app, "vendor/bin/bun"), 0o755);
await fs.writeFile(
  path.join(app, "package.json"),
  JSON.stringify({
    name: "aidlc-local-workbench",
    productName: "AI-DLC Workbench",
    version: "0.3.0",
    main: "apps/desktop/bootstrap.cjs",
    private: true,
  }),
);
for (const folder of [
  "apps/desktop",
  "apps/collaboration",
  "packages/workbench",
]) {
  await fs.mkdir(path.join(app, folder), { recursive: true });
  for (const file of await fs.readdir(folder))
    if (/\.(mjs|cjs)$/.test(file) && !file.includes(".nodecheck."))
      await fs.copyFile(path.join(folder, file), path.join(app, folder, file));
}
await fs.cp("apps/desktop/dist", path.join(app, "apps/desktop/dist"), {
  recursive: true,
});
await fs.mkdir(path.join(app, "node_modules"), { recursive: true });
await fs.cp(pty, path.join(app, "node_modules/node-pty"), {
  recursive: true,
  filter: (src) =>
    !/(?:^|\/)(?:node_modules|src|test|test_data|benchmark|\.git)(?:\/|$)/.test(
      path.relative(pty, src),
    ),
});
const notices = path.join(app, "vendor/licenses");
await fs.mkdir(notices, { recursive: true });
await fs.cp("apps/desktop/licenses", notices, { recursive: true });
for (const [name, source] of [
  ["Electron-LICENSE", path.resolve(electron, "../../../..", "LICENSE")],
  [
    "Chromium-LICENSES.html",
    path.resolve(electron, "../../../..", "LICENSES.chromium.html"),
  ],
  ["node-pty-LICENSE", path.join(pty, "LICENSE")],
])
  await fs.copyFile(source, path.join(notices, name));
for (const name of [
  "@xterm/xterm",
  "@xterm/addon-fit",
  "@xterm/addon-unicode11",
])
  await fs.copyFile(
    path.join(path.dirname(require.resolve(`${name}/package.json`)), "LICENSE"),
    path.join(notices, `${name.replaceAll("/", "-")}-LICENSE`),
  );
const plist = path.join(bundle, "Contents/Info.plist");
for (const [key, value] of [
  ["CFBundleName", "AI-DLC Workbench"],
  ["CFBundleDisplayName", "AI-DLC Workbench"],
  ["CFBundleIdentifier", "com.aidlc.local-workbench"],
  ["CFBundleShortVersionString", "0.3.0"],
]) {
  await exec("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
}
const entitlements = path.join(out, "entitlements.plist");
await fs.writeFile(
  entitlements,
  '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>',
);
await exec("/usr/bin/codesign", [
  "--force",
  "--deep",
  "--sign",
  "-",
  "--entitlements",
  entitlements,
  bundle,
]);
await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
const sourceDirty =
  (await exec("git", ["status", "--porcelain"])).stdout.trim().length > 0;
const receipt = {
  sourceDirty,
  at: new Date().toISOString(),
  bundle,
  revision,
  target: "darwin-arm64",
  signature: "local ad-hoc only",
  notarized: false,
  externalRuntimeRequired: false,
  bundledBunVersion: bunVersion.trim(),
  userInstalledClaudeRequired: true,
  gitRequiredForSourceFetch: true,
};
await fs.writeFile(
  path.join(out, "build.json"),
  JSON.stringify(receipt, null, 2),
);
await fs.mkdir(path.resolve("../evidence/v3"), { recursive: true });
await fs.writeFile(
  path.resolve("../evidence/v3/package-current.json"),
  JSON.stringify(receipt, null, 2),
);
console.log(JSON.stringify(receipt));
