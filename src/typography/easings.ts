/**
 * GSAP easing curves, ported to plain functions for Remotion.
 *
 * WHY THIS FILE EXISTS:
 * The portfolio uses GSAP (`ease: 'power4.out'`, `'power3.inOut'`, etc.).
 * GSAP can't run inside a Remotion composition — GSAP animates on
 * wall-clock time via requestAnimationFrame, but Remotion needs every
 * frame to be a pure function of `useCurrentFrame()` so renders are
 * deterministic. So we port the *curves* instead of the library.
 *
 * GSAP's PowerN easings are just polynomial ease functions:
 *   power1 = quad (^2), power2 = cubic (^3) ... actually GSAP maps:
 *   power1 -> ^2, power2 -> ^3, power3 -> ^4, power4 -> ^5
 *   (GSAP's "Power3" is the 4th-degree curve.)
 *
 * Each takes t in [0,1] and returns eased t in [0,1]. Feed them to
 * Remotion's `interpolate(..., { easing })` or apply directly.
 */

const easeOutPow = (p: number) => (t: number) => 1 - Math.pow(1 - t, p);
const easeInPow = (p: number) => (t: number) => Math.pow(t, p);
const easeInOutPow = (p: number) => (t: number) =>
  t < 0.5
    ? Math.pow(2 * t, p) / 2
    : 1 - Math.pow(-2 * t + 2, p) / 2;

// GSAP "power3" === degree 4, "power4" === degree 5.
export const power3 = {
  out: easeOutPow(4),
  in: easeInPow(4),
  inOut: easeInOutPow(4),
};

export const power4 = {
  out: easeOutPow(5),
  in: easeInPow(5),
  inOut: easeInOutPow(5),
};

/**
 * A spring-ish ease as a pure t->t function (slight overshoot then settle).
 * The real Remotion spring() needs fps; this is the curve-only version so
 * the schema's "spring" easing option works the same way as the polynomials.
 */
const springCurve = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // damped oscillation that ends exactly at 1
  return (
    1 - Math.pow(2, -10 * t) * Math.cos((t * 10 - 0.75) * ((2 * Math.PI) / 3))
  );
};

/**
 * Resolve the schema's `easing` enum value to an easing function.
 * Keeps the parameter editor (a dropdown) wired to real curves.
 */
export type EasingName = "power3.out" | "power3.inOut" | "power4.out" | "spring";

export const resolveEasing = (name: EasingName): ((t: number) => number) => {
  switch (name) {
    case "power3.inOut":
      return power3.inOut;
    case "power4.out":
      return power4.out;
    case "spring":
      return springCurve;
    case "power3.out":
    default:
      return power3.out;
  }
};

/**
 * Map a `direction` + a progress 0..1 + a travel distance to an {x,y}
 * offset and a scale. Centralizes how the `direction` parameter works
 * across all beat types.
 */
export const directionOffset = (
  direction: "up" | "down" | "left" | "right" | "scale",
  progress: number, // 0 = start (offset), 1 = settled (no offset)
  distance: number,
): { x: number; y: number; scale: number } => {
  const remaining = 1 - progress; // how far still to travel
  switch (direction) {
    case "down":
      return { x: 0, y: -distance * remaining, scale: 1 };
    case "left":
      return { x: distance * remaining, y: 0, scale: 1 };
    case "right":
      return { x: -distance * remaining, y: 0, scale: 1 };
    case "scale":
      return { x: 0, y: 0, scale: 1 - remaining * 0.6 };
    case "up":
    default:
      return { x: 0, y: distance * remaining, scale: 1 };
  }
};
