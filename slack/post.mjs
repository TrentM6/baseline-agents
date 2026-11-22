// post.mjs: the Slack adapter's outbound side. Posts one message to a channel
// as a given agent, converting markdown to Block Kit and writing a delivery
// receipt to logs/slack-posts.jsonl. Used by the gateway's post_report tool,
// so an agent running anywhere (CLI, Claude Code, an app, an automation) can
// report to Slack without holding a token itself.
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { ROOT, envValue, envSlug } from "../core/config.mjs";
import { postMessage } from "./slack-api.mjs";
import { toSlackMessage } from "./format-blocks.mjs";

/** Is the Slack adapter configured for this agent? */
export const slackTokenFor = (slug) => envValue(`SLACK_${envSlug(slug)}_BOT_TOKEN`);

/** Returns { ok, ts?, error? }. Never throws. */
export async function postAsAgent({ as, channelId, text, caller = "unknown" }) {
  const token = slackTokenFor(as);
  if (!token) return { ok: false, error: `no SLACK_${envSlug(as)}_BOT_TOKEN in .env` };
  const { text: fallback, blocks } = toSlackMessage(text);
  const base = (process.env.AVATAR_BASE_URL || "").replace(/\/+$/, "");
  const r = await postMessage(token, { channel: channelId, text: fallback, blocks, ...(base ? { icon_url: `${base}/${as}.png` } : {}) });
  if (r.ok) {
    try {
      mkdirSync(path.join(ROOT, "logs"), { recursive: true });
      appendFileSync(path.join(ROOT, "logs", "slack-posts.jsonl"), JSON.stringify({
        ts: new Date().toISOString(), caller, as, channel: channelId, message_ts: r.ts ?? null,
        head: String(text).split("\n").find((l) => l.trim())?.slice(0, 120) ?? "",
      }) + "\n");
    } catch {}
  }
  return r.ok ? { ok: true, ts: r.ts } : { ok: false, error: r.error || "unknown Slack error" };
}
