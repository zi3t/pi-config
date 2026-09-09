import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

type Scripts = Record<string, string>;

export function expandNpmScripts(command: string, scripts: Scripts): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  let pending = npmScriptNames(command).map((name) => ({ name, depth: 0 }));

  while (pending.length) {
    const { name, depth } = pending.shift()!;
    if (seen.has(name) || !scripts[name]) continue;
    seen.add(name);
    expanded.push(scripts[name]);
    if (depth === 0) {
      pending.push(...npmScriptNames(scripts[name]).map((nested) => ({ name: nested, depth: 1 })));
    }
  }

  return expanded;
}

function npmScriptNames(command: string): string[] {
  const names = [...command.matchAll(/\bnpm\s+(?:--prefix(?:=|\s+)\S+\s+)?(?:run|run-script)\s+([\w:-]+)/gi)]
    .map((match) => match[1]);
  for (const match of command.matchAll(/\bnpm\s+(test|start|stop|restart)\b/gi)) names.push(match[1]);
  return names;
}

export function classifyShellCommand(command: string, scripts: Scripts = {}, cwd = ".", root = cwd) {
  const expanded = expandNpmScripts(command, scripts);
  const text = [command, ...expanded].join("\n");
  const segments = text.split(/(?:&&|\|\||[;\n])/).map((part) => part.trim());
  const remote = segments.some((part) =>
    !/--dry-run\b/i.test(part) && (
      /\bwrangler\b.*(?:\bdeploy\b|\bdelete\b|--remote\b)/i.test(part) ||
      /\bnpm\s+publish\b/i.test(part) ||
      /\bgh\s+release\s+create\b/i.test(part)
    ));
  const writer = /\bnpm\s+(?:install|i|ci|update|uninstall)\b/i.test(text) ||
    /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:build|dev|preview)(?=[:\s]|$)/i.test(text) ||
    /\b(?:vite|astro|next|vinext)\s+build\b/i.test(text) ||
    /\bwrangler\s+dev\b/i.test(text) ||
    /\b(?:rm|mv|cp|rsync|mkdir|touch|tee)\b|\bsed\s+-i\b|(?:^|\s)>>?\s*[^&\s]/im.test(text);
  const externalPaths = [...text.matchAll(/(?:^|[\s="'])(\.\.\/[^\s"'`;|&)]+|\/Users\/[^\s"'`;|&)]+)/g)]
    .map((match) => resolve(cwd, match[1]))
    .filter((path) => {
      const fromRoot = relative(root, path);
      return fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
    });

  return { writer, remote, externalPaths: [...new Set(externalPaths)], expanded };
}

async function repositoryContext(pi: ExtensionAPI, cwd: string) {
  const rootResult = await pi.exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
  const root = rootResult.code === 0 ? rootResult.stdout.trim() : cwd;
  const status = rootResult.code === 0
    ? await pi.exec("git", ["-C", root, "status", "--porcelain"])
    : undefined;
  const dirty = status?.code === 0 ? status.stdout.split("\n").filter(Boolean).length : 0;
  let scripts: Scripts = {};

  try {
    const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    if (pkg.scripts && typeof pkg.scripts === "object") scripts = pkg.scripts;
  } catch {
    // Not a Node project, or no readable package manifest.
  }

  return { root, dirty, scripts };
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command = event.input.command as string;
    if (!command) return;

    const directRisk = classifyShellCommand(command);
    if (!directRisk.writer && !directRisk.remote && npmScriptNames(command).length === 0) return;

    const repo = await repositoryContext(pi, ctx.cwd);
    const risk = classifyShellCommand(command, repo.scripts, ctx.cwd, repo.root);
    const reasons = [
      risk.remote && "remote-capable command",
      risk.writer && risk.externalPaths.length > 0 && `writes outside this repository: ${risk.externalPaths.join(", ")}`,
      risk.writer && repo.dirty > 0 && `workspace writer in a dirty repository (${repo.dirty} changes)`,
    ].filter(Boolean) as string[];

    if (!reasons.length) return;
    if (!ctx.hasUI) return { block: true, reason: `Workspace guard: ${reasons.join("; ")}` };

    const allowed = await ctx.ui.confirm(
      "Workspace guard",
      `${reasons.join("\n")}\n\nRepository: ${repo.root}\nCommand: ${command}\n\nAllow?`,
    );
    if (!allowed) return { block: true, reason: "Blocked by workspace guard" };
  });
}
