#!/bin/bash
# slack-send.sh <channel-id> [thread_ts] — post a message (read from stdin) to
# Slack as whichever agent's SLACK_BOT_TOKEN is in the environment.
#
#   bash scripts/slack-send.sh C0123456789 < files/kb-digest.md
#
# Markdown is converted to Block Kit (slack/format-blocks.mjs), so reports
# render with headings and bold instead of literal syntax. Every confirmed post
# appends a receipt to logs/slack-posts.jsonl: a run's "ok" only proves the
# process ran; the receipt proves the message landed.
set -euo pipefail
channel="${1:?usage: slack-send.sh <channel-id> [thread_ts]  (message on stdin)}"
thread_ts="${2:-}"
# No apostrophes inside ${...:?...}: a single quote there opens a quoting context.
: "${SLACK_BOT_TOKEN:?slack-send: SLACK_BOT_TOKEN not set (the runner sets it for agents and automations allowed to post)}"

ROOT="${AGENTS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
msg="$(cat)"
payload="$(SLACK_CH="$channel" SLACK_MSG="$msg" SLACK_THREAD="$thread_ts" SLACK_FMT="$ROOT/slack/format-blocks.mjs" node --input-type=module -e '
  const { toSlackMessage } = await import("file://" + process.env.SLACK_FMT);
  const m = toSlackMessage(process.env.SLACK_MSG);
  const o = { channel: process.env.SLACK_CH, text: m.text, unfurl_links: false };
  if (m.blocks) o.blocks = m.blocks;
  if (process.env.SLACK_THREAD) o.thread_ts = process.env.SLACK_THREAD;
  process.stdout.write(JSON.stringify(o));
')"

resp="$(curl -sS -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data "$payload")"

if ! printf '%s' "$resp" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.exit(JSON.parse(s).ok?0:1)}catch{process.exit(1)}})'; then
  echo "slack-send: post failed: $resp" >&2
  exit 1
fi

# Delivery receipt. Best-effort: a receipt failure never fails a good post.
RECEIPTS="$ROOT/logs/slack-posts.jsonl" SLACK_CH="$channel" SLACK_CALLER="${AGENTS_CALLER:-unknown}" \
SLACK_MSG="$msg" SLACK_RESP="$resp" node -e '
  const fs = require("fs"), path = require("path");
  let r = {}; try { r = JSON.parse(process.env.SLACK_RESP || "{}"); } catch {}
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    caller: process.env.SLACK_CALLER,
    channel: process.env.SLACK_CH,
    message_ts: r.ts ?? null,
    head: (process.env.SLACK_MSG || "").split("\n").find((l) => l.trim())?.slice(0, 120) ?? "",
  }) + "\n";
  fs.mkdirSync(path.dirname(process.env.RECEIPTS), { recursive: true });
  fs.appendFileSync(process.env.RECEIPTS, line);
' 2>/dev/null || true
