# PHP multi-namespace guard — repro fixtures (PR #446)

Minimal PHP files reproducing the two multi-namespace shapes behind PR #446's
namespace-guard work, plus the single-namespace control. They exist so any
implementation of the guard can be re-checked against the exact shapes that
broke the original entity-side version.

## Files

| File | Shape | Expected classification |
|------|-------|------------------------|
| `two-blocks-same-name.php` | Two braced `namespace Shared { ... }` blocks sharing one name | MULTI — skip the per-file FQCN import map |
| `use-only-block.php` | A `use`-only braced block next to a type-defining block | MULTI — skip the per-file FQCN import map |
| `single-namespace.php` | One `namespace Vendor\Package;` block | SINGLE — keep the FQCN import map (must still resolve) |

## What each shape breaks

- `two-blocks-same-name.php` — an entity-scope guard counts distinct
  `packageScope` strings; both blocks share the name "Shared", so it sees
  `size === 1` and applies one block's `use` to the other, resolving a name the
  second block declares itself.
- `use-only-block.php` — a use-only block declares no type definitions and
  therefore contributes no `packageScope` entry at all, yet its imports are
  still confined to it. The guard never saw the block exist.
- `single-namespace.php` — the control: the guard must skip only the rare
  multi-namespace files and must not become "skip every file".

## Expected behavior

A correct guard classifies the two multi-namespace files as multi-namespace and
skips building the per-file FQCN import map (no confident 0.9 REFERENCES/CALLS
edge to a vendor file for a name the file declares itself), while the
single-namespace control still resolves normally.

## Reference implementations

- Upstream authoritative: `83b9be4` — counts `namespace_definition` nodes at
  the parser (`phpNamespaceBlocks`), on the same walk that already collects the
  unbraced spans.
- Independent fork validation: `0701040` (branch `fix/446-multi-namespace-guard`)
  — counts namespace-definition module entities; valid but shape-dependent.

## How to use

Feed the files through `core-ingestion`'s `parseFile`/`resolveEdges` (for
example, drop them into the `resolveEdges` test harness as inline sources): the
two multi-namespace files must not produce the confident FQCN edges, and the
control must. Recorded results: `resolveEdges` 82/82 on `0701040`, 83/83 on
`83b9be4` (see `planning/audit/tests/TEST-RESULTS.md` in the fork for the
recorded runs).
