import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(ts|tsx)$/.test(name)
        ? [path]
        : [];
  });
}

describe("Naira-only customer and admin UI", () => {
  it("does not render dollar-sign icon components", () => {
    const roots = [join(process.cwd(), "app"), join(process.cwd(), "components")];
    const source = roots
      .flatMap(sourceFiles)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(source).not.toMatch(/(?:Badge|Circle)DollarSign/);
  });
});
