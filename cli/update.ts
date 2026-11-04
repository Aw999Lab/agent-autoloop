// `agent-autoloop update`: what's installed from the public repository follows its releases, which have passed every check,
// not main, which may not have yet. A copy from any other repository follows that repository, as it was installed.
import { spawnSync } from "node:child_process";

const PUBLISHED = "https://github.com/KKKKhazix/agent-autoloop.git";
const RELEASE = /refs\/tags\/(v(\d+)\.(\d+)\.(\d+))$/;

function git(root: string, ...args: string[]) {
  const done = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (done.status !== 0) throw new Error(`git ${args[0]} 没成功：${done.stderr.trim()}`);
  return done.stdout.trim();
}

function latestRelease(root: string) {
  if (git(root, "config", "--get", "remote.origin.url") !== PUBLISHED) return null;
  const releases = git(root, "ls-remote", "--refs", "--tags", "origin", "v*")
    .split("\n")
    .flatMap((line) => {
      const found = RELEASE.exec(line);
      return found ? [{ tag: found[1], version: found.slice(2).map(Number) }] : [];
    });
  const newer = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return releases.sort((a, b) => newer(a.version, b.version)).at(-1)?.tag ?? null;
}

/** Brings this copy up to date. `to` is the release it's now at, if it follows releases. */
export function updateCode(root: string) {
  const before = git(root, "rev-parse", "HEAD");
  const to = latestRelease(root);
  if (to) {
    git(root, "fetch", "--quiet", "--depth", "1", "origin", `refs/tags/${to}:refs/tags/${to}`);
    git(root, "checkout", "--quiet", "--detach", to);
  } else git(root, "pull", "--quiet", "--ff-only");
  return { changed: git(root, "rev-parse", "HEAD") !== before, to };
}
