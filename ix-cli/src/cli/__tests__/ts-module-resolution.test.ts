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

  it("substitutes wildcard text without interpreting replacement tokens", () => {
    const root = workspace();
    const config = write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { paths: { "@core/*": ["src/core/*"] } },
      }),
    );
    const consumer = write(root, "src/consumer.ts");
    const target = write(root, "src/core/$&.ts");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer, target]);

    expect(resolve("src/consumer.ts", "@core/$&")).toEqual(["src/core/$&.ts"]);
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

  it("does not treat an unresolved baseUrl module as authoritative", () => {
    // `baseUrl` matches every bare specifier, so its miss carries no information.
    // Returning [] here tells the resolver "definitively not local", which drops
    // the edge; `undefined` means "no opinion" and lets the stem fallback run.
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

    expect(resolve("src/consumer.ts", "services/missing")).toBeUndefined();
  });

  it("keeps third-party specifiers unresolved rather than authoritative under baseUrl", () => {
    // The regression this guards: `baseUrl: "."` is the default in Next.js, CRA
    // and most monorepo templates. Claiming authority over `react` there erased
    // every third-party import edge in the graph.
    const root = workspace();
    const config = write(
      root,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: "." } }),
    );
    const consumer = write(root, "packages/app/index.ts");
    const sibling = write(root, "packages/lib/index.ts");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer, sibling]);

    expect(resolve("packages/app/index.ts", "react")).toBeUndefined();
    expect(resolve("packages/app/index.ts", "@org/lib")).toBeUndefined();
  });

  it("does not treat a catch-all paths rule as authoritative", () => {
    // `"*": ["src/*"]` matches every specifier, so it is baseUrl by another name.
    const root = workspace();
    const config = write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { paths: { "*": ["src/*"] } },
      }),
    );
    const consumer = write(root, "src/consumer.ts");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer]);

    expect(resolve("src/consumer.ts", "lodash")).toBeUndefined();
  });

  it("falls back to baseUrl when a matching paths rule resolves nothing", () => {
    // TypeScript tries `paths` first, then `baseUrl`. A failed rule must not
    // short-circuit the baseUrl lookup.
    const root = workspace();
    const config = write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: "src", paths: { "@core/*": ["missing/*"] } },
      }),
    );
    const consumer = write(root, "src/consumer.ts");
    const actual = write(root, "src/@core/thing.ts");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer, actual]);

    expect(resolve("src/consumer.ts", "@core/thing")).toEqual(["src/@core/thing.ts"]);
  });

  it("follows a relative extends that names a directory", () => {
    // Previously an existsSync probe stopped at the directory itself and never
    // tried <dir>/tsconfig.json, so the parent's paths were silently dropped.
    const root = workspace();
    write(
      root,
      "cfg/tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@core": ["src/worker"] } } }),
    );
    const config = write(root, "tsconfig.json", JSON.stringify({ extends: "./cfg" }));
    const consumer = write(root, "src/consumer.ts");
    // `paths` in an extended config resolve against the config that declares them.
    const worker = write(root, "cfg/src/worker.ts");
    const resolve = createTypeScriptModuleResolver(root, [config, consumer, worker]);

    expect(resolve("src/consumer.ts", "@core")).toEqual(["cfg/src/worker.ts"]);
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

  it("does not serve one caller's language preference to another in the same directory", () => {
    // Guards the memo key: results are cached, and callers in the same folder
    // share a config but not a preference order. Keying on the directory alone
    // would hand the .js answer to the .ts caller, or whichever ran first.
    const root = workspace();
    const config = write(
      root,
      "jsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
    );
    const jsConsumer = write(root, "src/consumer.js");
    const tsConsumer = write(root, "src/consumer.ts");
    const javascript = write(root, "src/services/worker.js");
    const typescript = write(root, "src/services/worker.ts");
    const resolve = createTypeScriptModuleResolver(root, [
      config,
      jsConsumer,
      tsConsumer,
      javascript,
      typescript,
    ]);

    // Order matters: whichever runs first would poison a directory-only key.
    expect(resolve("src/consumer.js", "services/worker")).toEqual(["src/services/worker.js"]);
    expect(resolve("src/consumer.ts", "services/worker")).toEqual(["src/services/worker.ts"]);
    // And repeated asks, which is what the cache exists for, stay stable.
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
