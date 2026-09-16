import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildTgrepSearchArgs,
  resolveTgrepPath,
  tgrepIndexPath,
} from "../extensions/tgrep/utils.ts";

test("tgrep cache identity is stable per canonical worktree", async () => {
  const first = tgrepIndexPath("/repo/worktree-a");
  assert.equal(first, tgrepIndexPath("/repo/worktree-a"));
  assert.notEqual(first, tgrepIndexPath("/repo/worktree-b"));
  assert.match(first, /\.cache\/pi-tgrep\/[0-9a-f]{24}$/);
});

test("tgrep paths stay inside the active worktree", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pi-tgrep-path-"));
  const root = join(parent, "repo");
  const outside = join(parent, "outside");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, "src", "main.ts"), "export {};\n");
  try {
    const canonicalRoot = await realpath(root);
    assert.equal(
      await resolveTgrepPath(canonicalRoot, "src"),
      await realpath(join(root, "src")),
    );
    await assert.rejects(resolveTgrepPath(canonicalRoot, outside), /inside/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("tgrep search arguments are bounded and select indexed or fresh mode", () => {
  const indexed = buildTgrepSearchArgs(
    {
      pattern: "VideoContainerValidator",
      fixedStrings: true,
      context: 3,
      globs: ["*.ts"],
      fileTypes: ["js"],
    },
    "/repo/src",
    "/cache/index",
    true,
  );
  assert.deepEqual(indexed, [
    "search",
    "--fixed-strings",
    "--smart-case",
    "--context",
    "3",
    "--glob",
    "*.ts",
    "--type",
    "js",
    "--color",
    "never",
    "--no-heading",
    "--line-number",
    "--index-path",
    "/cache/index",
    "VideoContainerValidator",
    "/repo/src",
  ]);

  const fresh = buildTgrepSearchArgs(
    { pattern: "foo", smartCase: false, fresh: true },
    "/repo",
    "/cache/index",
    false,
  );
  assert.ok(fresh.includes("--no-index"));
  assert.ok(!fresh.includes("--index-path"));
  assert.ok(!fresh.includes("--smart-case"));
});
