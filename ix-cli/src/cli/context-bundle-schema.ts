import { z } from "zod";

/**
 * Versioned contract for the deterministic context bundle produced by
 * `ix context` (schema `ix-context-bundle/1`).
 *
 * This is the single source of truth for the bundle's shape. The MCP server
 * uses it as the `ix_context` output schema so agents get a structured
 * contract, and the CLI validates every bundle with it before persisting it
 * (investigation save and `--out`), so a malformed or unexpected backend
 * payload can never be written to disk as if it were a valid bundle.
 *
 * Nested report objects (claims/decisions/conflicts/intents) keep their own
 * internal shapes and are typed loosely here; the bundle's versioned `schema`
 * field remains the authoritative marker.
 */
export const contextBundleSchema = z.object({
  schema: z.string(),
  generatedAt: z.string(),
  target: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    resolutionMode: z.string(),
  }),
  entities: z.array(
    z.object({ id: z.string(), name: z.string(), kind: z.string(), path: z.string().optional(), stale: z.boolean() }),
  ),
  relationships: z.array(z.object({ src: z.string(), dst: z.string(), predicate: z.string() })),
  claims: z.array(z.record(z.string(), z.unknown())),
  decisions: z.array(z.record(z.string(), z.unknown())),
  conflicts: z.array(z.record(z.string(), z.unknown())),
  intents: z.array(z.record(z.string(), z.unknown())),
  provenance: z.record(z.string(), z.unknown()),
  freshness: z.object({ stale: z.boolean(), classification: z.string() }),
  evidence: z.array(z.record(z.string(), z.unknown())),
  budgets: z.record(z.string(), z.number()),
  truncation: z.record(z.string(), z.number()),
  metadata: z.record(z.string(), z.unknown()),
});
