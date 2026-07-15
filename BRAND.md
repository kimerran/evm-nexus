# BRAND.md — EVM Nexus Design System

> Visual and interaction guidelines for **EVM Nexus**, an EVM-chain testing console.
> Derived directly from the provided mock HTML. This is the single source of truth for
> theme, tokens, typography, components, and motion. Every UI surface must conform to it.

---

## 1. Brand Essence

| Attribute | Value |
|---|---|
| Product name | **EVM Nexus** |
| Category | Developer tooling / blockchain infrastructure console |
| Personality | Technical, precise, engineered, "protocol-grade". Confident but calm. |
| Voice | Terse, factual, monospace-forward. Speaks in metrics ("Latency: 12ms", "Sync: 99.8%", "TPS Rate 1,420"). Uses systems language: *provision, broadcast, mempool, drip, bombard, keypair, sponsored transaction*. |
| Feel | Dark "cockpit" surface, cyan instrumentation glow, glassmorphism, live telemetry. Data is the hero. |
| Do | Show real-time status, use HEX/hash affordances, keep chrome minimal, let cyan mean "active/live". |
| Don't | Use playful illustration, rounded pill everything, bright multi-color palettes, marketing fluff, or light backgrounds. |

The aesthetic is a **Material Design 3 dark theme** re-skinned for a crypto/EVM instrument panel: near-black teal-tinted surfaces, a single electric-cyan accent, and two typefaces (a humanist grotesk for reading, a monospace for all machine data).

---

## 2. Color System (Material Design 3 tokens)

All colors are defined as design tokens. **Never hardcode hex values in components** — reference the token name (Tailwind class or CSS variable). The palette is dark-only.

### 2.1 Core surfaces
| Token | Hex | Usage |
|---|---|---|
| `background` | `#0d1516` | App background (page canvas) |
| `surface` / `surface-dim` | `#0d1516` | Base surface |
| `surface-container-lowest` | `#080f11` | Top nav bar, deepest wells, terminal backgrounds |
| `surface-container-low` | `#151d1e` | Inputs, insets, low cards, table headers |
| `surface-container` | `#192122` | Default card / panel background, side nav |
| `surface-container-high` | `#242b2d` | Hover states, raised chips, segmented buttons |
| `surface-container-highest` | `#2e3638` | Toasts, active toggles-off track, elevated chips |
| `surface-bright` | `#333a3c` | Brightest surface accent |
| `surface-variant` | `#2e3638` | Variant fills |

### 2.2 Primary (electric cyan — the accent)
| Token | Hex | Usage |
|---|---|---|
| `primary` | `#c3f5ff` | Primary text-on-dark, key figures, links, focus text |
| `primary-container` | `#00e5ff` | Primary buttons ("Connect Wallet", "Request Tokens"), key CTAs |
| `primary-fixed` | `#9cf0ff` | Fixed primary |
| `primary-fixed-dim` | `#00daf3` | Logotype "EVM Nexus", scrollbar hover, gradient stops, glow |
| `surface-tint` | `#00daf3` | Elevation tint / glow color |
| `on-primary` | `#00363d` | Text/icons on `primary` fills |
| `on-primary-container` | `#00626e` | Text/icons on `primary-container` fills |
| `on-primary-fixed` | `#001f24` | — |
| `on-primary-fixed-variant` | `#004f58` | — |
| `inverse-primary` | `#006875` | Inverse surfaces |

### 2.3 Secondary (slate blue — structural accents, active nav)
| Token | Hex | Usage |
|---|---|---|
| `secondary` | `#b7c8e1` | Secondary icons/text |
| `secondary-container` | `#3a4a5f` | **Active sidebar item background**, badges ("3 Total") |
| `secondary-fixed` | `#d3e4fe` | — |
| `secondary-fixed-dim` | `#b7c8e1` | — |
| `on-secondary` | `#213145` | — |
| `on-secondary-container` | `#a9bad3` | Text/icons on active nav item |
| `on-secondary-fixed` | `#0b1c30` | — |
| `on-secondary-fixed-variant` | `#38485d` | — |

### 2.4 Tertiary (amber — warnings, "moderate", secondary status)
| Token | Hex | Usage |
|---|---|---|
| `tertiary` | `#ffeac0` | Tertiary text |
| `tertiary-container` | `#fec931` | Tertiary fills |
| `tertiary-fixed` | `#ffdf96` | — |
| `tertiary-fixed-dim` | `#f3bf26` | — |
| `on-tertiary` | `#3e2e00` | — |
| `on-tertiary-container` | `#6f5500` | — |
| `on-tertiary-fixed` | `#251a00` | — |
| `on-tertiary-fixed-variant` | `#594400` | — |

Amber is used for **caution / "Moderate" congestion / SYSTEM log lines / pending confirmations**.

### 2.5 Error (coral — failures, destructive)
| Token | Hex | Usage |
|---|---|---|
| `error` | `#ffb4ab` | Error text, "REJECTED"/"Failed" states, delete-hover icon |
| `error-container` | `#93000a` | Error fill, "STRESS TEST MODE" badge bg |
| `on-error` | `#690005` | — |
| `on-error-container` | `#ffdad6` | Text on error fills, delete hover fg |

### 2.6 Text, outlines, inverse
| Token | Hex | Usage |
|---|---|---|
| `on-surface` / `on-background` | `#dce4e5` | Primary body text |
| `on-surface-variant` | `#bac9cc` | Secondary/muted text, inactive nav labels, captions |
| `outline` | `#849396` | Strong borders, input placeholders-search icon |
| `outline-variant` | `#3b494c` | **Default hairline borders/dividers** (most common border) |
| `inverse-surface` | `#dce4e5` | Inverse surface |
| `inverse-on-surface` | `#2a3233` | Text on inverse surface |

### 2.7 Semantic status → color mapping
| State | Token(s) |
|---|---|
| Live / active / online | `primary` / `primary-fixed-dim`, small pulsing dot (green `#22c55e` is acceptable for a literal "online" LED only) |
| Success / confirmed | `on-primary-container` on `primary/10` chip; green `#16a34a` allowed for a completed action button |
| Pending / confirming / moderate | `tertiary` |
| Failed / rejected / destructive | `error` / `error-container` |
| Encrypted / secure | `secondary` |

> The mock uses raw Tailwind `green-*` only for a literal network-health LED and a transient "Tokens Sent!" success flash. Treat green as a **status LED only**, never as a brand color. Cyan is the brand.

---

## 3. Typography

Two families only. Load via Google Fonts.

```
Hanken Grotesk — weights 400, 600, 700, 800  (UI + display + reading)
JetBrains Mono — weights 400, 700            (all machine data: hashes, addresses, code, labels)
```

### 3.1 Type scale (name → size / line-height / tracking / weight / family)
| Token | Size / LH | Tracking | Weight | Family | Usage |
|---|---|---|---|---|---|
| `display-lg` | 48px / 56px | −0.02em | 700 | Hanken Grotesk | Page H1 ("Dashboard", "Asset Launchpad") |
| `headline-md` | 24px / 32px | 0 | 600 | Hanken Grotesk | Card/section titles, logotype |
| `body-md` | 16px / 24px | 0 | 400 | Hanken Grotesk | Body copy, descriptions |
| `label-caps` | 11px / 16px | 0.05em | 700 | JetBrains Mono | UPPERCASE eyebrow labels, nav labels, field labels |
| `code-sm` | 14px / 20px | 0 | 400 | JetBrains Mono | Addresses, balances, metrics |
| `code-xs` | 12px / 16px | 0 | 400 | JetBrains Mono | Timestamps, hex strings, fine print, log lines |

### 3.2 Rules
- **All addresses, hashes, tx IDs, balances, gas figures, chain IDs, timestamps, and code use JetBrains Mono.** Never render hex/address data in the grotesk.
- `label-caps` is always UPPERCASE with letter-spacing; used for field labels and eyebrows ("RPC URL ENDPOINT", "DESTINATION ADDRESS", "PEER COUNT").
- Truncate long hashes as `0x71C…3A2` (leading 3–5 + ellipsis + trailing 3–4), monospace, with a hover `content_copy` affordance.
- Body text is `on-surface`; muted/secondary text is `on-surface-variant`.

---

## 4. Iconography

- **Material Symbols Outlined** exclusively. Default variation: `FILL 0, wght 400, GRAD 0, opsz 24`.
- Use `FILL 1` for the active/emphasis state of a feature icon (e.g. filled `water_drop`/`opacity` on the active Faucet, filled `rocket_launch` on the Bombard header).
- `vertical-align: middle` when inline with text.
- Recurring glyphs: `water_drop`/`opacity` (Faucet), `rocket_launch` (Launchpad/Bombard), `science` (Transaction Lab), `forum` (On-chain Chat), `key`/`key_visualizer` (Keypairs/API), `hub`/`dns` (network), `bolt` (execute), `content_copy`, `search`, `settings`, `notifications`, `add_link`, `account_balance_wallet`, `security`, `terminal`, `data_object`, `speed`.

---

## 5. Shape & Spacing

### 5.1 Border radius (note: `full` is 12px here, **not** a pill)
| Token | Value |
|---|---|
| `DEFAULT` | 0.125rem (2px) |
| `lg` | 0.25rem (4px) — chips, small buttons, table cells |
| `xl` | 0.5rem (8px) — **cards, panels, inputs, primary buttons** (most common) |
| `full` | 0.75rem (12px) — largest containers only |

Genuine circles (avatars, status dots, toggle knobs) use `rounded-full` via `border-radius: 50%` / Tailwind `rounded-full` on square boxes — supply these explicitly since the token `full` is 12px, not 9999px.

### 5.2 Spacing scale
| Token | px | | Token | px |
|---|---|---|---|---|
| `base` | 4 | | `gutter` | 20 |
| `xs` | 8 | | `lg` | 24 |
| `sm` | 12 | | `xl` | 32 |
| `md` | 16 | | `margin-mobile` | 16 |
| | | | `margin-desktop` | 40 |

- Page content padding: `margin-desktop` (40px) on desktop, `margin-mobile` (16px) on mobile.
- Grid gutter between bento cards: `gutter` (20px).
- Card internal padding: `lg` (24px) or `xl` (32px) for large config panels.

---

## 6. Layout System

### 6.1 App shell
```
┌────────────────────────────────────────────────────────────┐
│ TopNavBar  h-16  sticky  bg-surface-container-lowest        │  border-b outline-variant
│  [EVM Nexus]  Explorer  Docs  Bridge      [search][icons][Connect Wallet][avatar] │
├───────────┬────────────────────────────────────────────────┤
│ SideNav   │  Main content canvas                            │
│ w-64      │  bg-background, overflow-y-auto, custom-scroll   │
│ fixed     │  padding = margin-desktop                       │
│ bg-       │  ┌─ Page header (display-lg H1 + subtitle)      │
│ surface-  │  │                                              │
│ container │  └─ Bento grid (grid-cols-12 gap-gutter)        │
└───────────┴────────────────────────────────────────────────┘
```
- **TopNavBar**: height `h-16` (64px), `sticky top-0 z-50`, background `surface-container-lowest`, bottom border `outline-variant`. Left: logotype (`headline-md`, `primary-fixed-dim`) + nav links. Right: search input, `settings`/`notifications` icon buttons, `Connect Wallet` primary button, avatar.
- **SideNavBar**: `w-64`, `fixed left-0 top-16`, height `calc(100vh-64px)`, background `surface-container`, right border `outline-variant`. Top: network status block (Mainnet badge + latency). Middle: primary nav. Bottom (mt-auto): Support, API Keys, Network Settings.
- **Main**: offset by `ml-64`, scrolls independently with the custom scrollbar, max content width `max-w-7xl mx-auto`.
- **Responsive**: sidebar hides under `md`; nav links hide under `md`; search hides under `lg`.

### 6.2 Nav item states
- Inactive: `text-on-surface-variant`, `hover:bg-surface-container-high`, `rounded-lg`, `active:translate-x-1` (150ms).
- **Active: `bg-secondary-container text-on-secondary-container font-bold`.**
- Top-nav active link: `text-primary font-bold border-b-2 border-primary`.

### 6.3 Bento grid
12-column grid, `gap-gutter`. Metric stat cards span 1/3; hero visualization spans full; side controls span 4 cols; config panels span 12. Cards: `bg-surface-container rounded-xl border border-outline-variant`, hover `hover:border-primary/50 transition-colors`.

---

## 7. Component Patterns

### 7.1 Card / Panel
```html
<div class="bg-surface-container p-lg rounded-xl border border-outline-variant
            hover:border-primary/50 transition-colors">
```
Variant — **glass panel** (for overlays, launchpad forms, right-rail tips):
```css
background: rgba(30, 41, 59, 0.4);   /* 0.4–0.7 depending on depth */
backdrop-filter: blur(8px–12px);
border: 1px solid #3b494c;           /* outline-variant */
```

### 7.2 Buttons
| Variant | Classes |
|---|---|
| Primary CTA | `bg-primary-container text-on-primary-container rounded-lg font-bold hover:brightness-110 active:scale-95 transition-all` |
| Primary (alt) | `bg-primary text-on-primary rounded-lg font-bold hover:brightness-110` |
| Secondary/outline | `border border-outline-variant text-on-surface rounded-lg font-bold hover:bg-surface-container-high` |
| Ghost/icon | `material-symbols-outlined text-on-surface-variant hover:text-primary active:scale-95` |
| Segmented (LIVE/HISTORY) | active `bg-surface-container-high border border-outline-variant`; inactive `text-on-surface-variant` |
| Destructive hover | `hover:bg-error-container hover:text-on-error-container` |

All interactive elements get `active:scale-95` (buttons) or `active:translate-x-1` (nav rows) and `transition-all`.

### 7.3 Inputs
```html
<input class="bg-surface-container-low border border-outline-variant rounded-lg
              px-md py-3 font-code-sm text-on-surface
              focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all">
```
- Address/hash/numeric inputs use `font-code-sm`.
- Optional leading icon (`wallet`, `search`) absolutely positioned left; trailing action icon (`content_copy`, `link`) absolutely positioned right.
- Field label above: `font-label-caps text-primary` (or `text-on-surface-variant`), uppercase.
- Helper text below: `text-code-xs text-on-surface-variant italic`.

### 7.4 Chips / badges
- Status badge: `px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider`, colored per §2.7 (e.g. success `bg-primary/10 text-primary-fixed-dim`, failed `bg-error/10 text-error`, stress `bg-error-container text-error`).
- Count badge: `bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded text-[10px] font-bold`.

### 7.5 Tables (keypairs, deployments, live feed)
- Header row: `sticky top-0 bg-surface-container-low`, labels `font-label-caps text-on-surface-variant`.
- Rows: `divide-y divide-outline-variant/30`, `hover:bg-surface-container-highest/20`, `group` for hover-reveal copy icons (`opacity-0 group-hover:opacity-100`).
- Cell data (address/balance/hash): `font-code-sm`/`font-code-xs`, addresses in `text-primary`.
- Row actions: right-aligned icon buttons (export `key_visualizer`, delete `delete`).

### 7.6 Toggles / switches
- Track off: `bg-surface-container-highest`; on: `bg-primary-container`. Knob: white circle, `after:` pseudo, `peer-checked:after:translate-x-full`.

### 7.7 Sliders (TPS / amount)
```css
input[type=range] { background:#2e3638; height:4px; border-radius:2px; }
::-webkit-slider-thumb { height:16px; width:16px; border-radius:50%;
  background:#00daf3; box-shadow:0 0 10px rgba(0,218,243,.4); }
```
Live value read-out beside label in `mono text-primary font-bold` (e.g. "250 TPS", "50,000 TXs").

### 7.8 Terminal / log stream
- Background `bg-black/40`–`/60` or `surface-container-lowest`, `font-code-xs`, `space-y-1`, `custom-scrollbar`.
- Line format: `[HH:MM:SS]` timestamp in `text-on-surface-variant opacity-50`, then a colored tag (`SYSTEM:` tertiary, `AUTH:`/`FAUCET:` primary, success in green-400), then message.

### 7.9 Toast / status pill (bottom-right)
`fixed bottom-lg right-lg`, `bg-surface-container-highest border border-outline-variant shadow-xl rounded-lg`, icon + `font-code-sm`, optional `animate-bounce`. Used for "Indexing Block #…".

### 7.10 Network status block (sidebar top)
Pulsing dot (`bg-primary-container animate-pulse` or `status-pulse`) + `Mainnet-Alpha` (`headline-md`/`label-caps`, `primary`) + `Latency: 12ms` (`label-caps`, `on-surface-variant`).

---

## 8. Motion & Effects

| Effect | Spec |
|---|---|
| Button press | `active:scale-95`, `transition-all` (~150ms) |
| Nav row press | `active:translate-x-1 duration-150` |
| Card hover | border → `primary/50`, `transition-colors` |
| Status LED | `animate-pulse` dot, or custom `pulse-dot` keyframe (scale 1→1.5→1, opacity fade, 2s infinite) |
| Success | brief confetti burst (colors `#00daf3`, `#c3f5ff`, `#ffffff`) and/or button flip to green + `check_circle` |
| Toast | `animate-bounce` entrance |
| Ambient background | large radial gradient blob `bg-primary/5 blur-[120px] rounded-full`, `pointer-events-none`, offset off-canvas; faucet uses `radial-gradient(circle, rgba(0,218,243,.05), transparent 70%)` |
| Cursor particles | optional sparse cyan particle trail (`primary-container`, opacity 20%) — decorative, keep subtle and `pointer-events-none` |
| Custom scrollbar | width 4px, track transparent/`surface-container-low`, thumb `outline-variant` → hover `primary-fixed-dim`, radius 2px |

Keep motion **functional and restrained** — it communicates state (live, pending, success), it is never purely ornamental beyond the faint ambient glow. Respect `prefers-reduced-motion`: disable confetti, particles, bounce, and pulse when set.

---

## 9. Implementation Notes (Tailwind v4)

The mock was authored against the Tailwind CDN with a JS `tailwind.config`. **Port these tokens to Tailwind v4's CSS-first `@theme` block** (v4 has no `tailwind.config.js` by default). Example mapping:

```css
@import "tailwindcss";

@theme {
  /* fonts */
  --font-body-md: "Hanken Grotesk", sans-serif;
  --font-headline-md: "Hanken Grotesk", sans-serif;
  --font-display-lg: "Hanken Grotesk", sans-serif;
  --font-code-sm: "JetBrains Mono", monospace;
  --font-code-xs: "JetBrains Mono", monospace;
  --font-label-caps: "JetBrains Mono", monospace;

  /* core colors (subset — port ALL tokens from §2) */
  --color-background: #0d1516;
  --color-surface-container-lowest: #080f11;
  --color-surface-container-low: #151d1e;
  --color-surface-container: #192122;
  --color-surface-container-high: #242b2d;
  --color-surface-container-highest: #2e3638;
  --color-primary: #c3f5ff;
  --color-primary-container: #00e5ff;
  --color-primary-fixed-dim: #00daf3;
  --color-on-primary: #00363d;
  --color-on-primary-container: #00626e;
  --color-secondary-container: #3a4a5f;
  --color-on-secondary-container: #a9bad3;
  --color-tertiary: #ffeac0;
  --color-error: #ffb4ab;
  --color-error-container: #93000a;
  --color-on-surface: #dce4e5;
  --color-on-surface-variant: #bac9cc;
  --color-outline: #849396;
  --color-outline-variant: #3b494c;

  /* radius */
  --radius-lg: 0.25rem;
  --radius-xl: 0.5rem;
  --radius-full: 0.75rem;

  /* spacing (custom keys) */
  --spacing-base: 4px;
  --spacing-xs: 8px;
  --spacing-sm: 12px;
  --spacing-md: 16px;
  --spacing-gutter: 20px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-margin-mobile: 16px;
  --spacing-margin-desktop: 40px;
}
```
Define the full type scale (sizes/line-heights/weights from §3) via component classes or `@utility`, and load the two Google fonts in the root layout. Keep `html.dark` / `data-theme="dark"` — the product ships dark-only.

### Accessibility
- Body text `on-surface` (#dce4e5) on `background` (#0d1516) ≈ 13:1 contrast — excellent.
- Muted `on-surface-variant` (#bac9cc) stays ≥ 7:1 — safe for secondary text.
- Do not place `on-surface-variant` text on `primary-container`/`primary` fills; use the paired `on-*` token.
- Every icon-only button needs an `aria-label` / `title` (the mock already uses `title` on row actions).
- Maintain visible focus rings (`focus:ring-1 focus:ring-primary`).
