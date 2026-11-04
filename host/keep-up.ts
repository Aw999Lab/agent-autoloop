// What launchd and systemd do for `up`, for Windows: start it at login and again 10 seconds after it stops. Windows starts
// this from the user's Run key, which can't set a variable, so the install it keeps running comes as the one argument.
//   node keep-up.ts <AGENT_AUTOLOOP_HOME>
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { commandLine } from "./platform.ts";

const home = process.argv[2];
if (!home) throw new Error("usage: keep-up.ts <AGENT_AUTOLOOP_HOME>");
const PROGRAM = path.join(import.meta.dirname, "..", "bin", "agent-autoloop.ts");
const pidFile = path.join(home, "keep-up.pid");

/** One keeper per install: a second one would start `up` beside the first, which `up` refuses anyway. */
function another() {
  try {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    return pid !== process.pid && commandLine(pid).includes("keep-up.ts");
  } catch {
    return false;
  }
}

if (!another()) {
  writeFileSync(pidFile, String(process.pid));
  mkdirSync(path.join(home, "logs"), { recursive: true });
  const log = path.join(home, "logs", "up.log");
  const start = () => {
    const output = openSync(log, "a");
    const up = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", PROGRAM, "up"], {
      env: { ...process.env, AGENT_AUTOLOOP_HOME: home },
      stdio: ["ignore", output, output],
      windowsHide: true,
    });
    // A program that can't start reports an error, and may report an exit too.
    let ended = false;
    const again = () => {
      if (ended) return;
      ended = true;
      closeSync(output);
      setTimeout(start, 10_000);
    };
    up.on("error", again);
    up.on("exit", again);
  };
  start();
}
