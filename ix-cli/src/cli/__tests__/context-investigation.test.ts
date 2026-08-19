import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ConflictReport,
  DecisionReport,
  GraphEdge,
  GraphNode,
  IntentReport,
  ScoredClaim,
} from "../../client/types.js";
import type { EntityFacts } from "../explain/facts.js";
import {
  buildBundle,
  diffInvestigations,
  loadInvestigation,
  mergeDiffOptions,
  parseRequestedBudgets,
  renderInvestigationDiff,
  saveInvestigation,
} from "../commands/context.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ix-investigation-test-"));
  process.env.IX_HOME = home;
  // IX_HOME is the Ix home directory; investigations live in a subdirectory of
  // it, which saveInvestigation creates. Nothing is pre-created here — the tests
  // below assert on where the code actually writes, not on a directory the test
  // made itself.
});

/** Where saved investigations are expected to live, given IX_HOME. */
const investigationsDir = () => join(home, "investigations");

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

  it("writes into an investigations subdirectory of IX_HOME, not its root", () => {
    // IX_HOME is the Ix home itself — it holds config.yaml, bin/, cli/ and
    // dotfiles like .version-check.json. Saved state belongs in a subdirectory
    // of it, not loose among them.
    writeFileSync(join(home, "config.yaml"), "endpoint: http://localhost:8090\n");
    writeFileSync(join(home, ".version-check.json"), JSON.stringify({ latest: "0.9.3" }));

    saveInvestigation("widget-check", bundleWith([makeClaim("renders to DOM", 0.9)]));

    expect(readdirSync(investigationsDir())).toEqual(["widget-check.json"]);
    expect(readdirSync(home).sort()).toEqual([".version-check.json", "config.yaml", "investigations"]);
  });

  it("refuses to resume a missing or malformed investigation", () => {
    expect(loadInvestigation("does-not-exist")).toBeUndefined();
    // The fixture has to sit where the loader actually looks, or this passes
    // because the file is absent rather than because it is malformed — and
    // would keep passing with the JSON guard deleted.
    mkdirSync(investigationsDir(), { recursive: true });
    writeFileSync(join(investigationsDir(), "broken.json"), "not json", "utf8");
    expect(existsSync(join(investigationsDir(), "broken.json"))).toBe(true);
    expect(loadInvestigation("broken")).toBeUndefined();
  });

  it("refuses to save a bundle that does not match the versioned contract", () => {
    const malformed = { ...bundleWith([]), entities: "not-an-array" } as unknown as ReturnType<typeof buildBundle>;
    saveInvestigation("bad-shape", malformed);
    expect(loadInvestigation("bad-shape")).toBeUndefined();
    expect(existsSync(join(investigationsDir(), "bad-shape.json"))).toBe(false);
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

  it("preserves saved revision and depth for --diff unless explicitly overridden", () => {
    const bundle = bundleWith([makeClaim("renders to DOM", 0.9)]);
    bundle.metadata.asOfRev = 7;
    bundle.metadata.depth = "2";
    saveInvestigation("widget-check", bundle);
    const stored = loadInvestigation("widget-check")!;

    expect(mergeDiffOptions(stored, {})).toEqual({ asOfRev: "7", depth: "2" });
    expect(mergeDiffOptions(stored, { asOfRev: "3" })).toEqual({ asOfRev: "3", depth: "2" });
    expect(mergeDiffOptions(stored, { depth: "4" })).toEqual({ asOfRev: "7", depth: "4" });
    expect(mergeDiffOptions(stored, { asOfRev: "3", depth: "4" })).toEqual({ asOfRev: "3", depth: "4" });
  });

  it("never collides or escapes for hostile investigation ids", () => {
    const a = bundleWith([makeClaim("renders to DOM", 0.9)]);
    const b = bundleWith([makeClaim("mounts to DOM", 0.9)]);
    saveInvestigation("a/b", a);
    saveInvestigation("a?b", b);
    saveInvestigation("../../escape", a);
    saveInvestigation(".version-check", b);

    expect(loadInvestigation("a/b")?.bundle.evidence).toEqual(a.evidence);
    expect(loadInvestigation("a?b")?.bundle.evidence).toEqual(b.evidence);
    expect(loadInvestigation("../../escape")?.bundle.target.name).toBe("Widget");
    expect(loadInvestigation(".version-check")?.bundle.evidence).toEqual(b.evidence);

    // Every hostile id lands as one single-segment file inside the
    // investigations directory; nothing is written outside it, and nothing
    // becomes a dotfile that could shadow real Ix state.
    const jsonFiles = readdirSync(investigationsDir()).filter((f) => f.endsWith(".json"));
    expect(jsonFiles).toHaveLength(4);
    for (const f of jsonFiles) {
      expect(f).not.toContain("/");
      expect(f.startsWith(".")).toBe(false);
    }
    expect(existsSync(join(home, "..", "escape.json"))).toBe(false);
    expect(existsSync(join(home, ".version-check.json"))).toBe(false);
  });

  it("exposes effective budgets on every --diff diff, sourced from the saved investigation", () => {
    // The reproduction in B-4 showed that --max-* flags on the CLI do not change
    // the fresh side's budget: buildFreshBundle always receives saved.bundle.budgets.
    // The transparency fix surfaces that fact as data instead of hiding it, so
    // agents reading the diff JSON can answer "what budget governed this comparison"
    // without reading the source.
    const saved = bundleWith([makeClaim("renders to DOM", 0.9)]);
    saved.budgets = { maxEntities: 5, maxRelationships: 1, maxEvidence: 2, maxChars: 12000 };
    saveInvestigation("widget-check", saved);
    const stored = loadInvestigation("widget-check")!;
    const fresh = bundleWith([makeClaim("renders to DOM", 0.9)]);

    // Without CLI overrides, requested is absent and effective mirrors saved.
    const baselineDiff = diffInvestigations(stored, fresh);
    expect(baselineDiff.budgets.saved).toEqual({ maxEntities: 5, maxRelationships: 1, maxEvidence: 2, maxChars: 12000 });
    expect(baselineDiff.budgets.requested).toBeUndefined();
    expect(baselineDiff.budgets.effective).toEqual(baselineDiff.budgets.saved);
    expect(baselineDiff.budgets.note).toMatch(/no --max-\* overrides/i);

    // With CLI overrides parsed from raw commander strings, requested captures
    // every flag the user passed (even ones that disagree with saved), and the
    // note makes the precedence explicit.
    const requested = parseRequestedBudgets({ maxEntities: "50", maxEvidence: "25", maxRelationships: "100" });
    expect(requested).toEqual({ maxEntities: 50, maxEvidence: 25, maxRelationships: 100 });

    const overrideDiff = diffInvestigations(stored, fresh, requested);
    expect(overrideDiff.budgets.requested).toEqual(requested);
    // Critical invariant: the fresh bundle was still built with saved budgets,
    // so effective is the saved snapshot, not the requested one.
    expect(overrideDiff.budgets.effective).toEqual(overrideDiff.budgets.saved);
    expect(overrideDiff.budgets.note).toMatch(/--max-\* flags on the CLI are recorded/i);
  });

  it("treats whitespace, empty, or non-numeric --max-* strings as not provided", () => {
    // parseRequestedBudgets must mirror commander semantics: only flag-shaped
    // arguments count as "user override", not noise from shell quoting or
    // accidental empty strings. This is what stops the diff output from
    // reporting a phantom override. Numeric "0" is a real override (someone
    // asking for "0 entities" forces an empty bundle and is what they meant),
    // so it survives the parse — but non-strings, blanks, and NaN-producing
    // tokens do not.
    expect(parseRequestedBudgets({})).toBeUndefined();
    expect(parseRequestedBudgets({ maxEntities: "", maxEvidence: "  " })).toBeUndefined();
    expect(parseRequestedBudgets({ maxEntities: undefined })).toBeUndefined();
    expect(parseRequestedBudgets({ maxEntities: "abc" })).toBeUndefined();
    expect(parseRequestedBudgets({ maxEntities: "0" })).toEqual({ maxEntities: 0 });
    expect(parseRequestedBudgets({ maxEntities: "10", maxChars: undefined })).toEqual({ maxEntities: 10 });
    const partial = parseRequestedBudgets({ maxEntities: "10", maxEvidence: "5", maxRelationships: "0", maxChars: "12000" });
    expect(partial).toEqual({ maxEntities: 10, maxEvidence: 5, maxRelationships: 0, maxChars: 12000 });
  });

  it("renders the budget block in --diff text and llm output", () => {
    // Spy on console.log so we can assert exactly what humans and LLMs see.
    // This is the regression guard for the user-visible transparency: if a
    // future refactor flattens renderInvestigationDiff back to "entities/-
    // +", the budget block disappears and the silent ignore comes back.
    const saved = bundleWith([makeClaim("renders to DOM", 0.9)]);
    saved.budgets = { maxEntities: 5, maxRelationships: 1, maxEvidence: 2, maxChars: 12000 };
    saveInvestigation("widget-check", saved);
    const stored = loadInvestigation("widget-check")!;
    const fresh = bundleWith([makeClaim("renders to DOM", 0.9)]);
    const requested = { maxEvidence: 25 };

    const capture = () => {
      const lines: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => String(a)).join(" "));
      });
      return { lines, restore: () => spy.mockRestore() };
    };

    const text = capture();
    try {
      renderInvestigationDiff(stored, fresh, "text", requested);
    } finally {
      text.restore();
    }
    expect(text.lines.some((l) => l.includes("budgets:"))).toBe(true);
    expect(text.lines.some((l) => l.includes("saved     :"))).toBe(true);
    expect(text.lines.some((l) => l.includes("requested :")) && text.lines.some((l) => l.includes("evidence=25"))).toBe(true);
    expect(text.lines.some((l) => l.includes("effective :") && l.includes("evidence=2"))).toBe(true);

    const llm = capture();
    try {
      renderInvestigationDiff(stored, fresh, "llm", requested);
    } finally {
      llm.restore();
    }
    // Records, not the prose block with the colons moved. `scope=requested`
    // carries `applied=false` so the precedence rule — saved budgets govern
    // --diff — is a field an agent can test rather than a sentence to read.
    expect(llm.lines).toContain("budgets scope=saved entities=5 relationships=1 evidence=2 chars=12000");
    expect(llm.lines).toContain("budgets scope=requested evidence=25 applied=false");
    expect(llm.lines).toContain("budgets scope=effective entities=5 relationships=1 evidence=2 chars=12000");
    // And none of the prose survives into the record stream.
    expect(llm.lines.some((l) => l.includes(":") && l.startsWith("  "))).toBe(false);

    // json format must already cover this branch in diffInvestigations itself,
    // but assert here that the path is wired and the renderer doesn't double-print.
    const json = capture();
    try {
      renderInvestigationDiff(stored, fresh, "json", requested);
    } finally {
      json.restore();
    }
    expect(json.lines).toHaveLength(1);
    const parsed = JSON.parse(json.lines[0]);
    expect(parsed.budgets.saved).toEqual(saved.budgets);
    expect(parsed.budgets.requested).toEqual(requested);
    expect(parsed.budgets.effective).toEqual(saved.budgets);
  });

  // `--diff --format llm` used to fall through to the prose renderer, because
  // the diff path only branched on `json`. The llm branch emits records built
  // by `llmLine`, so a value carrying a space is quoted rather than splitting
  // the record. These tests pin that.
  describe("--format llm rendering", () => {
    function captureLog(fn: () => void): string[] {
      const lines: string[] = [];
      const orig = console.log;
      console.log = (...args: unknown[]) => {
        for (const arg of args) lines.push(String(arg));
      };
      try {
        fn();
      } finally {
        console.log = orig;
      }
      return lines;
    }

    it("emits a header and counts for an empty diff without falling back to prose", () => {
      const saved = bundleWith([makeClaim("renders to DOM", 0.9)]);
      saveInvestigation("widget-llm", saved);
      const stored = loadInvestigation("widget-llm")!;
      const fresh = bundleWith([makeClaim("renders to DOM", 0.9)]);

      const lines = captureLog(() => renderInvestigationDiff(stored, fresh, "llm"));

      expect(lines[0]).toBe(
        "diff investigation=widget-llm target=Widget freshness_previous=current freshness_current=current",
      );
      // Zero is the answer to the question --diff was asked, so it is carried
      // rather than dropped as a default.
      expect(lines).toContain(
        "count added_entities=0 removed_entities=0 added_relationships=0 removed_relationships=0" +
          " added_evidence=0 removed_evidence=0 added_claims=0 removed_claims=0",
      );
      // No `renderSection` lines means we did not fall back to prose.
      expect(lines.some((l) => l.startsWith("==") || l.startsWith("  "))).toBe(false);
    });

    it("lists added and removed entities, relationships, evidence and claims", () => {
      const saved = bundleWith([makeClaim("renders to DOM", 0.9)]);
      saveInvestigation("widget-llm-busy", saved);
      const stored = loadInvestigation("widget-llm-busy")!;

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
          // Fresh side replaces the saved `calls` edge with `holds` — so the
          // diff sees a removed relationship (calls) and an added one (holds),
          // matching what an agent would observe when a refactor renames a
          // graph predicate.
          edges: [
            { id: "edge-add", src: "entity-1", dst: "entity-3", predicate: "holds", attrs: {}, createdRev: 2 },
          ],
        }),
        provenance: { sourceType: "source", extractor: "tree-sitter", observedAt: "2026-01-01T00:00:00Z" },
        asOfRev: undefined,
        depth: undefined,
        budgets: { maxEntities: 50, maxRelationships: 100, maxEvidence: 25, maxChars: 12000 },
      });

      const lines = captureLog(() => renderInvestigationDiff(stored, fresh, "llm"));

      // Counts match the deterministic diff structure. The fresh bundle adds
      // a new claim (mounts to DOM) and replaces the `calls` evidence with a
      // `holds` one, so it has 2 added evidence records and 1 removed — the
      // skolem IDs are `claim:<claim_id>` and
      // `relationship:<src>:<dst>:<predicate>`, so a stale predicate in the
      // ranked evidence list yields a real added/removed pair.
      expect(lines).toContain(
        "count added_entities=1 removed_entities=0 added_relationships=1 removed_relationships=1" +
          " added_evidence=2 removed_evidence=1 added_claims=1 removed_claims=0",
      );

      // The change is a field, not a prefix fused to the record kind, so a
      // consumer routing on `entity` matches both sides of the comparison.
      expect(lines).toContain("entity change=added kind=method name=mount");
      expect(lines).toContain("relationship change=removed src=entity-1 pred=calls dst=entity-2");
      expect(lines).toContain("relationship change=added src=entity-1 pred=holds dst=entity-3");

      // A claim id carries the statement, so it contains spaces — quoted, per
      // docs/llm-format.md. Unquoted, `id=claim-mounts to DOM` is three tokens
      // and a consumer reads the id as `claim-mounts`.
      expect(lines).toContain('claim change=added id="claim-mounts to DOM" status=active');

      // An evidence title is a sentence. Same rule, and the reason the value
      // must never be built with a template literal.
      expect(lines).toContain(
        'evidence change=added score=30 kind=relationship title="entity-1 --holds--> entity-3"',
      );
      expect(lines).toContain(
        'evidence change=removed score=30 kind=relationship title="entity-1 --calls--> entity-2"',
      );

      // One record per line — the wire format invariant.
      for (const line of lines) expect(line).not.toContain("\n");
    });

    it("does not regress the prose (text) renderer", () => {
      const saved = bundleWith([makeClaim("renders to DOM", 0.9)]);
      saveInvestigation("widget-llm-text", saved);
      const stored = loadInvestigation("widget-llm-text")!;
      const fresh = bundleWith([makeClaim("renders to DOM", 0.9), makeClaim("mounts to DOM", 0.7)]);

      const lines = captureLog(() => renderInvestigationDiff(stored, fresh, "text"));

      // Prose path still emits its summary header and the `+N`/`-N` totals.
      expect(lines.some((l) => l.includes("Investigation diff: widget-llm-text"))).toBe(true);
      expect(lines.some((l) => /claims:\s+-\d+\s+\+\d+/.test(l))).toBe(true);
      expect(lines.some((l) => /entities:\s+-\d+\s+\+\d+/.test(l))).toBe(true);
    });
  });
});
