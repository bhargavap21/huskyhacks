Instinct is a quiet, editorial interface for a fraud tool that sits beside credit union staff. It borrows Sound Credit Union's colour palette (navy, blue, sky, gold, orange, ice) and sets it in Instinct's style: a pale page, a serif voice for headings, a plain sans for reading, hairline rows and a lot of air. It should feel like a well-set brief, not a dashboard.

## Content fundamentals

- Write in plain, short sentences. Speak to the member or staff person as "you". The product never says "I".
- Sentence case everywhere: headings, buttons, badges. No title case, no all caps.
- Headings name the source of the content, not a feeling: "What the panel said", "What the risk team said".
- Say what is unverified. A one-line `lead` under a heading states where the content came from ("Taken from the transcript you pasted.") and any caveat.
- Lists carry the substance. Each row opens with a short imperative or claim, then one explaining sentence: "Keep it simple. Pick one persona and one problem."
- No emoji, no exclamation marks, no marketing adjectives. Numbers stay numerals.

## Visual foundations

**Colour.** Set the page on `surface` and text in `ink-body`. Headings and the header title use `ink` (Sound `navy` in light). Links and the single primary action use `accent` with `on-accent`. Spend `highlight` (Sound `gold`) once per screen at most, with `on-highlight` text. `risk` (Sound orange) marks danger as a dot, bar or fill and always sits next to a word; risk wording uses `risk-text`, never `risk` itself. Captions and list numerals use `ink-muted`, on `surface` or `surface-raised` only.

**The header band.** A full-width `surface-band` strip, `header-height` tall. Product name centred in `title`, byline and date right-aligned in `meta` using `ink-body`, a text action ("Share") in `label`. No logo, no nav.

**Type.** Two families. `serif` (Newsreader) for `display`, `title`, `section` and `meta`, always weight 400. `sans` (Instrument Sans) for `lead`, `body`, `numeral`, `small` and `label`. Do not bold body copy for emphasis; restructure the sentence instead. Both faces load from Google Fonts.

**Layout.** One wide column with large side margins (216px at desktop, `space-4` on phones). Sections are separated by `space-8` of whitespace, never by rules or boxes. A `section` heading, then a `lead`, then `space-7`, then the list.

**Lists.** Ordered lists show the numeral in `ink-muted` in a `space-7` gutter, rows separated by a 1px `line` hairline, about 18px of padding above and below each row. Unordered lists use a small `ink-body` disc and no hairlines. Rows run long; let them wrap rather than truncate.

**Borders, shadows, radii.** Hairlines, not shadows. There is no shadow token. Rows, sections and the band are square (`radius-none`). Buttons and inputs take `radius-sm` (7px, Sound's own). Badges are `radius-pill`.

**States.** Hover darkens an accent fill to `accent-hover`. Focus is a 2px solid `focus` ring at a 2px offset, on every interactive element. Disabled drops to 40% opacity and removes the pointer.

**Dark theme.** A derived deep navy page (`surface`), `navy` as the raised layer, `sky` as the accent with navy labels, and `gold` as the focus ring. Sound's site has no dark mode; these values are an extension, not the brand's.

**Imagery and motion.** None by default. If a demo is shown, let it play with no captions over it ("show, do not explain"). Transitions, when used, are 150ms ease-out on colour only.

## Iconography

No icon set is part of this system. Prefer words. Where a mark is needed for status, use a filled circle (8px) in `risk`, `highlight` or `accent` before the word. Sound Credit Union's logo is not included and must not be redrawn; set "Instinct" in the `title` style instead.

## Accessibility notes

- `ink-muted` and `blue` fall to about 4.1 to 4.3:1 on `surface-band`. Use `ink` or `ink-body` there.
- `signal` orange is 3.6:1 on white: fills and icons only. `risk-text` is a darker derivation for wording.
- `line` hairlines are decorative. Controls take `line-strong` borders (3:1 or more in both themes).
