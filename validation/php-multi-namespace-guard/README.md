# PHP namespace scope validation fixtures

This directory contains three small PHP sources and a positive control for
checking namespace-scope handling. They are deliberately independent of any
particular test runner: a harness can feed each source to a parser and import
resolution implementation and inspect the resulting namespace classification
and edges.

## Fixtures

| File | Input shape | Expected classification |
| --- | --- | --- |
| `two-blocks-same-name.php` | Two braced namespace blocks share the same namespace name. | Multi-namespace; do not build one file-wide import map. |
| `use-only-block.php` | One braced namespace block contains only `use` statements, next to a block with a declaration. | Multi-namespace; the use-only block still has its own scope. |
| `single-namespace.php` | One ordinary namespace declaration contains a `use` and a function using the imported type. | Single-namespace; retain normal import resolution. |

## Expected behavior

A namespace guard must count namespace definitions at the syntax-tree level,
including braced blocks that contain no type declarations. The first two
fixtures therefore represent multiple scopes even when generated entities
would expose only one distinct scope string or no scope entry for the use-only
block. Their file-wide import map must not be applied across those scopes.

The single-namespace fixture is a positive control. It must remain eligible for
normal import resolution; a guard that rejects every file is incorrect.

## Suggested checks

For each fixture, parse the source, count its `namespace_definition` nodes, and
then run the implementation's import or edge-resolution step. The expected
namespace counts are:

- `two-blocks-same-name.php`: 2
- `use-only-block.php`: 2
- `single-namespace.php`: 1

The two multi-scope cases should not produce a confident file-wide import edge
that crosses namespace blocks. The positive control should continue to resolve
its imported `Account` type within its one namespace scope.
