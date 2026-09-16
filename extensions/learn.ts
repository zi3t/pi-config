import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";

const STATE = "learn-mode";
type LearnMode = "off" | "on" | "hybrid";

export function defaultLearnMode(root: string): LearnMode {
  return basename(root) === "hustler" ? "hybrid" : "off";
}

export function defaultsToLearningMode(root: string): boolean {
  return defaultLearnMode(root) !== "off";
}

export function isMutatingShellCommand(command: string): boolean {
  return /\b(?:rm|mv|cp|mkdir|touch|tee|truncate)\b|\bsed\s+-i\b|\bperl\s+-pi\b|(?:^|\s)>>?\s*[^&\s]|\b(?:git|but)\s+(?:add|commit|push|checkout|merge|rebase|reset|clean|discard|amend|squash|move)\b/im.test(command);
}

export default function (pi: ExtensionAPI) {
  let mode: LearnMode = "off";
  let hiddenWriteTools: string[] = [];

  const hideWriteTools = () => {
    const active = pi.getActiveTools();
    const newlyHidden = active.filter((name) => name === "edit" || name === "write");
    hiddenWriteTools = [...new Set([...hiddenWriteTools, ...newlyHidden])];
    if (newlyHidden.length) pi.setActiveTools(active.filter((name) => !newlyHidden.includes(name)));
  };

  const restoreWriteTools = () => {
    if (!hiddenWriteTools.length) return;
    pi.setActiveTools([...new Set([...pi.getActiveTools(), ...hiddenWriteTools])]);
    hiddenWriteTools = [];
  };

  const showStatus = (ctx: { ui: { setStatus: (id: string, text: string | undefined) => void } }) =>
    ctx.ui.setStatus(STATE, mode === "on" ? "LEARN" : mode === "hybrid" ? "LEARN:HYBRID" : undefined);

  pi.on("session_start", async (_event, ctx) => {
    let saved: LearnMode | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== STATE) continue;
      const data = entry.data as { mode?: unknown; enabled?: unknown };
      if (data.mode === "off" || data.mode === "on" || data.mode === "hybrid") {
        saved = data.mode;
      } else if (typeof data.enabled === "boolean") {
        saved = data.enabled ? "on" : "off";
      }
    }

    const rootResult = saved === undefined
      ? await pi.exec("git", ["-C", ctx.cwd, "rev-parse", "--show-toplevel"])
      : undefined;
    mode = saved ?? defaultLearnMode(rootResult?.code === 0 ? rootResult.stdout.trim() : ctx.cwd);
    if (mode === "on") hideWriteTools();
    showStatus(ctx);
  });

  pi.on("session_shutdown", restoreWriteTools);

  pi.registerCommand("learn", {
    description: "Set learning mode: strict (on), hybrid, or off",
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      if (!value) {
        ctx.ui.notify(`Learning mode is ${mode}.`, "info");
        return;
      }
      if (value !== "on" && value !== "off" && value !== "hybrid") {
        ctx.ui.notify("Usage: /learn on|hybrid|off", "warning");
        return;
      }

      mode = value;
      mode === "on" ? hideWriteTools() : restoreWriteTools();
      pi.appendEntry(STATE, { mode });
      showStatus(ctx);
      ctx.ui.notify(`Learning mode ${mode}.`, "info");
    },
  });

  pi.on("before_agent_start", (event) => {
    if (mode === "off") return;

    if (mode === "on") {
      return {
        systemPrompt: `${event.systemPrompt}\n\nLearning mode is ON. Tutor only: explain concepts, ask one useful next question or exercise, and review the user's attempt. Do not provide a complete solution, attempt file-writing tools, or run mutating shell commands. If implementation is requested, tell the user to run /learn off first.`,
      };
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\nHybrid learning mode is ON. Optimize for both speed and understanding. Before each new coding milestone, give a concise theory brief with the mental model, key invariant or equation, one worked example, and one primary reading resource. Use 60–90 minute milestones rather than micro-question pacing. The assistant may implement tooling, API scaffolding, tests, formatting, and integration; the user should implement the algorithmic core unless they explicitly ask the assistant to take over. After each milestone, use the questionnaire tool when available for a compact 3–5 question conceptual check, then review the user's explanation. Do not quiz after every response.`,
    };
  });

  pi.on("tool_call", (event) => {
    if (mode !== "on") return;
    const blocked = event.toolName === "edit" || event.toolName === "write" ||
      (event.toolName === "bash" && isMutatingShellCommand(event.input.command as string));
    if (blocked) return { block: true, reason: "Learning mode is on. Run /learn off before implementation." };
  });
}
