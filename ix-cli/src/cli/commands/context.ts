import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { IxClient } from "../../client/api.js";
import type {
  ConflictReport,
  DecisionReport,
  GraphNode,
  IntentReport,
  StructuredContext,
} from "../../client/types.js";
import { getEndpoint } from "../config.js";
import { collectFacts, type EntityFacts } from "../explain/facts.js";
import { printLlmLines } from "../llm.js";
import { resolveFileOrEntity } from "../resolve.js";
import { renderNote, renderSection, renderWarning } from "../ui.js";

/**
 * Schema version for the deterministic bundle shape. Bump only on a breaking
 * shape change, never per run.
 */
const BUNDLE_SCHEMA = "ix-context-bundle/1";

interface ContextOptions {
  kind?: string;
  path?: string;
  pick?: string;
  depth?: string;
  asOfRev?: string;
  maxEntities?: string;
  maxRelationships?: string;
  maxEvidence?: string;
  maxChars?: string;
  out?: string;
  save?: string;
  resume?: string;
  diff?: string;
  format: string;
}

/** Stable evidence kinds, ordered by relevance tier (lower is more relevant). */
type EvidenceKind =
  | "target"
  | "structural"
  | "claim"
  | "decision"
  | "conflict"
  | "intent"
  | "relationship"
  | "provenance";

interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  source: string;
  title: string;
  /** Deterministic relevance score: tier plus a stable tiebreaker. */
  score: number;
  reason: string;
  refs: string[];
}

interface ContextBundle {
  schema: typeof BUNDLE_SCHEMA;
  /** The one explicitly declared time-dependent field. */
  generatedAt: string;
  target: { id: string; name: string; kind: string; resolutionMode: string };
  entities: Array<{ id: string; name: string; kind: string; path?: string; stale: boolean }>;
  relationships: Array<{ src: string; dst: string; predicate: string }>;
  claims: Array<{ id: string; entityId: string; statement: string; status: string }>;
  decisions: DecisionReport[];
  conflicts: ConflictReport[];
  intents: IntentReport[];
  provenance: {
    sourceUri?: string;
    sourceHash?: string;
    extractor?: string;
    sourceType?: string;
    observedAt?: string;
    introducedRev?: number;
    historyLength: number;
    stale: boolean;
  };
  freshness: { stale: boolean; classification: "current" | "stale" | "unverified" };
  evidence: EvidenceItem[];
  budgets: { maxEntities: number; maxRelationships: number; maxEvidence: number; maxChars: number };
  truncation: {
    entitiesTruncated: number;
    relationshipsTruncated: number;
    evidenceTruncated: number;
    charactersTruncated: number;
  };
  metadata: {
    asOfRev?: number;
    depth?: string;
    rankingRule: "deterministic-tier";
  };
}

/**
 * Build a bounded, deterministic context bundle for one target.
 *
 * This composes Ix's existing intelligence rather than re-deriving it: the
 * target is resolved through the same resolver as `ix explain`, structural
 * facts come from the same collector, and claims/conflicts/decisions/intents
 * come from the same `/v1/context` service. The only new thing here is the
 * bundling, budgeting, and deterministic ranking.
 */
export function registerContextCommand(program: Command): void {
  program
    .command("context <target>")
    .description("Build a bounded, deterministic context bundle for a symbol, file, or entity")
    .option("--kind <kind>", "Filter target entity by kind")
    .option("--path <path>", "Prefer symbols from files matching this path substring")
    .option("--pick <n>", "Pick Nth candidate from ambiguous results (1-based)")
    .option("--depth <depth>", "Context-graph expansion depth")
    .option("--as-of-rev <n>", "Historical context as of a graph revision")
    .option("--max-entities <n>", "Maximum entities in the bundle", "50")
    .option("--max-relationships <n>", "Maximum relationships in the bundle", "100")
    .option("--max-evidence <n>", "Maximum evidence items in the bundle", "25")
    .option("--max-chars <n>", "Maximum characters of evidence output", "12000")
    .option("--format <fmt>", "Output format (text|json|llm)", "text")
    .option("--out <path>", "Write the JSON bundle to this file instead of stdout")
    .option("--save <id>", "Persist the bundle as a resumable investigation state")
    .option("--resume <id>", "Render a saved investigation state without a backend")
    .option("--diff <id>", "Diff a saved investigation against a fresh build of the same target")
    .addHelpText(
      "after",
      "\nExamples:\n  ix context IngestionService\n  ix context src/main.ts --format json\n  ix context Widget --max-entities 20 --max-evidence 10\n  ix context Widget --save widget-investigation\n  ix context --resume widget-investigation\n  ix context --diff widget-investigation",
    )
    .action(async (target: string | undefined, opts: ContextOptions) => {
      if (opts.resume) {
        renderSavedInvestigation(opts.resume, opts.format);
        return;
      }
      if (opts.diff) {
        const saved = loadInvestigation(opts.diff);
        if (!saved) return;
        const fresh = await buildFreshBundle(target ?? saved.bundle.target.name, opts, saved.bundle.budgets);
        if (!fresh) return;
        renderInvestigationDiff(saved, fresh, opts.format);
        return;
      }
      if (!target) {
        renderWarning("ix context requires a target unless --resume <id> or --diff <id> is given.");
        return;
      }

      const client = new IxClient(getEndpoint());

      const resolved = await resolveFileOrEntity(client, target, {
        path: opts.path,
        pick: opts.pick ? parseInt(opts.pick, 10) : undefined,
      });
      if (!resolved) return;

      const asOfRev = opts.asOfRev ? parseInt(opts.asOfRev, 10) : undefined;
      const maxEntities = clampInt(opts.maxEntities, 1, 500, 50);
      const maxRelationships = clampInt(opts.maxRelationships, 1, 1000, 100);
      const maxEvidence = clampInt(opts.maxEvidence, 1, 200, 25);
      const maxChars = clampInt(opts.maxChars, 1000, 1_000_000, 12_000);

      const [facts, context, provenance] = await Promise.all([
        collectFacts(client, resolved.id, resolved.name, resolved.kind),
        client.query(resolved.name, {
          asOfRev,
          depth: opts.depth,
        }),
        client.provenance(resolved.id),
      ]);

      const bundle = buildBundle({
        resolved,
        facts,
        context,
        provenance,
        asOfRev,
        depth: opts.depth,
        budgets: { maxEntities, maxRelationships, maxEvidence, maxChars },
      });

      if (opts.save) {
        saveInvestigation(opts.save, bundle);
        renderNote(`Saved investigation "${opts.save}" (${bundle.entities.length} entities, ${bundle.relationships.length} relationships, ${bundle.evidence.length} evidence items). Resume with: ix context --resume ${opts.save}`);
        return;
      }

      if (opts.out && opts.format !== "json") {
        renderWarning("--out writes JSON; ignoring --format and forcing json.");
      }
      const out = opts.out;
      if (out) {
        const fs = await import("node:fs");
        fs.writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n");
        renderNote(`Wrote ${bundle.entities.length} entities, ${bundle.relationships.length} relationships, ${bundle.evidence.length} evidence items to ${out}`);
        return;
      }
      renderBundle(bundle, opts.format);
    });

async function buildFreshBundle(
  target: string,
  opts: { kind?: string; path?: string; pick?: string; depth?: string; asOfRev?: string },
  budgets: { maxEntities: number; maxRelationships: number; maxEvidence: number; maxChars: number },
): Promise<ContextBundle | undefined> {
  const client = new IxClient(getEndpoint());
  const resolved = await resolveFileOrEntity(client, target, {
    kind: opts.kind,
    path: opts.path,
    pick: opts.pick ? parseInt(opts.pick, 10) : undefined,
  });
  if (!resolved) return undefined;

  const asOfRev = opts.asOfRev ? parseInt(opts.asOfRev, 10) : undefined;
  const [facts, context, provenance] = await Promise.all([
    collectFacts(client, resolved.id, resolved.name, resolved.kind),
    client.query(resolved.name, { asOfRev, depth: opts.depth }),
    client.provenance(resolved.id),
  ]);

  return buildBundle({ resolved, facts, context, provenance, asOfRev, depth: opts.depth, budgets });
}
}


/** Saved investigation state lives under ~/.ix/investigations. */
function investigationDir(): string {
  return process.env.IX_HOME || join(homedir(), ".ix", "investigations");
}

function investigationPath(id: string): string {
  return join(investigationDir(), `${sanitizeId(id)}.json`);
}

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "-");
}

export function saveInvestigation(id: string, bundle: ContextBundle): void {
  const dir = investigationDir();
  mkdirSync(dir, { recursive: true });
  const state = {
    schema: "ix-investigation/1",
    id: sanitizeId(id),
    savedAt: new Date().toISOString(),
    bundle,
  };
  writeFileSync(investigationPath(id), JSON.stringify(state, null, 2) + "\n", "utf8");
}

interface SavedInvestigation {
  schema: string;
  id: string;
  savedAt: string;
  bundle: ContextBundle;
}

export function loadInvestigation(id: string): SavedInvestigation | undefined {
  const path = investigationPath(id);
  if (!existsSync(path)) {
    renderWarning(`No saved investigation "${id}" at ${path}`);
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SavedInvestigation;
    if (parsed.schema !== "ix-investigation/1" || !parsed.bundle) {
      renderWarning(`Saved investigation "${id}" has an unknown schema; refusing to resume.`);
      return undefined;
    }
    return parsed;
  } catch {
    renderWarning(`Saved investigation "${id}" is not valid JSON; refusing to resume.`);
    return undefined;
  }
}

function renderSavedInvestigation(id: string, format: string): void {
  const saved = loadInvestigation(id);
  if (!saved) return;
  if (format === "json") {
    console.log(JSON.stringify(saved, null, 2));
    return;
  }
  renderNote(`Resumed investigation "${saved.id}" saved ${saved.savedAt}`);
  renderBundle(saved.bundle, format);
}

export function diffInvestigations(saved: SavedInvestigation, fresh: ContextBundle): InvestigationDiff {
  const prev = saved.bundle;
  const addedEntities = fresh.entities.filter((e) => !prev.entities.some((p) => p.id === e.id));
  const removedEntities = prev.entities.filter((p) => !fresh.entities.some((e) => e.id === p.id));
  const addedRelationships = fresh.relationships.filter(
    (r) => !prev.relationships.some((p) => p.src === r.src && p.dst === r.dst && p.predicate === r.predicate),
  );
  const removedRelationships = prev.relationships.filter(
    (p) => !fresh.relationships.some((r) => r.src === p.src && r.dst === p.dst && r.predicate === p.predicate),
  );
  const addedEvidence = fresh.evidence.filter((e) => !prev.evidence.some((p) => p.id === e.id));
  const removedEvidence = prev.evidence.filter((p) => !fresh.evidence.some((e) => e.id === p.id));
  const addedClaims = fresh.claims.filter((c) => !prev.claims.some((p) => p.id === c.id));
  const removedClaims = prev.claims.filter((p) => !fresh.claims.some((c) => c.id === p.id));

  return {
    schema: "ix-investigation-diff/1",
    investigation: saved.id,
    savedAt: saved.savedAt,
    generatedAt: new Date().toISOString(),
    target: fresh.target,
    freshness: { previous: prev.freshness, current: fresh.freshness },
    added: {
      entities: addedEntities,
      relationships: addedRelationships,
      evidence: addedEvidence,
      claims: addedClaims,
    },
    removed: {
      entities: removedEntities,
      relationships: removedRelationships,
      evidence: removedEvidence,
      claims: removedClaims,
    },
  };
}

interface InvestigationDiff {
  schema: string;
  investigation: string;
  savedAt: string;
  generatedAt: string;
  target: ContextBundle["target"];
  freshness: { previous: ContextBundle["freshness"]; current: ContextBundle["freshness"] };
  added: { entities: ContextBundle["entities"]; relationships: ContextBundle["relationships"]; evidence: EvidenceItem[]; claims: ContextBundle["claims"] };
  removed: { entities: ContextBundle["entities"]; relationships: ContextBundle["relationships"]; evidence: EvidenceItem[]; claims: ContextBundle["claims"] };
}

function renderInvestigationDiff(saved: SavedInvestigation, fresh: ContextBundle, format: string): void {
  const prev = saved.bundle;
  const diff = diffInvestigations(saved, fresh);

  if (format === "json") {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  renderSection(`Investigation diff: ${saved.id}`);
  console.log(`  freshness: ${prev.freshness.classification} -> ${fresh.freshness.classification}`);
  console.log(`  entities:  -${diff.removed.entities.length} +${diff.added.entities.length}`);
  console.log(`  relationships: -${diff.removed.relationships.length} +${diff.added.relationships.length}`);
  console.log(`  evidence:  -${diff.removed.evidence.length} +${diff.added.evidence.length}`);
  console.log(`  claims:    -${diff.removed.claims.length} +${diff.added.claims.length}`);
  if (diff.added.entities.length > 0) {
    renderSection("Added entities");
    for (const e of diff.added.entities) console.log(`  ${e.name} (${e.kind})`);
  }
  if (diff.removed.entities.length > 0) {
    renderSection("Removed entities");
    for (const e of diff.removed.entities) console.log(`  ${e.name} (${e.kind})`);
  }
  if (diff.added.evidence.length > 0) {
    renderSection("Added evidence");
    for (const e of diff.added.evidence) console.log(`  [${e.score}] ${e.kind} - ${e.title}`);
  }
  if (diff.removed.evidence.length > 0) {
    renderSection("Removed evidence");
    for (const e of diff.removed.evidence) console.log(`  [${e.score}] ${e.kind} - ${e.title}`);
  }
  console.log();
}

interface BuildInput {
  resolved: { id: string; name: string; kind: string; resolutionMode: string };
  facts: EntityFacts;
  context: StructuredContext;
  provenance: unknown;
  asOfRev?: number;
  depth?: string;
  budgets: { maxEntities: number; maxRelationships: number; maxEvidence: number; maxChars: number };
}

export function buildBundle(input: BuildInput): ContextBundle {
  const { resolved, facts, context, provenance, asOfRev, depth, budgets } = input;

  const stale = facts.stale;
  const classification = stale ? "stale" : "current";
  const prov = asRecord(provenance);

  // Entities: the target itself plus every referenced node, deduped by id and
  // ordered deterministically (kind, name, id) before budgeting.
  const seen = new Set<string>([resolved.id]);
  const entities: ContextBundle["entities"] = [
    {
      id: resolved.id,
      name: resolved.name,
      kind: resolved.kind,
      path: facts.path,
      stale,
    },
  ];
  for (const node of orderedNodes(context.nodes)) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    entities.push({
      id: node.id,
      name: node.name,
      kind: node.kind,
      path: node.provenance?.sourceUri,
      stale,
    });
  }

  // Relationships: graph edges, ordered deterministically.
  const relationships = [...context.edges]
    .sort((a, b) => cmp(a.src, b.src) || cmp(a.dst, b.dst) || cmp(a.predicate, b.predicate))
    .map((edge) => ({ src: edge.src, dst: edge.dst, predicate: edge.predicate }));

  const evidence = rankEvidence({ resolved, facts, context, relationships, prov });

  const bundle: ContextBundle = {
    schema: BUNDLE_SCHEMA,
    generatedAt: new Date().toISOString(),
    target: {
      id: resolved.id,
      name: resolved.name,
      kind: resolved.kind,
      resolutionMode: resolved.resolutionMode,
    },
    entities: [],
    relationships: [],
    claims: context.claims.map((scored) => ({
      id: scored.claim.id,
      entityId: scored.claim.entityId,
      statement: scored.claim.statement,
      status: scored.claim.status,
    })),
    decisions: context.decisions,
    conflicts: context.conflicts,
    intents: context.intents,
    provenance: {
      sourceUri: asString(prov.sourceUri) ?? facts.path,
      sourceHash: asString(prov.sourceHash),
      extractor: asString(prov.extractor),
      sourceType: asString(prov.sourceType),
      observedAt: asString(prov.observedAt),
      introducedRev: facts.introducedRev,
      historyLength: facts.historyLength,
      stale,
    },
    freshness: { stale, classification },
    evidence: [],
    budgets,
    truncation: {
      entitiesTruncated: 0,
      relationshipsTruncated: 0,
      evidenceTruncated: 0,
      charactersTruncated: 0,
    },
    metadata: {
      asOfRev,
      depth,
      rankingRule: "deterministic-tier",
    },
  };

  // Apply budgets with explicit truncation metadata. Ordering is already
  // deterministic, so cutting from the tail is stable across runs.
  const entityLimit = Math.min(entities.length, budgets.maxEntities);
  bundle.entities = entities.slice(0, entityLimit);
  bundle.truncation.entitiesTruncated = entities.length - entityLimit;

  const relLimit = Math.min(relationships.length, budgets.maxRelationships);
  bundle.relationships = relationships.slice(0, relLimit);
  bundle.truncation.relationshipsTruncated = relationships.length - relLimit;

  // Evidence is ordered by relevance, so keep the highest-priority prefix and
  // drop the tail when either the count or the character budget is exceeded.
  let chars = 0;
  let kept = 0;
  for (const item of evidence) {
    const size = item.title.length + item.reason.length + 64;
    if (kept >= budgets.maxEvidence || chars + size > budgets.maxChars) break;
    chars += size;
    kept += 1;
  }
  bundle.evidence = evidence.slice(0, kept);
  bundle.truncation.evidenceTruncated = evidence.length - kept;
  const fullChars = evidence.reduce((sum, item) => sum + item.title.length + item.reason.length, 0);
  bundle.truncation.charactersTruncated = Math.max(0, fullChars - chars);

  return bundle;
}

/** Deterministic evidence ranking: tier, then a stable id tiebreaker. */
function rankEvidence(input: {
  resolved: { id: string; name: string; kind: string };
  facts: EntityFacts;
  context: StructuredContext;
  relationships: Array<{ src: string; dst: string; predicate: string }>;
  prov: Record<string, unknown>;
}): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  const target = input.resolved;
  items.push({
    id: `target:${target.id}`,
    kind: "target",
    source: "resolution",
    title: `${target.name} (${target.kind})`,
    score: 0,
    reason: "resolved target — the bundle is centered on this entity",
    refs: [target.id],
  });

  const structural: Array<{ id: string; source: string; title: string; refs: string[] }> = [];
  if (input.facts.container) {
    structural.push({
      id: `container:${input.facts.container.name}`,
      source: "facts.container",
      title: `container ${input.facts.container.name} (${input.facts.container.kind})`,
      refs: [],
    });
  }
  for (const name of input.facts.topCallers) {
    structural.push({ id: `caller:${name}`, source: "facts.callers", title: `caller ${name}`, refs: [] });
  }
  for (const name of input.facts.topDependents) {
    structural.push({
      id: `dependent:${name}`,
      source: "facts.dependents",
      title: `dependent ${name}`,
      refs: [],
    });
  }
  for (const name of input.facts.members.slice(0, 10)) {
    structural.push({ id: `member:${name}`, source: "facts.members", title: `member ${name}`, refs: [] });
  }
  structural.forEach((item, index) => {
    items.push({ ...item, kind: "structural", score: 10 + index, reason: "direct structural relationship" });
  });

  for (const scored of input.context.claims) {
    items.push({
      id: `claim:${scored.claim.id}`,
      kind: "claim",
      source: "context.claims",
      title: scored.claim.statement,
      score: 20,
      reason: `context claim (relevance ${scored.relevance}, confidence ${scored.confidence?.score ?? "n/a"})`,
      refs: [scored.claim.entityId],
    });
  }
  for (const decision of input.context.decisions) {
    items.push({
      id: `decision:${decision.title}`,
      kind: "decision",
      source: "context.decisions",
      title: decision.title,
      score: 21,
      reason: decision.rationale,
      refs: decision.entityId ? [decision.entityId] : [],
    });
  }
  for (const conflict of input.context.conflicts) {
    items.push({
      id: `conflict:${conflict.id}`,
      kind: "conflict",
      source: "context.conflicts",
      title: `${conflict.claimA} vs ${conflict.claimB}`,
      score: 22,
      reason: conflict.reason,
      refs: [],
    });
  }
  for (const intent of input.context.intents) {
    items.push({
      id: `intent:${intent.id}`,
      kind: "intent",
      source: "context.intents",
      title: intent.statement,
      score: 23,
      reason: `intent status ${intent.status}`,
      refs: [],
    });
  }

  input.relationships.slice(0, 50).forEach((edge, index) => {
    items.push({
      id: `relationship:${edge.src}:${edge.dst}:${edge.predicate}`,
      kind: "relationship",
      source: "context.edges",
      title: `${edge.src} --${edge.predicate}--> ${edge.dst}`,
      score: 30 + Math.min(index, 10),
      reason: "graph relationship from the context service",
      refs: [edge.src, edge.dst],
    });
  });

  items.push({
    id: `provenance:${target.id}`,
    kind: "provenance",
    source: "provenance + facts.history",
    title: `history length ${input.facts.historyLength}, introduced rev ${input.facts.introducedRev ?? "unknown"}`,
    score: 40,
    reason: `provenance ${input.prov.sourceType ?? "unknown"}, extractor ${input.prov.extractor ?? "unknown"}`,
    refs: [target.id],
  });

  // Stable full ordering: score, then id.
  return items.sort((a, b) => a.score - b.score || cmp(a.id, b.id));
}

function renderBundle(bundle: ContextBundle, format: string): void {
  if (format === "json") {
    console.log(JSON.stringify(bundle, null, 2));
    return;
  }
  if (format === "llm") {
    printLlmLines([
      `target=${bundle.target.name}`,
      `target_kind=${bundle.target.kind}`,
      `stale=${bundle.freshness.stale}`,
      `classification=${bundle.freshness.classification}`,
      `entities=${bundle.entities.length}`,
      `relationships=${bundle.relationships.length}`,
      `claims=${bundle.claims.length}`,
      `decisions=${bundle.decisions.length}`,
      `conflicts=${bundle.conflicts.length}`,
      `intents=${bundle.intents.length}`,
      `evidence=${bundle.evidence.length}`,
      `truncated_entities=${bundle.truncation.entitiesTruncated}`,
      `truncated_relationships=${bundle.truncation.relationshipsTruncated}`,
      `truncated_evidence=${bundle.truncation.evidenceTruncated}`,
      `truncated_chars=${bundle.truncation.charactersTruncated}`,
      ...bundle.evidence.map(
        (item) => `evidence ${item.score} ${item.kind} ${item.title.replaceAll("\n", " ")}`,
      ),
    ]);
    return;
  }

  renderSection(`Context: ${bundle.target.name}`);
  console.log(`  kind:          ${bundle.target.kind}`);
  console.log(`  classification:${bundle.freshness.classification}`);
  console.log(`  entities:      ${bundle.entities.length}`);
  console.log(`  relationships: ${bundle.relationships.length}`);
  console.log(`  claims:        ${bundle.claims.length}`);
  console.log(`  decisions:     ${bundle.decisions.length}`);
  console.log(`  conflicts:     ${bundle.conflicts.length}`);
  console.log(`  intents:       ${bundle.intents.length}`);
  if (bundle.freshness.stale) {
    renderWarning("Source has changed since last ingest. Run ix map to update.");
  }

  if (bundle.evidence.length > 0) {
    renderSection("Evidence (highest relevance first)");
    for (const item of bundle.evidence) {
      console.log(`  [${item.score}] ${item.kind} — ${item.title}`);
      console.log(`         ${item.reason}`);
    }
  }

  const trunc = bundle.truncation;
  if (trunc.entitiesTruncated + trunc.relationshipsTruncated + trunc.evidenceTruncated > 0) {
    renderNote(
      `Truncated: ${trunc.entitiesTruncated} entities, ${trunc.relationshipsTruncated} relationships, ${trunc.evidenceTruncated} evidence items. Rerun with larger --max-* budgets for more.`,
    );
  }
  console.log();
}

function orderedNodes(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => cmp(a.kind, b.kind) || cmp(a.name, b.name) || cmp(a.id, b.id));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
