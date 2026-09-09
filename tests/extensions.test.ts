import assert from "node:assert/strict";
import test from "node:test";
import { classifyShellCommand } from "../extensions/workspace-guard.ts";
import { isExplicitWriteInvitation, isMutatingShellCommand } from "../extensions/learn.ts";

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

test("learning mode recognizes explicit permission and shell writes", () => {
  assert.equal(isExplicitWriteInvitation("How should I fix this?"), false);
  assert.equal(isExplicitWriteInvitation("Please change how you explain it"), false);
  assert.equal(isExplicitWriteInvitation("Please implement the change"), true);
  assert.equal(isExplicitWriteInvitation("Please fix this"), true);
  assert.equal(isMutatingShellCommand("npm test"), false);
  assert.equal(isMutatingShellCommand("cat result > answer.cpp"), true);
});
