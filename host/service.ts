// Keeping it running: launchd on a Mac, systemd on Linux, the user's Run key and keep-up.ts on Windows. Each starts it at
// login and restarts it if it stops.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { HOME } from "./home.ts";
import { commandLine, pidExists, system32, WINDOWS } from "./platform.ts";

const PROGRAM = path.join(import.meta.dirname, "..", "bin", "agent-autoloop.ts");
/** Another install on this machine (another AGENT_AUTOLOOP_HOME) has a service of its own. */
const label = () =>
  HOME === path.join(homedir(), ".agent-autoloop")
    ? "agent-autoloop"
    : `agent-autoloop-${createHash("sha256").update(HOME).digest("hex").slice(0, 8)}`;
const plistFile = () => path.join(homedir(), "Library/LaunchAgents", `${label()}.plist`);
const unitFile = () => path.join(homedir(), ".config/systemd/user", `${label()}.service`);
const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function plist() {
  const logs = path.join(HOME, "logs");
  const systemPaths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const searchPath = [path.dirname(process.execPath), ...systemPaths].join(":");
  const program = [process.execPath, "--disable-warning=ExperimentalWarning", PROGRAM, "up"];
  const programArguments = program.map((part) => `<string>${xml(part)}</string>`).join("");
  const homeEntry = `<key>AGENT_AUTOLOOP_HOME</key><string>${xml(HOME)}</string>`;
  const pathEntry = `<key>PATH</key><string>${xml(searchPath)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label()}</string>
  <key>ProgramArguments</key><array>${programArguments}</array>
  <key>EnvironmentVariables</key><dict>${homeEntry}${pathEntry}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(logs)}/up.log</string>
  <key>StandardErrorPath</key><string>${xml(logs)}/up.log</string>
</dict></plist>
`;
}

export function unit() {
  return `[Unit]
Description=Agent 自动化中台

[Service]
Environment=AGENT_AUTOLOOP_HOME=${HOME}
ExecStart=${process.execPath} --disable-warning=ExperimentalWarning ${PROGRAM} up
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

const domain = () => `gui/${process.getuid!()}`;
const launchdHasIt = () =>
  spawnSync("launchctl", ["print", `${domain()}/${label()}`], { stdio: "ignore" }).status === 0;
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const KEEP_UP = path.join(import.meta.dirname, "keep-up.ts");
const keepUpArgs = () => ["--disable-warning=ExperimentalWarning", KEEP_UP, HOME];
const quote = (part: string) => `"${part}"`;

/** What Windows runs at login: keep-up.ts, through a console host that shows no window. */
export function runCommand() {
  return [system32("conhost.exe"), "--headless", process.execPath, ...keepUpArgs()].map(quote).join(" ");
}

function runKeyValue() {
  const found = spawnSync(system32("reg.exe"), ["query", RUN_KEY, "/v", label()], {
    encoding: "utf8",
    windowsHide: true,
  });
  return found.status === 0 ? found.stdout : "";
}

/** The keeper of this install, if it is running. */
function keeper() {
  try {
    const pid = Number(readFileSync(path.join(HOME, "keep-up.pid"), "utf8").trim());
    return pidExists(pid) && commandLine(pid).includes("keep-up.ts") ? pid : null;
  } catch {
    return null;
  }
}

/** Only the keeper: what it started is stopped politely after, and the Agents that are running stay. */
function stopKeeper() {
  const pid = keeper();
  if (pid === null) return;
  try {
    process.kill(pid);
  } catch {}
}

export function installService() {
  mkdirSync(path.join(HOME, "logs"), { recursive: true, mode: 0o700 });
  if (WINDOWS) {
    execFileSync(system32("reg.exe"), ["add", RUN_KEY, "/v", label(), "/t", "REG_SZ", "/d", runCommand(), "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    stopKeeper();
    stopUp();
    spawn(process.execPath, keepUpArgs(), { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (process.platform === "darwin") {
    mkdirSync(path.dirname(plistFile()), { recursive: true });
    writeFileSync(plistFile(), plist());
    spawnSync("launchctl", ["bootout", `${domain()}/${label()}`], { stdio: "ignore" });
    // bootout returns before the old one is gone; loading before that fails and leaves none.
    for (let tries = 0; tries < 100 && launchdHasIt(); tries++) pause(100);
    execFileSync("launchctl", ["bootstrap", domain(), plistFile()]);
  } else {
    mkdirSync(path.dirname(unitFile()), { recursive: true });
    writeFileSync(unitFile(), unit());
    execFileSync("systemctl", ["--user", "daemon-reload"]);
    execFileSync("systemctl", ["--user", "enable", "--now", label()]);
    execFileSync("systemctl", ["--user", "restart", label()]);
  }
}

export function removeService() {
  if (WINDOWS) {
    if (!runKeyValue().includes(KEEP_UP)) return;
    spawnSync(system32("reg.exe"), ["delete", RUN_KEY, "/v", label(), "/f"], { stdio: "ignore", windowsHide: true });
    stopKeeper();
    return;
  }
  const file = process.platform === "darwin" ? plistFile() : unitFile();
  if (!existsSync(file) || !readFileSync(file, "utf8").includes(xml(PROGRAM))) return;
  if (process.platform === "darwin") {
    spawnSync("launchctl", ["bootout", `${domain()}/${label()}`], { stdio: "ignore" });
    rmSync(plistFile(), { force: true });
  } else {
    spawnSync("systemctl", ["--user", "disable", "--now", label()], { stdio: "ignore" });
    rmSync(unitFile(), { force: true });
  }
}

/** The process that left its number in up.pid, if it still is that process: the number may be someone else's by now. */
export function runningUp() {
  const file = path.join(HOME, "up.pid");
  if (!existsSync(file)) return null;
  const pid = readFileSync(file, "utf8").trim();
  // Windows quotes the program's path when it has a space in it.
  return /agent-autoloop(\.ts)?"? up\b/.test(commandLine(pid)) ? Number(pid) : null;
}

/** Windows has no SIGTERM to catch: `up` looks for this file instead, and goes the same way. */
export const stopFile = () => path.join(HOME, "up.stop");

/** Stopping a service returns before its process is gone, and one started by hand has no service to stop it. */
export function stopUp() {
  const pid = runningUp();
  if (pid === null) return;
  if (WINDOWS) writeFileSync(stopFile(), "");
  else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  // Asking Windows for a command line takes a while; that the number is still in use is enough here.
  const going = () => (WINDOWS ? pidExists(pid) : runningUp() !== null);
  for (let tries = 0; tries < 50 && going(); tries++) pause(100);
  // One that didn't see the file in time is ended; Agents it started aren't part of it and keep going.
  if (WINDOWS && pidExists(pid)) {
    try {
      process.kill(pid);
    } catch {}
  }
  rmSync(stopFile(), { force: true });
}

export function serviceRunning() {
  if (WINDOWS) return runKeyValue().includes(KEEP_UP) && keeper() !== null;
  if (process.platform === "darwin") return existsSync(plistFile()) && launchdHasIt();
  return spawnSync("systemctl", ["--user", "is-active", "--quiet", label()], { stdio: "ignore" }).status === 0;
}
