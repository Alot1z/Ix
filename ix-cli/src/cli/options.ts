import { InvalidArgumentError } from "commander";

/**
 * Parse a flag that must be a positive integer, rejecting anything else.
 *
 * The regex is the check; `Number` is only the conversion. `Number.parseInt`
 * on its own is not a validator and never was: it reads `"10abc"` as 10,
 * `"0x10"` as 0, `"1e3"` as 1 and `"-5"` as -5, so every one of those reaches
 * the command as a value the caller never typed. `Number.isSafeInteger` then
 * rejects the digit strings too large to survive the round trip.
 *
 * `example` is interpolated into the message so each flag can show a plausible
 * value for itself; the wording is otherwise identical, because the rule is.
 */
function parsePositiveInt(value: string, example: string): number {
  const normalized = value.trim();
  const reject = () =>
    new InvalidArgumentError(`must be a positive integer (for example, ${example})`);
  if (!/^\+?[1-9]\d*$/.test(normalized)) throw reject();

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) throw reject();
  return parsed;
}

export function parsePickOption(value: string): number {
  return parsePositiveInt(value, "1 or 2");
}

/**
 * Parse a `--max-*` budget flag.
 *
 * Validated at parse time rather than read back out of the raw option string
 * later, so the value is parsed once and a malformed one is refused where the
 * user can see which flag they mistyped. `ix context --diff` reports the
 * requested budget back to the caller, and a silently repaired number
 * (`--max-entities 1e3` becoming 1) is a misreport of the one thing that record
 * exists to carry.
 */
export function parseBudgetOption(value: string): number {
  return parsePositiveInt(value, "50");
}
