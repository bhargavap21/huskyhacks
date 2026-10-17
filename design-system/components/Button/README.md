Buttons in three weights: primary for the one action on a screen, secondary for alternatives, text for low-stakes links.

Markup: `<button class="in-btn in-btn--primary|--secondary|--text">`.

- The consumer provides a short sentence-case label ("Hold the transfer", "Call the member").
- One primary per view. Primary is `accent` with `on-accent`; hover moves to `accent-hover`.
- Secondary has a `line-strong` border on transparent; text buttons use `accent`.
- Radius is `radius-sm` (7px). Focus is a 2px `focus` ring at 2px offset. Disabled is 40% opacity.
