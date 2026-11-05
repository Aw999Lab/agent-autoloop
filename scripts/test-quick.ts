// `npm run test:quick`: every test file but the simulation. The file list is made here, not by a shell, because npm runs
// package scripts with cmd.exe on Windows, where `$(ls … | grep …)` is not understood and the whole suite would run.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const files = readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.ts") && name !== "simulation.test.ts")
  .sort()
  .map((name) => path.join("tests", name));

const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--test", ...files], {
  cwd: root,
  stdio: "inherit",
});
process.exit(run.status ?? 1);
