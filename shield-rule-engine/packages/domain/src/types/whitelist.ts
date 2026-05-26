import type { Action, TimeUnit } from "./common.js";

export type FieldType = "int" | "string" | "bool" | "cvv";

export type FieldSpec = Readonly<{
  name: string;
  type: FieldType;
}>;

export type FunctionSpec = Readonly<{
  name: string;
  groupingFields: readonly string[];
  allowedWindowUnits: readonly TimeUnit[];
  maxWindowValue: Readonly<Record<TimeUnit, number>>;
}>;

export type Whitelist = Readonly<{
  fields: readonly FieldSpec[];
  functions: readonly FunctionSpec[];
  actions: readonly Action[];
}>;
