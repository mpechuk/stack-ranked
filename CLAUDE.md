# CLAUDE.md — Stack Ranked

Working notes for this repo so a fresh session doesn't have to re-scan everything.
**Stack Ranked** is a single-page, dependency-free browser game (corporate
career-ladder engine builder, 2–6 players, Human/AI). The rules engine is pure
JS and runs headlessly in Node.

> **Two things to keep straight:** `game.js` is the source of truth for the
> **playable game**; `docs/STACK_RANKED_GAME_SPEC.md` is the source of truth for
> the **written rules**. When they drift, one of them is a bug. See
> **Maintenance Rules** at the bottom — follow them on every logic/card/visual
> change.

---

## 1. File map

| File | What it is |
|---|---|
| `game.js` | The rules engine + AI. **DOM-free**, Node-runnable. Exports `SR` (also `window.SR`/`globalThis.SR`). Embeds all card data verbatim in `CARDS`. |
| `index.html` | The whole UI (inline CSS/JS). Loads **PeerJS (CDN)**, `game.js`, **and `net.js`** via `<script src>`, drives the engine through async hooks. `SR` aliased as `SR`, `SR.constants` as `C`, `SR.helpers` as `H`, `SRNet` for online play. |
| `net.js` | **Online play** transport (loaded like `game.js`). **DOM-free** except the PeerJS transport; Node-runnable (`module.exports`/`window.SRNet`) for the pure pieces. Holds the snapshot codec (`serializeState`/`reviveState` — folds card refs ↔ `SR.DEFS`), the wire protocol (`MSG`/`msg`/`isValid`), identity (`deriveRoomCode`/`deriveClientId`/`sanitizeId`), `iceServers()`+`TURN_CONFIG`, gzip wire compression, a dependency-free QR encoder (`SRNet.qr`), and the **PeerJS `hostRoom`/`joinRoom`** transport. See §8. |
| `cards.json` | Canonical card data **plus** an `image` field per card. `game.js`'s `CARDS` is the same data **without** `image` — keep them in sync. |
| `leaderboard.md` | Career Ladder rung data (AP, CC thresholds, badges) — source for the ladder PDF. |
| `badges.json` | Compliance Badge component data — one badge per Mandatory Training (name, monogram, motto, source training, grant count, accent). Source for the badges PDF. Derived from the `trainings` in `cards.json`; not a rules change (badges stay fungible). |
| `docs/STACK_RANKED_GAME_SPEC.md` | Implementer spec (exact numbers/ordering). §13 covers the variant rules. |
| `docs/STACK_RANKED_RULEBOOK.md` | Player-facing rulebook (→ rulebook PDF). Has a "Variant Rules" section + Card Reference Appendix. |
| `stack_ranked_montecarlo.js` | **Card-faithful** Monte-Carlo balance harness — drives real `game.js`. Seeded/reproducible. See §5. |
| `stack_ranked_balance_simulator.py` | Old **coarse economic** sim (abstracts cards). Reference only; does NOT model the variant rules. |
| `montecarlo_results.txt` | Saved canonical output of the JS harness. |
| `generate_*.py` | PDF generators (see §6). |
| `card-art-prompts.txt`, `player-mat-art-prompts.txt`, `career-ladder-art-prompts.txt`, `badge-art-prompts.txt` | Image-gen prompts for the (mostly missing) card/mat/ladder/badge art. |
| `cards-images/`, `table-images/` | Card / table art PNGs (**Git LFS** — see §6). Only a handful exist; every generator tolerates missing art. |

---

## 2. Engine model (`game.js`)

IIFE with numbered sections. Rough map:
- **§1 `CARDS`** — all card data, verbatim from `cards.json` minus `image`. Categories: `skills.{tier1,tier2,tier3}`, `projects.{early,mid,late,evergreen}`, `events`, `trainings`, `management`, `feedback` (variant).
- **§2 Constants** — `RUNG_NAMES`, `AP_BY_RUNG=[2,2,3,3,4,4,4]`, `CC_THRESHOLD={1:8,2:18,3:30,4:44,5:60,6:78}`, `BADGE_REQ={4:2,5:4}`, `CEO_CC_BAR=78`, `BURNOUT_MAX=10`, `BURNOUT_CRISIS_RESET=6`, `LONG_GAME_ROUNDS=24`, `SAFETY_CAP=60`, **`DEFAULT_RULES`** (variant dials), `buildRules()`.
- **§3 Metadata** — `SKILL_META`, `MGMT_META`, `TRAINING_META`: hand-encoded structured effects keyed by `slug(name)`. **New cards with mechanical effects need an entry here** (plain +P/+PC/burnout live in meta; anything conditional is handled at its trigger site).
- **Helpers** — `slug`, `shuffle`, `leaderRung`, `threatLeader` (rung→CC→PC front-runner), `feedbackNegTarget`, `meetsRequirement`, `effective{Hire,Project,BacklogItem}Cost`, `mm(player)` (management meta), etc.
- **Actions** — `doHire`, `doWorkProject`, `doNetwork`, `doSelfCare`, `doOvertime`, `applyShipsItFriday`, `doShareProject`, `doContribute` (last two = collaboration), `doSwitchManager`/`applyChooseManager` (Request a Transfer — see below).
- **Round loop** (`play`): `startRound → startQuarterEffects → incomePhase → assignTasks` (Stand-Up backlog claim, shared Kanban) `→ Sprint` (`aiTakeTurn`/`hooks.humanTurn`, sequential by turn order) `→ lunch` (Office Chaos) `→ postmortem` (refill boards, Scope Creep, advance First Player, **Review every 3rd round**, Mandatory Training every 2nd review).
- **Review** (`runReview`, exact 5-step order): Step 1 score `= CCgainedThisQuarter + PC + feedback − tasksOnHand` (backlog length at Review); Step 2 CEO Board Vote (rung-5 & CC≥78, PC+feedback tiebreak, independent); Step 3 promotions **eligible-first then rank by score**, exactly **one rung per Review** (no level-skipping); Step 4 PIP/demote lowest; Step 5 reset (move Quarter Marker LAST, zero P/PC). Do not reorder — see spec §9.
- **AI** — `ARCH` archetype weights (`grinder`, `politician`, `balanced`, `workaholic`, `cautious`); `aiTakeTurn` (scores Work/Collaborate/Hire/Network/**SwitchManager** per AP — the last only when `managerValue(current)` is clearly negative), `aiDecide` (event/feedback/**chooseManager** choices).
- **Hooks** (all optional): `log`, `onChange`, `wait`, `humanTurn`, `decide(req)`, `onEvent(card)` (Office Chaos announcement — awaited so the host can hold the table on the drawn card), `onReview(summary)`, `onGameOver`. AI-only games pass `{}` or just `{log}`.

### Resources / persistence
`rung`(0–6), `productivity`(resets each Review), `politicalCapital`(resets), `burnout`(persistent 0–10, Crisis at 10), `careerCapital`(persistent, ~monotonic), `quarterMarker`, `complianceBadges`, `hasPip`, `backlog[]`, `_transferUsedThisQuarter`(resets each Quarter).

### Request a Transfer (core rule, always-on — NOT a variant dial)
Sprint action to escape a punishing early boss: costs 1 AP + 2 Burnout, **once per Quarter** (`_transferUsedThisQuarter`, reset in `startRound`). `doSwitchManager` draws the top **2** of the Management deck (before discarding the current, so a near-empty deck can't strand you), discards the current boss, and returns `{ok:true, pending:'chooseManager'}` holding the 2 on `player._managerChoice`; the driver then calls `applyChooseManager(state, player, id)` to keep one + `syncImmunity`. AI: `aiTakeTurn` scores a switch only when `managerValue(current) < -0.5` (leave a clearly-bad boss), then keeps the higher-`managerValue` candidate; `aiDecide` case `chooseManager` mirrors that. `managerValue(player, mgrDef)` (exported in `SR.helpers`) is the heuristic boss-quality score. **Test-only seam:** `state._noTransfer` disables it (never set by `newGame`/UI). Because AP is fixed at `beginTurn`, a mid-Sprint switch doesn't retroactively change this turn's AP. Public: `SR.actions.{switchManager,chooseManager}`, `SR.helpers.managerValue`.

### Variant rules (both default ON; all dials in `DEFAULT_RULES` / per-game `config.rules`)
- **Feedback deck** — 18 cards (9 Positive +2 / 9 Constructive −2). `resolveFeedbackPhase(state, hooks)` runs at the **top of every Review, before `runReview`** (called from `postmortem`, async so humans can be asked); it's a **dispatcher** on `feedbackMode` → `resolveFeedbackClassic` or `resolveFeedbackGiveOne`, then a shared `tallyFeedback`. Net folds into Review Score + CEO tiebreak, clamped to ±`feedbackNetCap` (=4). Dials: `feedbackMode`(`'classic'` default | `'give-one'`), `feedbackValue`(2), `feedbackNetCap`(4), `feedbackTarget`(`'score'` default | `'rung'` | `'blend'` | `'spread'`), `feedbackNegLeaderOnly`, `feedbackBlendPcWeight`(6). Transient — never touches persistent PC. UI is selectable ("Feedback Round" on setup → `config.rules.feedbackMode`).
  - `'classic'` — deal 1/player, keep-or-give. UI: `hooks.decide({action:'giveFeedback', options:[…]})` returns a playerId.
  - `'give-one'` ("360° Review") — deal each player 1 Positive + 1 Constructive; each **gives one away (never to self) and discards the other**, chosen face-down from pre-phase state and revealed simultaneously (resolve all gifts into a `gifts[]` array, THEN assign — don't mutate held mid-loop). AI throws the negative at `feedbackNegTarget`, discards the positive → bounded leader-bash. UI: `hooks.decide({action:'giveFeedbackChoose', options:[{key:'pos:'|'neg:'+pid}]})` returns `"<polarity>:<pid>"`. **Balance-measured equal to classic (see spec §13.3) — it's table-feel, not a balance lever.**
  - Review summary rows carry `feedback` either way.
- **Collaborative Projects** — a backlog item can be `shared`; anyone contributes Productivity (`doContribute`/`contributeToProject`) across turns; on completion (`completeCollaborative`): **CC follows the Productivity that paid for it** — solo owner → full CC; lone outside funder → that funder takes full CC; ≥`collabMinContributors`(2) with ≥1 non-owner → contributors split CC proportionally and the **owner takes PC = max(cardCC−2,1) IN LIEU of a CC share** (capped by `collabOwnerPcCap`=3; `collabOwnerMustContribute`=true → owner must pay ≥1 P to earn it). Dials also: `collabLeaderCannotReceive`. **Semantic invariant:** never credit a non-contributing owner with CC; owner PC is *instead of*, not *on top of*, CC. (Getting this wrong made the Politician win ~45–60% — see spec §13.3.)

Public (variants): `SR.actions.{shareProject,contribute}`, `SR.helpers.sharedProjects`. Internal (tests): `SR._internal.{resolveFeedbackPhase,resolveFeedbackGiveOne,resolveFeedbackClassic,contributeToProject,completeCollaborative,sharedProjects,threatLeader,buildRules}`.

---

## 3. Run it headlessly

```js
const SR = require('./game.js');
const st = SR.newGame({ variant:'race-to-ceo', // or 'long-game'
  players:[{name:'A',kind:'ai',archetype:'grinder'}, /* … */],
  rules:{ /* overrides merged over DEFAULT_RULES; omit for defaults */ } });
await SR.play(st, { /* hooks; {} for silent AI-only */ });
// winner: st.winnerId (CEO) else st.standings[0]
```

---

## 4. Design invariants (don't "simplify" these — spec §9)

Review Score must count **CC gained this Quarter** (not banked P/PC alone). Promotions **filter to eligible, then rank by score** (not score-first). CEO Board Vote is independent and the new CEO is excluded from Steps 3–4. Burnout Crisis is an **immediate interrupt** on any burnout change. Promotions advance **exactly one rung** — never skip a level. Quarter Marker moves **last**. Evergreen Kanban slot never depletes / is Scope-Creep-exempt. Plus the variant semantics in §2.

---

## 5. Balance testing

**Test suite (assertions, fast — run this on every logic/card change):**
```
npm test        # node --test over test/*.test.js — ~2.5s, zero deps (Node's built-in runner)
```
`test/` folds the balance harnesses into pass/fail checks so you don't eyeball tables:
`balance.test.js` drives the exported `runCell` from the Monte-Carlo harness at N=400 (seeded → exactly reproducible) and asserts the design invariants for the **recommended** and **baseline** rulesets — 100% CEO endings, `balSD < 5.5` (well-balanced), Burnout a live constraint (`crises/game > 3.5`, since **every Project carries Burnout**), and comeback-friendly (`comeback > 25%`, `runaway < 40%`); `manager-switch.test.js` asserts the Request-a-Transfer causal verdict (`verdict()`); `engine-smoke.test.js` runs a headless AI game + resource invariants and confirms `game.js`/`net.js` load as Node modules. **New balance-affecting change → run `npm test`; if a threshold legitimately moves, update it there.** Thresholds are ranges with margin — they catch a real regression (e.g. reverting per-Project burnout spikes balSD back toward ~8.6 and drops crises to ~2.4, failing the checks) without breaking on benign tweaks.

**Full human-facing sweeps (deep dives, big N, printed tables):**
```
npm run sim:balance  -- [gamesPerCell=1500] [variant=race-to-ceo]   # = node stack_ranked_montecarlo.js
```
Seeded. For each ruleset it runs **DISTINCT** games (5 different archetypes → strategy balance) and **MIRROR** games (all-Balanced → any lead is pure luck → comeback metrics), then a player-count/variant sanity sweep. Metrics: win-rate spread (`balSD`), comeback (bottom-half / dead-last-at-halftime wins), runaway (halftime leader wins), % CEO endings, and burnout load (crises / self-care / overtime per game). **Recommended defaults are among the most balanced configs measured** (balSD ~2.6pp since every Project now carries Burnout — far tighter than the pre-burnout ~8.6pp, with comeback/runaway held); `feedbackTarget:'rung'` now *loosens* balance (over-lifts the Politician) — see spec §13.3. Both scripts export their compute functions and only run their CLI under `require.main === module`, so the test suite reuses them.
```
npm run sim:transfer -- [gamesPerArm=1000] [variant=race-to-ceo]    # = node stack_ranked_manager_switch_test.js
```
Focused catch-up test for Request-a-Transfer: 6 identical (Balanced) seats split into a cohort forced onto The Micromanager vs a clean-boss field; runs Arm A (`state._noTransfer=true`) vs Arm B (transfers on) on the **same seeds**. Proves the causal lift — being able to switch ~triples the bad cohort's win share (~10%→~39%) and nearly doubles its final rung. Its `verdict()` is the single source of truth shared by the CLI and the test.

The Python sim (`stack_ranked_balance_simulator.py`) is the older coarse tool — do NOT use it for the variant rules (it abstracts cards).

---

## 6. PDF / visual generators

Deps: `pip install reportlab pillow markdown beautifulsoup4`. **Python 3.9** here — no backslashes inside f-string expressions (hoist emoji chars to a variable). Generators print a warning and skip missing art.

> **The generated PDFs are NOT tracked in git** — `docs/*.pdf` is git-ignored and the PDFs are **published as GitHub Release assets**. **CI publishes them automatically:** `.github/workflows/publish-pdfs.yml` runs on every push to `main` that touches a PDF *source* (path-filtered — see below), regenerates all five, and cuts a fresh **`pdf-<run_number>`** release marked **Latest**; the README download links use `/releases/latest/download/…` so they always resolve to that newest build. **Gotcha:** the workflow's `paths:` filter is a hardcoded list — a new generator *input* (e.g. a new source `.md`/data file or art dir) must be added there or a change to it won't trigger a rebuild. To publish by hand (or when CI is unavailable — release create/edit is blocked from some agent sessions by org egress policy), regenerate locally and run **`scripts/publish_pdf_release.sh`** (defaults to the stable **`pdf-assets`** tag; pass a tag + `--latest` to mimic CI). The manual `pdf-assets` release is never pruned (prune only matches `pdf-<number>`).
>
> **The image assets are stored in Git LFS** — `*.png` (see `.gitattributes`: `cards-images/`, `table-images/`, `docs/Cover*.png`). Working with them needs `git lfs` installed; a checkout without it yields pointer files (fine for the deploy/CI paths, which don't touch the PNGs, but the generators and `add_card_image.py` need the real bytes → `git lfs pull`). LFS objects push through the normal `git push`.

| Command | Reads | Writes (git-ignored; auto-published by CI, or via the publish script) |
|---|---|---|
| `python3 generate_rulebook_pdf.py` | `docs/STACK_RANKED_RULEBOOK.md` | `docs/Stack_Ranked_Rulebook.pdf` |
| `python3 generate_print_and_play.py` | `cards.json` | `docs/Stack_Ranked_PrintAndPlay.pdf` |
| `python3 generate_player_mat.py` | self-contained layout + `table-images/` | `docs/Stack_Ranked_PlayerMat.pdf` |
| `python3 generate_career_ladder.py` | `leaderboard.md` | `docs/Stack_Ranked_CareerLadder.pdf` |
| `python3 generate_badges.py` | `badges.json` | `docs/Stack_Ranked_Badges.pdf` |

`generate_print_and_play.py` builds decks from a hardcoded `groups` list — **a new card category must be added there** (+ `PALETTE`/`CATEGORY_EMOJI` entries). It also exports `RESOURCE_EMOJI`/`icon_tag`/`xml_escape`, reused by `generate_player_mat.py`.

---

## 7. ⚠️ MAINTENANCE RULES — follow on every change

Keep the game, the written/printable rules, and the visuals in lockstep. After any change, do the matching row(s), then regenerate the affected PDF(s):

1. **Changed game LOGIC / RULES** (round loop, Review, actions, thresholds, `DEFAULT_RULES`, card *effects*):
   - Update **`docs/STACK_RANKED_GAME_SPEC.md`** (implementer spec) **and** **`docs/STACK_RANKED_RULEBOOK.md`** (player rules).
   - Keep **`index.html`** in sync (any new `hooks.decide` action, new action buttons, review columns).
   - **Regenerate the rulebook PDF.**
   - Re-run **`stack_ranked_montecarlo.js`**, refresh `montecarlo_results.txt`, and update the balance writeups (spec §13.3, rulebook Designer's Notes).

2. **Changed CARDS** (`cards.json` and/or `game.js` `CARDS`):
   - **Keep `game.js` `CARDS` and `cards.json` in sync** — identical except `cards.json` carries `image`, `game.js` does not. Add structured effects to `SKILL_META`/`MGMT_META`/`TRAINING_META` if mechanical. New category → also update `generate_print_and_play.py`'s `groups`.
   - Update **`docs/STACK_RANKED_RULEBOOK.md`** Card Reference Appendix + Deck Composition, and **`card-art-prompts.txt`** (add prompt blocks, bump the END count).
   - **Regenerate the print-and-play PDF** (and rulebook PDF).

3. **Changed player-facing TRACKERS / quick-reference / components** → update `generate_player_mat.py`, **regenerate the player-mat PDF**.

4. **Changed the CAREER LADDER** — `leaderboard.md` holds the rungs / AP / CC thresholds / badges (mirror in `game.js` constants + spec §6.1) **and** the **"Stack Rank Formula" = the Review Score formula**. So changes to *either* the ladder numbers *or* review scoring must edit `leaderboard.md` and **regenerate the career-ladder PDF**.

5. **The Review Score formula is DUPLICATED in ~6 places — change them together.** Source of truth is `game.js` `runReview` (Step 1). The printed/written copies that must match it:
   `docs/STACK_RANKED_GAME_SPEC.md` §6 Step 1 (+ §13.1 for the variant term) · `docs/STACK_RANKED_RULEBOOK.md` (Step 1 **and** the Quick Reference Sheet) · `leaderboard.md` "Stack Rank Formula" (→ Career Ladder PDF) · `generate_player_mat.py` Quick Reference (→ Player Mat PDF) · `index.html` review-modal subtitle. Current formula: **CC gained this Quarter + Political Capital + Feedback held (variant) − Tasks on hand** (`player.backlog.length` at Review). Any scoring change → update all copies → regenerate the rulebook, player-mat, and career-ladder PDFs.

6. **Only regenerate PDFs whose source actually changed** — regenerating from an unchanged source just rewrites an identical file. (Map: rulebook.md→Rulebook.pdf; cards.json→PrintAndPlay.pdf; player_mat.py→PlayerMat.pdf; leaderboard.md→CareerLadder.pdf; badges.json→Badges.pdf.)

7. **Changed a `hooks.decide` action, an action button, or the Review columns** → the **online guest** must mirror it (§8). The host serializes each `decide` request over the wire and the guest re-renders it with the *same* modal functions; a new `decide` action needs a matching branch in `guestHandleDecide`, and a new Sprint action verb needs a branch in `applyTurnAction` (shared by local clicks and the host's remote-turn driver). Net play adds **no** rules — don't touch spec/rulebook/PDFs for it.

8. **Verify before finishing:** `npm test` (the assertion suite — covers `node --check` via module-load, headless AI game, balance invariants, and the transfer causal check) plus `node --check net.js`. For a deeper balance read on a scoring/card change, also run `npm run sim:balance -- 300` (no crash, sane balance). `index.html`'s inline script isn't browser-tested by default — syntax-check it and confirm every `SR.*`/`SRNet.*` it calls exists. Online play is verifiable headlessly up to the broker (CDP smoke: page loads PeerJS, Open Room mints a code + QR, no exceptions) plus Node unit tests (`serializeState`/`reviveState`, `isValid`, `deriveClientId`, `applyTurnAction`); the actual peer-to-peer **DataConnection can't complete in the sandbox** (UDP/mDNS) → the data path is a **manual two-device** check.

---

## 8. Networked play (online) — PeerJS, `net.js` + `index.html`

**Host-authoritative**, **star topology** (host ↔ each client, no mesh), over **PeerJS/WebRTC**. Layered entirely over the existing engine hooks — **`game.js` is unchanged** (it's the "pure reducer/engine"). Perfect-information game ⇒ redaction is payload-trimming only.

- **Transport:** PeerJS (`window.Peer`, a **CDN global** in `index.html`) uses its **free public broker** (`0.peerjs.com`) for **signalling only**; data flows P2P once the `DataConnection` opens. `net.js` exposes `hostRoom`/`joinRoom` (both `Promise<api>`) and sends **plain envelope objects with PeerJS's DEFAULT serialization**. ⚠️ **Do NOT use `serialization:'none'`** — in PeerJS 1.5.x it never completes the handshake (the host's `connection` event never fires), which is exactly "players can't connect". `joinRoom` guards with a ~22 s timeout + re-issues the connect offer up to 3× (the public broker occasionally drops the first relay); `hostRoom` guards with a broker-open timeout. PeerJS `network`/`server-error`/`socket-error`/`disconnected` are **transient** → `peer.reconnect()`, room stays up. If the public broker is unreliable, set `PEERJS_CONFIG` (in `net.js`) to a dedicated PeerServer.
- **Identity / room codes (`net.js`):** the host's broker id **is** the room code, namespaced `srk-<code>`. `deriveRoomCode(hostName, Date.now())` mints a fresh 6-char code per session (avoids `unavailable-id` while a prior room tears down); optional vanity code. `deriveClientId(room, name)` is deterministic → persisted to `localStorage`, so a refresh reclaims the same seat; duplicate names bump a suffix. `sanitizeId` enforces PeerJS's `[a-z0-9-]`/single-separator rule.
- **Protocol (`net.js`):** versioned envelope `{v,type,t,payload}` + `SRNet.MSG` + `SRNet.isValid` (untrusted peers). client→host: `JOIN_REQUEST·ACTION_INTENT·DECIDE_ANSWER·PONG`; host→client: `JOIN_ACCEPTED·JOIN_REJECTED·LOBBY_UPDATE·START_GAME·STATE_UPDATE·YOUR_TURN·AP_UPDATE·TURN_ENDED·DECIDE·EVENT·EVENT_DONE·REVIEW·REVIEW_DONE·GAME_OVER·LOG·KICK·PING` (`EVENT`/`EVENT_DONE` mirror the Office Chaos modal: host broadcasts `EVENT` with the trimmed card, shows it locally for ~5 s, then broadcasts `EVENT_DONE`; guests display it dismiss-less and hide on `EVENT_DONE` — same shape as `REVIEW`/`REVIEW_DONE`). **Stale guard:** `ACTION_INTENT` carries `{round,phase}`; the host drops intents not matching the live remote turn.
- **Lobby / seats (`index.html`):** **dynamic self-naming** — Open Room (host name, variant/feedback, max players, board-only), players join by code entering **their own name** → live roster; host **+/− AI** to fill, then Start. `hostStart` builds `config.players` from the roster (host? + connected clients + AI), `SR.newGame`, maps `roster[i].clientId → players[i].id` in `Net.host.seatOwner` (`'host'` = local/AI, else `clientId`) + `playerByClient` for reconnect. `isLocalSeat()`/`clientForSeat()` pick local-modal vs `beginRemoteTurn`/`remoteDecide`.
- **Runtime reuse:** the host hooks (`makeNetHostHooks`), `beginRemoteTurn`, `remoteDecide`, `applyTurnAction`, and every render/modal fn are shared with local play. Guest rehydrates `STATE_UPDATE` into `UI.activeState` (existing render/modal fns unchanged); `onAction` → `Net.guestSendTurnAction` (ACTION_INTENT) when `Net.mode==='guest'`; claim/decide resolve the same `beginClaimDecision`/`showDecision`/`showShipsChoice` promises, shipped back as `DECIDE_ANSWER`.
- **Roles / liveness:** host may own **zero** seats (board-only, auto-advances the Review); no-seat peers are **spectators**. 5 s heartbeat `PING`; silent >15 s or a closed conn → **AI auto-acts** (`SR.aiTakeTurn`/`SR.aiDecide`) so play never stalls; a reconnecting client (same derived id) resumes its seat with a forced `STATE_UPDATE`. **Bandwidth:** per-client last-snapshot fingerprint (`sendState` dedup — idle table costs only a PING). (Wire gzip compression was removed with `serialization:'none'`; snapshots are small enough as plain BinaryPack objects.)
- **QR (`SRNet.qr`):** now encodes the tiny **`…/#room=CODE`** join link; scanning opens the guest straight into Join mode with the code prefilled. Kept from the old design; the SDP copy-paste flow is gone.
- **TURN:** `iceServers()` = STUN always + TURN when `TURN_CONFIG` (in `net.js`) is filled (static creds or metered.ca key). **This is a static site — any embedded credential is PUBLIC.** Unconfigured ⇒ STUN-only (won't connect symmetric-NAT/CGNAT pairs, e.g. two phones on cellular).
- **Deps/offline:** online mode needs the PeerJS CDN + public broker (+ optional TURN) → **not offline/serverless**; local pass-and-play stays fully offline. If PeerJS fails to load, `netUnavailableMsg()` says so and local play still works.
- **Maintenance:** a new `hooks.decide` action → add a `guestHandleDecide` branch; a new Sprint verb → add to `applyTurnAction` (shared local + remote). A new host→client message type → add to `MSG`, send it, and handle it in `guestDispatch` (and bump `PROTO` if the shape changes incompatibly).
- **Deploy gotcha:** the Pages workflows (`.github/workflows/deploy-pages.yml`, `pr-preview.yml`) copy a **hardcoded list** (`cp index.html game.js net.js _site/`); a new *local* runtime file must be added to both `cp` lines or it 404s. PeerJS is a CDN URL, not a repo file, so it needs no `cp`.

---

## 9. Git / PR workflow — watch open PRs, clean up after merge

**Branch, don't commit to `main`.** New work goes on a feature branch (`git checkout -b <name>`); open a PR with `gh pr create`. Commit/push only when the user asks (see the commit-message / PR-body footer conventions in the environment prompt).

**Watch open PRs.** When PRs are outstanding, keep an eye on their merge state: `gh pr list --state open` and `gh pr view <n> --json state,mergedAt,mergeStateStatus`. Once one shows merged, run the post-merge cleanup below **for that PR's branch**.

**Post-merge cleanup procedure** (run once a PR is merged):
1. `git checkout main`
2. `git pull --prune origin main` — fast-forwards `main` to the merge commit and prunes stale remote-tracking refs.
3. `git branch -d <merged-branch>` — deletes the local branch (safe `-d`; refuses if not merged).
4. **Remote branch:** GitHub may leave `origin/<merged-branch>` behind. Deleting it (`git push origin --delete <branch>`) is a **destructive remote op the auto-mode classifier blocks unless the user explicitly asked to delete the *remote* branch** — so only do it on explicit instruction; otherwise leave it and mention it.

Never delete a branch that isn't merged, and never force-delete (`-D`) without the user's say-so.
