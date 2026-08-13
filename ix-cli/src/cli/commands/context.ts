import type { Command } from "commander";

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
    .addHelpText(
      "after",
      "\nExamples:\n  ix context IngestionService\n  ix context src/main.ts --format json\n  ix context Widget --max-entities 20 --max-evidence 10",
    )
    .action(async (target: string, opts: ContextOptions) => {
      const client = new IxClient(getEndpoint());

      const resolved = await resolveFileOrEntity(client, target, {
        kind: opts.kind,
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

      renderBundle(bundle, opts.format);
    });
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
