// The few things that differ on Windows: finding and starting programs, looking at a process, stopping a tree of them.
// Everywhere else this is plain Node, so each function here is a no-op or the obvious POSIX call there.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export const WINDOWS = process.platform === "win32";
/** What Windows runs directly, in the order it prefers them. A bare name with none of these is a Unix script. */
const RUNNABLE = [".exe", ".com", ".cmd", ".bat"];

/** The tools Windows ships, by their own path: what a PATH has in it can neither hide them nor stand in for them. */
export const system32 = (...parts: string[]) => path.join(process.env.SystemRoot ?? "C:\Windows", "System32", ...parts);

/** A program by name on PATH (or at a path), with the extension Windows needs. Null if there is none. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const hasDirectory = /[\\/]/.test(name);
  const places = hasDirectory ? [""] : (env.Path ?? env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const given = path.extname(name).toLowerCase();
  // A path given whole may be a script with a #! line, which has no extension to add.
  const names = RUNNABLE.includes(given)
    ? [name]
    : [...RUNNABLE.map((ext) => name + ext), ...(hasDirectory ? [name] : [])];
  for (const place of places) {
    for (const candidate of names) {
      const file = hasDirectory ? candidate : path.join(place, candidate);
      if (existsSync(file) && statSync(file).isFile()) return file;
    }
  }
  return null;
}

/**
 * npm installs a command as a .cmd that runs `node <script>`. Windows can't start a .cmd without a shell, and a shell
 * would read the prompt as commands, so go straight to what the .cmd runs.
 */
function npmShim(file: string): string[] | null {
  const script = /"%dp0%\\([^"]+\.[cm]?js)"/i.exec(readFileSync(file, "utf8"))?.[1];
  return script ? [process.execPath, path.join(path.dirname(file), script)] : null;
}

/** A script whose #! line names node, as a Mac or Linux would run it. */
function nodeScript(file: string): string[] | null {
  const first = readFileSync(file, "utf8").split("\n", 1)[0].trim();
  if (!first.startsWith("#!")) return null;
  // `/usr/bin/env node`, `/usr/local/bin/node`, or `C:\Program Files\nodejs\node.exe` with its space.
  return /(?:^|[\\/\s])node(?:\.exe)?(?:\s|$)/i.test(first.slice(2)) ? [process.execPath, file] : null;
}

/** argv ready for CreateProcess: the program found, a .cmd from npm turned into the node script it runs. */
export function resolveCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  return WINDOWS ? windowsCommand(argv, env) : argv;
}

/** What resolveCommand does on Windows; on its own so it can be checked anywhere. */
export function windowsCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const [program, ...rest] = argv;
  const file = findOnPath(program, env);
  if (!file) throw new Error(`找不到 ${program}：先装好，并确认它在 PATH 里`);
  if (/\.(exe|com)$/i.test(file)) return [file, ...rest];
  const shim = /\.(cmd|bat)$/i.test(file) ? npmShim(file) : nodeScript(file);
  if (!shim) throw new Error(`Windows 上不能直接运行 ${file}：请改用 .exe、npm 装的命令或 node 脚本`);
  return [...shim, ...rest];
}

/** The one line install.ps1 writes, relative to where it is so the console's code page doesn't matter. */
export const COMMAND_LINE = '@node --disable-warning=ExperimentalWarning "%~dp0..\\app\\bin\\agent-autoloop.ts" %*';

/** Whether a .cmd is the one install.ps1 wrote, and leads to this program. */
export function windowsCommandIsOurs(file: string, program: string) {
  try {
    if (!/\.cmd$/i.test(file) || readFileSync(file, "utf8").trim() !== COMMAND_LINE) return false;
    const leadsTo = path.join(path.dirname(file), "..", "app", "bin", "agent-autoloop.ts");
    return realpathSync(leadsTo) === realpathSync(program);
  } catch {
    return false;
  }
}

export function pidExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // No permission to signal it still means it is there.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The command line a process was started with, or "" if there is no such process. */
export function commandLine(pid: number | string) {
  const number = Number(pid);
  if (!Number.isInteger(number) || number <= 0) return "";
  try {
    if (WINDOWS) {
      return execFileSync(
        system32("WindowsPowerShell", "v1.0", "powershell.exe"),
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${number}').CommandLine`,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 20_000 },
      );
    }
    return execFileSync("ps", ["-p", String(number), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/** Ends a process and everything it started. There is no polite version of this for a program without a window. */
export function killTree(pid: number) {
  spawnSync(system32("taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
}
