import { callUpstream } from "./upstreams.mjs";
import { logToolCall } from "./log.mjs";
import { runSecondOpinion } from "./second-opinion.mjs";
import { isLocalTool, runLocalTool } from "./local-tools.mjs";

/**
 * The one place a tool call actually runs: policy check, argument-scope check,
 * dispatch (upstream, local tool, or second_opinion), logging. Every caller
 * goes through here, so "what a tool call does" can't drift between callers.
 */
export async function executeTool({ caller, name, args, clients, policy }) {
  const started = Date.now();

  if (!policy.allowed(caller, name)) {
    logToolCall({ caller, tool: name, ok: false, ms: 0, error: "denied by policy" });
    return {
      content: [{ type: "text", text: `Tool ${name} is not allowed for caller "${caller}".` }],
      isError: true,
    };
  }

  const violation = policy.scopeViolation(name, args);
  if (violation) {
    logToolCall({ caller, tool: name, ok: false, ms: 0, error: `scope: ${violation}` });
    return { content: [{ type: "text", text: `Denied by scope: ${violation}.` }], isError: true };
  }

  try {
    let result;
    if (name === "second_opinion") {
      result = { content: [{ type: "text", text: await runSecondOpinion(args ?? {}, caller) }] };
    } else if (isLocalTool(name)) {
      result = await runLocalTool(name, args ?? {}, caller);
    } else {
      result = await callUpstream(clients, name, args);
    }
    logToolCall({ caller, tool: name, ok: true, ms: Date.now() - started });
    return result;
  } catch (e) {
    logToolCall({ caller, tool: name, ok: false, ms: Date.now() - started, error: e });
    return { content: [{ type: "text", text: `Error: ${String(e?.message ?? e).slice(0, 500)}` }], isError: true };
  }
}
