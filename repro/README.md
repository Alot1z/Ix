# Ix finding reproduction harness (`repro/`)

Deterministic `resolveEdges` probes for the #446-era findings F-014, F-016,
F-017, F-019 (plus pre-existing F-020). Runs against whichever `core-ingestion`
dist is present in the tree, so it works for any Git state:

- **upstream main** → asserts the bugs are present (`--expect bug`)
- **a fork-fix commit** (or a cherry-pick/apply of one onto main) → asserts the
  bugs are gone (`--expect fixed`)

## Usage

```bash
# build core-ingestion for the current checkout
cd core-ingestion && npm ci && npm run build && cd ..

# upstream main: bugs must reproduce
node repro/probe.mjs --mode inbatch --expect bug
node repro/probe.mjs --mode crossbatch --expect bug   # PHP cross-batch path

# after applying a fork fix (git apply, or check out a fix branch):
node repro/probe.mjs --expect fixed
```

Machine-readable output: `node repro/probe.mjs --json`. Exit 0 = all
assertions for the mode+expect combination hold.

Override the loaded dist: `IX_CORE_INGESTION_DIST=/abs/path/core-ingestion/dist/index.js`.

## Cases

| Case | Fixture | Bug asserted (expect=bug) | Fix asserted (expect=fixed) |
|---|---|---|---|
| F-019-same | `php-same/` (two classes on one line + consumer `new B()`) | no IMPORTS edge (false negative) | IMPORTS@0.9 to B.php |
| F-019-multi | `php-multi/` (multi-line control) | — | always resolves (control) |
| F-014-C6 | `php-scope/` (global `use Vendor\Thing` + `namespace A { class Thing {} }` + `new Thing()`) | wrong CALLS@0.9 to Vendor/Thing.php | no CALLS to Vendor/Thing.php |
| F-016-X1 | `ts-renamed/` (renamed import, provider has only method `Base`) | EXTENDS@0.9 qkey M.Base | no EXTENDS |
| F-016-X2 | `ts-renamed-x2/` (real export) | — | always resolves (control) |
| F-017-Y1 | `ts-config/` (`@core` mapping, provider has only method `Base`) | EXTENDS@0.9 qkey W.Base | no EXTENDS |
| F-017-Y2 | `ts-config/` (real export) | — | always resolves (control) |
| F-020 | `f020/` (single-char `B` vs `User`) | B loses CALLS/REFERENCES, User keeps them | — (pre-existing, always asserted) |

Note on F-017: on merged main the plain-key guard is needed on BOTH the
configured block and the unified #443 fallback (`f9274cc` + `cba11a3`); a
single guard is not sufficient. The harness's `--expect fixed` run for Y1
therefore only passes when both guards are present.

## How to apply a fork fix onto an arbitrary base

```bash
# from the Ix-remap repo (fix commits live there):
git show <fix-sha> -- core-ingestion/src/index.ts | git apply --3way   # in this worktree
```

Historical fix commits: `0a7d97f` (F-014), `f577492` (F-019),
`cba11a3` (F-016), `f9274cc` (F-017).
