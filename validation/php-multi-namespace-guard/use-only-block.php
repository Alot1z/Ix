<?php
// Edge case 2 (from PR-446 F-001): a braced block containing ONLY `use`
// statements, alongside a type-defining block.
//
// A use-only block declares no type definitions, so it contributes NO
// `packageScope` entry from the entity side — the old guard saw only one scope
// and let the file through, applying the first block's `use` to the second.
//
// Correct behaviour (83b9be4's parser-level count): the file declares TWO
// namespace_definition nodes (one use-only), so `phpNamespaceBlocks === 2` and
// the per-file FQCN import map is skipped entirely.
namespace App {
    use Vendor\Package\Service;
}

namespace Other {
    function run(Service $s): void { $s->execute(); }
}
