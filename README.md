# STACK RANKED

### A Game of Corporate Ascension

A fully playable, single-page browser simulator of **Stack Ranked** — the
engine-building, corporate-ladder satire game. Race up the org chart from Intern
to CEO by banking Career Capital, hoarding Political Capital, surviving Office
Chaos, and gaming the Quarterly Performance Review — all without burning out.

**▶ Play it:** open `index.html` in any modern browser, or host it on GitHub
Pages (see below). No build step, no server, no dependencies.

---

## What's in the box

| File | Purpose |
|---|---|
| `index.html` | The whole game UI — setup screen, live dashboard, review & game-over modals. Self-contained (inline CSS/JS). |
| `game.js` | The rules engine and AI. Zero DOM dependencies, so it can be unit-tested headlessly. |
| `docs/STACK_RANKED_GAME_SPEC.md` | The implementation spec this build follows to the letter. |
| `cards.json` | Raw card data (also embedded in `game.js`). |
| `leaderboard.md` | Raw Career Ladder rung data (rungs, Action Points, Career Capital thresholds, Badges required) — source for `generate_career_ladder.py`. |
| `stack_ranked_balance_simulator.py` | The original coarse *economic* Monte-Carlo balance tool (reference only). |
| `stack_ranked_montecarlo.js` | Card-faithful Monte-Carlo harness — drives the real `game.js` engine (every card, the exact Review, the AI) over thousands of seeded games to measure archetype balance and comeback viability. Used to tune the two **variant rules** (Feedback deck, Collaborative Projects). Run: `node stack_ranked_montecarlo.js [gamesPerCell]`. |
| `generate_print_and_play.py` | Regenerates `docs/Stack_Ranked_PrintAndPlay.pdf` straight from `cards.json` (`pip install reportlab pillow`, then `python3 generate_print_and_play.py`). |
| `generate_rulebook_pdf.py` | Regenerates `docs/Stack_Ranked_Rulebook.pdf` straight from `docs/STACK_RANKED_RULEBOOK.md`, with a clickable table of contents and PDF bookmarks (`pip install reportlab markdown beautifulsoup4`, then `python3 generate_rulebook_pdf.py`). |
| `generate_player_mat.py` | Regenerates `docs/Stack_Ranked_PlayerMat.pdf`, six copies of a landscape Player Desk mat (Career/Political Capital, Productivity, Burnout, Compliance Badges, a Management Style slot, and Tableau/Backlog zones) — optional header/background art, see `player-mat-art-prompts.txt` (`pip install reportlab pillow`, then `python3 generate_player_mat.py`). |
| `generate_career_ladder.py` | Regenerates `docs/Stack_Ranked_CareerLadder.pdf`, the shared Career Ladder board (7 ascending rungs, Intern through CEO, with pawn slots) straight from `leaderboard.md` — reuses the Player Desk mat's background art, plus its own optional header banner, see `career-ladder-art-prompts.txt` (`pip install reportlab pillow`, then `python3 generate_career_ladder.py`). |

## Features

- **2–6 players**, any mix of **Human** (hot-seat) and **AI**. Watch an all-AI
  game, play solo against bots, or pass-and-play with friends.
- **Five AI archetypes** — Grinder, Politician, Balanced, Workaholic, Cautious —
  each with a distinct playstyle.
- **Both win conditions:** *Race to CEO* (first to the top wins) and
  *The Long Game* (fixed 24 rounds, highest Final Score wins).
- **All 113 cards implemented** — 30 Skills/Tools, 31 Projects (incl. a
  13-card evergreen pool — *Reduce Technical Debt* and its twelve siblings,
  every one of them carrying a Burnout cost — that fills the Kanban Board's
  permanent 5th slot), 30 Office Chaos events, 12 Mandatory Trainings, and 10
  Management Styles, each with its exact effect.
- **Faithful rules:** the full round loop (Stand-Up → Sprint → Lunch →
  Postmortem), the exact 5-step Quarterly Review (eligibility-first promotion, the
  independent CEO Board Vote, Meteoric Rise capped at VP, PIP/demotion, and the
  Quarter-Marker-moves-last ordering), Burnout Crisis as an interrupt, Scope
  Creep, tier unlocks, and every documented edge case from the spec's postmortem.
- **Perfect information**, as the rules intend — every stat, board, tableau, and
  the full activity log are visible to everyone.
- **Two optional variant rules** (on by default, tunable):
  - **Feedback deck** — 18 cards (9 Positive / 9 Constructive) dealt at each
    Quarterly Review; keep yours or hand it to a rival. Worth ±2 political
    points that Review (net capped at ±4). A bounded rubber-band.
  - **Collaborative Projects** — pool Productivity into one Project; the Career
    Capital splits by contribution and the owner banks Political Capital in
    lieu of a CC share. See `docs/STACK_RANKED_GAME_SPEC.md` §13 for the tuned
    settings and the balance study behind them.
- Adjustable speed (Slow → Instant) for the AI turns.

## How to play

1. Pick a **win condition** and set up your **players** (name, Human/AI, and an
   AI archetype).
2. At **Stand-Up**, pick up a task from the Kanban Board into your
   **Backlog** — mandatory if it's empty, optional (skippable) once you have
   at least one, no cap either way (free — a claim, not a completion; you
   can't pay for it until your Sprint).
3. On your **Sprint**, spend Action Points on:
   - **Hire** a Skill/Tool from the Job Board (pay Productivity).
   - **Work a Project** (pay Productivity for any one entry in your Backlog,
     your choice → gain Career Capital).
   - **Network** (free: +2 Political Capital, +1 Career Capital).
   - **Self-Care** (free: −2 Burnout).
   - **Overtime** (once/round: +1 Action Point, +2 Burnout).
4. Every 3rd round is a **Quarterly Performance Review** — promotions, PIPs, and
   the CEO Board Vote. Career Capital gates every promotion; Compliance Badges
   gate Director and VP.
5. First player promoted to **CEO** wins (or highest Final Score in the Long
   Game). Don't hit **10 Burnout** — that triggers a Crisis.

## Host it on GitHub Pages

This repo is already a static site — nothing to build.

1. Push to GitHub (files must be at the repository root, as they are here).
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** = *Deploy from a branch*,
   **Branch** = `main`, folder = `/ (root)`, then **Save**.
4. Wait ~1 minute. Your game is live at
   `https://<your-username>.github.io/<repo-name>/`.

Because everything is plain HTML/JS with relative paths, it works identically
whether opened from `file://`, a local static server, or GitHub Pages.

---

*Built from `docs/STACK_RANKED_GAME_SPEC.md`. Card text and flavor are part of
the product and shown verbatim in-game.*
