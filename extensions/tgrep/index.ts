import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import {
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  buildTgrepSearchArgs,
  resolveTgrepPath,
  tgrepIndexPath,
} from "./utils.ts";

const INDEX_MIN_FILES = 1_000;
const INDEX_MAX_FILES = 100_000;
const INDEX_EXCLUDES = [
  ".git",
  ".next",
  ".vinext",
  ".wrangler",
  "dist",
  "node_modules",
  "out",
  "output",
];

const searchSchema = Type.Object({
  pattern: Type.String({ minLength: 1, maxLength: 2_000 }),
  path: Type.Optional(Type.String({ minLength: 1, maxLength: 1_024 })),
  fixedStrings: Type.Optional(Type.Boolean()),
  ignoreCase: Type.Optional(Type.Boolean()),
  smartCase: Type.Optional(Type.Boolean()),
  wholeWord: Type.Optional(Type.Boolean()),
  multiline: Type.Optional(Type.Boolean()),
  multilineDotall: Type.Optional(Type.Boolean()),
  filesOnly: Type.Optional(Type.Boolean()),
  context: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
  maxCountPerFile: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
  globs: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      maxItems: 8,
    }),
  ),
  fileTypes: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      maxItems: 8,
    }),
  ),
  fresh: Type.Optional(
    Type.Boolean({
      description:
        "Bypass the index and scan current files. Use after edits or when completeness matters.",
    }),
  ),
});

type SearchParams = Static<typeof searchSchema>;

type Runtime = {
  root: string;
  indexPath: string;
  fileCount: number;
  indexed: boolean;
  server?: ChildProcess;
};

async function run(
  pi: ExtensionAPI,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  timeout = 120_000,
) {
  return pi.exec("tgrep", args, { cwd, signal, timeout });
}

async function gitRoot(
  pi: ExtensionAPI,
  cwd: string,
  signal?: AbortSignal,
) {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    signal,
    timeout: 5_000,
  });
  if (result.code !== 0 || !result.stdout.trim())
    throw new Error("tgrep requires a Git worktree");
  return realpath(result.stdout.trim());
}

function countFromOutput(output: string) {
  const match = output.match(/^([0-9]+)(?:\s+text files\b)?/mu);
  if (!match) throw new Error("Could not read tgrep file count");
  return Number(match[1]);
}

async function createRuntime(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<Runtime> {
  const root = await gitRoot(pi, ctx.cwd, ctx.signal);
  const indexPath = tgrepIndexPath(root);
  const count = await run(pi, ["count-files", root], root, ctx.signal, 30_000);
  if (count.code !== 0)
    throw new Error(count.stderr.trim() || "tgrep count-files failed");
  return {
    root,
    indexPath,
    fileCount: countFromOutput(count.stdout),
    indexed: false,
  };
}

async function buildIndex(
  pi: ExtensionAPI,
  runtime: Runtime,
  signal?: AbortSignal,
) {
  await mkdir(runtime.indexPath, { recursive: true });
  const args = [
    "index",
    runtime.root,
    "--index-path",
    runtime.indexPath,
    "--index-strategy",
    "external",
    "--index-buffer",
    "128",
  ];
  for (const excluded of INDEX_EXCLUDES) args.push("--exclude", excluded);
  const result = await run(pi, args, runtime.root, signal, 300_000);
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || "tgrep index failed");
  runtime.indexed = true;
}

async function startServer(runtime: Runtime) {
  if (runtime.server && runtime.server.exitCode === null) return;
  const args = [
    "serve",
    runtime.root,
    "--index-path",
    runtime.indexPath,
    "--max-memory",
    "512",
    "--max-cpu",
    "25",
    "--poll-interval",
    "30",
    "--watch-budget",
    "4096",
  ];
  for (const excluded of INDEX_EXCLUDES) args.push("--exclude", excluded);
  const server = spawn("tgrep", args, {
    cwd: runtime.root,
    stdio: "ignore",
  });
  server.on("error", () => undefined);
  runtime.server = server;
}

async function stopServer(runtime?: Runtime) {
  const server = runtime?.server;
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise<void>((resolveDone) => {
    const timeout = setTimeout(resolveDone, 2_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolveDone();
    });
  });
  if (server.exitCode === null) server.kill("SIGKILL");
}

export default function tgrepExtension(pi: ExtensionAPI) {
  let runtime: Runtime | undefined;

  async function currentRuntime(ctx: ExtensionContext) {
    const root = await gitRoot(pi, ctx.cwd, ctx.signal);
    if (!runtime || runtime.root !== root) {
      await stopServer(runtime);
      runtime = await createRuntime(pi, ctx);
    }
    return runtime;
  }

  async function ensureIndexed(ctx: ExtensionContext) {
    const current = await currentRuntime(ctx);
    if (
      current.fileCount < INDEX_MIN_FILES ||
      current.fileCount > INDEX_MAX_FILES
    )
      return current;
    if (!current.indexed) await buildIndex(pi, current, ctx.signal);
    await startServer(current);
    return current;
  }

  pi.registerTool({
    name: "tgrep_search",
    label: "tgrep",
    description:
      "Run bounded literal, regex, files-only, or multiline searches inside the current Git worktree. Uses a watched trigram index for medium-sized repositories and a fresh scan for small or very large repositories.",
    promptSnippet: "Run broad or exhaustive regex/multiline repository searches",
    promptGuidelines: [
      "Use tgrep_search for broad, exhaustive, files-only, or multiline content searches; keep ffgrep for ordinary identifier searches and fffind for paths.",
      "Set tgrep_search fresh=true after edits or whenever completeness against current files matters more than indexed speed.",
    ],
    parameters: searchSchema,
    async execute(_toolCallId, params: SearchParams, signal, _onUpdate, ctx) {
      const current = params.fresh
        ? await currentRuntime(ctx)
        : await ensureIndexed(ctx);
      const searchPath = await resolveTgrepPath(
        current.root,
        params.path ?? ".",
      );
      const useIndex =
        !params.fresh &&
        current.indexed &&
        current.fileCount >= INDEX_MIN_FILES &&
        current.fileCount <= INDEX_MAX_FILES;
      const result = await run(
        pi,
        buildTgrepSearchArgs(
          params,
          searchPath,
          current.indexPath,
          useIndex,
        ),
        current.root,
        signal,
      );
      if (result.code === 1)
        return {
          content: [{ type: "text", text: "No matches found." }],
          details: { matches: false, indexed: useIndex },
        };
      if (result.code !== 0)
        throw new Error(result.stderr.trim() || "tgrep search failed");
      const truncated = truncateHead(result.stdout, {
        maxLines: 300,
        maxBytes: 30_000,
      });
      const suffix = truncated.truncated
        ? `\n\n[Truncated to ${truncated.outputLines}/${truncated.totalLines} lines.]`
        : "";
      return {
        content: [{ type: "text", text: `${truncated.content}${suffix}` }],
        details: {
          matches: true,
          indexed: useIndex,
          fileCount: current.fileCount,
          truncated: truncated.truncated,
        },
      };
    },
  });

  pi.registerCommand("tgrep-status", {
    description: "Show tgrep file count and index/server status",
    handler: async (_args, ctx) => {
      try {
        const current = await currentRuntime(ctx);
        const status = await run(
          pi,
          [
            "status",
            current.root,
            "--index-path",
            current.indexPath,
          ],
          current.root,
          ctx.signal,
          30_000,
        );
        ctx.ui.notify(
          `${current.fileCount} text files\n${status.stdout.trim() || status.stderr.trim() || "No index/server"}`,
          status.code === 0 ? "info" : "warning",
        );
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });

  pi.registerCommand("tgrep-reindex", {
    description: "Rebuild the external tgrep index for the current worktree",
    handler: async (_args, ctx) => {
      try {
        const current = await currentRuntime(ctx);
        await stopServer(current);
        current.server = undefined;
        current.indexed = false;
        ctx.ui.setStatus("tgrep", "indexing");
        await buildIndex(pi, current, ctx.signal);
        await startServer(current);
        ctx.ui.notify(`Indexed ${current.fileCount} text files.`, "info");
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      } finally {
        ctx.ui.setStatus("tgrep", undefined);
      }
    },
  });

  pi.on("session_shutdown", async () => {
    await stopServer(runtime);
  });
}
