// kb.mjs: the knowledge-base table of contents every agent turn is given.
//
// Agents read the real pages themselves (Read/Grep/Glob, or the gateway's
// kb_* tools). This map tells them WHICH pages exist, so they read the right
// one instead of grepping blindly and wrongly concluding "no record".
//
// Built from kb/log.md (recent filings) and every kb/<category>/index.md.
// Categories are whatever folders you create under kb/.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./config.mjs";

const KB = path.join(ROOT, "kb");
const INDEX_CAP = 2600; // chars per category index
const LOG_LINES = 25;

const safeRead = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

function categories() {
  try {
    return readdirSync(KB, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export function kbMap() {
  const parts = [];
  const logMd = safeRead(path.join(KB, "log.md"));
  if (logMd) {
    const lines = logMd.split("\n").filter((l) => l.startsWith("- "));
    if (lines.length) parts.push("## Recent KB filings (newest first)\n" + lines.slice(0, LOG_LINES).join("\n"));
  }
  for (const c of categories()) {
    const idx = safeRead(path.join(KB, c, "index.md"));
    if (idx) parts.push(`## kb/${c}/: pages\n` + idx.slice(0, INDEX_CAP));
  }
  return parts.join("\n\n");
}
