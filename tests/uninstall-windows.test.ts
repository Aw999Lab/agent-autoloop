// `agent-autoloop uninstall` on Windows, from a copy of the program laid out as install.ps1 leaves it, in a throwaway home.
// The home is not the default one, so the startup entry it looks for is one only this test could have made: the real one
// can't be reached. Failure cases: the agent-autoloop.cmd install.ps1 wrote is left behind; someone's own agent-autoloop.cmd
// of the same name, on PATH or beside it, is removed; the data is deleted; the installed code is left; a Skill link that
// leads somewhere else is removed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test as nodeTest } from "node:test";
import { COMMAND_LINE } from "../host/platform.ts";

const test = process.platform === "win32" ? nodeTest : nodeTest.skip;
const repo = join(import.meta.dirname, "..");
const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-autoloop-uninstall-win-")));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

test("it takes away the command install.ps1 wrote and nothing else, and the data stays", () => {
  const person = join(dir, "person");
  const hub = join(person, "hub");
  const app = join(hub, "app");
  for (const part of ["bin", "cli", "host", "kernel", "plugins", "protocol", "skills", "worker", "package.json"]) {
    cpSync(join(repo, part), join(app, part), { recursive: true });
  }
  mkdirSync(join(hub, "bin"), { recursive: true });
  writeFileSync(join(hub, "bin", "agent-autoloop.cmd"), `${COMMAND_LINE}\r\n`);
  const theirs = join(person, "theirs");
  mkdirSync(theirs);
  writeFileSync(join(theirs, "agent-autoloop.cmd"), "@echo mine\r\n");
  // Looks the same, but runs some other program.
  const lookalike = join(person, "lookalike");
  mkdirSync(lookalike);
  writeFileSync(
    join(lookalike, "agent-autoloop.cmd"),
    `@node --disable-warning=ExperimentalWarning "C:\elsewhere\agent-autoloop.ts" %*\r\n`,
  );

  const system = join(process.env.SystemRoot ?? "C:\Windows", "System32");
  const env: NodeJS.ProcessEnv = { ...process.env, USERPROFILE: person, AGENT_AUTOLOOP_HOME: hub };
  delete env.PATH;
  env.Path = [theirs, lookalike, join(hub, "bin"), system].join(";");
  for (const name of ["AGENT_AUTOLOOP_RULES", "AGENT_AUTOLOOP_PUBLIC_URL"]) delete env[name];
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", join(app, "bin", "agent-autoloop.ts"), ...args],
      {
        env,
        encoding: "utf8",
        timeout: 60_000,
        windowsHide: true,
      },
    );
  const set = run("init", "--no-service", "--command", "node -e 1", "--port", "3999");
  assert.equal(set.status, 0, set.stderr);

  const done = run("uninstall", "--yes");
  assert.equal(done.status, 0, done.stderr);
  assert.ok(!existsSync(join(hub, "bin", "agent-autoloop.cmd")), "its own command is gone");
  assert.equal(readFileSync(join(theirs, "agent-autoloop.cmd"), "utf8"), "@echo mine\r\n");
  assert.ok(existsSync(join(lookalike, "agent-autoloop.cmd")), "one that runs something else stays");
  assert.ok(existsSync(join(hub, "config.json")), "the data stays");
  assert.match(done.stdout, /规则、密钥和记录还留在/);
  assert.ok(!existsSync(app), "the installed code is removed");
});
