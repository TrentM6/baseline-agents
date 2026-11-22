#!/usr/bin/env node
/**
 * schedule.mjs — turn automations.yaml schedules into real OS jobs.
 *
 *   node scripts/schedule.mjs print              show what would be installed (default)
 *   node scripts/schedule.mjs install            install/refresh every automation's job
 *   node scripts/schedule.mjs install-receiver   keep the Slack receiver running as a service
 *   node scripts/schedule.mjs uninstall          remove every job this repo installed
 *
 * macOS → launchd agents in ~/Library/LaunchAgents.
 * Linux → systemd user units in ~/.config/systemd/user (run
 *         `loginctl enable-linger $USER` once so they run while you're logged out).
 *
 * Idempotent: `install` rewrites every job and retires jobs for automations
 * that no longer exist or have no schedule. Nothing runs on a schedule until
 * you run `install`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = process.env.AGENTS_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = process.env.AGENTS_LABEL_PREFIX ?? `agents.${path.basename(ROOT).replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
const mode = process.argv[2] ?? "print";
const isMac = process.platform === "darwin";
const HOME = os.homedir();
const NODE = process.execPath;
const PATH_VAR = [path.dirname(NODE), path.join(HOME, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(":");
const LOG_DIR = path.join(ROOT, "logs", "scheduler");

const doc = parse(fs.readFileSync(path.join(ROOT, "automations/automations.yaml"), "utf8")) ?? {};
const scheduled = Object.entries(doc.automations ?? {}).filter(([, a]) => Array.isArray(a?.schedule) && a.schedule.length);

const sh = (cmd, args, { quiet = false } = {}) => {
  try { return execFileSync(cmd, args, { stdio: quiet ? "ignore" : "inherit" }); } catch (e) { if (!quiet) throw e; }
};
const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------- launchd ---
const LA_DIR = path.join(HOME, "Library/LaunchAgents");
const uid = () => String(process.getuid());

function launchdPlist(label, programArgs, { calendar = null, keepAlive = false, logName }) {
  const cal = calendar
    ? `  <key>StartCalendarInterval</key>\n  <array>\n${calendar.map((s) =>
        `    <dict>${s.weekday !== undefined ? `<key>Weekday</key><integer>${s.weekday}</integer>` : ""}<key>Hour</key><integer>${s.hour}</integer><key>Minute</key><integer>${s.minute}</integer></dict>`).join("\n")}\n  </array>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEsc(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs.map((a) => `    <string>${xmlEsc(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${xmlEsc(ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEsc(PATH_VAR)}</string>
    <key>AGENTS_ROOT</key><string>${xmlEsc(ROOT)}</string>
  </dict>
${cal}${keepAlive ? "  <key>KeepAlive</key><true/>\n  <key>RunAtLoad</key><true/>\n" : ""}  <key>StandardOutPath</key><string>${xmlEsc(path.join(LOG_DIR, logName))}</string>
  <key>StandardErrorPath</key><string>${xmlEsc(path.join(LOG_DIR, logName))}</string>
</dict>
</plist>
`;
}

function launchdLoad(label, plistPath) {
  sh("launchctl", ["bootout", `gui/${uid()}/${label}`], { quiet: true });
  sh("launchctl", ["bootstrap", `gui/${uid()}`, plistPath]);
}

// ---------------------------------------------------------------- systemd ---
const SD_DIR = path.join(HOME, ".config/systemd/user");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const onCalendar = (s) => `${s.weekday !== undefined ? WEEKDAYS[s.weekday] + " " : ""}*-*-* ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}:00`;

function systemdService(desc, execArgs, { longRunning = false } = {}) {
  return `[Unit]
Description=${desc}
${longRunning ? "After=network-online.target\nWants=network-online.target\nStartLimitIntervalSec=0\n" : ""}
[Service]
Type=${longRunning ? "simple" : "oneshot"}
WorkingDirectory=${ROOT}
Environment=AGENTS_ROOT=${ROOT}
Environment=PATH=${PATH_VAR}
ExecStart=${execArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}
${longRunning ? "Restart=always\nRestartSec=5\n# Each agent turn is a child process; one OOM-killed turn must not stop the service.\nOOMPolicy=continue\nKillMode=control-group\nTimeoutStopSec=20\n" : ""}
${longRunning ? "[Install]\nWantedBy=default.target\n" : ""}`;
}

function systemdTimer(desc, unit, slots) {
  return `[Unit]
Description=${desc}

[Timer]
${slots.map((s) => `OnCalendar=${onCalendar(s)}`).join("\n")}
Persistent=true
Unit=${unit}

[Install]
WantedBy=timers.target
`;
}

// ------------------------------------------------------------------ plan ---
function plan() {
  const jobs = scheduled.map(([name, a]) => ({
    name,
    label: `${PREFIX}.automation.${name}`,
    slots: a.schedule,
    args: ["/bin/bash", path.join(ROOT, "scripts/run-automation.sh"), name, "--trigger=schedule"],
  }));
  return jobs;
}

function existingLabels() {
  const dir = isMac ? LA_DIR : SD_DIR;
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith(`${PREFIX}.automation.`))
      .map((f) => f.replace(/\.(plist|service|timer)$/, ""))
      .filter((v, i, arr) => arr.indexOf(v) === i);
  } catch {
    return [];
  }
}

function retire(label) {
  if (isMac) {
    sh("launchctl", ["bootout", `gui/${uid()}/${label}`], { quiet: true });
    fs.rmSync(path.join(LA_DIR, `${label}.plist`), { force: true });
  } else {
    sh("systemctl", ["--user", "disable", "--now", `${label}.timer`], { quiet: true });
    fs.rmSync(path.join(SD_DIR, `${label}.timer`), { force: true });
    fs.rmSync(path.join(SD_DIR, `${label}.service`), { force: true });
  }
  console.log(`  retired ${label}`);
}

if (mode === "print") {
  console.log(`Scheduler: ${isMac ? "launchd (macOS)" : "systemd --user (Linux)"} · label prefix ${PREFIX}`);
  for (const j of plan()) {
    const when = j.slots.map((s) => (isMac ? `${s.weekday !== undefined ? WEEKDAYS[s.weekday] + " " : "daily "}${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}` : onCalendar(s))).join(", ");
    console.log(`  ${j.label}  →  ${when}`);
  }
  if (!scheduled.length) console.log("  (no automation has a schedule)");
  console.log("\nRun `node scripts/schedule.mjs install` to install these.");
} else if (mode === "install") {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const wanted = new Set();
  for (const j of plan()) {
    wanted.add(j.label);
    if (isMac) {
      fs.mkdirSync(LA_DIR, { recursive: true });
      const p = path.join(LA_DIR, `${j.label}.plist`);
      fs.writeFileSync(p, launchdPlist(j.label, j.args, { calendar: j.slots, logName: `${j.name}.log` }));
      launchdLoad(j.label, p);
    } else {
      fs.mkdirSync(SD_DIR, { recursive: true });
      fs.writeFileSync(path.join(SD_DIR, `${j.label}.service`), systemdService(`Agents automation ${j.name}`, j.args));
      fs.writeFileSync(path.join(SD_DIR, `${j.label}.timer`), systemdTimer(`Schedule for automation ${j.name}`, `${j.label}.service`, j.slots));
    }
    console.log(`  installed ${j.label}`);
  }
  if (!isMac) {
    sh("systemctl", ["--user", "daemon-reload"]);
    for (const l of wanted) sh("systemctl", ["--user", "enable", "--now", `${l}.timer`]);
  }
  for (const l of existingLabels()) if (!wanted.has(l)) retire(l);
  console.log("Done. Each run logs to logs/runs.jsonl; scheduler output goes to logs/scheduler/.");
} else if (mode === "install-receiver") {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const label = `${PREFIX}.slack-receiver`;
  const args = ["/bin/bash", "-c", `set -a; [ -f "${ROOT}/.env" ] && . "${ROOT}/.env"; set +a; exec "${NODE}" "${ROOT}/slack/receiver.mjs"`];
  if (isMac) {
    fs.mkdirSync(LA_DIR, { recursive: true });
    const p = path.join(LA_DIR, `${label}.plist`);
    fs.writeFileSync(p, launchdPlist(label, args, { keepAlive: true, logName: "slack-receiver.log" }));
    launchdLoad(label, p);
  } else {
    fs.mkdirSync(SD_DIR, { recursive: true });
    fs.writeFileSync(path.join(SD_DIR, `${label}.service`), systemdService("Agents Slack receiver", args, { longRunning: true }));
    sh("systemctl", ["--user", "daemon-reload"]);
    sh("systemctl", ["--user", "enable", "--now", `${label}.service`]);
  }
  console.log(`  installed ${label} — logs in logs/scheduler/slack-receiver.log${isMac ? "" : " (or journalctl --user -u " + label + ")"}`);
} else if (mode === "uninstall") {
  for (const l of existingLabels()) retire(l);
  const recv = `${PREFIX}.slack-receiver`;
  if (isMac) {
    sh("launchctl", ["bootout", `gui/${uid()}/${recv}`], { quiet: true });
    fs.rmSync(path.join(LA_DIR, `${recv}.plist`), { force: true });
  } else {
    sh("systemctl", ["--user", "disable", "--now", `${recv}.service`], { quiet: true });
    fs.rmSync(path.join(SD_DIR, `${recv}.service`), { force: true });
  }
  console.log("Done.");
} else {
  console.error("usage: node scripts/schedule.mjs print | install | install-receiver | uninstall");
  process.exit(2);
}
