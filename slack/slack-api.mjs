// slack-api.mjs — the Slack Web API calls the runner needs, hand-rolled on
// Node built-ins (global fetch) so the Slack runtime has no npm dependencies.
//
// WHY the retry loop: Slack rate-limits per method (HTTP 429 + Retry-After, or a
// 200 body with `error:"ratelimited"`). Honoring Retry-After is the difference
// between a reply that lands a second late and a reply that's dropped silently.
const BASE = "https://slack.com/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, token, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt === 3) return { ok: false, error: `fetch_failed:${e.message}` };
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (res.status === 429) {
      const wait = (Number(res.headers.get("retry-after")) || 1) * 1000;
      await sleep(wait);
      continue;
    }
    const j = await res.json().catch(() => ({ ok: false, error: "bad_json" }));
    if (!j.ok && j.error === "ratelimited") { await sleep(1000 * (attempt + 1)); continue; }
    return j;
  }
  return { ok: false, error: "ratelimited_giveup" };
}

// chat.postMessage — thread_ts aware (omit it for a top-level post). icon_url
// overrides the per-message avatar (requires the chat:write.customize scope);
// omit it and Slack falls back to the app's own configured icon. `blocks` is
// optional Block Kit output from format-blocks.mjs's toSlackMessage() — `text`
// still goes through as the notification-preview fallback either way.
export function postMessage(token, { channel, text, blocks, thread_ts, icon_url }) {
  const body = { channel, text };
  if (blocks && blocks.length) body.blocks = blocks;
  if (thread_ts) body.thread_ts = thread_ts;
  if (icon_url) body.icon_url = icon_url;
  return call("chat.postMessage", token, body);
}

// reactions.add — used as a lightweight "seen" ack on the triggering message.
export function addReaction(token, { channel, timestamp, name }) {
  return call("reactions.add", token, { channel, timestamp, name });
}

// conversations.replies — the thread history a turn needs for context. Read
// methods take query params (GET), not a JSON body, so this doesn't reuse
// call(). Returns the raw Slack response; callers treat failure as "no
// context available" rather than an error (the turn still runs).
export async function fetchReplies(token, { channel, ts, limit = 12 }) {
  const qs = new URLSearchParams({ channel, ts, limit: String(limit) });
  try {
    const res = await fetch(`${BASE}/conversations.replies?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: `fetch_failed:${e.message}` };
  }
}

// auth.test — resolve the bot's own user/bot id (used to suppress self-replies).
export function authTest(token) {
  return call("auth.test", token, {});
}
