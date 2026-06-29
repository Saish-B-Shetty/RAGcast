# Handoff: RAGcast — Podcast RAG Chat App

## Overview
RAGcast is a retrieval-augmented chat app for podcasts. A user signs in, picks (or creates) an
episode from a transcript, then asks questions and gets answers grounded in that episode's
transcript and/or the web. Every answer is tagged with its source. A right-hand context panel
lists the books and people mentioned in the episode, each with a timestamp; book entries link out
to Amazon.

The product has three screens: **Sign In**, **Main App** (sidebar + chat + context panel), and
**New Episode**.

## About the Design Files
The file in this bundle (`RAGcast Prototype.html`) is a **design reference created in HTML** — a
single-file React (via in-browser Babel) prototype that demonstrates the intended look, layout, and
interactions. **It is not production code to ship as-is.**

The task is to **recreate this design in the target codebase's existing environment** (React, Vue,
Svelte, etc.) using that project's established component library, routing, state management, and
styling conventions. If no codebase exists yet, implement it in a modern React + TypeScript stack
(e.g. Vite + React + CSS modules or Tailwind) — the prototype's structure maps cleanly to
components.

The prototype keeps everything in one HTML file with inline `<style>` and four inline
`<script type="text/babel">` blocks (data, shared components, screens, app orchestrator). Use it to
read exact markup, classes, and values — but split it into real components in your target stack.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, shadows, and interactions are
all specified below and present in the HTML. Recreate the UI pixel-perfectly using your codebase's
libraries and patterns. Placeholder boxes (book covers, avatars) are intentional — wire them to real
images when available.

---

## Design Tokens

### Colors (CSS custom properties, defined in `:root`)
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0A0A0A` | App background, chat area |
| `--panel` | `#111111` | Sidebar + context panel background |
| `--card` | `#1A1A1A` | Cards (book/person rows), input bar |
| `--card-2` | `#161616` | Menu surfaces, hover fills |
| `--border` | `#222222` | All hairline borders |
| `--border-soft` | `#1d1d1d` | (reserved) softer border |
| `--blue` | `#0066FF` | Primary accent — send button, active states, links |
| `--blue-bright` | `#2D82FF` | Bright blue — timestamps, ts-links, hovers |
| `--green` | `#00C48C` | "From Transcript" source badge |
| `--amazon` | `#FF9900` | Amazon buy / book-row hover accent |
| `--text` | `#F4F6FA` | Primary text |
| `--muted` | `#8A8F98` | Secondary text |
| `--muted-2` | `#6A6F78` | Tertiary / placeholder text |
| user bubble bg | `#1E1E1E` | User message bubble |
| danger | `#FF6B6B` | Log out item |

Accent tints used as fills (over dark): blue `rgba(0,102,255,.10–.18)`, green
`rgba(0,196,140,.12)`, amazon `rgba(255,153,0,.12)`.

### Typography
- **Body / UI font:** `Inter` (Google Fonts), weights 400–900.
- **Display font:** `Space Grotesk` (Google Fonts), weights 500–700. Used via `--display` for the
  wordmark, chat title, "In this episode" title, section headers, and the New Episode H1.
- **Mono:** `ui-monospace, Menlo, monospace` — only for the ⌘N keycap and placeholder labels
  ("cover", "photo").
- Import: `Inter:400;500;600;700;800;900` + `Space Grotesk:500;600;700`.

Key sizes (px): H1 (New Episode) 30/700; chat title 19/700; section header 13/700; body message 15;
user bubble 14.5; book title 13.5/700; author/bio 11.5; timestamp 11/600; sidebar episode name
13.5/600; date 11.5; badge 10.5/700 uppercase.

### Spacing & Shape
- Card padding: 13–16px. Panel header padding: 21px 22px 15px. Chat header padding: 20px 32px.
- Gaps: card lists 11px; thread messages 22px; badge row 9px below.
- Radius: cards/rows 13–14px; sign-in card 24px; bubbles 18px (with one 6px corner for the tail);
  input bar 18px; buttons 11–14px; badges 7px; pills/keycap 6px.
- Shadows: soft, dark, blue-tinted. Examples: sign-in card
  `0 30px 80px -20px rgba(0,0,0,.8), 0 0 70px -10px rgba(0,102,255,.18)`; send button
  `0 6px 18px -6px rgba(0,102,255,.7)`; menu `0 18px 44px -12px rgba(0,0,0,.85)`.

---

## Screens / Views

### 1. Sign In
- **Purpose:** Authenticate and enter the app.
- **Layout:** Full-viewport, flex-centered on `--bg`. A 440px card sits over (a) a faint dotted grid
  radially masked toward center and (b) a large radial blue glow behind the card. A footer line is
  pinned to the bottom-center.
- **Components:**
  - **Card** (`.signin-card`): 440px wide, padding 48/44/36, radius 24, gradient bg
    `linear-gradient(180deg,#131313,#0E0E0E)`, 1px `--border`, the blue-tinted shadow above. Subtle
    rise-in animation (transform only; resting opacity 1 — do not gate visibility on the animation).
  - **Wordmark** (`.logo`/`.wordmark`): "RAGcast", Space Grotesk 30px/700, centered. (No icon/dot.)
  - **Tagline:** "Ask anything from every podcast you've heard." — `--muted`, 15px, centered.
  - **Continue with Google button** (`.gbtn`): full width, bg `#0F0F0F`, 1px `--blue` border,
    radius 14, 15.5px/600 white text, multicolor Google "G" SVG on the left. Hover: bg `#121823`,
    blue glow, lift 1px, brighter border.
  - **Fine print:** "By continuing you agree to our Terms and Privacy Policy." — `--muted-2`, 12px;
    links underlined in `#333`.
  - **Footer:** "RAGcast · retrieval-augmented listening" — `--muted-2`, 12px, bottom-center.
- **Behavior:** Clicking the Google button navigates to the Main App.

### 2. Main App
Three columns, full height: **Sidebar (280px)** · **Chat (flex)** · **Context Panel (resizable)**.

#### Sidebar (`.sidebar`, 280px, bg `--panel`, right border)
- **Wordmark** at top (Space Grotesk 21px/700).
- **New Episode row** (`.new-ep`): NOT a filled button — a ghost list row. Plus icon + "New Episode"
  + right-aligned ⌘N keycap (`.kbd`, mono 11.5px, bordered pill). Hover bg `#171717`. When the New
  Episode screen is open it gets an active state (`.on`: bg `#161b22`, blue text, inset blue ring).
- **"Recent Episodes"** label: `--muted-2`, 11px/700, uppercase, letter-spacing .12em.
- **Episode list** (`.ep-list`, scrollable): each item (`.ep-item`) shows episode name (13.5/600,
  truncated) + relative date (11.5px `--muted-2`). Active item: bg `#161b22`, 2px left blue border,
  inset blue ring; name turns white. Hover: bg `#171717`. A pencil "rename" icon (`.ep-edit`)
  fades in on hover at the right.
- **Account footer** (`.sb-foot`): full-width button with a 34px grey circle avatar ("AK", solid
  `#222`, no gradient), name "Arjun Kapoor" (13/600) + email "arjun@gmail.com" (11.5 `--muted-2`),
  and a chevron at the right that rotates 180° when the menu is open. Hover bg `#161616`.
  - **Account menu** (`.acct-menu`): opens upward above the footer; surface `#161616`, radius 13,
    the menu shadow. Contains one item: **"Log out"** (`.acct-item.danger`, color `#FF6B6B`, logout
    SVG icon). A full-screen transparent backdrop closes it on outside click.

#### Chat (`.chat`, flex, bg `--bg`)
- A soft blue radial glow bleeds in from the top-right (decorative, `pointer-events:none`).
- **Header** (`.chat-head`): episode title (Space Grotesk 19px/700) + a pencil rename icon. Thin
  `--border` divider below.
- **Thread** (`.thread`, max-width 840px, centered, 28/32 padding, 22px gaps):
  - **User message** (`.msg.user` / `.bubble-user`): right-aligned, grey bubble `#1E1E1E`, 1px
    `--border`, radius `18 18 6 18`, 14.5px text. Max width 78%.
  - **Assistant message** (`.msg.bot` / `.bubble-bot`): left-aligned **plain text — NO bubble/box**
    (transparent bg, no border), 15px/1.65. Above each answer sits a **source badge** (see below).
    Inline timestamps render as `.ts-link` (bright blue). `<em>` used for emphasis.
  - **Typing indicator** (`.typing`): three blue dots with staggered blink animation, shown while a
    reply is "loading".
- **Source badges** (`.badge`): pill, 10.5px/700 uppercase, with a 6px leading dot.
  - `From Transcript` → green theme (`.transcript`): green tinted bg + ring, text `#3FE3B4`.
  - `From Web` → blue theme (`.web`): blue tinted bg + ring, text `#5C9BFF`.
  - `From Transcript + Web` → split (`.split`): half-green/half-blue gradient bg, split dot.
- **Input bar** (`.inputbar-wrap` / `.inputbar`, max-width 840px): card `--card`, radius 18, 1px
  border. Auto-growing `<textarea>` placeholder "Ask anything about this episode…" + a 40px blue
  send button (`.send`) with up-arrow SVG. Focus state: blue border + blue glow ring. Send is
  disabled (grey) when the input is empty.

#### Context Panel (`.context-panel`, default 344px, bg `--panel`, left border)
- **Resizable:** a 9px drag handle (`.cp-resize`) on the LEFT edge. Dragging changes width, clamped
  **264–560px**; a blue line shows on hover/active. Width persists to `localStorage`
  (`ragcast_panel_w`).
- **Header** (`.cp-head`): "In this episode" (Space Grotesk 13px/700) + sub "Auto-extracted from the
  transcript" (11.5px `--muted-2`). Bottom border.
- **Two collapsible sections** (`.cp-sec`), "Books Mentioned" and "People Mentioned":
  - **Header** (`.cp-sec-head`, a button): a chevron (`.cp-chev`, rotates −90° when collapsed) +
    label + a right-aligned **count pill** (`.count`). Click toggles collapse via a CSS grid-rows
    `1fr ⇄ 0fr` transition (260ms) on `.cp-collapse` (inner wrapper has `overflow:hidden;
    min-height:0`).
  - **Book row** (`.book-row`, an `<a>` to Amazon search, opens new tab): 48×66 striped cover
    placeholder (`.mini-cover`, label "cover") + title (13.5/700) + author (11.5 `--muted`) +
    "Mentioned at MM:SS" (11px bright blue). Hover: amazon-orange border + shadow, and an
    external-link arrow (`.br-go`) fades in top-right. **No "Buy" button** — the whole card is the
    link.
  - **Person row** (`.person-row`): 42px circular striped avatar placeholder (`.mini-av`, label
    "photo") + name (13.5/700) + one-line bio (11px `--muted`) + "Mentioned at MM:SS".
  - **Empty state** (`.cp-empty`): dashed-border note "No books/people detected in this transcript
    yet." shown when a section has no items.

### 3. New Episode
- **Purpose:** Create an episode from a YouTube URL or a pasted transcript. Replaces the chat +
  context panel (sidebar stays; the New Episode row shows its active state).
- **Layout:** Centered column, max-width 920px, 46/32 padding.
  - **H1** "Start a New Episode" (Space Grotesk 30px/700) + sub "Drop in a link or a transcript —
    RAGcast does the rest."
  - **Two equal cards** (`.ne-card`) separated by a vertical **"or" divider** (`.or-div`: thin line
    / "or" / thin line), `align-items:stretch` so both cards match height.
    - **Card 1 — Paste YouTube URL:** title, helper text, "Video link" label, URL input
      (placeholder `https://youtube.com/watch?v=...`), **Fetch Transcript** primary blue button.
    - **Card 2 — Paste Transcript:** title, helper text, "Transcript" label, 4-row textarea, an
      "Episode name" input, **Save Episode** secondary button (`.ne-btn.sec`: `#161616` + border,
      blue border on hover).
  - **Note** (`.ne-note`, italic `--muted-2`, centered): "RAGcast will automatically extract books,
    people and timestamps from your transcript."
  - Inputs (`.tin`): bg `#0E0E0E`, 1px border, radius 12; focus → blue border + blue glow ring.

---

## Interactions & Behavior
- **Sign in → app:** "Continue with Google" sets the screen to the main app.
- **Log out:** account footer → menu → "Log out" returns to the Sign In screen and closes any open
  New Episode view.
- **Select episode:** clicking a sidebar item makes it active, closes the New Episode view, and
  swaps the chat thread + context panel to that episode's data.
- **New Episode:**
  - "Fetch Transcript" (YouTube) → creates an episode prepended to the list, made active, and (in
    this demo) populated with the sample books/people of the first episode.
  - "Save Episode" (manual) → creates an episode with an **empty** context panel (shows the empty
    state), demonstrating per-episode extraction.
- **Ask a question:** Enter (without Shift) or the send button appends a user message, shows the
  typing indicator for ~1.4s, then appends an assistant reply with a (demo: random) source badge.
  Thread auto-scrolls to the bottom.
- **Collapse sections:** clicking a section header folds/unfolds its list with a grid-rows
  animation; chevron rotates.
- **Resize panel:** drag the left handle of the context panel; width clamps 264–560px and persists.
- **Hover/active/focus states:** specified per component above (episode items, rows, buttons, input
  focus, drag handle).
- **Animations:** sign-in card rise (.6s ease, transform only); typing dots blink (1.2s); collapse
  (.26s `cubic-bezier(.4,0,.2,1)`); account menu rise (.14s).

## State Management
Suggested state (held in the app-level component in the prototype):
- `screen`: `'signin' | 'app'`.
- `newOpen`: boolean — whether the New Episode view replaces the chat.
- `episodes`: array of `{ id, name, date, books[], people[] }` where `books` =
  `{ id, title, author, ts }` and `people` = `{ id, name, bio, ts }`.
- `activeId`: id of the selected episode.
- `threads`: map of `episodeId → message[]`, where a message is either
  `{ id, role:'user', text }` or `{ id, role:'bot', source:'transcript'|'web'|'split', html/content }`.
  Episodes without an entry fall back to a generic welcome message.
- `input`: current composer text. `typing`: boolean (reply in-flight).
- `panelWidth`: number (264–560), persisted to `localStorage['ragcast_panel_w']`.
- Account menu open + per-section collapse booleans are local to their components.

Data fetching (real implementation): fetch/transcribe a transcript, run extraction for books/people
+ timestamps, and answer questions via your RAG backend, returning a `source` per answer. The
prototype mocks all of this with static data and canned responses.

## Design Tokens — quick reference
See the **Design Tokens** section above (colors table, fonts, spacing, radius, shadows). All are
declared as CSS variables in `:root` and reused throughout.

## Assets
- **Fonts:** Inter + Space Grotesk (Google Fonts) — load via the same `<link>` or your build's font
  pipeline.
- **Icons:** inline SVGs in the prototype (Google "G", plus, pencil, send, chevron, logout,
  external-link). Replace with your icon library (e.g. lucide) — shapes match Lucide closely.
- **Images:** none. Book covers and person photos are intentional striped placeholders
  (`.mini-cover` / `.mini-av`) labelled "cover"/"photo". Wire to real image URLs when available.
- **Content:** all podcast names, book titles, authors, people, bios, and timestamps in the
  prototype are realistic placeholders — replace with real data.

## Files
- `RAGcast Prototype.html` — the full high-fidelity prototype (all three screens + interactions).
  Single self-contained file: inline `<style>` for all tokens/components, and inline
  `text/babel` scripts (`data` → `components` → `screens` → `app`). Open in a browser to interact;
  read it for exact markup, class names, and values.
