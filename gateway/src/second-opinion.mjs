import { logModelSpend } from "./log.mjs";

export const secondOpinionTool = {
  name: "second_opinion",
  description:
    "Ask a non-Claude model (via OpenRouter) for its take on a question or a piece of work. " +
    "Use for cross-family review (code diffs, headline variants, different-distribution drafts). " +
    "Every call is metered and its cost logged. Model examples: 'openai/gpt-5.3-codex', 'google/gemini-3-pro', 'deepseek/deepseek-v4'.",
  inputSchema: {
    type: "object",
    properties: {
      model: { type: "string", description: "OpenRouter model id, e.g. openai/gpt-5.3-codex" },
      prompt: { type: "string", description: "The question or material to review" },
      system: { type: "string", description: "Optional system prompt" },
    },
    required: ["model", "prompt"],
  },
};

export async function runSecondOpinion({ model, prompt, system }, caller) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY not set: add it to .env to enable second_opinion"
    );
  }
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, usage: { include: true } }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content ?? "";
  const usage = data.usage ?? {};
  logModelSpend({
    caller,
    model,
    prompt_tokens: usage.prompt_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? null,
    cost_usd: usage.cost ?? null,
  });
  const costNote =
    usage.cost != null ? `\n\n[${model} · $${Number(usage.cost).toFixed(4)}]` : `\n\n[${model}]`;
  return answer + costNote;
}
