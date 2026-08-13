import { describe, expect, it } from "vitest";

import type {
  ConflictReport,
  DecisionReport,
  GraphEdge,
  GraphNode,
  IntentReport,
  ScoredClaim,
} from "../../client/types.js";
import type { EntityFacts } from "../explain/facts.js";
import { buildBundle } from "../commands/context.js";

function makeFacts(overrides: Partial<EntityFacts> = {}): EntityFacts {
  return {
    id: "entity-1",
    name: "Widget",
    kind: "class",
    members: ["render", "mount"],
    memberCount: 2,
    callerCount: 3,
    calleeCount: 2,
    dependentCount: 4,
    importerCount: 1,
    downstreamDependents: 6,
    downstreamDepth: 2,
    topCallers: ["App", "Panel", "Shell"],
    topDependents: ["App", "Panel", "Shell", "Frame"],
    historyLength: 5,
    introducedRev: 3,
    stale: false,
    diagnostics: [],
    ...overrides,
  };
}

function makeClaim(statement: string, relevance: number): ScoredClaim {
  return {
    claim: { id: `claim-${statement}`, entityId: "entity-1", statement, status: "active" },
    relevance,
    finalScore: relevance,
    confidence: {
      baseAuthority: { value: 0.5, reason: "base" },
      verification: { value: 0.5, reason: "verify" },
      recency: { value: 0.5, reason: "recent" },
      corroboration: { value: 0.5, reason: "corroborate" },
      conflictPenalty: { value: 0.5, reason: "penalty" },
      intentAlignment: { value: 0.5, reason: "intent" },
      score: 0.5,
    },
  };
}

function makeContext(overrides: Partial<{
  claims: ScoredClaim[];
  conflicts: ConflictReport[];
  decisions: DecisionReport[];
  intents: IntentReport[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}> = {}) {
  return {
    claims: overrides.claims ?? [makeClaim("renders to DOM", 0.9)],
    conflicts: overrides.conflicts ?? [],
    decisions: overrides.decisions ?? [],
    intents: overrides.intents ?? [],
    nodes:
      overrides.nodes ??
      ([
        {
          id: "entity-2",
          kind: "method",
          name: "render",
          attrs: {},
          provenance: { sourceUri: "src/widget.ts", extractor: "tree-sitter", sourceType: "source", observedAt: "2026-01-01T00:00:00Z" },
          createdRev: 3,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ] as GraphNode[]),
    edges:
      overrides.edges ??
      ([
        { id: "edge-1", src: "entity-1", dst: "entity-2", predicate: "calls", attrs: {}, createdRev: 3 },
      ] as GraphEdge[]),
    metadata: { query: "Widget", seedEntities: ["entity-1"], hopsExpanded: 1, asOfRev: 3 },
  };
}

function input() {
  return {
    resolved: { id: "entity-1", name: "Widget", kind: "class", resolutionMode: "exact" },
    facts: makeFacts(),
    context: makeContext(),
    provenance: { sourceType: "source", extractor: "tree-sitter", observedAt: "2026-01-01T00:00:00Z" },
    asOfRev: undefined,
    depth: undefined,
    budgets: { maxEntities: 50, maxRelationships: 100, maxEvidence: 25, maxChars: 12000 },
  };
}

describe("ix context bundle", () => {
  it("is deterministic for identical input apart from the declared timestamp", () => {
    const first = buildBundle(input());
    const second = buildBundle(input());

    // The only permitted time-dependent field.
    expect(first.generatedAt).toBeTypeOf("string");
    const { generatedAt: _g1, ...firstStatic } = first;
    const { generatedAt: _g2, ...secondStatic } = second;
    expect(firstStatic).toEqual(secondStatic);
  });

  it("orders evidence by the deterministic tier and a stable id tiebreaker", () => {
    const bundle = buildBundle(input());
    const scores = bundle.evidence.map((item) => item.score);

    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    // The resolved target is the most relevant item.
    expect(bundle.evidence[0]?.kind).toBe("target");
    // Direct structural facts rank above context claims.
    expect(bundle.evidence[1]?.kind).toBe("structural");
    const claimItem = bundle.evidence.find((item) => item.kind === "claim");
    expect(claimItem?.source).toBe("context.claims");
  });

  it("enforces budgets and reports explicit truncation", () => {
    const bundle = buildBundle({
      ...input(),
      budgets: { maxEntities: 1, maxRelationships: 0, maxEvidence: 2, maxChars: 12000 },
    });

    expect(bundle.entities).toHaveLength(1);
    expect(bundle.truncation.entitiesTruncated).toBeGreaterThan(0);
    expect(bundle.relationships).toHaveLength(0);
    expect(bundle.truncation.relationshipsTruncated).toBe(1);
    expect(bundle.evidence.length).toBeLessThanOrEqual(2);
    expect(bundle.truncation.evidenceTruncated).toBeGreaterThanOrEqual(0);
  });

  it("classifies staleness from the collected facts", () => {
    const stale = buildBundle({ ...input(), facts: makeFacts({ stale: true }) });
    expect(stale.freshness).toEqual({ stale: true, classification: "stale" });

    const current = buildBundle({ ...input(), facts: makeFacts({ stale: false }) });
    expect(current.freshness).toEqual({ stale: false, classification: "current" });
  });
});
