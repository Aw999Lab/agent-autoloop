// What Windows needs to start a program, checked on every platform: the name is found with the extension Windows wants;
// an npm .cmd becomes the node script it runs, so no shell ever reads a prompt; a #! script for node is run by node; a
// shell script is refused, not handed to something that would read it differently. The .cmd install.ps1 writes is ours
// only if it is exactly that line and leads to this program.
// Failure cases: a .cmd is run through cmd.exe; a script that isn't node's is run by node; someone else's .cmd is taken.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { COMMAND_LINE, findOnPath, windowsCommand, windowsCommandIsOurs } from "../host/platform.ts";

const dir = mkdtempSync(path.join(tmpdir(), "agent-autoloop-platform-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const env = (...places: string[]) => ({ PATH: places.join(path.delimiter) });

const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
IF EXIST "%dp0%\\node.exe" (SET "_prog=%dp0%\\node.exe") ELSE (SET "_prog=node")
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`;

test("a name is found on PATH with the extension Windows needs, in PATH's order", () => {
  const first = path.join(dir, "first");
  const second = path.join(dir, "second");
  mkdirSync(first);
  mkdirSync(second);
  writeFileSync(path.join(first, "tool.cmd"), "@echo off\n");
  writeFileSync(path.join(second, "tool.exe"), "");
  writeFileSync(path.join(second, "other.exe"), "");
  assert.equal(findOnPath("tool", env(first, second)), path.join(first, "tool.cmd"), "PATH order comes first");
  assert.equal(findOnPath("other", env(first, second)), path.join(second, "other.exe"));
  assert.equal(findOnPath("missing", env(first, second)), null);
  // A bare name without an extension is a Unix script, which Windows can't start.
  writeFileSync(path.join(first, "bare"), "#!/bin/sh\n");
  assert.equal(findOnPath("bare", env(first)), null);
});

test("an npm .cmd becomes the node script it runs; the prompt is only ever an argument", () => {
  const bin = path.join(dir, "npm");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "codex.cmd"), NPM_SHIM);
  const prompt = 'say "hi" & del /q * %PATH% $(touch x)';
  assert.deepEqual(windowsCommand(["codex", "exec", prompt], env(bin)), [
    process.execPath,
    path.join(bin, "node_modules\\@openai\\codex\\bin\\codex.js"),
    "exec",
    prompt,
  ]);
  // A .cmd that isn't npm's would need cmd.exe, which reads its arguments as commands.
  writeFileSync(path.join(bin, "own.cmd"), "@echo %1\n");
  assert.throws(() => windowsCommand(["own", prompt], env(bin)), /不能直接运行/);
  assert.throws(() => windowsCommand(["nowhere"], env(bin)), /找不到 nowhere/);
});

test("a #! script is run by node only if node is what it names", () => {
  const scripts = path.join(dir, "scripts");
  mkdirSync(scripts);
  for (const [name, line] of [
    ["env", "#!/usr/bin/env node"],
    ["spaced", "#!C:\\Program Files\\nodejs\\node.exe"],
    ["unix", "#!/usr/local/bin/node --flag"],
  ]) {
    const file = path.join(scripts, name);
    writeFileSync(file, `${line}\nconsole.log(1)\n`);
    assert.deepEqual(windowsCommand([file, "a"], {}), [process.execPath, file, "a"], line);
  }
  for (const line of ["#!/bin/sh", "#!/usr/bin/env python3", "#!/opt/nodely/bin/bash", "console.log(1)"]) {
    const file = path.join(scripts, "other");
    writeFileSync(file, `${line}\n`);
    assert.throws(() => windowsCommand([file], {}), /不能直接运行/, line);
  }
});

test("the .cmd install.ps1 writes is ours only when it is that line and leads here", () => {
  const home = path.join(dir, "home");
  const program = path.join(home, "app", "bin", "agent-autoloop.ts");
  mkdirSync(path.dirname(program), { recursive: true });
  mkdirSync(path.join(home, "bin"));
  writeFileSync(program, "");
  const command = path.join(home, "bin", "agent-autoloop.cmd");
  writeFileSync(command, `${COMMAND_LINE}\r\n`);
  assert.ok(windowsCommandIsOurs(command, program));
  const elsewhere = path.join(dir, "elsewhere.ts");
  writeFileSync(elsewhere, "");
  assert.ok(!windowsCommandIsOurs(command, elsewhere), "it leads to another install");
  writeFileSync(command, `${COMMAND_LINE}\r\n@echo and more\r\n`);
  assert.ok(!windowsCommandIsOurs(command, program), "someone changed it");
  assert.ok(!windowsCommandIsOurs(path.join(home, "bin", "none.cmd"), program));
  const installer = readFileSync(path.join(import.meta.dirname, "..", "install.ps1"), "utf8");
  assert.ok(installer.includes(`$Line = '${COMMAND_LINE}'`), "install.ps1 writes the same line");
});
