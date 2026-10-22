import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchCaptureBrowser } from "../src/visual/browser.ts";

test("a hung capture executable is killed as an owned process and does not inherit unrelated environment", async () => {
  const home = await mkdtemp(join(tmpdir(), "aidlc-capture-lifetime-"));
  const executable = join(home, "fake-chrome.sh");
  const old = process.env.AIDLC_CAPTURE_SENTINEL;
  process.env.AIDLC_CAPTURE_SENTINEL = "must-not-reach-renderer";
  try {
    await writeFile(
      executable,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX shell parameter expansion.
      '#!/bin/sh\necho $$ > "$HOME/owned.pid"\nprintf "%s" "${AIDLC_CAPTURE_SENTINEL-unset}" > "$HOME/owned-env.txt"\nexec sleep 60\n',
      { mode: 0o700 },
    );
    await expect(launchCaptureBrowser(home, executable)).rejects.toThrow(
      "launch timeout",
    );
    const pid = Number(
      (await readFile(join(home, "owned.pid"), "utf8")).trim(),
    );
    expect(Number.isInteger(pid) && pid > 1).toBe(true);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await readFile(join(home, "owned-env.txt"), "utf8")).toBe("unset");
  } finally {
    if (old === undefined) delete process.env.AIDLC_CAPTURE_SENTINEL;
    else process.env.AIDLC_CAPTURE_SENTINEL = old;
    await rm(home, { recursive: true, force: true });
  }
}, 15000);
