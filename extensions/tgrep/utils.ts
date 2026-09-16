import { createHash } from "node:crypto";
import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type TgrepSearchOptions = {
  pattern: string;
  fixedStrings?: boolean;
  ignoreCase?: boolean;
  smartCase?: boolean;
  wholeWord?: boolean;
  multiline?: boolean;
  multilineDotall?: boolean;
  filesOnly?: boolean;
  context?: number;
  maxCountPerFile?: number;
  globs?: string[];
  fileTypes?: string[];
  fresh?: boolean;
};

export function tgrepIndexPath(root: string) {
  const key = createHash("sha256").update(root).digest("hex").slice(0, 24);
  return join(homedir(), ".cache", "pi-tgrep", key);
}

export async function resolveTgrepPath(root: string, requested = ".") {
  const candidate = isAbsolute(requested)
    ? resolve(requested)
    : resolve(root, requested);
  await access(candidate);
  const canonical = await realpath(candidate);
  const fromRoot = relative(root, canonical);
  if (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))
  )
    return canonical;
  throw new Error("tgrep path must stay inside the current Git worktree");
}

export function buildTgrepSearchArgs(
  params: TgrepSearchOptions,
  searchPath: string,
  indexPath: string,
  useIndex: boolean,
) {
  const args = ["search"];
  if (params.fixedStrings) args.push("--fixed-strings");
  if (params.ignoreCase) args.push("--ignore-case");
  else if (params.smartCase !== false) args.push("--smart-case");
  if (params.wholeWord) args.push("--word-regexp");
  if (params.multilineDotall) args.push("--multiline-dotall");
  else if (params.multiline) args.push("--multiline");
  if (params.filesOnly) args.push("--files-with-matches");
  if (params.context !== undefined)
    args.push("--context", String(params.context));
  if (params.maxCountPerFile !== undefined)
    args.push("--max-count", String(params.maxCountPerFile));
  for (const glob of params.globs ?? []) args.push("--glob", glob);
  for (const fileType of params.fileTypes ?? [])
    args.push("--type", fileType);
  args.push("--color", "never", "--no-heading", "--line-number");
  if (useIndex) args.push("--index-path", indexPath);
  else args.push("--no-index");
  args.push(params.pattern, searchPath);
  return args;
}
