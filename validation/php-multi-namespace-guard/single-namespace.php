<?php
// Positive control (from PR-446 F-001): the common single-namespace file must
// STILL be indexed. The multi-namespace guard exists to skip only the rare
// multi-namespace files — it must not quietly become "skip every file".
//
// Correct behaviour: this file declares exactly ONE `namespace_definition`
// node, so `phpNamespaceBlocks === 1` and the per-file FQCN import map IS
// built: `Account` resolves to Vendor\Package\Account via the `use`.
namespace Vendor\Package;

use Vendor\Package\Account;

function run(Account $a): void { new Account(); $a->save(); }
