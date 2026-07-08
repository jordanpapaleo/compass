import { describe, expect, it } from "vitest";
import { getGitContext, parseShortstat } from "./git.ts";

describe("parseShortstat", () => {
  it("parses full shortstat lines", () => {
    expect(parseShortstat(" 3 files changed, 42 insertions(+), 7 deletions(-)")).toEqual({
      changed_files: 3,
      insertions: 42,
      deletions: 7,
    });
  });
  it("handles singular forms and missing parts", () => {
    expect(parseShortstat(" 1 file changed, 1 insertion(+)")).toEqual({
      changed_files: 1,
      insertions: 1,
      deletions: 0,
    });
    expect(parseShortstat("")).toEqual({ changed_files: 0, insertions: 0, deletions: 0 });
  });
});

describe("getGitContext", () => {
  it("returns null without a cwd", async () => {
    expect(await getGitContext(undefined)).toBeNull();
  });
  it("returns null for a non-repo directory", async () => {
    expect(await getGitContext("/tmp")).toBeNull();
  });
  it("reads real facts from this repo", async () => {
    const ctx = await getGitContext(process.cwd());
    expect(ctx).not.toBeNull();
    expect(typeof ctx?.branch).toBe("string");
    expect(ctx?.branch.length).toBeGreaterThan(0);
  });
});
