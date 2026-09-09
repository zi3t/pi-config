import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";

const STATE = "learn-mode";

export function defaultsToLearningMode(root: string): boolean {
  return basename(root) === "hustler";
}

export function isMutatingShellCommand(command: string): boolean {
  return /\b(?:rm|mv|cp|mkdir|touch|tee|truncate)\b|\bsed\s+-i\b|\bperl\s+-pi\b|(?:^|\s)>>?\s*[^&\s]|\b(?:git|but)\s+(?:add|commit|push|checkout|merge|rebase|reset|clean|discard|amend|squash|move)\b/im.test(command);
}

export default function (pi: ExtensionAPI) {
  let enabled = false;
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
    ctx.ui.setStatus(STATE, enabled ? "LEARN" : undefined);

  pi.on("session_start", async (_event, ctx) => {
    let saved: boolean | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === STATE) {
        saved = (entry.data as { enabled?: boolean })?.enabled;
      }
    }

    const rootResult = saved === undefined
      ? await pi.exec("git", ["-C", ctx.cwd, "rev-parse", "--show-toplevel"])
      : undefined;
    enabled = saved ?? defaultsToLearningMode(rootResult?.code === 0 ? rootResult.stdout.trim() : ctx.cwd);
    if (enabled) hideWriteTools();
    showStatus(ctx);
  });

  pi.on("session_shutdown", restoreWriteTools);

  pi.registerCommand("learn", {
    description: "Turn strict tutoring mode on or off",
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      if (!value) {
        ctx.ui.notify(`Learning mode is ${enabled ? "on" : "off"}.`, "info");
        return;
      }
      if (value !== "on" && value !== "off") {
        ctx.ui.notify("Usage: /learn on|off", "warning");
        return;
      }

      enabled = value === "on";
      enabled ? hideWriteTools() : restoreWriteTools();
      pi.appendEntry(STATE, { enabled });
      showStatus(ctx);
      ctx.ui.notify(`Learning mode ${value}.`, "info");
    },
  });

  pi.on("before_agent_start", (event) => {
    if (!enabled) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\nLearning mode is ON. Tutor only: explain concepts, ask one useful next question or exercise, and review the user's attempt. Do not provide a complete solution, attempt file-writing tools, or run mutating shell commands. If implementation is requested, tell the user to run /learn off first.`,
    };
  });

  pi.on("tool_call", (event) => {
    if (!enabled) return;
    const blocked = event.toolName === "edit" || event.toolName === "write" ||
      (event.toolName === "bash" && isMutatingShellCommand(event.input.command as string));
    if (blocked) return { block: true, reason: "Learning mode is on. Run /learn off before implementation." };
  });
}
