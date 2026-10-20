import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
test("validation seccomp changes exactly clone/setns/unshare and preserves the effective baseline", () => {
  const policy = JSON.parse(
    readFileSync(
      new URL("security/chromium-validation-seccomp.json", root),
      "utf8",
    ),
  );
  const provenance = JSON.parse(
    readFileSync(new URL("security/seccomp-provenance.json", root), "utf8"),
  );
  const rule = policy.syscalls.pop();
  expect(rule).toEqual({
    comment: "Approved validation-only Chromium user namespaces",
    names: ["clone", "setns", "unshare"],
    action: "SCMP_ACT_ALLOW",
    args: [],
    includes: {},
    excludes: {},
  });
  expect(
    createHash("sha256").update(JSON.stringify(policy)).digest("hex"),
  ).toBe(provenance.baseCanonicalSha256);
  expect(policy.defaultAction).toBe("SCMP_ACT_ERRNO");
  const compose = readFileSync(
    new URL("docker-compose.validation.yml", root),
    "utf8",
  );
  expect(compose).toContain("container_name: aidlc-browser-validation");
  expect(compose).not.toMatch(
    /privileged:|SYS_ADMIN|unconfined|ipc:|userns_mode:|network_mode:|no-sandbox|\.aws/,
  );
  expect(
    readFileSync(new URL("docker-compose.yml", root), "utf8"),
  ).not.toContain("security_opt");
});
