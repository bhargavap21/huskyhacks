## Design system

This project uses the Instinct design system in `design-system/`.
Before building or changing any UI, read `design-system/README.md` and the guideline for the component you touch in `design-system/components/<Name>/README.md`.

- Load `design-system/tokens.css`, then `design-system/components.css`.
- Use the CSS variables (`var(--accent)`, `var(--space-5)`) and type classes (`.section`, `.body`). Never hard-code hex colors, font sizes or spacing.
- Reuse the `in-*` component classes (`in-header`, `in-section`, `in-ol`, `in-btn`, `in-badge`) before writing new styles.
- New components follow the same rules: square corners except buttons (`radius-sm`) and badges (`radius-pill`), hairlines not shadows, sentence case, gold (`highlight`) at most once per screen, risk color always paired with a word.
- Check text contrast against the README's accessibility notes in both light and dark themes.
