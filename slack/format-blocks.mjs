// format-blocks.mjs: turn standard markdown (headings, **bold**, [label](url),
// - bullets, tables) into Slack Block Kit + mrkdwn, so a report posts as a
// report (header, dividers, bold sections) instead of a wall of literal
// markdown. Slack does not render markdown: mrkdwn wants *bold* (single
// asterisks), <url|label> links, and has no heading or table syntax.
//
// Contract: skills and agents write normal markdown; THIS is the one seam that
// translates. Used by the runner for agent replies and by scripts/slack-send.sh
// for automation posts.
//
// Slack limits honored: header text <=150 chars, section mrkdwn <=3000 chars,
// <=50 blocks (long sections overflow into continuation sections).

const SECTION_MAX = 2900; // headroom under Slack's 3000
const BLOCK_MAX = 48;     // headroom under Slack's 50

// Inline markdown → mrkdwn. Order matters: links before bold (labels may be bold).
export function inline(md) {
  return String(md)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>") // [t](url) → <url|t>
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")                          // **b** → *b*
    .replace(/^(\s*)- /gm, "$1• ");                               // - bullet → • bullet
}

// Split a long mrkdwn string on line boundaries into ≤SECTION_MAX chunks.
function chunk(text) {
  const out = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > SECTION_MAX) { out.push(cur); cur = line; }
    else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

// Slack mrkdwn has no table syntax, so a raw markdown table posts as literal
// pipes. Each table becomes one bullet per row: first column as the bold
// label, remaining columns as "Header: value" pairs.
const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableSep = (line) => /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(line);
const parseTableRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function tableToBullets(header, rows) {
  return rows
    .map((cells) => {
      const label = cells[0] || "";
      const rest = header
        .slice(1)
        .map((h, i) => (cells[i + 1] ? `${h}: ${cells[i + 1]}` : null))
        .filter(Boolean)
        .join(" · ");
      return rest ? `• *${label}* · ${rest}` : `• *${label}*`;
    })
    .join("\n");
}

/** Build { text, blocks } for chat.postMessage from markdown-ish input.
 * No headings AND no table at all → blocks omitted (plain conversational
 * message, inline conversions only). */
export function toSlackMessage(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const hasHeading = lines.some((l) => /^#{1,3} /.test(l));
  const hasTable = lines.some((l, i) => isTableRow(l) && isTableSep(lines[i + 1] || ""));

  if (!hasHeading && !hasTable) return { text: inline(md) };

  const blocks = [];
  let buf = []; // pending body lines for the current section
  const flush = () => {
    const text = inline(buf.join("\n").trim());
    buf = [];
    if (!text) return;
    for (const part of chunk(text)) blocks.push({ type: "section", text: { type: "mrkdwn", text: part } });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h1 = /^# (.+)$/.exec(line);
    const h2 = /^#{2,3} (.+)$/.exec(line);
    if (h1) {
      flush();
      blocks.push({ type: "header", text: { type: "plain_text", text: h1[1].slice(0, 150), emoji: true } });
      continue;
    }
    if (h2) {
      flush();
      blocks.push({ type: "divider" });
      buf.push(`*${h2[1]}*`);
      continue;
    }
    if (isTableRow(line) && isTableSep(lines[i + 1] || "")) {
      const header = parseTableRow(line);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) { rows.push(parseTableRow(lines[j])); j++; }
      buf.push(tableToBullets(header, rows));
      i = j - 1;
      continue;
    }
    buf.push(line);
  }
  flush();

  // `text` is not just a notification preview. When the message contains a
  // mention, Slack echoes THIS field back as event.text, so it is the entire
  // prompt the mentioned agent receives. Build it from the full blocks; a
  // first-line-only fallback would starve a mentioned agent of the content.
  const fallback = blocks
    .map((b) => (b.type === "header" ? b.text.text : b.type === "section" ? b.text.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 6000);

  return { text: fallback, blocks: blocks.slice(0, BLOCK_MAX) };
}
