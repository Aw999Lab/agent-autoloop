// What /bin/sh does for an agent on Mac and Linux, for Windows: run the command with its output going to two files, and
// publish the exit code in a third, so all three are there even if the worker has gone by then.
//   node run-turn.ts <marker> <stdout file> <stderr file> <exit file> <program> [args...]
// The marker is only a name for this turn to be found by in a process list.
import { spawn } from "node:child_process";
import { closeSync, openSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { resolveCommand } from "../host/platform.ts";

const [, , , out, err, exit, ...argv] = process.argv;

/** Published whole or not at all: the worker reads this file as soon as it exists. */
let published = false;
function publish(code: number) {
  // A program that can't start reports both an error and a close.
  if (published) return;
  published = true;
  writeFileSync(`${exit}.tmp`, `${code}\n`);
  renameSync(`${exit}.tmp`, exit);
}

// The worker can't cheaply ask Windows what a process number is now, so this file's age says this wrapper is still here.
const beat = `${exit}.beat`;
const touch = () => {
  try {
    const now = new Date();
    utimesSync(beat, now, now);
  } catch {}
};
touch();
setInterval(touch, 5000).unref();

const stdout = openSync(out, "w");
const stderr = openSync(err, "w");
try {
  const [program, ...args] = resolveCommand(argv);
  const child = spawn(program, args, { stdio: ["ignore", stdout, stderr], windowsHide: true });
  child.on("error", (error) => {
    writeFileSync(err, `${error.message}\n`, { flag: "a" });
    publish(127);
  });
  // A program killed from outside has no code; any number but 0 says it didn't finish.
  child.on("close", (code) => {
    closeSync(stdout);
    closeSync(stderr);
    publish(code ?? 1);
  });
} catch (error) {
  writeFileSync(err, `${(error as Error).message}\n`, { flag: "a" });
  publish(127);
}
