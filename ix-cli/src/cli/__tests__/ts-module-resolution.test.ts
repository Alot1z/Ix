import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTypeScriptModuleResolver } from "../ts-module-resolution.js";

const workspaces: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "ix-ts-resolution-"));
  workspaces.push(root);
  return root;
}

function write(root: string, relativePath: string, content = ""): string {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return filePath;
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("createTypeScriptModuleResolver", () => {
  it("resolves tsconfig paths before an unrelated same-stem file", () => {
    const root = workspace();
    const config = write(
      root,
      "tsconfig.json",
      `{
      // JSONC comments and trailing commas are valid in tsconfig files.
      "compilerOptions": {
        "baseUrl": ".",
        "paths": { "@core": ["src/adapters/worker"], },
      },
    }`,
    );
    const consumer = write(root, "src/consumer.ts");
    const worker = write(root, "src/adapters/worker.ts");
    const unrelated = write(root, "legacy/core.ts");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer, worker, unrelated]);

    expect(resolve("src/consumer.ts", "@core")).toEqual(["src/adapters/worker.ts"]);
  });

  it("treats an unresolved matching paths rule as authoritative", () => {
    const root = workspace();
    const config = write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { paths: { "@core/*": ["src/core/*"] } },
      }),
    );
    const consumer = write(root, "src/consumer.ts");
    const unrelated = write(root, "legacy/missing.ts");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer, unrelated]);

    expect(resolve("src/consumer.ts", "@core/missing")).toEqual([]);
  });

  it("resolves baseUrl modules", () => {
    const root = workspace();
    const config = write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: "src" },
      }),
    );
    const consumer = write(root, "src/consumer.ts");
    const worker = write(root, "src/services/worker.ts");
    const unrelated = write(root, "vendor/worker.ts");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer, worker, unrelated]);

    expect(resolve("src/consumer.ts", "services/worker")).toEqual(["src/services/worker.ts"]);
  });

  it("treats an unresolved baseUrl module as authoritative", () => {
    const root = workspace();
    const config = write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: "src" },
      }),
    );
    const consumer = write(root, "src/consumer.ts");
    const unrelated = write(root, "legacy/missing.ts");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer, unrelated]);

    expect(resolve("src/consumer.ts", "services/missing")).toEqual([]);
  });

  it("prefers JavaScript for extensionless imports from JavaScript files", () => {
    const root = workspace();
    const config = write(
      root,
      "jsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: "src" },
      }),
    );
    const consumer = write(root, "src/consumer.js");
    const javascript = write(root, "src/services/worker.js");
    const typescript = write(root, "src/services/worker.ts");
    const resolve = createTypeScriptModuleResolver(root, [
      config,
      consumer,
      javascript,
      typescript,
    ]);

    expect(resolve("src/consumer.js", "services/worker")).toEqual(["src/services/worker.js"]);
  });

  it("matches mapped paths case-insensitively on case-insensitive filesystems", () => {
    const root = workspace();
    const config = write(
      root,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@utils": ["src/utils"] } } }),
    );
    const consumer = write(root, "src/consumer.ts");
    const actual = write(root, "src/Utils.ts");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer, actual], {
      caseSensitive: false,
    });

    expect(resolve("src/consumer.ts", "@utils")).toEqual(["src/Utils.ts"]);
  });

  it("selects runtime and declaration targets for mapped JavaScript paths", () => {
    const root = workspace();
    const config = write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { paths: { "@sample/tool": ["lib/index.js"] } },
      }),
    );
    const consumer = write(root, "apps/client.ts");
    const declarations = write(root, "lib/index.d.ts");
    const runtime = write(root, "lib/index.js");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer, declarations, runtime]);

    expect(resolve("apps/client.ts", "@sample/tool", "runtime")).toEqual(["lib/index.js"]);
    expect(resolve("apps/client.ts", "@sample/tool", "types")).toEqual(["lib/index.d.ts"]);
  });
});
