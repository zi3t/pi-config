import assert from "node:assert/strict";
import test from "node:test";
import { defaultLearnMode, defaultsToLearningMode, isMutatingShellCommand } from "../extensions/learn.ts";

test("learning mode defaults only in hustler and distinguishes shell writes", () => {
  assert.equal(defaultLearnMode("/Users/example/hustler"), "hybrid");
  assert.equal(defaultLearnMode("/Users/example/other"), "off");
  assert.equal(defaultsToLearningMode("/Users/example/hustler"), true);
  assert.equal(defaultsToLearningMode("/Users/example/other"), false);
  assert.equal(isMutatingShellCommand("npm test"), false);
  assert.equal(isMutatingShellCommand("cat result > answer.cpp"), true);
});
