/**
 * Minimal type declarations for `flubber` (no official @types package).
 * Only the surface we use. flubber morphs SVG path `d` strings.
 */
declare module "flubber" {
  type Point = [number, number];
  interface Options {
    maxSegmentLength?: number;
    string?: boolean;
    single?: boolean;
  }
  /** Returns an interpolator: t in [0,1] -> SVG path `d` string. */
  export function interpolate(
    fromShape: string | Point[],
    toShape: string | Point[],
    options?: Options,
  ): (t: number) => string;
  export function toCircle(
    fromShape: string,
    cx: number,
    cy: number,
    r: number,
    options?: Options,
  ): (t: number) => string;
  export function fromCircle(
    cx: number,
    cy: number,
    r: number,
    toShape: string,
    options?: Options,
  ): (t: number) => string;
  export function separate(
    fromShape: string,
    toShapes: string[],
    options?: Options,
  ): (t: number) => string[];
  export function combine(
    fromShapes: string[],
    toShape: string,
    options?: Options,
  ): (t: number) => string[];
  export function interpolateAll(
    fromShapes: string[],
    toShapes: string[],
    options?: Options,
  ): Array<(t: number) => string>;
}
