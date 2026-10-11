import { CostTerm } from "@critter-evo/core";

/**
 * Series colors: the dataviz reference categorical palette's dark steps, in
 * slot order. Checked with its validator against the panel surface (#161a1f):
 * every adjacent pair clears ΔE 8 under color vision deficiency and ΔE 15 with
 * normal vision, and every color has 3:1 contrast. Assign slots in order, so
 * neighbors in a legend or a stack always differ.
 */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"] as const;

/** Energy eaten: the green slot, for food. */
export const EATEN_COLOR = SERIES_COLORS[5];

/**
 * All costs together, beside energy eaten: violet, which clears every check
 * against the eaten green. Brain cost shares it, on its own chart.
 */
export const SPENT_COLOR = SERIES_COLORS[6];

/** Cost terms in the order they are listed and stacked, taking the other slots in order. */
export const COST_TERM_ORDER: readonly CostTerm[] = [
  CostTerm.Basal,
  CostTerm.Traits,
  CostTerm.Movement,
  CostTerm.Terrain,
  CostTerm.Thermal,
  CostTerm.Brain,
  CostTerm.Senses,
];

/** Color of each cost term, by CostTerm. */
export const COST_TERM_COLORS: Record<CostTerm, string> = Object.fromEntries(
  COST_TERM_ORDER.map((term, k) => [term, SERIES_COLORS[k < 5 ? k : k + 1]!]),
) as Record<CostTerm, string>;

/** Brain and senses cost nothing until brains and eyes arrive, so they are left out while zero. */
export function shownCostTerms(costs: ArrayLike<number>): CostTerm[] {
  return COST_TERM_ORDER.filter((term) => (term !== CostTerm.Brain && term !== CostTerm.Senses) || costs[term]! > 0);
}
