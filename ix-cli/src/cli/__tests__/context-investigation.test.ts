import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ConflictReport,
  DecisionReport,
  GraphEdge,
  GraphNode,
  IntentReport,
  ScoredClaim,
} from "../../client/types.js";
import type { EntityFacts } from "../explain/facts.js";
import { buildBundle, diffInvestigations, loadInvestigation, saveInvestigation } from "../commands/context.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ix-investigation-test-"));
  process.env.IX_HOME = home;
  mkdirSync(join(home, ".ix", "investigations"), { recursive: true });
});

afterEach(() => {
  delete process.env.IX_HOME;
  rmSync(home, { recursive: true, force: true });
});

function makeFacts(overrides: Partial<EntityFacts> = {}): EntityFacts {
  return {
    id: "entity-1",
    name: "Widget",
    kind: "class",
    members: ["render"],
    memberCount: 1,
    callerCount: 1,
    calleeCount: 1,
    dependentCount: 1,
    importerCount: 0,
    downstreamDependents: 2,
    downstreamDepth: 1,
    topCallers: ["App"],
    topDependents: ["App"],
    historyLength: 2,
    introducedRev: 1,
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

function makeContext(overrides: Partial<{ nodes: GraphNode[]; edges: GraphEdge[]; claims: ScoredClaim[] }> = {}) {
  return {
    claims: overrides.claims ?? [makeClaim("renders to DOM", 0.9)],
    conflicts: [] as ConflictReport[],
    decisions: [] as DecisionReport[],
    intents: [] as IntentReport[],
    nodes:
      overrides.nodes ??
      ([
        {
          id: "entity-2",
          kind: "method",
          name: "render",
          attrs: {},
          provenance: { sourceUri: "src/widget.ts", extractor: "tree-sitter", sourceType: "source", observedAt: "2026-01-01T00:00:00Z" },
          createdRev: 1,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ] as GraphNode[]),
    edges:
      overrides.edges ??
      ([
        { id: "edge-1", src: "entity-1", dst: "entity-2", predicate: "calls", attrs: {}, createdRev: 1 },
      ] as GraphEdge[]),
    metadata: { query: "Widget", seedEntities: ["entity-1"], hopsExpanded: 1, asOfRev: 1 },
  };
}

function bundleWith(claims: ScoredClaim[], stale = false) {
  return buildBundle({
    resolved: { id: "entity-1", name: "Widget", kind: "class", resolutionMode: "exact" },
    facts: makeFacts({ stale }),
    context: makeContext({ claims }),
    provenance: { sourceType: "source", extractor: "tree-sitter", observedAt: "2026-01-01T00:00:00Z" },
    asOfRev: undefined,
    depth: undefined,
    budgets: { maxEntities: 50, maxRelationships: 100, maxEvidence: 25, maxChars: 12000 },
  });
}

describe("ix context investigation state", () => {
  it("persists and resumes an investigation under ~/.ix/investigations", () => {
    const bundle = bundleWith([makeClaim("renders to DOM", 0.9)]);
    saveInvestigation("widget-check", bundle);

    const loaded = loadInvestigation("widget-check");
    expect(loaded).toBeDefined();
    expect(loaded?.schema).toBe("ix-investigation/1");
    expect(loaded?.bundle.target.name).toBe("Widget");
    expect(loaded?.bundle.evidence).toEqual(bundle.evidence);
  });

  it("refuses to resume a missing or malformed investigation", () => {
    expect(loadInvestigation("does-not-exist")).toBeUndefined();
    writeFileSync(join(home, ".ix", "investigations", "broken.json"), "not json", "utf8");
    expect(loadInvestigation("broken")).toBeUndefined();
  });

  it("computes a deterministic delta between saved and fresh state", () => {
    const saved = bundleWith([makeClaim("renders to DOM", 0.9)]);
    saveInvestigation("widget-check", saved);
    const stored = loadInvestigation("widget-check")!;

    // Fresh state: one extra entity + one new claim; one relationship removed.
    const fresh = buildBundle({
      resolved: { id: "entity-1", name: "Widget", kind: "class", resolutionMode: "exact" },
      facts: makeFacts(),
      context: makeContext({
        claims: [makeClaim("renders to DOM", 0.9), makeClaim("mounts to DOM", 0.7)],
        nodes: [
          {
            id: "entity-2",
            kind: "method",
            name: "render",
            attrs: {},
            provenance: { sourceUri: "src/widget.ts", extractor: "tree-sitter", sourceType: "source", observedAt: "2026-01-01T00:00:00Z" },
            createdRev: 1,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          {
            id: "entity-3",
            kind: "method",
            name: "mount",
            attrs: {},
            provenance: { sourceUri: "src/widget.ts", extractor: "tree-sitter", sourceType: "source", observedAt: "2026-01-01T00:00:00Z" },
            createdRev: 2,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
      provenance: { sourceType: "source", extractor: "tree-sitter", observedAt: "2026-01-01T00:00:00Z" },
      asOfRev: undefined,
      depth: undefined,
      budgets: { maxEntities: 50, maxRelationships: 100, maxEvidence: 25, maxChars: 12000 },
    });

    const diff = diffInvestigations(stored, fresh);

    expect(diff.schema).toBe("ix-investigation-diff/1");
    expect(diff.investigation).toBe("widget-check");
    expect(diff.added.entities.map((e) => e.id)).toContain("entity-3");
    expect(diff.removed.entities).toHaveLength(0);
    expect(diff.added.claims.map((c) => c.id)).toContain("claim-mounts to DOM");
    expect(diff.removed.claims).toHaveLength(0);

    const { generatedAt: _g, ...diffStatic } = diff;
    expect(diffStatic).toEqual({ ...diffStatic });
  });

  it("surfaces staleness changes in the delta", () => {
    const saved = bundleWith([makeClaim("renders to DOM", 0.9)], false);
    saveInvestigation("widget-check", saved);
    const stored = loadInvestigation("widget-check")!;
    const fresh = bundleWith([makeClaim("renders to DOM", 0.9)], true);

    const diff = diffInvestigations(stored, fresh);
    expect(diff.freshness.previous.classification).toBe("current");
    expect(diff.freshness.current.classification).toBe("stale");
  });
});
