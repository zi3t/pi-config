import assert from "node:assert/strict";
import test from "node:test";
import { classifyShellCommand } from "../extensions/workspace-guard.ts";
import { isMutatingShellCommand } from "../extensions/learn.ts";

test("workspace guard expands scripts and finds meaningful risk", () => {
  assert.equal(classifyShellCommand("npm run check", { check: "tsc --noEmit" }).writer, false);
  assert.equal(classifyShellCommand("npm test", { test: "npm run build", build: "vite build" }).writer, true);
  assert.equal(classifyShellCommand("wrangler deploy --dry-run").remote, false);
  assert.equal(classifyShellCommand("wrangler deploy").remote, true);
  assert.deepEqual(
    classifyShellCommand("npm run build:site", { "build:site": "cp out ../zi3t/public" }, "/repo/pkg", "/repo/pkg").externalPaths,
    ["/repo/zi3t/public"],
  );
});

test("learning mode distinguishes checks from shell writes", () => {
  assert.equal(isMutatingShellCommand("npm test"), false);
  assert.equal(isMutatingShellCommand("cat result > answer.cpp"), true);
});
