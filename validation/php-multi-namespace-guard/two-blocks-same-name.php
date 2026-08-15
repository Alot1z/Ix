<?php
// Edge case 1 (from PR-446 F-001): two braced blocks SHARING one namespace name.
//
// The old multi-namespace guard counted distinct `packageScope` strings from
// entities, so this file produced size === 1 ("Shared" appears once) and the
// per-file `use` index was applied to BOTH blocks — resolving `Account` (which
// the second block declares itself) against Vendor\Package and pointing it at
// the wrong file.
//
// Correct behaviour (83b9be4's parser-level count): the file declares TWO
// namespace_definition nodes, so `phpNamespaceBlocks === 2` and the per-file
// FQCN import map is skipped entirely.
namespace Shared {
    use Vendor\Package\Account;
    function run(Account $a): void { new Account(); $a->save(); }
}

namespace Shared {
    class Account { public function save(): void {} }
}
