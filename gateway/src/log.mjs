import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./config.mjs";

const LOG_DIR = path.join(ROOT, "logs");

function append(file, row) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(path.join(LOG_DIR, file), JSON.stringify(row) + "\n");
  } catch {
    // logging must never break a tool call
  }
}

/** One row per tool call, every caller: logs/toolcalls.jsonl. */
export function logToolCall({ caller, tool, ok, ms, error }) {
  append("toolcalls.jsonl", {
    ts: new Date().toISOString(),
    caller,
    tool,
    ok,
    ms,
    ...(error ? { error: String(error).slice(0, 300) } : {}),
  });
}

/** Metered non-Claude model calls (second_opinion): logs/model-spend.jsonl. */
export function logModelSpend({ caller, model, prompt_tokens, completion_tokens, cost_usd }) {
  append("model-spend.jsonl", { ts: new Date().toISOString(), caller, model, prompt_tokens, completion_tokens, cost_usd });
}
