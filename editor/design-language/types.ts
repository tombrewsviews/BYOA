export type AxisKey =
  | "temperature" | "contrast" | "density" | "softness" | "character" | "weight";
export type DialState = Record<AxisKey, number>; // each -3..+3
export type Delta = Partial<DialState>;
/** Resolved output: CSS custom property name -> value string. */
export type TokenMap = Record<string, string>;
export type DialAxis = {
  key: AxisKey;
  label: string;
  minLabel: string; // e.g. "cooler"
  maxLabel: string; // e.g. "warmer"
};
