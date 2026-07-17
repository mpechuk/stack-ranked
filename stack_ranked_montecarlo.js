/* =============================================================================
 * STACK RANKED — Monte-Carlo balance harness (card-faithful)
 * -----------------------------------------------------------------------------
 * Unlike stack_ranked_balance_simulator.py (a coarse *economic* model that
 * abstracts cards), this harness drives the REAL engine in game.js — every
 * card, the exact Review algorithm, Scope Creep, Burnout, Management Styles,
 * and the two variant rules under test:
 *
 *   1. Feedback deck  (±2 political points, dealt then given at each Review)
 *   2. Collaborative Projects (pool Productivity; CC split by contribution,
 *      owner banks PC = max(cc-2,1))
 *
 * It answers two questions the user asked:
 *   A. Is the game still balanced across the five archetypes?
 *   B. Can a player who has fallen behind — through bad luck, not bad play —
 *      still win?  (Measured in MIRROR games where all five seats play the
 *      identical archetype, so any mid-game lead is luck alone.)
 *
 * Math.random is replaced by a seeded PRNG so every run is reproducible.
 *
 * Run:  node stack_ranked_montecarlo.js [gamesPerCell]
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

const ARCHES = ['grinder', 'politician', 'balanced', 'workaholic', 'cautious'];

// --- play a single game; return a compact result record --------------------
async function playOne(archetypes, rules, variant) {
  const players = archetypes.map(function (a, i) {
    return { name: a[0].toUpperCase() + i, kind: 'ai', archetype: a };
  });
  const state = SR.newGame({ variant: variant, players: players, rules: rules });

  // midpoint snapshot: ranks as of Review #2 (round 6)
  let midRankBySeat = null; // seat -> rank (1 = ahead)
  // burnout-load counters (log-hook based; no effect on RNG/determinism)
  let crises = 0, selfcare = 0, overtime = 0;
  const hooks = {
    log: function (e) {
      if (e.cls === 'crisis') crises++;
      else if (e.cls === 'action') {
        if (e.text.indexOf('Self-Care') >= 0) selfcare++;
        else if (e.text.indexOf('Overtime') >= 0) overtime++;
      }
    },
    onReview: function (summary) {
      if (summary.reviewNumber === 2 && !midRankBySeat) {
        const ranked = state.players.slice().sort(function (a, b) {
          if (b.rung !== a.rung) return b.rung - a.rung;
          if (b.careerCapital !== a.careerCapital) return b.careerCapital - a.careerCapital;
          return b.politicalCapital - a.politicalCapital;
        });
        midRankBySeat = {};
        ranked.forEach(function (p, idx) { midRankBySeat[p.seat] = idx + 1; });
      }
    }
  };

  await SR.play(state, hooks);

  const n = state.players.length;
  const endedViaCeo = !!state.winnerId;
  const winner = state.winnerId
    ? state.players.find(function (p) { return p.id === state.winnerId; })
    : state.players.find(function (p) { return p.id === state.standings[0].id; });

  const winnerMidRank = midRankBySeat ? midRankBySeat[winner.seat] : null;
  // Was the mid-game leader the eventual winner? (runaway-leader signal)
  let midLeaderWon = null;
  if (midRankBySeat) {
    const leaderSeat = Object.keys(midRankBySeat).find(function (s) { return midRankBySeat[s] === 1; });
    midLeaderWon = (String(winner.seat) === String(leaderSeat));
  }
  return {
    winnerArch: winner.archetype,
    winnerSeat: winner.seat,
    rounds: state.roundNumber,
    endedViaCeo: endedViaCeo,
    winnerMidRank: winnerMidRank,          // 1..n (n = dead last at halftime)
    midLeaderWon: midLeaderWon,            // bool
    n: n,
    finalRungByArch: state.players.reduce(function (m, p) { (m[p.archetype] = m[p.archetype] || []).push(p.rung); return m; }, {}),
    crises: crises, selfcare: selfcare, overtime: overtime,
    endBurnAvg: state.players.reduce(function (s, p) { return s + p.burnout; }, 0) / n
  };
}

function pct(x, d) { return (100 * x / d).toFixed(1); }

async function runCell(archetypesFactory, rules, variant, nGames, baseSeed) {
  const winsByArch = {}; ARCHES.forEach(function (a) { winsByArch[a] = 0; });
  const winsBySeat = [0, 0, 0, 0, 0, 0];
  let rounds = 0, ceoEndings = 0;
  let midKnown = 0, winnerWasBottomHalf = 0, winnerWasLast = 0, midLeaderWon = 0;
  let crisesSum = 0, selfcareSum = 0, overtimeSum = 0, burnSum = 0;
  const rungSum = {}; const rungCnt = {}; ARCHES.forEach(function (a) { rungSum[a] = 0; rungCnt[a] = 0; });

  for (let g = 0; g < nGames; g++) {
    seed(baseSeed + g * 2654435761);
    const arches = archetypesFactory(g);
    const r = await playOne(arches, rules, variant);
    winsByArch[r.winnerArch] = (winsByArch[r.winnerArch] || 0) + 1;
    winsBySeat[r.winnerSeat] = (winsBySeat[r.winnerSeat] || 0) + 1;
    rounds += r.rounds;
    crisesSum += r.crises; selfcareSum += r.selfcare; overtimeSum += r.overtime; burnSum += r.endBurnAvg;
    if (r.endedViaCeo) ceoEndings++;
    if (r.winnerMidRank != null) {
      midKnown++;
      const half = Math.ceil(r.n / 2);
      if (r.winnerMidRank > half) winnerWasBottomHalf++;
      if (r.winnerMidRank === r.n) winnerWasLast++;
      if (r.midLeaderWon) midLeaderWon++;
    }
    Object.keys(r.finalRungByArch).forEach(function (a) {
      r.finalRungByArch[a].forEach(function (rg) { rungSum[a] += rg; rungCnt[a] += 1; });
    });
  }

  return {
    nGames: nGames,
    winsByArch: winsByArch,
    winsBySeat: winsBySeat,
    avgRounds: rounds / nGames,
    pctCeo: 100 * ceoEndings / nGames,
    midKnown: midKnown,
    pctWinnerBottomHalf: midKnown ? 100 * winnerWasBottomHalf / midKnown : 0,
    pctWinnerLast: midKnown ? 100 * winnerWasLast / midKnown : 0,
    pctMidLeaderWon: midKnown ? 100 * midLeaderWon / midKnown : 0,
    avgRungByArch: ARCHES.reduce(function (m, a) { m[a] = rungCnt[a] ? rungSum[a] / rungCnt[a] : 0; return m; }, {}),
    crisesPerGame: crisesSum / nGames, selfcarePerGame: selfcareSum / nGames,
    overtimePerGame: overtimeSum / nGames, endBurnAvg: burnSum / nGames
  };
}

// balance spread metrics over the five archetype win rates
function balanceStats(winsByArch, nGames) {
  const p = ARCHES.map(function (a) { return (winsByArch[a] || 0) / nGames; });
  const mean = p.reduce(function (s, x) { return s + x; }, 0) / p.length;
  const sd = Math.sqrt(p.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / p.length);
  const max = Math.max.apply(null, p), min = Math.min.apply(null, p);
  return { sdPct: (100 * sd).toFixed(1), spreadPct: (100 * (max - min)).toFixed(1), minPct: (100 * min).toFixed(1), maxPct: (100 * max).toFixed(1) };
}

function printCell(title, res) {
  console.log('\n### ' + title + '  (' + res.nGames + ' games)');
  const bs = balanceStats(res.winsByArch, res.nGames);
  ARCHES.forEach(function (a) {
    const w = res.winsByArch[a] || 0;
    const wp = 100 * w / res.nGames;
    const bar = '#'.repeat(Math.round(wp / 2));
    console.log('  ' + a.padEnd(11) + ' ' + wp.toFixed(1).padStart(5) + '%  ' + bar.padEnd(26) + ' avg rung ' + res.avgRungByArch[a].toFixed(2));
  });
  console.log('  balance: sd=' + bs.sdPct + 'pp  spread(max-min)=' + bs.spreadPct + 'pp  [' + bs.minPct + '%..' + bs.maxPct + '%]');
  console.log('  pacing:  avg ' + res.avgRounds.toFixed(1) + ' rounds, ' + res.pctCeo.toFixed(1) + '% end via CEO');
  console.log('  burnout: avg end ' + res.endBurnAvg.toFixed(1) + ',  ' + res.crisesPerGame.toFixed(1) +
    ' crises/game,  ' + res.selfcarePerGame.toFixed(1) + ' self-care/game,  ' + res.overtimePerGame.toFixed(1) + ' overtime/game');
}

function printMirror(title, res) {
  console.log('\n### ' + title + '  (' + res.nGames + ' games, all-Balanced mirror — leads are pure luck)');
  console.log('  seat win% : ' + res.winsBySeat.slice(0, 5).map(function (w) { return (100 * w / res.nGames).toFixed(1); }).join('  ') + '   (fair = 20.0 each)');
  console.log('  COMEBACK — winner was in the BOTTOM HALF at halftime: ' + res.pctWinnerBottomHalf.toFixed(1) + '%');
  console.log('  COMEBACK — winner was DEAD LAST at halftime:          ' + res.pctWinnerLast.toFixed(1) + '%');
  console.log('  RUNAWAY  — halftime leader went on to win:            ' + res.pctMidLeaderWon.toFixed(1) + '%');
  console.log('  pacing:  avg ' + res.avgRounds.toFixed(1) + ' rounds, ' + res.pctCeo.toFixed(1) + '% end via CEO');
}

// --- rule presets -----------------------------------------------------------
const RULESETS = {
  baseline:     { feedback: false, collaboration: false },
  // "naive literal": both rules exactly as first described, NO guardrails —
  // uncapped feedback swing, negatives dumped on the ladder leader, owner PC
  // uncapped, owner needn't contribute. (The CC-follows-Productivity fix is in;
  // that was a bug, not a balance dial.)
  literalNaive: { feedback: true, collaboration: true, feedbackNetCap: 999, feedbackTarget: 'rung',
                  collabOwnerPcCap: 999, collabOwnerMustContribute: false },
  // tuned recommendation = the engine's DEFAULT_RULES (classic feedback, score
  // targeting, ±4 cap, owner PC capped at 3 and must-contribute).
  recommended:  {},
  // optional "aggressive rubber-band" toggle: recommended + rung targeting.
  rungToggle:   { feedbackTarget: 'rung' },
  // NEW "360° Review" feedback mode: everyone gets one Positive + one
  // Constructive, gives one away (face-down/simultaneous) and discards the
  // other. Same ±4 cap. Compared here against `recommended` (current default).
  giveOne:      { feedbackMode: 'give-one' },
  // give-one + rung targeting (the strongest bounded leader-bash on offer).
  giveOneRung:  { feedbackMode: 'give-one', feedbackTarget: 'rung' }
};

async function main() {
  const N = parseInt(process.argv[2] || '1500', 10);
  const VARIANT = process.argv[3] || 'race-to-ceo';
  const distinct = function () { return ARCHES.slice(); };            // 5 distinct archetypes
  const mirror = function () { return ['balanced','balanced','balanced','balanced','balanced']; };

  console.log('STACK RANKED — Monte-Carlo balance harness');
  console.log('variant=' + VARIANT + '  games/cell=' + N + '  (seeded, reproducible)');

  const order = ['baseline', 'literalNaive', 'recommended', 'rungToggle', 'giveOne', 'giveOneRung'];
  const summary = {};
  for (const key of order) {
    const rules = RULESETS[key];
    const distRes = await runCell(distinct, rules, VARIANT, N, 12345);
    const mirRes = await runCell(mirror, rules, VARIANT, N, 99999);
    printCell('DISTINCT — ' + key, distRes);
    printMirror('MIRROR   — ' + key, mirRes);
    summary[key] = { distinct: distRes, mirror: mirRes };
  }

  // compact comparison table
  console.log('\n\n===================== SUMMARY TABLE =====================');
  console.log('ruleset         balSD  spread   comeback(botHalf/last)  runaway  ceo%  crisis/g');
  order.forEach(function (key) {
    const d = summary[key].distinct, m = summary[key].mirror;
    const bs = balanceStats(d.winsByArch, d.nGames);
    console.log('  ' + key.padEnd(14) +
      ' ' + (bs.sdPct + 'pp').padStart(6) +
      ' ' + (bs.spreadPct + 'pp').padStart(7) +
      '   ' + (m.pctWinnerBottomHalf.toFixed(0) + '%/' + m.pctWinnerLast.toFixed(0) + '%').padStart(9) +
      '           ' + (m.pctMidLeaderWon.toFixed(0) + '%').padStart(5) +
      '   ' + d.pctCeo.toFixed(0) + '%' +
      '   ' + d.crisesPerGame.toFixed(1));
  });
  console.log('  (lower balSD/spread = more even strategies; higher comeback & lower runaway = more forgiving of bad luck)');

  // ---- player-count & variant sanity for the RECOMMENDED ruleset ----
  console.log('\n\n=========== RECOMMENDED ruleset — player-count & variant sanity ===========');
  console.log('(all-mirror; leads are luck) players  variant       comeback(botHalf/last)  runaway  ceo%  avgRounds');
  const nCounts = [2, 3, 4, 5, 6];
  for (const variant of ['race-to-ceo', 'long-game']) {
    for (const nc of nCounts) {
      const fac = function () { const a = []; for (let i = 0; i < nc; i++) a.push('balanced'); return a; };
      const res = await runCell(fac, RULESETS.recommended, variant, Math.max(400, Math.floor(N / 2)), 424242 + nc);
      console.log('  ' + String(nc).padStart(21) + '  ' + variant.padEnd(12) +
        '  ' + (res.pctWinnerBottomHalf.toFixed(0) + '%/' + res.pctWinnerLast.toFixed(0) + '%').padStart(9) +
        '            ' + (res.pctMidLeaderWon.toFixed(0) + '%').padStart(4) +
        '   ' + res.pctCeo.toFixed(0) + '%   ' + res.avgRounds.toFixed(1));
    }
  }
}

// Canonical base seeds used by the CLI cells (re-exported so the test suite runs
// the exact same reproducible cells as a headless `node stack_ranked_montecarlo.js`).
const SEEDS = { distinct: 12345, mirror: 99999, sanity: 424242 };

// Run the CLI table only when invoked directly; when required as a module
// (the test suite), expose the computation surface for assertions instead.
if (require.main === module) {
  main().catch(function (e) { console.error(e); process.exit(1); });
}

module.exports = {
  SR: SR, ARCHES: ARCHES, RULESETS: RULESETS, SEEDS: SEEDS,
  seed: seed, playOne: playOne, runCell: runCell, balanceStats: balanceStats,
  // convenience factories matching the CLI cells
  distinctFactory: function () { return ARCHES.slice(); },
  mirrorFactory: function () { return ['balanced', 'balanced', 'balanced', 'balanced', 'balanced']; }
};
