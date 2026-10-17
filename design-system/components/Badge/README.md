A pill that states a risk level in words, with a coloured dot as the second signal.

Markup: `<span class="in-badge in-badge--risk|--review|--safe|--neutral">`.

- The consumer provides one to three words ("Likely scam", "Needs review", "Verified", "No signal").
- `--risk`: `risk-text` on `risk-soft` with a `risk` dot. `--review`: `on-highlight` on `highlight` (the gold moment, so one per screen). `--safe`: `ink` on `safe-soft` with an `accent` dot. `--neutral`: `ink-muted` with a `line` outline.
- Never rely on the colour alone; the word carries the meaning.
