import * as fs from "node:fs";
import * as nodePath from "node:path";

interface PathRule {
  pattern: string;
  targets: string[];
  baseDir: string;
}

interface LoadedConfig {
  dir: string;
  baseUrl?: string;
  paths: PathRule[];
}

export type TypeScriptModuleResolver = (
  sourcePath: string,
  specifier: string,
  kind?: "runtime" | "types",
) => string[] | undefined;

const SOURCE_SUFFIXES = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];

function normalizePath(value: string): string {
  return nodePath.posix.normalize(value.replace(/\\/g, "/"));
}

function isWithinDir(filePath: string, dir: string): boolean {
  return dir === "." || filePath === dir || filePath.startsWith(`${dir}/`);
}

function toggleFirstAsciiCase(value: string): string | undefined {
  const index = value.search(/[A-Za-z]/);
  if (index === -1) return undefined;
  const char = value[index];
  const toggled = char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
  return value.slice(0, index) + toggled + value.slice(index + 1);
}

function isCaseSensitiveFilesystem(workspaceRoot: string, absoluteFilePaths: string[]): boolean {
  for (const candidate of [...absoluteFilePaths, workspaceRoot]) {
    const basename = nodePath.basename(candidate);
    const toggled = toggleFirstAsciiCase(basename);
    if (!toggled || toggled === basename) continue;
    const alternate = nodePath.join(nodePath.dirname(candidate), toggled);
    try {
      return fs.realpathSync.native(candidate) !== fs.realpathSync.native(alternate);
    } catch {
      return true;
    }
  }
  return true;
}

function parseJsonc(text: string): unknown {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      } else {
        output += " ";
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        output += "  ";
        blockComment = false;
        i += 1;
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      lineComment = true;
      output += "  ";
      i += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      output += "  ";
      i += 1;
    } else {
      output += char;
    }
  }

  let normalized = "";
  inString = false;
  escaped = false;
  for (let i = 0; i < output.length; i += 1) {
    const char = output[i];
    if (inString) {
      normalized += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      normalized += char;
      continue;
    }
    if (char === ",") {
      let next = i + 1;
      while (/\s/.test(output[next] ?? "")) next += 1;
      if (output[next] === "}" || output[next] === "]") continue;
    }
    normalized += char;
  }

  return JSON.parse(normalized);
}

function readObject(filePath: string): Record<string, unknown> | undefined {
  try {
    const parsed = parseJsonc(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveExtends(configPath: string, value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith(".")) return undefined;
  const unresolved = nodePath.resolve(nodePath.dirname(configPath), value);
  const candidates = [unresolved, `${unresolved}.json`, nodePath.join(unresolved, "tsconfig.json")];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function loadConfig(
  workspaceRoot: string,
  configPath: string,
  cache: Map<string, LoadedConfig | undefined>,
  loading = new Set<string>(),
): LoadedConfig | undefined {
  const absoluteConfig = nodePath.resolve(configPath);
  if (cache.has(absoluteConfig)) return cache.get(absoluteConfig);
  if (loading.has(absoluteConfig)) return undefined;
  loading.add(absoluteConfig);

  const raw = readObject(absoluteConfig);
  if (!raw) {
    cache.set(absoluteConfig, undefined);
    loading.delete(absoluteConfig);
    return undefined;
  }

  const parentPath = resolveExtends(absoluteConfig, raw.extends);
  const parent = parentPath ? loadConfig(workspaceRoot, parentPath, cache, loading) : undefined;
  const configDir = nodePath.dirname(absoluteConfig);
  const compilerOptions =
    raw.compilerOptions && typeof raw.compilerOptions === "object"
      ? (raw.compilerOptions as Record<string, unknown>)
      : {};
  const ownBaseUrl =
    typeof compilerOptions.baseUrl === "string"
      ? nodePath.resolve(configDir, compilerOptions.baseUrl)
      : undefined;
  const baseUrl = ownBaseUrl ?? parent?.baseUrl;
  let paths = parent?.paths ?? [];
  if (compilerOptions.paths && typeof compilerOptions.paths === "object") {
    const pathBase = baseUrl ?? configDir;
    paths = Object.entries(compilerOptions.paths as Record<string, unknown>)
      .filter(
        (entry): entry is [string, string[]] =>
          Array.isArray(entry[1]) && entry[1].every((target) => typeof target === "string"),
      )
      .map(([pattern, targets]) => ({ pattern, targets, baseDir: pathBase }))
      .sort((a, b) => {
        const aStar = a.pattern.indexOf("*");
        const bStar = b.pattern.indexOf("*");
        if (aStar === -1 || bStar === -1) return aStar === -1 ? -1 : 1;
        return bStar - aStar;
      });
  }

  const relativeDir = normalizePath(nodePath.relative(workspaceRoot, configDir) || ".");
  const loaded = { dir: relativeDir, baseUrl, paths };
  cache.set(absoluteConfig, loaded);
  loading.delete(absoluteConfig);
  return loaded;
}

function matchPathPattern(pattern: string, specifier: string): string | undefined {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : undefined;
  if (pattern.indexOf("*", star + 1) !== -1) return undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return specifier.startsWith(prefix) && specifier.endsWith(suffix)
    ? specifier.slice(prefix.length, specifier.length - suffix.length)
    : undefined;
}

export function createTypeScriptModuleResolver(
  workspaceRoot: string,
  absoluteFilePaths: string[],
  options: { caseSensitive?: boolean } = {},
): TypeScriptModuleResolver {
  const root = nodePath.resolve(workspaceRoot);
  const caseSensitive =
    options.caseSensitive ?? isCaseSensitiveFilesystem(root, absoluteFilePaths);
  const pathKey = (value: string): string => {
    const normalized = normalizePath(value);
    return caseSensitive ? normalized : normalized.toLowerCase();
  };
  const indexed = new Map(
    absoluteFilePaths.map((filePath) => {
      const relativePath = normalizePath(nodePath.relative(root, nodePath.resolve(filePath)));
      return [pathKey(relativePath), relativePath];
    }),
  );

  const resolveCandidate = (
    absoluteTarget: string,
    sourcePath: string,
    kind: "runtime" | "types",
  ): string[] => {
    const relativeTarget = normalizePath(nodePath.relative(root, absoluteTarget));
    const extension = nodePath.posix.extname(relativeTarget).toLowerCase();
    const base = extension ? relativeTarget.slice(0, -extension.length) : relativeTarget;
    const sourceExtension = nodePath.posix.extname(normalizePath(sourcePath)).toLowerCase();
    const preferJavaScript = [".js", ".jsx", ".mjs", ".cjs"].includes(sourceExtension);
    const extensionlessSuffixes =
      kind === "types"
        ? SOURCE_SUFFIXES
        : preferJavaScript
          ? [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".d.ts"]
          : [".ts", ".tsx", ".js", ".jsx", ".d.ts", ".mjs", ".cjs"];
    const candidates =
      extension === ".js"
        ? kind === "types"
          ? [base + ".ts", base + ".tsx", base + ".d.ts", relativeTarget, base + ".jsx"]
          : preferJavaScript
            ? [relativeTarget, base + ".jsx", base + ".ts", base + ".tsx", base + ".d.ts"]
            : [base + ".ts", base + ".tsx", relativeTarget, base + ".jsx", base + ".d.ts"]
        : extension === ".jsx"
          ? kind === "types"
            ? [base + ".tsx", base + ".d.ts", relativeTarget]
            : preferJavaScript
              ? [relativeTarget, base + ".tsx", base + ".d.ts"]
              : [base + ".tsx", relativeTarget, base + ".d.ts"]
          : extension
            ? [relativeTarget]
            : [
                ...extensionlessSuffixes.map((suffix) => relativeTarget + suffix),
                ...extensionlessSuffixes.map((suffix) =>
                  nodePath.posix.join(relativeTarget, "index" + suffix),
                ),
              ];
    const match = candidates.map((candidate) => indexed.get(pathKey(candidate))).find(Boolean);
    return match ? [match] : [];
  };

  const configCache = new Map<string, LoadedConfig | undefined>();
  const configs = absoluteFilePaths
    .filter((filePath) => /(?:^|[/\\])(?:tsconfig|jsconfig)\.json$/i.test(filePath))
    .map((filePath) => loadConfig(root, filePath, configCache))
    .filter((config): config is LoadedConfig => config !== undefined)
    .sort((a, b) => b.dir.length - a.dir.length);

  return (sourcePath: string, rawSpecifier: string, kind = "runtime"): string[] | undefined => {
    const specifier = rawSpecifier.split(/[?#]/, 1)[0];
    if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) return undefined;
    const normalizedSource = normalizePath(sourcePath);
    const config = configs.find((candidate) => isWithinDir(normalizedSource, candidate.dir));
    if (config) {
      for (const rule of config.paths) {
        const star = matchPathPattern(rule.pattern, specifier);
        if (star === undefined) continue;
        for (const target of rule.targets) {
          const matches = resolveCandidate(
            nodePath.resolve(rule.baseDir, target.split("*").join(star)),
            sourcePath,
            kind,
          );
          if (matches.length > 0) return matches;
        }
        return [];
      }
      if (config.baseUrl) {
        const matches = resolveCandidate(
          nodePath.resolve(config.baseUrl, specifier),
          sourcePath,
          kind,
        );
        if (matches.length > 0) return matches;
      }
    }
    return config?.baseUrl ? [] : undefined;
  };
}
