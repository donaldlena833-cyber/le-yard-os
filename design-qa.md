# Reservation floor design QA

## Comparison target

- Source visual truth: `/Users/donaldlena/.codex/generated_images/019ffb8a-cfb7-7af3-8dd3-7125d5e4dfab/exec-285cda67-74c0-4987-8e9b-4bf38a13f531.png`
- Browser-rendered implementation: `/Users/donaldlena/.codex/visualizations/2026/08/13/019ffb8a-cfb7-7af3-8dd3-7125d5e4dfab/le-yard-dark-floor-tablet-final.png`
- Interaction state: `/Users/donaldlena/.codex/visualizations/2026/08/13/019ffb8a-cfb7-7af3-8dd3-7125d5e4dfab/le-yard-dark-floor-dragged.png`
- Mobile state: `/Users/donaldlena/.codex/visualizations/2026/08/13/019ffb8a-cfb7-7af3-8dd3-7125d5e4dfab/le-yard-dark-floor-mobile-final.png`
- Combined final comparison: `/Users/donaldlena/.codex/visualizations/2026/08/13/019ffb8a-cfb7-7af3-8dd3-7125d5e4dfab/le-yard-direction-2-comparison-final.png`
- Source pixels: 1501 x 1048.
- Implementation CSS viewport: 1194 x 834 at device pixel ratio 1.
- Implementation capture pixels: 1184 x 827; normalized to 1194 x 834 for the combined comparison.
- Density normalization: source was aspect-fit/cropped to 1194 x 834; implementation was scaled to the same comparison frame. Browser chrome was excluded.
- State: authenticated demo reservation book, same service date and populated floor, default floor state plus active drag state.

## Findings

No actionable P0, P1, or P2 differences remain.

- [P3] The source mock uses a literal architectural line drawing and a bottom guest drawer; the implementation uses the product's real normalized table coordinates and keeps existing pacing/service context beneath the floor. This is intentional product fidelity rather than a visual regression: it preserves live floor semantics and existing service actions while adopting the source's floor-first hierarchy.

## Required fidelity surfaces

- Fonts and typography: the implementation retains Le Yard OS's established sans-serif stack and weights. The source's compact operational hierarchy is matched with dense uppercase eyebrows, strong reservation times, and restrained supporting copy. No truncation or wrapping blocks the floor task at tablet or mobile sizes.
- Spacing and layout rhythm: the tablet view uses a narrow day-book rail beside a dominant landscape floor. Controls align to the floor header and the compact service strip replaces dashboard-style metric cards. Radii and shadows stay within the existing design system.
- Colors and visual tokens: the user-requested deviation is applied deliberately: the floor is charcoal rather than the source's light plan. Cream tables, amber edit/needs-reset states, green occupied states, and muted room outlines remain legible and consistent.
- Image quality and asset fidelity: the selected direction contains no required photographic or illustrative asset. Lucide icons are used for controls; the floor itself is rendered from the actual reservation table model rather than a raster approximation.
- Copy and content: operational copy is direct and self-explanatory. Edit mode says that tables can be dragged and save automatically. The post-move notice names the table and exposes Undo. Guest confirmation copy and the email omit the internal confirmation number.

## Full-view comparison evidence

The combined final comparison shows the same core hierarchy as direction 2: a dense upcoming-book rail, a dominant floor, compact top-level service controls, direct edit affordance, and table-state color. The implementation intentionally adds the existing Le Yard OS navigation shell and changes the floor surface to charcoal per the user's selection.

## Focused region evidence

The active-drag capture shows the important fidelity details that are too small in the full comparison: the selected amber table, horizontal and vertical snap guides, visible move handles, a saved-state notice, and Undo. The mobile capture verifies that the floor switches to a portrait aspect so the real table layout remains separated and touchable.

## Comparison history

1. First tablet comparison: no P0/P1/P2 hierarchy issue. The dark floor, left book, edit control, and dominant room view matched the chosen direction.
2. First mobile pass found a P2 responsive issue: the landscape floor compressed 17 minimum-size touch targets into too little height, creating visible overlap.
3. Fix applied: changed the floor to a 3:4 portrait aspect below the small breakpoint while retaining 16:10 from tablet upward.
4. Post-fix evidence: `le-yard-dark-floor-mobile-final.png` shows separated table targets, readable zone labels, visible legend, and no hidden persistent controls.

## Interaction and browser checks

- Edit floor control enabled only with `reservations.configure`.
- Pointer/touch-style drag moved table 15 and immediately showed saved feedback.
- Undo restored the prior normalized position without a confirmation dialog.
- Mobile Book/Floor/Service switcher exposed the floor correctly.
- Browser console checked: no application error; only the existing reduced-motion development warning was present.

## Implementation checklist

- [x] Floor-first tablet composition.
- [x] Dark floor surface with semantic table colors.
- [x] Touch, pointer, and keyboard drag sensors.
- [x] Optimistic coordinate persistence and failure rollback.
- [x] Undo after a move.
- [x] Portrait mobile floor treatment.
- [x] One-step public booking and confirmation email.
- [x] Clean email without a confirmation number.

final result: passed
