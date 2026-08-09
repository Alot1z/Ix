import * as fs from "node:fs";
import * as path from "node:path";
import { IxClient } from "../client/api.js";
import { SUPPORTED_EXTENSIONS } from "./supported-extensions.js";
import { lastIngestAtFor, loadIngestMtimeCache, resolveWorkspaceRoot } from "./config.js";

export interface StaleInfo {
  lastIngestAt: string | null;
  currentRev: number;
  staleFiles: number;
  sampleChangedFiles: string[];
}

const SUPPORTED_NAMES = new Set([
  ".gitignore", ".gitattributes", ".editorconfig", ".env",
  ".eslintrc", ".prettierrc", ".babelrc",
  "Makefile", "Dockerfile", "Procfile", "Gemfile", "Rakefile",
  "BUILD", "WORKSPACE",
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", ".next",
  ".cache", "__pycache__", ".ix", ".claude",
]);

/**
 * Walk a directory and collect file paths with supported extensions.
 * Bounded to prevent runaway on huge repos.
 */
function collectFiles(dir: string, limit: number = 5000): string[] {
  const results: string[] = [];
  const stack = [dir];

  while (stack.length > 0 && results.length < limit) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= limit) break;
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext) || SUPPORTED_NAMES.has(entry.name)) {
          results.push(fullPath);
        }
      }
    }
  }
  return results;
}

/**
 * Whether a file differs from what this workspace's last ingest recorded.
 *
 * Exact inequality, not "newer than": this is the same test ingest applies when
 * deciding what to re-parse (`mtimeCache.get(path) === mtime` => skip), so
 * status and map cannot disagree about a given file. A path absent from the
 * baseline is new, and new is stale.
 */
function differsFromBaseline(filePath: string, baseline: Map<string, number>): boolean {
  try {
    return baseline.get(filePath) !== fs.statSync(filePath).mtimeMs;
  } catch {
    return false; // inaccessible: not something the user can act on
  }
}

/**
 * Detect files modified since this workspace was last ingested.
 *
 * Compares against the per-root ingest record, not the patch log. The patch log
 * carries no workspace — a patch document has no workspace field at all — so
 * `listPatches({limit: 1})` returns whatever workspace was mapped most recently
 * *anywhere on the machine*. Mapping an unrelated repo therefore advanced the
 * timestamp this compared against, and every file in the workspace you were
 * actually asking about fell behind it and was reported current. The filesystem
 * scan was correctly rooted the whole time; only the thing it compared to was
 * global.
 *
 * `currentRev` stays global on purpose. It is the graph's revision counter,
 * shared by every workspace, and reporting it is not the bug — reporting
 * another workspace's *staleness* was.
 */
export async function detectStaleFiles(
  client: IxClient,
  root: string,
  maxSamples: number = 5
): Promise<StaleInfo> {
  const patches = await client.listPatches({ limit: 1 });
  const currentRev = patches[0]?.rev ?? 0;

  const lastIngest = lastIngestAtFor(root);
  if (!lastIngest) {
    // This root has no ingest record, so there is no baseline to be stale
    // against. Saying "0 changed" matches what the old code did with an empty
    // patch log, and beats inventing a number from a baseline that is not ours.
    return { lastIngestAt: null, currentRev, staleFiles: 0, sampleChangedFiles: [] };
  }

  const baseline = loadIngestMtimeCache(root);
  const changedFiles = collectFiles(root)
    .filter((filePath) => differsFromBaseline(filePath, baseline))
    .map((filePath) => path.relative(root, filePath));

  return {
    lastIngestAt: lastIngest.toISOString(),
    currentRev,
    staleFiles: changedFiles.length,
    sampleChangedFiles: changedFiles.slice(0, maxSamples),
  };
}

/**
 * Check if a specific file is stale (changed since its workspace was ingested).
 *
 * Takes no client: it used to fetch the newest patch on every call, which was
 * both an HTTP round-trip per file on paths like `ix explain` and `ix locate`,
 * and the same cross-workspace comparison as above.
 */
export function isFileStale(filePath: string): boolean {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) return false;

  const root = resolveWorkspaceRoot();
  if (!lastIngestAtFor(root)) return false;

  return differsFromBaseline(absolute, loadIngestMtimeCache(root));
}
