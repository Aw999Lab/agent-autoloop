// install.ps1, in a throwaway home with a PATH of only what it needs. `git` is a stand-in that copies this program, so
// nothing needs committing. Failure cases: the command it writes isn't the one the program knows as its own, or doesn't
// run; the user's PATH is changed when told not to; running it again sets up again; someone's own agent-autoloop.cmd is
// overwritten, or the next step printed doesn't work.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test as nodeTest } from "node:test";
import { COMMAND_LINE, windowsCommandIsOurs } from "../host/platform.ts";

const test = process.platform === "win32" ? nodeTest : nodeTest.skip;
const repo = path.join(import.meta.dirname, "..");
const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "agent-autoloop-install-win-")));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

const copy = path.join(dir, "the-program");
for (const part of ["bin", "cli", "host", "kernel", "plugins", "protocol", "skills", "worker", "package.json"]) {
  cpSync(path.join(repo, part), path.join(copy, part), { recursive: true });
}
const tools = path.join(dir, "tools");
mkdirSync(tools);
writeFileSync(
  path.join(tools, "fake-git.cjs"),
  `const [command, ...rest] = process.argv.slice(2);
if (command === "clone") {
  const to = rest.at(-1);
  require("node:fs").cpSync(${JSON.stringify(copy)}, to, { recursive: true });
  require("node:fs").mkdirSync(require("node:path").join(to, ".git"));
}
`,
);
writeFileSync(path.join(tools, "git.cmd"), '@node "%~dp0fake-git.cjs" %*\r\n');

const system = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
const PATH = [tools, path.dirname(process.execPath), system, path.join(system, "WindowsPowerShell", "v1.0")].join(";");
const userPath = () =>
  spawnSync("reg", ["query", "HKCU\\Environment", "/v", "Path"], { encoding: "utf8", windowsHide: true }).stdout;

function install(root: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, Path: PATH, AGENT_AUTOLOOP_HOME: root };
  delete env.PATH;
  delete env.AGENT_AUTOLOOP_RULES;
  delete env.AGENT_AUTOLOOP_PUBLIC_URL;
  const args = ["--no-path", "--no-service", "--command", "node -e 1", "--port", "3997"];
  const run = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repo, "install.ps1"), ...args],
    { env, encoding: "utf8", timeout: 120_000, windowsHide: true },
  );
  return { ...run, out: `${run.stdout}${run.stderr}` };
}

test("it installs a command the program knows as its own, that runs, and leaves the user's PATH alone", () => {
  const before = userPath();
  const root = path.join(dir, "home");
  const first = install(root);
  assert.equal(first.status, 0, first.out);
  assert.match(first.out, /装好了/);
  const command = path.join(root, "bin", "agent-autoloop.cmd");
  assert.equal(readFileSync(command, "utf8").trim(), COMMAND_LINE);
  assert.ok(windowsCommandIsOurs(command, path.join(root, "app", "bin", "agent-autoloop.ts")));
  const version = spawnSync("cmd.exe", ["/d", "/c", command, "--version"], {
    encoding: "utf8",
    env: { ...process.env, AGENT_AUTOLOOP_HOME: root },
    windowsHide: true,
  });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /agent-autoloop/i);
  assert.equal(userPath(), before, "--no-path");

  const config = readFileSync(path.join(root, "config.json"), "utf8");
  const again = install(root);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /更新好了/);
  assert.equal(readFileSync(path.join(root, "config.json"), "utf8"), config, "not set up a second time");
});

test("someone's own agent-autoloop.cmd stays, and the next step printed is the whole command", () => {
  const root = path.join(dir, "theirs");
  mkdirSync(path.join(root, "bin"), { recursive: true });
  const theirs = "@echo theirs\r\n";
  writeFileSync(path.join(root, "bin", "agent-autoloop.cmd"), theirs);
  const run = install(root);
  assert.equal(run.status, 0, run.out);
  assert.equal(readFileSync(path.join(root, "bin", "agent-autoloop.cmd"), "utf8"), theirs);
  assert.match(run.out, /node --disable-warning=ExperimentalWarning ".*agent-autoloop\.ts"/);
  assert.ok(existsSync(path.join(root, "config.json")));
});
