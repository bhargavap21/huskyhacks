The full-width header band that opens every Instinct page: product name centred, byline and one action on the right.

Markup: `<header class="in-header">` holding `<h1 class="in-header__title">`, a `<span class="in-header__meta">` and a `<button class="in-header__action">`.

- The consumer provides the product name, the byline ("Made for <name> · <date>") and at most one text action.
- Background `surface-band`; title in `title` style and `ink`; meta in `meta` style and `ink-body` (not `ink-muted`, which fails on the band).
- Do not add a logo, navigation or a second action. Do not round or shadow the band.
