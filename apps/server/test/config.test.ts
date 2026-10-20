import { describe, expect, test } from "bun:test";
import { readPort } from "../src/config";

describe("PORT", () => {
  test("defaults to 8787 and accepts valid custom ports", () => {
    expect(readPort({})).toBe(8787);
    expect(readPort({ PORT: "18787" })).toBe(18787);
  });

  test.each([
    "",
    "0",
    "65536",
    "-1",
    "8787x",
    "1.5",
    "Infinity",
    "1e3",
    " 8787",
  ])("rejects invalid configuration: %s", (port) => {
    expect(() => readPort({ PORT: port })).toThrow("PORT は");
  });
});
