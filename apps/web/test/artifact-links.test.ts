import { expect, test } from "bun:test";
import { artifactLink } from "../src/api/artifacts.ts";

test("artifact links resolve relative documents while retaining the space boundary", () => {
  expect(
    artifactLink(
      "../intents/round/mockups/index.html",
      "design-document/README.md",
      "default",
    ),
  ).toBe("intents/round/mockups/index.html");
  expect(
    artifactLink(
      "aidlc/spaces/default/design-document/README.md",
      "",
      "default",
    ),
  ).toBe("design-document/README.md");
  expect(
    artifactLink("note%20one.md", "design-document/README.md", "default"),
  ).toBe("design-document/note one.md");
});
test.each([
  "../../outside.md",
  "/etc/passwd",
  "javascript:alert(1)",
  "https://example.com/file.md",
  "//evil.example/x",
  ".aidlc-engine/file",
  "audit/events.jsonl",
  "%252e%252e/secret",
  "aidlc/spaces/other/file.md",
  "x\\y",
  "#anchor",
])("refuses non-artifact link %s", (href) =>
  expect(artifactLink(href, "", "default")).toBeNull(),
);
