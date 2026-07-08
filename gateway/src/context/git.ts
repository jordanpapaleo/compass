/**
 * Git context provider — Day 2.
 *
 * Given a working directory (clients pass `x-compass-cwd`; IDEs know their
 * project root), collect cheap facts about the repo state: branch, dirtiness,
 * diff size. The router folds these into decisions (e.g. a huge working diff
 * escalates pr-review), and every fact lands in the explanation trail.
 *
 * Fail-soft by design: no cwd, not a repo, git missing, or a slow command →
 * null context, never a failed request. Context should improve routing, not
 * gate it.
 */

import { execFile } from "node:child_process";

export interface GitContext {
  branch: string;
  /** Uncommitted changes present (staged or unstaged). */
  dirty: boolean;
  /** Files changed in the working tree vs HEAD. */
  changed_files: number;
  insertions: number;
  deletions: number;
}

const GIT_TIMEOUT_MS = 1500;

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, encoding: "utf8" },
      (err, stdout) => resolve(err ? null : stdout.trim()),
    );
  });
}

/** Parse `git diff --shortstat` output like " 3 files changed, 42 insertions(+), 7 deletions(-)" */
export function parseShortstat(s: string): Pick<GitContext, "changed_files" | "insertions" | "deletions"> {
  const files = /(\d+) files? changed/.exec(s);
  const ins = /(\d+) insertions?\(\+\)/.exec(s);
  const del = /(\d+) deletions?\(-\)/.exec(s);
  return {
    changed_files: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}

export async function getGitContext(cwd: string | undefined): Promise<GitContext | null> {
  if (!cwd) return null;

  const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === null) return null; // not a repo / git unavailable

  const [shortstat, status] = await Promise.all([
    git(cwd, ["diff", "HEAD", "--shortstat"]),
    git(cwd, ["status", "--porcelain"]),
  ]);

  const stat = parseShortstat(shortstat ?? "");
  return {
    branch,
    dirty: Boolean(status && status.length > 0),
    ...stat,
  };
}
