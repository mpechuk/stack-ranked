# Stack Ranked — Digital Implementation Specification

**Purpose of this document:** everything needed to start building an online/digital
version of *Stack Ranked* without re-deriving rules from the print rulebook. This
is written for an implementer (human or AI coding agent) and is optimized for
precision over narrative — exact numbers, exact order of operations, and the
specific edge cases that broke earlier draft rulesets during balance testing.

Companion files in this project (not required to read first, but useful):
- `STACK_RANKED_RULEBOOK.md` — the human-facing rulebook (flavor text, full prose).
- `cards.json` — the raw card data, embedded verbatim in full in Section 8 below.
- `stack_ranked_balance_simulator.py` — a Monte Carlo balance-testing script. It
  validates the *economic shape* of the game (pacing, promotion viability across
  strategies) but does **not** implement individual cards — see Section 10 for
  exactly how to use it (and how not to).

---

## 1. Game Overview

- **Players:** 2–6 (rules adjust slightly at 2 and 6 — see Section 7.4).
- **Genre:** engine-building career-ladder game. Corporate satire theme.
- **Base win condition:** first player promoted to CEO wins. Game ends immediately
  when this happens (finish the current round, then stop).
- **Advanced variant win condition ("The Long Game"):** fixed 24 rounds (8
  Quarters), highest Final Score wins even if nobody reaches CEO. Formula in
  Section 7.5.
- **Validated pacing** (from 20,000-game Monte Carlo simulation, final tuned
  ruleset): average game length **34.4 rounds** at 5 players (range **30.2–32.7**
  rounds across 2/3/4/6-player configurations), with **100%** of simulated games
  ending via an actual CEO promotion rather than any round cap. At a real
  human pace this maps to the target **60–90 minute** session.
- **Perfect information game:** there is no hidden information anywhere in the
  ruleset. Every resource, every card in every tableau, every board, and every
  Review Score is public. This matters a lot for the online implementation —
  see Section 7.1.

---

## 2. Core Resources & Terminology

| Term | Type | Range / Notes |
|---|---|---|
| **Rung** | persistent | 0 (Intern) through 6 (CEO). See ladder table in 7.3. |
| **Productivity (P)** | banked, resets quarterly | Spent to Hire cards and Work Projects. Not itself Career Capital. |
| **Political Capital (PC)** | banked, resets quarterly | Gained mainly via Networking. Never spent on anything directly — only ever compared (Review Score, CEO Board Vote). |
| **Burnout** | persistent gauge | 0–10. At 10, triggers a **Burnout Crisis** immediately (see 5.2.5), not at end-of-round. |
| **Career Capital (CC)** | persistent, (almost) monotonic | The permanent "résumé" score. Gates every promotion. Only known way it can ever *decrease* is the **Credit-Stealing Boss** Management Style card (−1 CC per completed Project). Otherwise strictly non-decreasing. |
| **Quarter Marker** | persistent pointer | A snapshot of a player's CC as of the end of the last Review. Used to compute "CC gained this Quarter" for Review Score. Moves to match current CC at the end of every Review (Step 5). |
| **Compliance Badges** | persistent counter | Gained from Mandatory Training. Gates Director (needs 2) and VP (needs 4). Never decreases. |
| **PIP token** | boolean flag | Held or not held. A second consecutive PIP converts to a demotion. |
| **Employee of the Quarter token** | persistent counter | Consolation for eligible-but-not-selected promotion candidates. Worth points only in the Advanced Variant. |
| **Management Style** | card reference | One per player, asymmetric passive power. Redrawn on every promotion or demotion. |
| **Action Points (AP)** | per-round budget | 2 / 3 / 4 depending on rung — see 6.1. |
| **First Player token** | rotating marker | Passes clockwise (i.e., to the next player in seating/turn order) every round. Determines Action Phase order and tie-breaks for several card effects ("the First Player…"). |

---

## 3. Setup

1. Every player starts at Rung 0 (Intern) with Productivity 0, Political Capital 0,
   Burnout 0, Career Capital 0, Compliance Badges 0, Quarter Marker 0, no PIP
   token, empty tableau.
2. Shuffle the Management Style deck; each player draws 1, face-up (public).
3. Shuffle Tier 1 Skill/Tool cards; reveal 5 face-up to form the **Job Board**
   (10 for 6-player games — see 7.4).
4. Shuffle Early Project cards; reveal 4, plus one card drawn from the
   13-card **Evergreen pool** (headlined by **Reduce Technical Debt**) as a
   permanent 5th slot, to form the **Kanban Board**.
5. Shuffle the Office Chaos deck and the Mandatory Training deck separately (two
   independent face-down draw piles).
6. Assign a random first player (any tiebreak method is fine online — no need to
   replicate the joke tiebreak from the print rulebook).

Deck composition (for a virtual "deck" you don't need physical duplicate copies of
a card — a count/multiplicity is enough — but preserve these ratios for shuffle
odds and reshuffle-when-depleted behavior):

| Deck | Unique cards | Copies in the shuffle pool | Enters play |
|---|---|---|---|
| Skill/Tool — Tier 1 | 12 | ×2 each (24 total) | Round 1 |
| Skill/Tool — Tier 2 | 10 | ×1 each | Shuffled in at Quarter 3 (available starting round 7 — see note below) |
| Skill/Tool — Tier 3 | 8 | ×1 each | Shuffled in at Quarter 5 (available starting round 13) |
| Project — Early | 6 | ×2 each (12 total) | Round 1 |
| Project — Mid | 6 | ×1 each | Quarter 3 |
| Project — Late | 6 | ×1 each | Quarter 5 |
| Project — Evergreen | 13 | ×1 each (13 total); every design carries a Burnout cost; own draw/discard pool feeding a permanent 5th board slot; never mixes with the main Project pool, the slot itself is never discarded | Round 1 |
| Office Chaos | 30 | ×1 each | Round 1 (reshuffle discard pile when the draw pile is empty) |
| Mandatory Training | 12 | ×1 each | Round 1 (reshuffle when empty) |
| Management Style | 16 | ×1 each | Round 1 (reshuffle when empty) |

> **Tier-unlock implementation note:** "Quarter 3" = once the Quarter-3 Review
> has happened (i.e., starting round 7 onward, since reviews land on rounds 3,
> 6, 9…). Practically: when refilling the Job Board or Kanban Board (Postmortem
> phase, 5.4), if the current round number is ≥ 7, Tier 2 Skill and Mid Project
> cards are eligible to be drawn into empty slots; if ≥ 13, Tier 3 Skill and
> Late Project cards are also eligible. Simplest implementation: maintain a
> single shuffled draw pile per card family, and just don't shuffle
> Tier 2/3 (or Mid/Late) cards into that pile until the round threshold is
> crossed — then merge them in and reshuffle.

---

## 4. Suggested State Model

This is a suggested shape, not a mandate — adapt to whatever language/framework
gets chosen. The important part is *what fields must exist*, since the rules
below depend on all of them.

### Player
```
Player {
  id, displayName
  rung: int                      // 0-6
  productivity: int              // banked, resets to 0 at end of every Review
  politicalCapital: int          // banked, resets to 0 at end of every Review
  burnout: int                   // 0-10, clamped
  careerCapital: int             // persistent, effectively monotonic (see Sec 2)
  quarterMarker: int             // CC snapshot as of the last Review
  complianceBadges: int          // persistent
  hasPip: bool
  employeeOfQuarterTokens: int
  skipActionRounds: int          // >0 means "no Action Phase this round, then decrement"
  backlog: [{card: CardRef, lockedScope: int}]   // grows by 1 every Stand-Up (5.1.2), no size cap; any entry paid off via Work a Project, any order
  managementStyle: CardRef
  tableau: [CardRef]             // permanent Skill/Tool cards in play
  goldenParachuteArmed: bool     // true if holding an unused Golden Parachute Clause
  immuneToDemotion: bool         // true if holding Golden Handcuffs (Fully Vested)
  firstVpReviewNumber: int|null  // first Review at which this player reached rung 5 (VP) — for analytics/"upset" tracking only, not required for correctness
  overtimeUsedThisRound: bool    // resets every round
}
```

### GameState
```
GameState {
  roundNumber: int               // starts at 1
  phase: enum [INCOME, ACTION, LUNCH, POSTMORTEM, REVIEW, GAME_OVER]
  players: [Player]              // turn order = seating order
  firstPlayerIndex: int          // rotates +1 (mod playerCount) every round
  jobBoard: [CardRef]            // 5 slots (10 at 6 players)
  kanbanBoard: [CardRef]        // 5 slots, one of which is always the Evergreen slot
  projectUnclaimedRounds: map<boardSlotId, int>   // Scope Creep counters, per slot
  skillDrawPile / skillDiscardPile: [CardRef]
  projectDrawPile / projectDiscardPile: [CardRef]
  evergreenDrawPile / evergreenDiscardPile: [CardRef]   // own 3-card pool for the permanent 5th Kanban slot
  eventDrawPile / eventDiscardPile: [CardRef]
  trainingDrawPile / trainingDiscardPile: [CardRef]
  managementDrawPile / managementDiscardPile: [CardRef]
  promotionSlots: int            // 1 (2-5p) or 2 (6p) — derived from player count, constant per game
  variant: 'race-to-ceo' | 'long-game'
  winnerId: string|null
  gameOverAfterRound: int|null   // when CEO is crowned mid-round-processing, finish the round, then stop
}
```

Note on **CardRef**: every unique card design needs a stable ID (e.g. a slug of
its name). Section 8's JSON doesn't include IDs, so generate them at load time
(e.g. `slugify(category + "/" + name)`) and keep a lookup table. Multiple
physical copies of the same design (Tier 1 Skills, Early Projects) are
multiple instances of the *same* CardRef — no need for separate per-copy IDs
unless your UI needs to distinguish "which physical copy" for animation
purposes.

---

## 5. Round Algorithm

A round always resolves these phases **in order**, fully completing one phase
for all players before the next phase begins.

### 5.1 — Stand-Up Meeting (Income Phase)

**5.1.1 — Income (simultaneous, no player choice)**
For every player:
```
player.productivity += sum(p.gain for p in player.tableau if p has a Productivity-per-round effect) + 1   // the flat "showed up" bonus
player.politicalCapital += sum(p.gain for p in player.tableau if p has a PC-per-round effect)
if (currentLeaderRung - player.rung) >= 2:                       // Mentorship Bonus
    player.politicalCapital += 1
```
"Current leader" = the maximum `rung` among all players at the start of this
phase. Recompute every round (it can change).

Apply any passive per-round Management Style effects here too if they're
income-phase-shaped (e.g. **The Actually Supportive Manager**: `+1 PC every
Income Phase`). See each card's `effect` text in Section 8 for exact wording —
most Management Style and Skill/Tool effects are either (a) a flat per-round
income modifier applied here, or (b) a triggered/conditional effect applied at
the specific moment its trigger occurs (Project completion, Burnout Crisis,
Overtime, etc.) — read each effect string to classify it; they're written in
plain language on purpose and none of them require inventing new mechanics
beyond what's listed.

**5.1.2 — Backlog Grooming (sequential, in First Player order)**
Immediately after Income, still within Stand-Up: for every player, in First
Player order (this step is sequential, not simultaneous, because it draws
from the shared Kanban Board — same reasoning as 5.2's Sprint):

- If `player.backlog.length === 0`, claiming is **mandatory** — the backlog
  may never be left at zero.
- If `player.backlog.length > 0`, the player is **asked whether they want
  to claim another entry this round or skip**. Declining leaves the backlog
  unchanged this Stand-Up; accepting proceeds exactly like the mandatory
  case below. AI players always accept (see the note at the end of this
  section) — this choice is meaningful primarily for human players who may
  prefer to focus on clearing an already-large backlog rather than growing
  it further.

Claiming (whether mandatory or accepted voluntarily) takes exactly one card
from the Kanban Board into `player.backlog` —
`player.backlog.push({card, lockedScope})`. There is still no size cap and
no upper limit — a player who always accepts (or has an empty backlog every
round) will keep accumulating entries just as before this skip option
existed.

This is a **claim, not a completion**: no Productivity is paid, and no
reward is granted, at this point. Removing the card from the board follows
the exact same slot mechanics as claiming during a Sprint (5.2.2's "Work a
Project" / 5.2.3): a non-Evergreen slot empties and isn't refilled until the
next Postmortem (5.4); the Evergreen slot immediately redraws a replacement
from its own pool (5.2.3) — which is what makes it possible to satisfy every
player's claim in the same Stand-Up even when all 4 non-Evergreen slots are
already spoken for (the Evergreen slot can supply an unlimited number of
sequential claims in a single Stand-Up, since it never runs out).
`lockedScope` is set to whatever Scope Creep (5.2.4) that slot had accrued
at the moment of claiming (always 0 for the Evergreen slot, which is
exempt) — it is **frozen** from this point on for that specific backlog
entry and does not keep increasing while it sits in the backlog, even after
a new card refills that slot and *its* Scope Creep starts accruing
independently.

If literally no card is available anywhere on the board to satisfy this
(every slot — including Evergreen — is empty), skip it silently for that
player this round; this should not occur in practice given the Evergreen
backstop above.

**Paying for a backlog entry never happens here.** Stand-Up only ever adds
one (at most); the only way to pay an entry's cost and collect its reward
is the Sprint's Work a Project action (5.2.2), which still costs its normal
1 AP per entry worked, and the player chooses which entry (any order, not
FIFO/LIFO). A player's backlog grows by at most one entry every Stand-Up
(zero if they choose to skip while non-empty); whether it also shrinks that
round depends entirely on how much AP and Productivity they spend Working
entries during their Sprint.

**Implementation note on the skip decision:** the reference AI always
accepts the claim (never voluntarily skips) — the balance data in Section
9.8 was measured under unconditional claiming and remains valid for AI-only
or mixed games, since AI behavior is unchanged by this option. The skip
choice is a capability for human players; nothing prevents implementing a
smarter AI heuristic for it later (e.g., skip once the backlog already
exceeds some multiple of the player's typical AP budget), but that's a
deliberate future tuning decision, not assumed here.

This whole sub-phase (like Income) is skipped for a round in which
`restrictions.skipIncome` is set (IT Outage) — Backlog Grooming is part of
the same Stand-Up phase.

### 5.2 — Sprint (Action Phase) — sequential, in First Player order

Each player, in turn order starting from the First Player, spends their full
Action Point budget before the next player begins. (This is a meaningful
implementation choice: it means board contention — e.g. two players wanting the
same Job Board card — is resolved strictly by turn order, not simultaneously.)

**5.2.1 — AP budget by rung**
```
rung 0-1 (Intern, Software Engineer): 2 AP
rung 2-3 (Team Lead, Manager):        3 AP
rung 4-6 (Director, VP, CEO):         4 AP
```
If a player has `skipActionRounds > 0`: they skip this entire phase this round
(spend 0 AP), then decrement `skipActionRounds` by 1. (They still take part in
Income/Lunch/Postmortem.)

**5.2.2 — Actions** (player chooses one per AP; may repeat)
- **Hire**: pay a Job Board card's `cost` (Productivity) → remove it from the
  Job Board. If `type == "One-Shot"`: resolve its `effect` immediately, then
  discard it. If `type == "Permanent"`: add it to the player's `tableau`
  (its ongoing effect now applies every future Income Phase / trigger).
- **Work a Project**: choose **any one entry** in the player's own backlog
  (`player.backlog` — accumulated at Stand-Up, see 5.1.2) and pay its
  Productivity cost (`card.cost + lockedScope`, plus the same discounts as
  before) → apply its `reward` immediately, then remove that entry from the
  backlog. This is the **only** way to pay for and complete a backlog entry
  — Stand-Up only ever adds one, never pays for one (5.1.2). The player is
  free to pick whichever entry they want each time — cheapest, highest-value,
  whatever — not restricted to a fixed order; a player with several
  affordable entries and enough AP can Work more than one in the same
  Sprint. Unavailable (nothing to Work) only if the backlog is completely
  empty, which can only happen right after a Stand-Up that itself had
  nothing available to assign (see 5.1.2's Evergreen-backstop note) — in
  ordinary play the backlog is never empty for long, since Stand-Up adds an
  entry every round. The one exception that still targets the Kanban Board
  directly, bypassing the backlog entirely, is **Ships It Friday at 5 PM**
  (Section 8): it completes any board Project immediately at half cost,
  independent of the player's backlog.
- **Network**: no cost. `politicalCapital += 2`, `careerCapital += 1`.
- **Self-Care**: no cost. `burnout = max(0, burnout - 2)`.
- **Overtime** (once per player per round, doesn't consume an AP slot — check
  and clear `overtimeUsedThisRound` at the top of each player's turn): grants
  **+1 AP to spend this round**, and immediately applies `burnout += 2` (checking
  for a Crisis right away — see 5.2.5). A player may take this before, during,
  or after their normal AP spend; simplest implementation is to let them
  toggle it in the UI at any point during their turn and just extend their
  remaining-AP counter by 1 once.

**5.2.3 — Evergreen Projects Pool ("Reduce Technical Debt" and friends)**
Unlike every other Project, the 5th Kanban Board slot never empties. It is
filled from its own **Evergreen pool** (`projects.evergreen`, 13 designs
spanning cost 1–8, every single one carrying a Burnout cost — tech debt always
costs you something — from cheap-and-mild filler up to pricier, nastier
paydowns) rather than the main Project draw pile, and it is also **exempt
from Scope Creep** (its cost never increases, regardless of which Evergreen
card currently occupies it).

When the card in that slot is claimed: discard it to `evergreenDiscardPile`,
then immediately draw the next card from `evergreenDrawPile` (reshuffling
`evergreenDiscardPile` back into the draw pile if it's empty — same
reshuffle-on-empty pattern as every other deck) into the same slot. The card
occupying the 5th slot can therefore change from claim to claim — this one may
come up again, or a different Evergreen design may take its place — but the
slot itself always holds *some* Evergreen card and never sits empty.
Functionally, treat the slot as an always-available repeatable action rather
than a depleting board slot, whose specific cost/reward varies by draw.

**5.2.4 — Scope Creep**
Track, per Kanban Board slot (excluding Evergreen), how many full rounds it
has sat unclaimed. Every time 2 full rounds pass with no claim, `cost += 1` for
that slot (reward unchanged). Reset the counter to 0 whenever the slot is
refilled with a new card. This is most simply implemented as a per-slot
counter incremented once at Postmortem (5.4) and checked there.

**5.2.5 — Burnout Crisis (interrupt, not end-of-round check)**
Check **immediately** every single time a player's `burnout` value changes
(Overtime, certain Skill/Project/Event effects) — not once at the end of the
round:
```
if player.burnout >= 10:
    player.burnout = 6
    player.politicalCapital = max(0, player.politicalCapital - 2)
    player.skipActionRounds = max(player.skipActionRounds, 1)   // skip their NEXT Sprint
```
Some Skill/Tool cards modify this (e.g. **The Bus Factor of One** doubles the
PC penalty; **On-Call Pager Veteran** ignores the first Burnout gained each
Quarter — apply card-specific modifiers before the threshold check).

### 5.3 — Lunch
Draw the top card of the Office Chaos deck (reshuffle discards if empty) and
resolve its `effect` for all relevant players. **Most Office Chaos cards are
fully automatic** (e.g. "Every player gains 1 Burnout"), but a few require a
per-player decision and need a decision-collection step in the UI before
resolving:
- *Quiet Quitting Goes Mainstream* — each player optionally declines Overtime this round to remove 1 Burnout instead (only relevant for players who haven't already used/decided on Overtime this round).
- *A Colleague's Job Interview (Elsewhere)* — each player picks one of two options.
- *The Office Dog Visits*, *The Chair Finally Gets Fixed*, *Corporate Wellness Session* — "each player **may** remove Burnout" (optional, default to "no" if a client doesn't respond, never auto-apply).
- *Therapy Benefit Actually Gets Used* — "**any one** player" — needs a single designated chooser (house rule: let the player who drew/resolved the card decide, or the current First Player).

Full effect text for all 30 cards is in Section 8 (`events` array) — treat that
text as the literal spec; nothing beyond what's written there needs to be
inferred.

### 5.4 — Postmortem
1. Refill the Job Board and Kanban Board back to full size (5 slots each,
   10 Job Board slots at 6 players — see 7.4), drawing from the appropriate
   tier-gated pool (see Section 3's tier-unlock note). Reset the Scope Creep
   counter to 0 for any newly-filled Project slot.
2. Increment Scope Creep counters (5.2.4) for slots that were *not* refilled
   this Postmortem (i.e., stayed unclaimed).
3. Advance `firstPlayerIndex` to the next player in turn order.
4. If `roundNumber` is about to complete a **Quarter** (i.e. `roundNumber % 3
   == 0`), run the Quarterly Performance Review (Section 6) before moving to
   the next round.
5. If the review that just completed is an **even-numbered** Review (2nd, 4th,
   6th… — i.e. `roundNumber` is 6, 12, 18…), every player simultaneously draws
   and resolves one Mandatory Training card (see `trainings` array, Section 8)
   before the next round's Income Phase. This is otherwise identical in
   structure to Lunch resolution (mostly automatic effects).

---

## 6. Quarterly Performance Review Algorithm

Triggered when `roundNumber % 3 == 0`. This is the most algorithmically dense
part of the game and the part most likely to be implemented subtly wrong — the
order below reflects real bugs found and fixed during balance simulation (see
Section 9 for the "why" behind each one). Resolve in exactly this order:

### Step 1 — Calculate Review Score (for every player)
```
for each player:
    ccGainedThisQuarter = player.careerCapital - player.quarterMarker
    reviewScore = ccGainedThisQuarter + player.politicalCapital - floor(player.burnout / 4)
```
**Do not** substitute `player.careerCapital` (lifetime total) or omit the
`ccGainedThisQuarter` term and use only banked P/PC — both were tried and both
produce a broken game (Section 9.1).

### Step 2 — CEO Board Vote (resolve before any other promotion logic)
```
candidates = [p for p in players if p.rung == 5 and p.careerCapital >= 78]
newCeo = null
if len(candidates) == 1:
    newCeo = candidates[0]
elif len(candidates) > 1:
    newCeo = argmax(candidates, key = p.politicalCapital)   // ties: break randomly or by turn order, your call
if newCeo != null:
    newCeo.rung = 6
    gameOverAfterRound = current roundNumber
    // IMPORTANT: newCeo must be excluded from Steps 3 and 4 below.
```
The Board Vote is **independent of Review Score** — a player who wasn't this
Quarter's top scorer can still win the vote and become CEO, as long as they
clear the Career Capital bar and hold the most Political Capital among rung-5
peers. This is intentional (see Section 9.3).

### Step 3 — Standard Promotions (rungs 1–5)
Determine `promotionSlots` for the player count (Section 7.4: 1 for 2–5
players, 2 for 6 players).

```
eligible = [p for p in players
            if p.rung < 5
            and p != newCeo
            and meetsRequirement(p, p.rung + 1)]
eligible.sort(descending by reviewScore)          // rank ONLY among the eligible
promoted = eligible[0 : promotionSlots]

for p in promoted:
    p.rung += 1
    // Meteoric Rise check:
    secondHighestScore = the 2nd-highest reviewScore among ALL players this review (not just eligible)
    nextTarget = min(p.rung + 1, 5)                // capped at VP — cannot leapfrog into CEO
    if secondHighestScore > 0
       and p.reviewScore >= 2 * secondHighestScore
       and nextTarget > p.rung
       and meetsRequirement(p, nextTarget):
        p.rung = nextTarget

for p in eligible not in promoted:                 // eligible but slot(s) already taken
    p.employeeOfQuarterTokens += 1
    p.politicalCapital += 1
```

`meetsRequirement(p, targetRung)`:
```
if targetRung in {4: 2 badges, 5: 4 badges} and p.complianceBadges < required: return false
return p.careerCapital >= CC_THRESHOLD[targetRung]
```

> **Critical ordering note:** filter to eligible candidates **first**, *then*
> rank by Review Score among only that eligible pool. Do not rank all players
> by score first and walk down the list checking eligibility one at a time —
> that ordering was tried and produces a game-breaking bug where a strategy
> that reliably posts the *worst* Review Score (because it spends its
> Productivity down to zero completing Projects) can bank enormous Career
> Capital and *still* never receive a promotion slot, because higher-scoring
> players (even ones who are barely eligible) always get checked/take the slot
> first. See Section 9.2 for the full story.

### Step 4 — PIP and Demotion
```
candidates = [p for p in players if p not in promoted and p != newCeo]
candidates.sort(ascending by reviewScore)
forReview = candidates[0 : promotionSlots]         // PIP slot count == promotion slot count

for p in forReview:
    if p.immuneToDemotion:                          // Golden Handcuffs
        continue
    if p.hasPip:
        if p.goldenParachuteArmed:                  // Golden Parachute Clause, one-shot
            p.goldenParachuteArmed = false
            p.hasPip = false
            continue                                 // demotion averted, card consumed
        p.hasPip = false
        if p.rung == 0:
            p.skipActionRounds = max(p.skipActionRounds, 3)   // Freelance Purgatory: skip the whole next Quarter
        else:
            p.rung -= 1
            // draw a new Management Style card (see Step 5)
    else:
        p.hasPip = true
```

### Step 5 — Reset
```
for each player:
    player.quarterMarker = player.careerCapital
    // burnout, careerCapital, complianceBadges all persist unchanged
for each player promoted in Step 3 or demoted in Step 4:
    draw a new Management Style card for that player (discard the old one)
for each player:
    player.productivity = 0
    player.politicalCapital = 0
```

> **Order matters here too:** compute new Review Scores in Step 1 using the
> Quarter Marker from *before* this Review (i.e., as it was left at the end of
> the *previous* Review). Only move the Quarter Marker in Step 5, after
> everything else has already used the old value.

### 6.1 — CC Thresholds (Career Ladder)

| Rung | AP | CC to promote in | Badges required |
|---|---|---|---|
| 0 — Intern | 2 | — | — |
| 1 — Software Engineer | 2 | 8 | — |
| 2 — Team Lead | 3 | 18 | — |
| 3 — Manager | 3 | 30 | — |
| 4 — Director | 4 | 44 | 2 |
| 5 — VP | 4 | 60 | 4 |
| 6 — CEO | 4 | 78 + Board Vote | — |

---

## 7. Multiplayer, Variants & Player-Count Adjustments

### 7.1 — No Hidden Information
Every field on every `Player` object, every board, and every discard pile is
public. There are no hidden hands, no secret objectives, no fog of war. This
significantly simplifies the online architecture:
- The full `GameState` can be broadcast to every connected client after every
  state-changing action — no per-player filtered views are needed.
- There's no need to worry about information leakage through state diffs.
- Spectator mode is free (a spectator just receives the same broadcast).

### 7.2 — Turn Structure Recap (for architecture purposes)
- **Stand-Up (Income)**: the Income half (5.1.1) is simultaneous and fully
  deterministic, no player input required. The Backlog Grooming half (5.1.2)
  that follows it is sequential by turn order, same as Action Phase, since it
  draws from the shared Kanban Board — and needs a decision from every
  player, every round, of which card to claim into their backlog.
- **Action Phase**: sequential by turn order; each player's actions are
  discrete, individually-resolved events (good fit for an event-sourced or
  action-log architecture — replaying the log fully reconstructs state).
- **Lunch**: one shared draw; usually deterministic, occasionally
  needs a decision from one or all players (Section 5.3).
- **Postmortem**: deterministic.
- **Quarterly Review**: fully deterministic given the state at the moment it
  triggers — no player input required at all, which makes it easy to
  auto-resolve and animate as a single atomic step.

This game has **no real-time pressure** anywhere in the ruleset (nothing is
timed by the rules themselves) — it's turn-based with sequential player
actions, which makes it a good fit for either a live WebSocket session *or* an
async "play a turn, come back later" design. That choice is open (Section 11).

### 7.3 — Career Ladder
See table in Section 6.1.

### 7.4 — Player Count Adjustments
- **2 players:** no rule changes. 1 promotion slot, 1 PIP slot (same as 3–5
  players).
- **3–5 players:** standard rules as written throughout this document.
- **6 players:** 2 promotion slots and 2 PIP slots per Review (already
  reflected in `promotionSlots`). Additionally, the Job Board reveals **10**
  cards instead of 5 (still respecting tier-unlock timing).

### 7.5 — Advanced Variant: "The Long Game"
Alternate win condition. Play a fixed 24 rounds (8 Quarters) instead of racing
to CEO — ignore the CEO Board Vote's game-ending effect entirely (a player can
still become CEO and keep playing). At the end of round 24:
```
for each player:
    finalScore = (rung * 10) + (careerCapital / 2) + politicalCapital
                 - burnout + (5 * employeeOfQuarterTokens)
winner = argmax(players, key = finalScore)
```
Highest Final Score wins, even if nobody ever reached CEO. This should be a
game-setup-time toggle (`variant: 'race-to-ceo' | 'long-game'`), not a
mid-game option.

---

## 8. Complete Card Data (all 113 unique designs, verbatim)

This is the literal source of truth for every card's cost, effect, and reward.
Field meanings:
- Skills (`skills.tier1/tier2/tier3`): `cost` in Productivity, `type` is `"Permanent"` (joins tableau, effect applies every relevant trigger/round) or `"One-Shot"` (resolve `effect` once immediately, then discard).
- Projects (`projects.early/mid/late/evergreen`): `cost` in Productivity, `reward` applied immediately on claim. The `evergreen` entries additionally have a `note` field documenting their always-available, Scope-Creep-exempt, own-pool behavior (Section 5.2.3).
- `events` (Office Chaos), `trainings` (Mandatory Training), `management` (Management Style): each just has `name`, `effect`, `flavor` — no cost, since none of these are purchased.
- `flavor` fields are display-only joke text — show them in the UI (they are part of the product) but they never affect game logic.

```json
{
  "skills": {
    "tier1": [
      {"name": "Copy-Paste from Stack Overflow", "cost": 1, "type": "Permanent", "effect": "+1 Productivity/round.", "flavor": "It worked on someone else's machine in 2019. Good enough."},
      {"name": "Ctrl+F Power User", "cost": 1, "type": "Permanent", "effect": "+1 Productivity/round.", "flavor": "Never reads past the first match."},
      {"name": "Free Snack Hoarder", "cost": 1, "type": "Permanent", "effect": "+1 Political Capital/round.", "flavor": "Keeps granola bars in every drawer for emergency morale trades."},
      {"name": "Office Plant Whisperer", "cost": 1, "type": "Permanent", "effect": "+1 Political Capital/round.", "flavor": "The only living thing in the office that's thriving."},
      {"name": "Reply-All Enthusiast", "cost": 2, "type": "One-Shot", "effect": "Immediately: every other player gains 1 Burnout; you gain 2 Political Capital.", "flavor": "Accidentally cc'd the whole company on a lunch order question. Iconic."},
      {"name": "Emotional Support Rubber Duck", "cost": 2, "type": "Permanent", "effect": "Once per Quarter, take Overtime without gaining Burnout.", "flavor": "It just listens. That's more than your manager does."},
      {"name": "\u201cLet's Take This Offline\u201d", "cost": 2, "type": "Permanent", "effect": "+1 Political Capital/round. Once per Quarter, resolve a Mandatory Training without losing next round's Action Point (you still gain the Badge).", "flavor": "Bought yourself three weeks. The meeting still happens eventually."},
      {"name": "Standing Desk Enthusiast", "cost": 2, "type": "Permanent", "effect": "+1 Productivity/round. Ignore Burnout gained from Office Chaos cards.", "flavor": "Won't stop talking about it, but their back does feel great."},
      {"name": "LinkedIn Thought Leader", "cost": 2, "type": "Permanent", "effect": "+2 Political Capital/round; \u22121 Productivity/round.", "flavor": "Posted \u201cHot take: communication is important.\u201d 40,000 impressions."},
      {"name": "Regex Whisperer", "cost": 3, "type": "Permanent", "effect": "+3 Productivity/round; +1 Burnout/round.", "flavor": "Nobody else can read their code. That's job security, right?"},
      {"name": "Actually Reads the Documentation", "cost": 3, "type": "Permanent", "effect": "+1 Productivity/round. Your Projects cost 1 less Productivity (minimum 1).", "flavor": "A hero nobody asked for."},
      {"name": "Master of Small Talk", "cost": 3, "type": "Permanent", "effect": "+2 Political Capital/round.", "flavor": "Knows everyone's dog's name. Cannot recall a single deadline."}
    ],
    "tier2": [
      {"name": "Scrum Master", "cost": 4, "type": "Permanent", "effect": "+2 Political Capital/round; \u22121 Productivity/round.", "flavor": "Facilitates a 45-minute meeting to schedule a 15-minute meeting."},
      {"name": "Full-Stack, Full-Burnout", "cost": 4, "type": "Permanent", "effect": "+3 Productivity/round; +1 Burnout/round.", "flavor": "Owns the frontend, backend, database, and the on-call phone."},
      {"name": "AI Prompt Engineer", "cost": 4, "type": "Permanent", "effect": "+3 Productivity/round. Each time an Office Chaos card is drawn, flip a coin; on heads, discard 2 Productivity from your bank (a confident hallucination).", "flavor": "Confidently hallucinated the entire Q3 roadmap."},
      {"name": "Toxic Positivity Certification", "cost": 4, "type": "Permanent", "effect": "+2 Political Capital/round. You may not take Self-Care actions.", "flavor": "Everything is a learning opportunity, including this."},
      {"name": "The Brilliant Jerk", "cost": 5, "type": "Permanent", "effect": "+4 Productivity/round; \u22121 Political Capital/round.", "flavor": "Ships incredible code. Has made three people cry this quarter."},
      {"name": "Master Delegator", "cost": 5, "type": "Permanent", "effect": "+2 Productivity/round; +2 Political Capital/round.", "flavor": "Has not personally touched a keyboard since 2021."},
      {"name": "Buzzword Compiler", "cost": 4, "type": "Permanent", "effect": "+2 Political Capital/round; \u22121 Productivity/round.", "flavor": "Synergizes core competencies to leverage actionable takeaways."},
      {"name": "Whiteboard Diagram Enthusiast", "cost": 4, "type": "Permanent", "effect": "+2 Productivity/round. If you have 4+ Skill cards in play, your Projects cost 1 less Productivity.", "flavor": "The diagram has 14 boxes. Nobody knows what 6 of them mean."},
      {"name": "On-Call Pager Veteran", "cost": 5, "type": "Permanent", "effect": "+2 Productivity/round. Ignore the first Burnout you'd gain each Quarter.", "flavor": "Has slept through three fire drills and one actual fire."},
      {"name": "Imposter Syndrome (Actually Very Competent)", "cost": 4, "type": "Permanent", "effect": "+2 Productivity/round; +1 Political Capital/round.", "flavor": "Is, statistically, doing better than they think."}
    ],
    "tier3": [
      {"name": "The Bus Factor of One", "cost": 6, "type": "Permanent", "effect": "+3 Productivity/round. If you suffer a Burnout Crisis, lose double the usual Political Capital penalty.", "flavor": "If they quit, nothing ships again. Ever."},
      {"name": "Golden Handcuffs (Fully Vested)", "cost": 7, "type": "Permanent", "effect": "Ignore all PIP and demotion effects for the rest of the game.", "flavor": "The stock options mature in 18 months. So does nothing else."},
      {"name": "Rolodex of Every VP", "cost": 7, "type": "Permanent", "effect": "+4 Political Capital/round.", "flavor": "Knows a guy. Always knows a guy."},
      {"name": "Ships It Friday at 5 PM", "cost": 6, "type": "One-Shot", "effect": "Immediately complete one Project on the Kanban Board at half its listed Productivity cost (round up).", "flavor": "The demo gods are watching. Ship it and pray."},
      {"name": "The Exit Interview Isn't Scary Anymore", "cost": 6, "type": "One-Shot", "effect": "Immediately remove all your Burnout and gain 1 Compliance Badge.", "flavor": "Says everything they wish they'd said in every performance review \u2014 on the way out the door."},
      {"name": "The Fixer", "cost": 8, "type": "Permanent", "effect": "Whenever any other player suffers a Burnout Crisis, gain 2 Political Capital.", "flavor": "Somehow always available exactly when someone else's project catches fire."},
      {"name": "VP Whisperer", "cost": 7, "type": "Permanent", "effect": "+3 Productivity/round; +2 Political Capital/round.", "flavor": "Gets meetings on the calendar that shouldn't be mathematically possible."},
      {"name": "Golden Parachute Clause", "cost": 8, "type": "One-Shot", "effect": "Hold this card face-down in front of you. The next time you would be demoted, discard this instead and ignore the demotion.", "flavor": "Negotiated on the way in. Nobody remembers why."}
    ]
  },
  "projects": {
    "early": [
      {"name": "Update the README (Nobody Reads It Anyway)", "cost": 2, "reward": "3 Career Capital.", "flavor": "Now technically documented."},
      {"name": "Fix the Bug in Production (On a Friday)", "cost": 3, "reward": "4 Career Capital; +1 Burnout.", "flavor": "It's fine. Everything is fine."},
      {"name": "Onboard the New Hire", "cost": 3, "reward": "3 Career Capital; +1 Political Capital.", "flavor": "They seem nice. Give it two Quarters."},
      {"name": "Clean Up the Shared Drive", "cost": 2, "reward": "3 Career Capital.", "flavor": "Found 40 folders named \u2018final_FINAL_v2.\u2019"},
      {"name": "Respond to the Simple Support Ticket", "cost": 2, "reward": "2 Career Capital; +1 Political Capital.", "flavor": "It was a browser cache issue. It's always a browser cache issue."},
      {"name": "Write the Sprint Retro Notes", "cost": 4, "reward": "5 Career Capital.", "flavor": "Action items: none of these will happen."}
    ],
    "mid": [
      {"name": "Migrate the Legacy Codebase", "cost": 6, "reward": "8 Career Capital; +1 Burnout.", "flavor": "Nobody who wrote the original code still works here."},
      {"name": "Launch the Feature Nobody Asked For", "cost": 5, "reward": "7 Career Capital.", "flavor": "It tested well with exactly one user: the VP's nephew."},
      {"name": "Respond to the RFP (Due Tomorrow, Started Today)", "cost": 5, "reward": "6 Career Capital; +1 Political Capital.", "flavor": "Yes, we can absolutely do all of this by Q2."},
      {"name": "Survive the Compliance Audit", "cost": 6, "reward": "7 Career Capital; 1 Compliance Badge.", "flavor": "Everyone suddenly remembers where the fire extinguishers are."},
      {"name": "Rebuild the CI/CD Pipeline (Third Time's the Charm)", "cost": 6, "reward": "8 Career Capital; +1 Burnout.", "flavor": "This one's permanent. Definitely. For real this time."},
      {"name": "Run the All-Hands Presentation", "cost": 5, "reward": "6 Career Capital; +1 Political Capital.", "flavor": "Slides are just screenshots of Slack messages, but with a logo now."}
    ],
    "late": [
      {"name": "Ship the Major Redesign Before the Conference", "cost": 8, "reward": "11 Career Capital; +1 Burnout.", "flavor": "The demo gods are watching. They are not merciful."},
      {"name": "Turn Around the Failing Division", "cost": 9, "reward": "13 Career Capital.", "flavor": "Everyone competent already quietly left. You didn't get the memo in time."},
      {"name": "Land the Whale Client", "cost": 8, "reward": "11 Career Capital; +2 Political Capital.", "flavor": "They want it fully custom, half price, by Friday."},
      {"name": "Lead the Company-Wide Reorganization", "cost": 9, "reward": "13 Career Capital; +1 Burnout.", "flavor": "Nobody's title changed, but everyone's manager did. Twice."},
      {"name": "Present to the Board (12 Minutes to Justify a Department)", "cost": 7, "reward": "10 Career Capital; +2 Political Capital.", "flavor": "They looked at their phones for eleven of them."},
      {"name": "Negotiate the Vendor Contract (40 Pages of Terms)", "cost": 7, "reward": "10 Career Capital.", "flavor": "Nobody read past page 3. That's where the bad clause is."}
    ],
    "evergreen": [
      {"name": "Answer a “Quick Question” on Slack", "cost": 2, "reward": "3 Career Capital; +1 Burnout.", "flavor": "That was forty-five minutes ago. There are now six people in the thread.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Reduce Technical Debt", "cost": 4, "reward": "5 Career Capital; +1 Burnout.", "flavor": "Perpetually 80% done. It has always been 80% done. It will always be 80% done.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Untangle the Legacy Spaghetti (One More Time)", "cost": 5, "reward": "6 Career Capital; +1 Burnout.", "flavor": "Found a comment that says “DO NOT REMOVE, NOT SURE WHY.” Removed it anyway.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Reply to the Jira Comment From Six Months Ago", "cost": 1, "reward": "1 Career Capital; +1 Burnout.", "flavor": "The person who filed it left the company in Q2. The ticket did not.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Delete the Commented-Out Code From 2019", "cost": 2, "reward": "2 Career Capital; +1 Burnout.", "flavor": "It's not documentation. It was never documentation.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Un-hardcode the Hardcoded Value", "cost": 3, "reward": "3 Career Capital; +1 Burnout.", "flavor": "Replaced “prod-server-3” with a config flag that defaults to “prod-server-3.”", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Rotate the API Keys You Forgot About", "cost": 3, "reward": "4 Career Capital; +2 Burnout.", "flavor": "Rotated three keys. Broke a fourth integration nobody remembered existed.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Bump the Node Version (Nothing Breaks. Probably.)", "cost": 4, "reward": "4 Career Capital; +1 Burnout.", "flavor": "247 transitive dependencies quietly disagree.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Consolidate the Three Config Files Into One (Now Four)", "cost": 4, "reward": "4 Career Capital; +2 Burnout.", "flavor": "Progress, technically.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Archive the Zombie Microservice", "cost": 5, "reward": "7 Career Capital; +2 Burnout.", "flavor": "Nobody knows what calls it. Everybody's afraid to find out.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Migrate Off the Framework You Migrated To Last Year", "cost": 6, "reward": "7 Career Capital; +1 Burnout.", "flavor": "The last migration's postmortem recommended this framework.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Squash 40 Commits Into “misc fixes”", "cost": 6, "reward": "8 Career Capital; +2 Burnout.", "flavor": "git blame now blames everyone equally.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."},
      {"name": "Finally Read the Incident Postmortem Action Items", "cost": 8, "reward": "10 Career Capital; +2 Burnout.", "flavor": "Item 1: “Add more monitoring.” Filed fourteen months ago. Still open.", "note": "Evergreen: this slot never leaves the Kanban Board. When claimed, discard this card and immediately draw a new card from the Evergreen pool into the same slot (this one may come up again). Exempt from Scope Creep."}
    ]
  },
  "events": [
    {"name": "Reply-All Apocalypse", "effect": "Every player gains 1 Burnout.", "flavor": "247 replies. 246 said \u201cplease remove me from this thread.\u201d"},
    {"name": "All-Hands Meeting (Could Have Been an Email)", "effect": "Every player loses 1 Productivity from this round's income.", "flavor": "It was, in fact, an email."},
    {"name": "Layoffs Loom (Just a Rumor... Probably)", "effect": "Every player gains 1 Burnout. The First Player gains 1 Political Capital out of sheer relief.", "flavor": "HR scheduled a \u201cquick chat.\u201d Nobody is calm."},
    {"name": "Quiet Quitting Goes Mainstream", "effect": "Any player may decline their Overtime option this round to remove 1 Burnout instead.", "flavor": "Doing exactly what's in the job description. Revolutionary."},
    {"name": "Free Bagel Friday", "effect": "Every player gains 1 Political Capital.", "flavor": "Cinnamon raisin again. Someone doesn't respect the group chat's preferences."},
    {"name": "Fire Drill", "effect": "The player who used Overtime most recently gains 1 Burnout.", "flavor": "Now standing in a parking lot with 200 coworkers you've never seen before."},
    {"name": "Surprise Reorg", "effect": "Randomly choose two players; swap one Skill card between them.", "flavor": "Nobody's job changed. Everybody's manager did."},
    {"name": "Engagement Survey (Anonymous, Allegedly)", "effect": "Every player gains 1 Political Capital.", "flavor": "Question 14: \u2018I feel my work is valued.\u2019 Strongly Disagree."},
    {"name": "The Office Dog Visits", "effect": "Each player may remove 1 Burnout.", "flavor": "Best coworker on the payroll. Unfortunately unpaid."},
    {"name": "New CEO Announced", "effect": "Each player with 5 or more Skill cards in play discards 1 of their choice.", "flavor": "New broom, new org chart, same problems."},
    {"name": "WiFi Dies Mid-Demo", "effect": "The First Player loses 1 Productivity.", "flavor": "The client watched a loading spinner for four minutes."},
    {"name": "Snack Wall Restocked", "effect": "Every player gains 1 Productivity.", "flavor": "Someone's hoarding the good granola bars again."},
    {"name": "The Chair Finally Gets Fixed", "effect": "Every player may remove 1 Burnout.", "flavor": "After 11 months and 4 support tickets. A quiet miracle."},
    {"name": "Casual Friday Goes Full Week", "effect": "Every player gains 1 Political Capital.", "flavor": "Nobody knows what \u2018business casual\u2019 means anymore. Everyone's relieved."},
    {"name": "Unlimited PTO (Policy, Not Practice)", "effect": "No player may use the Self-Care action this round.", "flavor": "Technically infinite. Practically, someone will ask why you're taking it."},
    {"name": "Company Offsite in Cancun", "effect": "The First Player gains 2 Productivity. Every other player gains 1 Burnout (FOMO).", "flavor": "Mandatory fun. Fully mandatory."},
    {"name": "IT Outage", "effect": "Skip the Income Phase for every player this round.", "flavor": "The ticket says \u2018Priority: Urgent.\u2019 The queue says \u2018Position: 214.\u2019"},
    {"name": "Late-Night CEO Email", "effect": "Every player gains 1 Burnout.", "flavor": "Sent 11:47 PM. Subject line: \u2018Quick thought \ud83d\udca1\u2019"},
    {"name": "Company-Wide Chat Outage", "effect": "No player may take the Network action this round.", "flavor": "Turns out everyone was just Slacking each other from three feet away."},
    {"name": "Corporate Wellness Session", "effect": "Every player may remove 1 Burnout, but loses 1 Productivity this round.", "flavor": "A 20-minute breathing exercise squeezed between two deadlines."},
    {"name": "Viral Hustle Culture Post", "effect": "Every player immediately resolves a Mandatory Training card, out of the normal cycle.", "flavor": "\u2018Sleep is for people who don't want it badly enough\u2019 \u2014 2.1M likes."},
    {"name": "A Colleague's Job Interview (Elsewhere)", "effect": "Each player chooses: gain 2 Political Capital (you covered for them), or gain 2 Productivity (you quietly took their tasks).", "flavor": "They \u2018have a dentist appointment.\u2019 Everyone knows."},
    {"name": "Open-Floor-Plan Renovation", "effect": "Every player gains 1 Burnout.", "flavor": "Now you can hear every phone call within 40 feet. Great for focus."},
    {"name": "Catered Lunch (Actually Good This Time)", "effect": "Every player gains 1 Productivity and 1 Political Capital.", "flavor": "The good taco place. Morale is measurably higher."},
    {"name": "Server Room Overheats", "effect": "Whoever has the most Skill cards in play loses 1 Productivity.", "flavor": "It's always the one player with the biggest tableau."},
    {"name": "The Standing Desk Convert", "effect": "Each player who owns \u201cStanding Desk Enthusiast\u201d gains 1 extra Political Capital.", "flavor": "They will tell you about it regardless."},
    {"name": "The Spreadsheet Leaks Early", "effect": "Every player gains 1 Political Capital.", "flavor": "Someone found next Quarter's ranking spreadsheet. Everyone's recalculating."},
    {"name": "Everything Is On Fire (Metaphorically, Probably)", "effect": "Whoever has the most Burnout gains 1 more Burnout. Every other player gains 1 Political Capital in sympathy.", "flavor": "It's always the same person's fire."},
    {"name": "Therapy Benefit Actually Gets Used", "effect": "Any one player may remove 2 Burnout.", "flavor": "Covered at 60% after the deductible. Still worth it."},
    {"name": "National Cybersecurity Awareness Month (It's Also October)", "effect": "Every player gains 1 Compliance Badge.", "flavor": "The phishing test email had 12 typos. 30% of the company still clicked it."}
  ],
  "trainings": [
    {"name": "Anti-Harassment Training (The Annual Awkward One)", "effect": "Standard.", "flavor": "Same video. Same actor. Somehow one year older each time."},
    {"name": "Cybersecurity Awareness: You Clicked the Phishing Link", "effect": "Standard, plus +1 Burnout.", "flavor": "The email was from \u2018IT Depatrment.\u2019 It had a countdown timer."},
    {"name": "Data Privacy Training (Promises Retention By Lunch)", "effect": "Standard.", "flavor": "GDPR, CCPA, and six acronyms nobody in the room can define."},
    {"name": "DEI Refresher Course", "effect": "Standard.", "flavor": "The same slide deck as last year, with a new date in the corner."},
    {"name": "Fire Safety Procedures (Nobody Remembers)", "effect": "Standard.", "flavor": "The evacuation map on the wall is for a building that no longer exists."},
    {"name": "The Team Retreat (Trust Falls Included)", "effect": "Standard, plus +1 Burnout.", "flavor": "Someone did not get caught. It has changed the team dynamic permanently."},
    {"name": "Information Security Awareness Month", "effect": "Standard.", "flavor": "Coincidentally also National Cybersecurity Awareness Month. Nobody planned this. Everyone's annoyed regardless."},
    {"name": "New Manager Training (\u201cGood Luck\u201d Sendoff)", "effect": "Gain 2 Compliance Badges instead of the usual 1.", "flavor": "Four hours on feedback techniques. Zero minutes on the raise you were promised."},
    {"name": "Bias Workshop (Everyone Assumes It's About Someone Else)", "effect": "Standard.", "flavor": "Full attendance. Zero self-recognition."},
    {"name": "Phishing Simulation Test (People Actually Failed)", "effect": "Standard. Additionally, whoever has the least Political Capital also gains 1 Burnout.", "flavor": "23% company-wide click rate. HR is \u2018concerned.\u2019"},
    {"name": "Ethics Training (Sponsored By the Thing That Caused It)", "effect": "Standard.", "flavor": "Scheduled the same week as the news story. Nobody mentions the news story."},
    {"name": "Unconscious Bias Training, Redux", "effect": "Standard, plus +1 Political Capital.", "flavor": "The sequel nobody asked for. Somehow longer than the original."}
  ],
  "management": [
    {"name": "The Micromanager", "effect": "Your first Action each round must be Work a Project if you can afford one; otherwise it is wasted.", "flavor": "Wants a status update on the status update."},
    {"name": "The Absentee Boss", "effect": "Gain 1 free Action Point each round. You may not take the Network action \u2014 your boss is never around to introduce you to anyone.", "flavor": "Hasn't reviewed a time-off request since the reorg. Or approved one. Or seen one."},
    {"name": "The Credit-Stealing Boss", "effect": "Whenever you complete a Project, lose 1 Career Capital but gain 1 Political Capital (sympathetic coworkers notice).", "flavor": "Presented your work at the all-hands. Used the word \u2018we\u2019 a lot. Meant \u2018I.\u2019"},
    {"name": "The Chaotic Pivot-Happy Visionary", "effect": "At the start of each Quarter, flip a coin: heads, gain 2 Productivity; tails, discard 1 Skill card.", "flavor": "The strategy changed twice during this sentence."},
    {"name": "The Yes-Man Exec", "effect": "Hiring Skill cards costs 1 less Productivity (minimum 1). Mandatory Training costs you 2 lost Action Points next round instead of 1.", "flavor": "Agreed with the last three people who talked to him. In the same meeting."},
    {"name": "The Actually Supportive Manager", "effect": "Gain 1 Political Capital every Income Phase. No drawback.", "flavor": "Asked how you're doing and waited for the actual answer. Suspicious, but in a good way."},
    {"name": "The Results-at-Any-Cost Boss", "effect": "Overtime grants +1 extra Productivity, but also +1 extra Burnout, on top of its normal effect.", "flavor": "Doesn't care how you hit the number. Cares extremely if you don't."},
    {"name": "The Buzzword Machine", "effect": "Network grants +1 extra Political Capital. Your Projects cost 1 more Productivity \u2014 nobody can define the deliverable.", "flavor": "Wants to double-click on synergies before we boil the ocean."},
    {"name": "The Founder Who Refuses to Delegate", "effect": "Gain 1 free Action Point each round. Self-Care costs 2 Action Points instead of 1.", "flavor": "\u201cWe're moving fast\u201d has justified everything since 2019."},
    {"name": "The Tenure-Not-Talent Manager", "effect": "Compliance Badges count double toward promotion requirements. Hiring Skill cards costs 1 more Productivity.", "flavor": "Been here 14 years. Still can't use the new expense software."},
    {"name": "The Seagull Manager", "effect": "At the start of each Quarter, flip a coin: heads, every other player gains 1 Burnout \u2014 you swooped in and stirred things up; tails, you gain 1 Political Capital \u2014 you flew off before anyone noticed.", "flavor": "Flies in, makes a lot of noise, craps on the roadmap, and is gone before the retro."},
    {"name": "The Mushroom Manager", "effect": "+2 Productivity/round (fed on nothing, somehow still growing); \u22121 Political Capital/round (kept in the dark \u2014 nobody tells you anything).", "flavor": "Kept in the dark and fed manure. Thriving, weirdly."},
    {"name": "The Peter Principle", "effect": "Your Action Points are always 2, no matter your rung \u2014 promoted well past their competence. Hiring Skill cards costs 1 less Productivity (overcompensates by throwing tools at the problem).", "flavor": "Promoted three times. Still can't find the deploy script."},
    {"name": "The Always-On Boss", "effect": "Overtime grants +1 extra Burnout, on top of its normal effect (always expects a same-night reply). Self-Care costs 2 Action Points instead of 1 (there's no such thing as fully logging off).", "flavor": "Texts you at 11 PM. Reacts with a \ud83d\udc4d to your out-of-office reply."},
    {"name": "The Nepotism Hire", "effect": "+2 Political Capital/round (knows people); Hiring Skill cards costs 1 more Productivity (couldn't approve a headcount request to save their life).", "flavor": "Turns out the CEO is their uncle. Nobody has said this out loud."},
    {"name": "The Consultant-Turned-Manager", "effect": "Your Projects cost 1 less Productivity (loves a framework for everything); \u22121 Political Capital/round (nobody trusts the person who charges by the hour).", "flavor": "Drew a 2x2 matrix. Nobody asked for the 2x2 matrix."}
  ]
}
```

---

## 9. Known Design Decisions & Postmortem (read this before "fixing" anything)

These all came out of an actual iterative balance-testing process (three tuning
passes, 20,000 simulated games each). If an implementation naively "simplifies"
any of these back to the more obvious-seeming version, the game breaks the same
way it did in early testing. Consolidated here for quick reference; each is
also called out inline at its relevant rule above.

**9.1 — Review Score must count CC gained this Quarter, not just banked P/PC.**
Early draft: `reviewScore = productivity + politicalCapital - burnoutPenalty`,
using only *leftover, unspent* banked resources. This catastrophically
punishes any strategy that actually spends its Productivity completing
Projects (which is the entire point of Projects) — such a player's bank
balance looks empty right at the review moment even though they're
out-earning everyone on Career Capital. Fixed by explicitly adding "Career
Capital gained since your Quarter Marker" as its own term (Step 1, Section 6).

**9.2 — Promotion candidates must be filtered to "eligible" first, then ranked
by score — not ranked by score first with eligibility checked one at a time.**
The second ordering silently starves any strategy that reliably posts a low
Review Score (see 9.1's root cause) even after 9.1 is fixed, because with a
single promotion slot shared by 5 players, some *other* eligible player almost
always outranks the specialist by score and takes the slot first, every single
Quarter, forever. Filtering the pool to only-the-eligible before ranking gives
every qualified player a fair shot at the score-based tiebreak.

**9.3 — The CEO Board Vote is independent of Review Score and independent of
standard promotion.** It's evaluated separately (Step 2, before Steps 3–4), and
a VP who wasn't this Quarter's best performer can absolutely win the vote and
become CEO purely by holding the most Political Capital among rung-5 peers.
This is an intentional satirical beat, not a bug — but it does mean **the newly
crowned CEO must be explicitly excluded from both the Step 3 promotion pool and
the Step 4 PIP/demotion pool of the same Review.** An early implementation bug
let the new CEO get swept into the PIP/demotion check in the same Review they
were crowned (because their Review Score that Quarter could be mediocre even
though their Political Capital was high) — resulting in them being demoted
back to VP immediately after becoming CEO, in the same function call. Exclude
by identity, not by rank.

**9.4 — Burnout Crisis is an interrupt, checked immediately after every change
to `burnout`, not a once-per-round batch check.** A player can cross the
threshold mid-Action-Phase (e.g., from Overtime) and must have the Crisis
resolve before their next action, not queued until end of round.

**9.5 — Meteoric Rise is capped at VP (rung 5); it can never jump a player
directly into CEO.** The Board Vote is the only path to rung 6, by design —
otherwise a single spectacular Quarter could end the game without ever
passing through the political gate that's supposed to matter at the top.

**9.6 — The Evergreen slot never depletes.** Every other Project is a
one-time board slot; the 5th Kanban Board slot is a repeatable action
disguised as a board slot. Claiming it just draws the next card from its own
small Evergreen pool into the same slot — don't let it get accidentally swept
up in the normal Kanban "refill empty slots" logic (5.4) as if it needed
replacing from the main Project pool, and don't let it drop out of Scope Creep
accounting into the regular path either — it draws from its own pool and
never leaves the board.

**9.7 — Quarter Marker moves *after* everything else in a Review, not before.**
Review Score (Step 1) must be computed against the marker position left over
from the *previous* Review. Moving the marker is explicitly the last
sub-step (Step 5) of the current Review.

**9.8 — Backlog Grooming (5.1.2) adds unconditionally every round with no
size cap, and Work a Project can target any backlog entry — this changes
the archetype balance from the v3 baseline, though choice among entries
prevents the outright soft-lock an earlier single-held-task design had.**
Two designs were tried here, in order, each simulated with the same
five-archetype, one-of-each methodology as Section 10:

- **v1 of this feature (superseded):** each player could hold at most one
  task, claimed via a heuristic (`bestClaimIndex`) that always grabbed the
  single highest-value available card with no regard for the claiming
  player's Productivity income — and since a held task couldn't be
  abandoned or swapped, a player assigned an expensive card they couldn't
  afford was stuck with *only* that card until they somehow paid it off.
  Instrumented: Politician held the exact same unpaid task for 23 of 24
  rounds in a representative Long Game, consistently across repeated runs.
  Win rates: Workaholic/Grinder ~30% each, Balanced/Cautious/Politician
  ~13-14% each.
- **Current design:** the one-task cap is gone. Every player's backlog
  grows by exactly one entry every Stand-Up regardless of size (still via
  `bestClaimIndex`, still with no regard for affordability), but Work a
  Project can now pay off **any** backlog entry, not just the most recent
  or most valuable one — so a player who can't afford their priciest entry
  can simply Work a cheaper one instead. This removes the multi-round
  soft-lock: the same instrumentation now shows every archetype making
  steady Career Capital progress, though low-Productivity archetypes
  (Politician especially) still end a 24-round game with a visibly larger,
  more slowly-draining backlog (15-19 entries typical) than
  Productivity-heavy ones (Workaholic, often single digits) — which reads
  as an intentional, on-theme consequence ("the backlog always grows")
  rather than a bug. Win rates over a 300-game sweep: Workaholic ~27%,
  Grinder/Politician ~23% each, Balanced ~17%, Cautious ~11% — closer to
  even than v1 of this feature, though still not a match for the v3
  baseline (Balanced 51%, Cautious 36%, Grinder+Workaholic under 2%
  combined) from before this feature existed at all. Whether that
  remaining gap is worth a further rebalance (e.g., retuning the claim
  heuristic, or the AI's Work-vs-Hire-vs-Network weighting now that
  Working can happen many times per Sprint) is a follow-up decision, not
  something addressed here.

---

## 10. Relationship to the Existing Balance Simulator

`stack_ranked_balance_simulator.py` (included in this project) is a Monte Carlo
tool that pits five fixed bot policies (Grinder, Politician, Balanced,
Workaholic, Cautious) against each other for tens of thousands of games to
validate that the economy is winnable by more than one playstyle, and that
games converge in a reasonable number of rounds.

**What it validates and can be trusted for:**
- Overall pacing (rounds per game, % of games ending via a genuine CEO
  promotion vs. hitting a safety-valve round cap).
- The shape of the Quarterly Review algorithm — its `run_review()` function
  implements the *exact* same Step 1–5 / Board Vote / eligibility-first logic
  described in Section 6 above, already debugged against the three failure
  modes in Section 9.
- Relative strategy viability at a coarse level (final tuned numbers: Balanced
  ~51%, Cautious ~36%, Politician ~11%, Workaholic ~1%, Grinder ~0.5% win rate
  in 5-player all-distinct-strategy games — see `results.json` for full
  numbers, or the Designer's Notes section of the rulebook).

**What it deliberately does NOT model, and should not be copied from:**
- Individual cards. The simulator abstracts "Hiring a Skill card" as a generic
  `invest_p` / `invest_pc` action with a diminishing-returns formula, not as
  drawing one of 30 specific named cards with specific effects. **The real
  card-by-card effects in Section 8 are the actual game** — the simulator's
  economy is a simplified stand-in used only to validate pacing and promotion
  fairness at a structural level.
- Office Chaos, Mandatory Training, and Management Style cards are not
  individually modeled in the simulator at all (it applies small generic
  random noise instead). Their real effects come only from Section 8.
- The simulator's bots follow one fixed policy for an entire game and never
  adapt — real players (or any non-trivial AI opponent) should be expected to
  outperform every one of these bots individually, especially the specialists.
  If you want AI opponents for solo/practice play, the five archetypes are a
  reasonable *starting point* for AI personality profiles, but should almost
  certainly be made more adaptive than the literal bot code.

If you re-run or extend the simulator, `python3 stack_ranked_balance_simulator.py`
regenerates `results.json` and `balance_chart.png` from scratch (no cached
state) — safe to modify and re-run at any time.

---

## 11. Open Questions for Project Kickoff

Not answered by the ruleset itself — decide these before or during initial
architecture work:

1. **Real-time vs. async turn-based.** Nothing in the rules requires live
   simultaneity except the Income (5.1.1)/Lunch/Postmortem phases being
   "simultaneous" in the sense of not depending on turn order — they don't
   require players to be online at the same instant. (Backlog Grooming,
   5.1.2, and Action Phase both already resolve strictly by turn order.) A
   play-by-web async model (get notified when it's your turn, act
   whenever) is fully viable given Section 7.2's analysis, and may be an
   easier v1 than a live WebSocket session.
2. **Tech stack.** No constraint from the rules. A perfect-information,
   turn-based game with no real-time physics is comfortable in almost
   anything — pick based on team familiarity rather than game requirements.
3. **Lobby / matchmaking.** Private room codes vs. public matchmaking vs.
   both.
4. **AI opponents.** Wanted for solo play? If so, budget this as real design
   work, not a port of the simulator bots (see Section 10's caveat).
5. **Persistence.** In-memory (server restart = game lost) is fine for an MVP
   given typical session length (~30–90 min); a real deployment probably wants
   at least periodic state snapshots for reconnect support.
6. **Reconnect / disconnect handling.** The rules don't address this (it's a
   physical-game ruleset). Suggest: a disconnected player's turn can be
   auto-skipped after a timeout using the "safest" default action (Self-Care,
   or simply passing remaining AP), with a way to resume control on
   reconnect before their next turn actually locks in.

---

## 12. Reference Files In This Project

- `STACK_RANKED_RULEBOOK.md` — full human-readable rulebook with flavor text,
  setup narrative, and the Designer's Notes balance-testing writeup.
- `Stack_Ranked_PrintAndPlay.pdf` — physical card sheets (not needed for the
  digital build, but a useful visual cross-check of card layout/grouping).
- `cards.json` — the same card data embedded in Section 8, as a standalone file
  if you'd rather load it directly than extract the fenced block above.
- `stack_ranked_balance_simulator.py` / `results.json` / `balance_chart.png` —
  balance-testing tool and its output (Section 10).
