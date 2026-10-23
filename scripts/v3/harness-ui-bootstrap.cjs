// Test-only replacement of the native folder-picker result, never loaded by the app entry.
const { dialog } = require("electron");
dialog.showOpenDialog = async (_window, options) => ({
  canceled: false,
  filePaths: [
    options.title?.includes(".claude")
      ? process.env.V3_TEST_HARNESS
      : process.env.V3_TEST_PROJECT,
  ],
});
import("../../apps/desktop/main.mjs").catch((e) => {
  console.error(e);
  process.exit(1);
});
