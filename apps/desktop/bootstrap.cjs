require("electron");
import("./main.mjs").catch((error) => {
  console.error("Workbench initialization failed", error.message);
  process.exitCode = 1;
});
