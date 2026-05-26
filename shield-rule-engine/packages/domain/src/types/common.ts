export type Primitive = number | string;

export type CmpOp = "eq" | "neq" | "lt" | "le" | "gt" | "ge";

export const CMP_OPS: readonly CmpOp[] = ["eq", "neq", "lt", "le", "gt", "ge"] as const;

export type TimeUnit = "sec" | "min" | "h" | "d";

export const TIME_UNITS: readonly TimeUnit[] = ["sec", "min", "h", "d"] as const;

export type Duration = Readonly<{
  value: number;
  unit: TimeUnit;
}>;

export type Action = "DECLINE" | "LOCK" | "WARM";

export const ACTIONS: readonly Action[] = ["DECLINE", "LOCK", "WARM"] as const;

export type Position = Readonly<{
  offset: number;
  line: number;
  column: number;
}>;

export type Span = Readonly<{
  start: Position;
  end: Position;
}>;

export const ZERO_POS: Position = Object.freeze({ offset: 0, line: 1, column: 1 });
export const ZERO_SPAN: Span = Object.freeze({ start: ZERO_POS, end: ZERO_POS });

export const SOURCE_CMP_OPS: Readonly<Record<string, CmpOp>> = Object.freeze({
  "=": "eq",
  "!=": "neq",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
});

export function durationMs(d: Duration): number {
  const unit = d.unit;
  const value = d.value;
  const sec = 1000;
  const min = 60 * sec;
  const h = 60 * min;
  const day = 24 * h;
  const table: Record<TimeUnit, number> = { sec, min, h, d: day };
  return value * table[unit];
}
