/* =============================================================================
 * STACK RANKED — "Request a Transfer" catch-up test (card-faithful, seeded)
 * -----------------------------------------------------------------------------
 * Question: does the new Request-a-Transfer action let a player dealt a
 * PUNISHING early boss catch up to a player dealt a GOOD boss?
 *
 * Setup: 6 seats, ALL playing the identical `balanced` archetype, so the only
 * variable is the starting Management Style. Seats 0-2 start under The
 * Micromanager (punishing early). Seats 3-5 are the REFERENCE FIELD — three
 * different, non-punishing bosses a player wouldn't bother switching away from
 * (so the field is stable across both arms), representing "a typical opponent."
 * All forced boss ids are pulled from the draw pile so a transfer always lands
 * the switcher on some OTHER boss.
 *
 * Two arms, SAME seeds (so the only difference is the mechanic):
 *   Arm A — transfers DISABLED (state._noTransfer): the bad cohort is stuck.
 *   Arm B — transfers ON: the bad cohort can escape.
 *
 * A healthy result: in Arm B the bad cohort's win share climbs toward its fair
 * 50% share and well above Arm A; bad-cohort seats that switched win at roughly
 * the good cohort's per-seat rate, and far above bad-cohort seats that didn't.
 *
 * Run:  node stack_ranked_manager_switch_test.js [gamesPerArm=1000] [variant=race-to-ceo]
 * ========================================================================== */
'use strict';
const path = require('path');

// ---- seeded RNG (mulberry32); install globally so game.js's Math.random uses it
let _rngState = 1;
function mulberry32() {
  _rngState |= 0; _rngState = (_rngState + 0x6D2B79F5) | 0;
  let t = Math.imul(_rngState ^ (_rngState >>> 15), 1 | _rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function seed(s) { _rngState = s >>> 0; }
Math.random = mulberry32;

const SR = require(path.join(__dirname, 'game.js'));

const BAD_ID = 'the-micromanager';
// Reference field: three DIFFERENT non-punishing bosses (managerValue >= 0 for a
// balanced player), so these seats never want to transfer and stay identical in
// both arms. Deliberately NOT all-the-best — a realistic spread of decent bosses.
const FIELD_IDS = ['the-actually-supportive-manager', 'the-mushroom-manager', 'the-consultant-turned-manager'];
const FORCED_IDS = [BAD_ID].concat(FIELD_IDS);
const NSEATS = 6;
// Base seed shared by both arms (same seeds => the only difference is the mechanic).
const BASE_SEED = 20260714;
const BAD_SEATS = [0, 1, 2];
const GOOD_SEATS = [3, 4, 5];
const isBad = function (seat) { return BAD_SEATS.indexOf(seat) >= 0; };
const fieldIdForSeat = function (seat) { return FIELD_IDS[GOOD_SEATS.indexOf(seat) % FIELD_IDS.length]; };

// --- play a single game; return a compact per-seat record ------------------
async function playOne(noTransfer, variant) {
  const players = [];
  for (let i = 0; i < NSEATS; i++) players.push({ name: 'P' + i, kind: 'ai', archetype: 'balanced' });
  const state = SR.newGame({ variant: variant, players: players });
  if (noTransfer) state._noTransfer = true;

  // Force starting bosses, then remove all forced ids from the draw pile so a
  // transfer can only land the switcher on some OTHER boss (and never on a
  // reference-field boss).
  state.players.forEach(function (p) { p.managementStyle = SR.DEFS[isBad(p.seat) ? BAD_ID : fieldIdForSeat(p.seat)]; });
  state.managementDrawPile = state.managementDrawPile.filter(function (c) { return FORCED_IDS.indexOf(c.id) < 0; });

  // Count Request-a-Transfer uses per seat by watching the action log.
  const transfersBySeat = {};
  const nameToSeat = {};
  state.players.forEach(function (p) { nameToSeat[p.name] = p.seat; transfersBySeat[p.seat] = 0; });
  const hooks = {
    log: function (e) {
      const m = /^(\S+) requests a transfer/.exec(e.text);
      if (m && nameToSeat[m[1]] != null) transfersBySeat[nameToSeat[m[1]]]++;
    }
  };

  await SR.play(state, hooks);

  const winner = state.winnerId
    ? state.players.find(function (p) { return p.id === state.winnerId; })
    : state.players.find(function (p) { return p.id === state.standings[0].id; });

  return {
    winnerSeat: winner.seat,
    transfersBySeat: transfersBySeat,
    rungBySeat: state.players.reduce(function (m, p) { m[p.seat] = p.rung; return m; }, {})
  };
}

function pct(n, d) { return d ? (100 * n / d).toFixed(1) + '%' : '—'; }

// --- run one arm over G games ----------------------------------------------
async function runArm(noTransfer, G, variant, baseSeed) {
  let badWins = 0, goodWins = 0;
  // per bad-SEAT-game buckets
  let badSwitchSeatGames = 0, badSwitchWins = 0;
  let badStaySeatGames = 0, badStayWins = 0;
  let goodSeatGames = 0, goodWinsSeat = 0;
  let badSeatsThatSwitched = 0, badSeatsTotal = 0;
  let badRungSum = 0, goodRungSum = 0, rungSeatsBad = 0, rungSeatsGood = 0;

  for (let g = 0; g < G; g++) {
    seed(baseSeed + g * 2654435761);
    const r = await playOne(noTransfer, variant);
    if (isBad(r.winnerSeat)) badWins++; else goodWins++;

    BAD_SEATS.forEach(function (seat) {
      badSeatsTotal++;
      const switched = r.transfersBySeat[seat] > 0;
      if (switched) badSeatsThatSwitched++;
      const won = r.winnerSeat === seat;
      if (switched) { badSwitchSeatGames++; if (won) badSwitchWins++; }
      else { badStaySeatGames++; if (won) badStayWins++; }
      badRungSum += r.rungBySeat[seat]; rungSeatsBad++;
    });
    GOOD_SEATS.forEach(function (seat) {
      goodSeatGames++; if (r.winnerSeat === seat) goodWinsSeat++;
      goodRungSum += r.rungBySeat[seat]; rungSeatsGood++;
    });
  }

  return {
    G: G,
    badCohortWinShare: badWins / G,          // fair = 0.50
    goodCohortWinShare: goodWins / G,
    badSeatSwitchRate: badSeatsThatSwitched / badSeatsTotal,
    badSwitchWinRate: badSwitchSeatGames ? badSwitchWins / badSwitchSeatGames : null, // fair = 1/6
    badStayWinRate: badStaySeatGames ? badStayWins / badStaySeatGames : null,
    goodSeatWinRate: goodWinsSeat / goodSeatGames,
    badAvgRung: badRungSum / rungSeatsBad,
    goodAvgRung: goodRungSum / rungSeatsGood
  };
}

async function main() {
  const G = parseInt(process.argv[2] || '1000', 10);
  const variant = process.argv[3] || 'race-to-ceo';
  const BASE = BASE_SEED;

  console.log('STACK RANKED — Request-a-Transfer catch-up test');
  console.log('variant=' + variant + '  games/arm=' + G + '  seeded, reproducible');
  console.log('6 balanced seats · bad cohort (0-2)=The Micromanager · field (3-5)=' + FIELD_IDS.join(', '));
  console.log('fair share: cohort 50.0% · per-seat 16.7%\n');

  const A = await runArm(true, G, variant, BASE);   // transfers OFF
  const B = await runArm(false, G, variant, BASE);  // transfers ON (same seeds)

  const row = function (label, v) { console.log('  ' + label.padEnd(38) + v); };
  console.log('=========== ARM A — transfers DISABLED (bad cohort is stuck) ===========');
  row('bad-cohort win share', pct(A.badCohortWinShare, 1) + '   (fair 50.0%)');
  row('field-cohort win share', pct(A.goodCohortWinShare, 1));
  row('bad-cohort avg final rung', A.badAvgRung.toFixed(2));
  row('field-cohort avg final rung', A.goodAvgRung.toFixed(2));

  console.log('\n=========== ARM B — transfers ON (bad cohort can escape) ===========');
  row('% of bad-cohort seats that switched', pct(B.badSeatSwitchRate, 1));
  row('bad-cohort win share', pct(B.badCohortWinShare, 1) + '   (fair 50.0%)');
  row('field-cohort win share', pct(B.goodCohortWinShare, 1));
  row('bad-cohort per-seat win (switched)', B.badSwitchWinRate == null ? '—' : pct(B.badSwitchWinRate, 1) + '   (fair 16.7%)');
  row('bad-cohort per-seat win (did NOT)', B.badStayWinRate == null ? '—' : pct(B.badStayWinRate, 1));
  row('field-cohort per-seat win', pct(B.goodSeatWinRate, 1) + '   (fair 16.7%)');
  row('bad-cohort avg final rung', B.badAvgRung.toFixed(2));
  row('field-cohort avg final rung', B.goodAvgRung.toFixed(2));

  console.log('\n=========== CATCH-UP VERDICT ===========');
  // The causal proof is the A→B lift on the SAME cohort: being able to switch
  // must materially raise both the bad cohort's win share and its final rung.
  const v = verdict(A, B);
  const lift = v.lift, rungLift = v.rungLift, causal = v.causal, parity = v.parity;
  row('bad-cohort win-share lift (B − A)', (lift >= 0 ? '+' : '') + (100 * lift).toFixed(1) + 'pp   (' +
    pct(A.badCohortWinShare, 1) + ' → ' + pct(B.badCohortWinShare, 1) + ')');
  row('bad-cohort rung lift (B − A)', (rungLift >= 0 ? '+' : '') + rungLift.toFixed(2) + '   (' +
    A.badAvgRung.toFixed(2) + ' → ' + B.badAvgRung.toFixed(2) + ')');
  row('switchers vs field (per-seat win)', B.badSwitchWinRate != null ? pct(B.badSwitchWinRate, 1) + ' vs ' + pct(B.goodSeatWinRate, 1) : '—');
  console.log('\n  ' + (causal
    ? '✅ PASS — switching materially lets the bad cohort catch up' +
      (parity ? ' (switchers approach the field\'s per-seat rate).' : ' (they close much of the gap to the field).')
    : '⚠️  REVIEW — catch-up weaker than expected; inspect the numbers above.'));
}

// Compute the causal verdict from two arms — the single source of truth shared by
// the CLI printout and the test-suite assertion.
function verdict(A, B) {
  const lift = B.badCohortWinShare - A.badCohortWinShare;
  const rungLift = B.badAvgRung - A.badAvgRung;
  const relInc = A.badCohortWinShare > 0 ? B.badCohortWinShare / A.badCohortWinShare : Infinity;
  const causal = lift > 0.05 && relInc >= 1.4 && rungLift > 0.3;
  const parity = B.badSwitchWinRate != null && B.goodSeatWinRate > 0 && (B.badSwitchWinRate / B.goodSeatWinRate) >= 0.6;
  return { lift: lift, rungLift: rungLift, relInc: relInc, causal: causal, parity: parity };
}

if (require.main === module) {
  main().catch(function (e) { console.error(e); process.exit(1); });
}

module.exports = {
  SR: SR, seed: seed, runArm: runArm, verdict: verdict, BASE_SEED: BASE_SEED,
  BAD_ID: BAD_ID, FIELD_IDS: FIELD_IDS
};
