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

test("CI browser policy is an explicit app-only overlay and cannot alter ports, mounts or privileges", () => {
  const overlay = readFileSync(
    new URL("docker-compose.ci-browser.yml", root),
    "utf8",
  );
  expect(Bun.YAML.parse(overlay)).toEqual({
    services: {
      app: {
        security_opt: ["seccomp=./security/chromium-validation-seccomp.json"],
      },
    },
  });
  const workflow = readFileSync(
    new URL(".github/workflows/ci.yml", root),
    "utf8",
  );
  const [checks, docker] = workflow.split("  docker:");
  expect(checks).not.toContain("docker-compose.ci-browser.yml");
  expect(
    docker?.match(
      /docker compose -p aidlc-ci -f docker-compose.yml -f docker-compose.ci-browser.yml /g,
    ),
  ).toHaveLength(4);
  expect(
    readFileSync(new URL("docker-compose.yml", root), "utf8"),
  ).not.toContain("security_opt");
});
