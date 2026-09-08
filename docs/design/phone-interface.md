# Le Yard Phone — locked interface specification

Approved direction: the supplied light/dark mobile reference, with Le Yard's warm neutrals, olive brand surface, and brass monogram. Primary actions use **#3866D6**, as specified on September 7, 2026.

- Inter Tight throughout Phone. Titles 22/28px semibold; section headings 19/24px semibold; body/day labels 14.5/18px regular; labels 12–13px. Brand/number-specific compositions may use 26px. Headings track -0.7px to -0.9px; body tracks +0.3px. The final instruction for negative heading tracking supersedes the earlier positive section-heading value.
- Circular icon and dial controls 38–46px; 6px inset highlight plus layered soft drop shadows. Primary controls retain tactile depth. Text actions and founder/filter segments stay shaped for readable labels.
- Shared CSS variables: `--text`, `--muted`, `--strong`, `--card`, `--button`, `--inner`, `--track`, `--ring`, `--primary`. Light and dark use the same markup. Theme choice is stored locally.
- Cards: no visible borders, inset highlight, subtle 1px ring, layered drop shadows. Outer cards 22px; ordinary cards 18px; rows/chips 11–14px. Circular controls 50%. No decorative device frame in the working app.
- Dividers: 1px `var(--track)`. Page margins 26px (20px only on very narrow screens), 16–22px group gaps, 8–12px component gaps.
- Floating capsule dock, contact rail based on real recent conversations, search, grouped call history, delivery metadata, voicemail playback, and visible consent controls. No invented unread counts, presence, charts, call analytics, or transcriptions.
- Motion: short view entrance, tactile press response, smooth theme/active control transitions. Respect reduced motion.

The existing provider, session, consent, error recovery, and idempotency behavior remains the contract. Visual review must cover mobile/desktop, both themes, all four destinations, and the composer.
