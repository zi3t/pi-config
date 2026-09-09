import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATE = "learn-mode";

export function isExplicitWriteInvitation(prompt: string): boolean {
  return /\b(?:please\s+(?:edit|modify|implement|write|change|fix)\s+(?:it|this|(?:the|this|my)\s+(?:code|files?|project|implementation|solution|changes?|bug|issue))|you\s+(?:can|may|should)\s+(?:edit|modify|implement|write|fix)|(?:make|apply)\s+the\s+changes|do\s+it\s+for\s+me)\b/i.test(prompt);
}

export function isMutatingShellCommand(command: string): boolean {
  return /\b(?:rm|mv|cp|mkdir|touch|tee|truncate)\b|\bsed\s+-i\b|\bperl\s+-pi\b|(?:^|\s)>>?\s*[^&\s]|\b(?:git|but)\s+(?:add|commit|push|checkout|merge|rebase|reset|clean|discard|amend|squash|move)\b/im.test(command);
}

export default function (pi: ExtensionAPI) {
  let enabled = false;
  let allowWritesThisTurn = false;

  const showStatus = (ctx: { ui: { setStatus: (id: string, text: string | undefined) => void } }) =>
    ctx.ui.setStatus(STATE, enabled ? "LEARN" : undefined);

  pi.on("session_start", (_event, ctx) => {
    enabled = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === STATE) {
        enabled = (entry.data as { enabled?: boolean })?.enabled === true;
      }
    }
    showStatus(ctx);
  });

  pi.registerCommand("learn", {
    description: "Turn learning mode on or off",
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
      allowWritesThisTurn = false;
      pi.appendEntry(STATE, { enabled });
      showStatus(ctx);
      ctx.ui.notify(`Learning mode ${value}.`, "info");
    },
  });

  pi.on("before_agent_start", (event) => {
    allowWritesThisTurn = enabled && isExplicitWriteInvitation(event.prompt);
    if (!enabled) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\nLearning mode is ON. Act as a tutor: explain concepts, ask one useful next question or exercise, and review the user's attempt. Do not provide a complete solution or modify files unless this current prompt explicitly asks you to do the implementation. ${allowWritesThisTurn ? "The current prompt explicitly permits implementation." : "The current prompt does not permit implementation."}`,
    };
  });

  pi.on("tool_call", (event) => {
    if (!enabled || allowWritesThisTurn) return;
    const blocked = event.toolName === "edit" || event.toolName === "write" ||
      (event.toolName === "bash" && isMutatingShellCommand(event.input.command as string));
    if (blocked) {
      return {
        block: true,
        reason: "Learning mode is on. Ask the user to explicitly invite implementation before modifying files.",
      };
    }
  });
}
