// repro/probe.mjs — deterministic resolveEdges probe harness for the #446-era
// findings (F-014, F-016, F-017, F-019, F-020).
//
// Usage:
//   node repro/probe.mjs [--mode inbatch|crossbatch] [--expect bug|fixed] [--json]
//
//   --mode inbatch   (default) all fixture files parsed together, one resolveEdges call
//   --mode crossbatch PHP cases only: provider indexed via buildGlobalResolutionIndex,
//                    consumer resolved with the global index (cross-batch path)
//   --expect bug     assert the historical bug is PRESENT (for upstream-main runs)
//   --expect fixed   assert the bug is ABSENT (for fix-applied runs)
//
// Exit 0 = all assertions for the mode+expect combination hold; exit 1 otherwise.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'repro', 'fixtures');
const DIST = process.env.IX_CORE_INGESTION_DIST || join(ROOT, 'core-ingestion', 'dist', 'index.js');
const { parseFile, resolveEdges, buildGlobalResolutionIndex } = await import(pathToFileURL(DIST).href);

const args = process.argv.slice(2);
const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'inbatch';
const expect = args.includes('--expect') ? args[args.indexOf('--expect') + 1] : 'bug';
const asJson = args.includes('--json');

const F = (rel) => join(FIXTURES, rel);
const src = (abs) => readFileSync(abs, 'utf8');
const files = (rels) => rels.map((r) => F(r));
const norm = (p) => p.replace(/\\/g, '/');

const cfgResolver = (target) => () => [F(target)];

const cases = [
  {
    id: 'F-019-same', label: 'same-line sibling PHP types resolve (F-019)',
    rels: ['php-same/Vendor/Package/B.php', 'php-same/Vendor/Package/C.php'],
    bugIs: (edges) => !edges.some(e => e.predicate === 'IMPORTS' && norm(e.dstFilePath).includes('php-same')),
    fixedIs: (edges) => edges.some(e => e.predicate === 'IMPORTS' && e.confidence >= 0.9 && norm(e.dstFilePath).includes('php-same')),
  },
  {
    id: 'F-019-multi', label: 'multi-line sibling control (F-019)',
    rels: ['php-multi/Vendor/Package/B.php', 'php-multi/Vendor/Package/C.php'],
    bugIs: (edges) => !edges.some(e => e.predicate === 'IMPORTS' && norm(e.dstFilePath).includes('php-multi')),
    fixedIs: (edges) => edges.some(e => e.predicate === 'IMPORTS' && e.confidence >= 0.9 && norm(e.dstFilePath).includes('php-multi')),
    always: 'fixed',
  },
  {
    id: 'F-014-C6', label: 'global use + namespace block must not cross-scope CALLS (F-014)',
    rels: ['php-scope/Vendor/Thing.php', 'php-scope/main.php'],
    bugIs: (edges) => edges.some(e => e.predicate === 'CALLS' && e.confidence >= 0.9 && norm(e.dstFilePath).includes('Thing.php')),
    fixedIs: (edges) => !edges.some(e => e.predicate === 'CALLS' && norm(e.dstFilePath).includes('Thing.php')),
  },
  {
    id: 'F-016-X1', label: 'renamed import must not bind to provider method (F-016)',
    rels: ['ts-renamed/m.ts', 'ts-renamed/app.ts'],
    bugIs: (edges) => edges.some(e => e.predicate === 'EXTENDS' && e.confidence >= 0.9 && e.dstQualifiedKey === 'M.Base'),
    fixedIs: (edges) => !edges.some(e => e.predicate === 'EXTENDS' && e.dstQualifiedKey === 'M.Base'),
  },
  {
    id: 'F-016-X2', label: 'renamed import of real export resolves (control)',
    rels: ['ts-renamed-x2/m.ts', 'ts-renamed-x2/app.ts'],
    bugIs: (edges) => !edges.some(e => e.predicate === 'EXTENDS' && e.confidence >= 0.9 && e.dstQualifiedKey === 'Base'),
    fixedIs: (edges) => edges.some(e => e.predicate === 'EXTENDS' && e.confidence >= 0.9 && e.dstQualifiedKey === 'Base'),
    always: 'fixed',
  },
  {
    id: 'F-017-Y1', label: 'configured binding must not bind to provider method (F-017)',
    rels: ['ts-config/worker.ts', 'ts-config/app.ts'],
    opts: { resolveModuleSpecifier: cfgResolver('ts-config/worker.ts') },
    bugIs: (edges) => edges.some(e => e.predicate === 'EXTENDS' && e.confidence >= 0.9 && e.dstQualifiedKey === 'W.Base'),
    fixedIs: (edges) => !edges.some(e => e.predicate === 'EXTENDS' && e.dstQualifiedKey === 'W.Base'),
  },
  {
    id: 'F-017-Y2', label: 'configured renamed import of real export resolves (control)',
    rels: ['ts-config/worker2.ts', 'ts-config/app2.ts'],
    opts: { resolveModuleSpecifier: cfgResolver('ts-config/worker2.ts') },
    bugIs: (edges) => !edges.some(e => e.predicate === 'EXTENDS' && e.confidence >= 0.9 && e.dstQualifiedKey === 'Base'),
    fixedIs: (edges) => edges.some(e => e.predicate === 'EXTENDS' && e.confidence >= 0.9 && e.dstQualifiedKey === 'Base'),
    always: 'fixed',
  },
  {
    id: 'F-020', label: 'single-char names lose CALLS/REFERENCES, multi-char do not (pre-existing)',
    rels: ['f020/B.php', 'f020/consumer.php', 'f020/User.php', 'f020/consumer-user.php'],
    bugIs: (edges) => {
      const bRefs = edges.filter(e => norm(e.dstFilePath).includes('f020/B.php') && (e.predicate === 'CALLS' || e.predicate === 'REFERENCES'));
      const uRefs = edges.filter(e => norm(e.dstFilePath).includes('f020/User.php') && (e.predicate === 'CALLS' || e.predicate === 'REFERENCES'));
      return bRefs.length === 0 && uRefs.length >= 2;
    },
    fixedIs: (edges) => edges.some(e => norm(e.dstFilePath).includes('f020/B.php') && (e.predicate === 'CALLS' || e.predicate === 'REFERENCES')),
    always: 'bug',
  },
];

function runBatch(absList, opts) {
  const results = absList.map(fp => parseFile(fp, src(fp))).filter(Boolean);
  return resolveEdges(results, undefined, undefined, opts);
}

function runCrossBatch(absList, opts) {
  const providerPaths = absList.slice(0, -1);
  const consumerPath = absList[absList.length - 1];
  const sources = new Map(providerPaths.map(fp => [fp, src(fp)]));
  const globalIndex = buildGlobalResolutionIndex(providerPaths, sources);
  const consumer = parseFile(consumerPath, src(consumerPath));
  return resolveEdges([consumer], undefined, globalIndex, opts);
}

const results = [];
let failed = 0;
for (const c of cases) {
  if (mode === 'crossbatch' && !c.rels.some(r => r.endsWith('.php'))) continue;
  const absList = files(c.rels);
  const edges = mode === 'crossbatch' ? runCrossBatch(absList, c.opts) : runBatch(absList, c.opts);
  const desired = c.always || expect;
  const isOk = desired === 'bug' ? c.bugIs(edges) : c.fixedIs(edges);
  if (!isOk) failed++;
  results.push({
    case: c.id, label: c.label, mode, expect: desired, pass: isOk,
    edges: edges.map(e => `${e.predicate}@${e.confidence} ${norm(e.dstFilePath).split('/').pop()} (${e.dstQualifiedKey})`),
  });
}

if (asJson) {
  console.log(JSON.stringify({ mode, expect, results, failed, total: results.length }, null, 1));
} else {
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.case} [${r.mode} expect=${r.expect}] — ${r.label}`);
    for (const e of r.edges) console.log(`       ${e}`);
  }
  console.log(`\n${results.length - failed}/${results.length} assertions hold (mode=${mode}, expect=${expect})`);
}
process.exit(failed ? 1 : 0);
