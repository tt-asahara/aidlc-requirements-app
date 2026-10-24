import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// This is a chooser location, not a working-directory change. Only the selected
// project root and explicit UI defaults participate; never consult the CLI cwd.
export async function projectDialogDirectory({ root, store, documents, home }) {
  for (const candidate of [root, store, documents, home]) {
    if (typeof candidate !== "string" || !path.isAbsolute(candidate)) continue;
    try {
      if (!(await fs.stat(candidate)).isDirectory()) continue;
      await fs.access(candidate, constants.R_OK | constants.X_OK);
      return await fs.realpath(candidate);
    } catch {
      // Missing or inaccessible directories fall through without changing state.
    }
  }
  return undefined; // Let the native chooser use its default if none is usable.
}
