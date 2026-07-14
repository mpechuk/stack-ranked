"""
STACK RANKED — Balance Simulation
==================================
Monte Carlo simulation used to tune the game's economy across three
iterations:
  v1 - baseline design: promotion requires an AND-gate of two independent
       lifetime stats (cumulative Productivity spent on Projects, and
       cumulative Political Capital built via Networking). No fallback if
       the top scorer doesn't qualify.
  v2 - fix: unify both paths into a single persistent "Career Capital" (CC)
       stat fed by BOTH completed Projects and Networking. Add a fallback
       so a wasted promotion slot checks the next-highest scorer instead
       of vanishing.
  v3 - polish: raise Overtime's Burnout cost (curb Workaholic spam), add
       Mentorship/Underdog bonus PC for trailing players, and boost the
       Career Capital earned per Network action (help Politician).

Five bot archetypes with fixed behavioral policies are pitted against each
other (one seat each) across many randomized games per iteration. Random
elements: per-turn strategy die-rolls, project-completion "crunch" burnout,
and small weekly Office Chaos noise.

Run: python3 simulate.py
"""
import random
import statistics
from dataclasses import dataclass, field

random.seed(42)  # reproducible for repeated tuning runs

RUNG_NAMES = ["Intern", "Software Engineer", "Team Lead", "Manager",
              "Director", "VP", "CEO"]
CEO_RUNG = 6
ROUNDS_PER_QUARTER = 3
MAX_ROUNDS = 90
BURNOUT_MAX = 10
BURNOUT_CRISIS_RESET = 6
BASE_P_INCOME = 1.0
BASE_PC_INCOME = 0.4

# Final rulebook Career Capital thresholds (used directly by v2/v3)
CC_THRESH = {1: 8, 2: 18, 3: 30, 4: 44, 5: 60, 6: 78}
# v1 baseline's two independent AND-gated thresholds (deliberately roughly
# equivalent in overall difficulty to CC_THRESH, just split across two
# separate stats that different archetypes may never touch)
PP_THRESH = {1: 6, 2: 14, 3: 24, 4: 36, 5: 50, 6: 66}
PC_THRESH = {1: 6, 2: 12, 3: 20, 4: 30, 5: 42, 6: 56}
BADGE_REQ = {4: 2, 5: 4}  # Director needs 2, VP needs 4


def ap_for_rung(rung):
    if rung <= 1:
        return 2
    if rung <= 3:
        return 3
    return 4


def promo_slots(n_players):
    return 2 if n_players == 6 else 1


class Config:
    def __init__(self, version):
        self.version = version
        self.unified_cc = version in ("v2", "v3")
        self.fallback_promotion = version in ("v2", "v3")
        self.eligibility_first = version == "v3"
        self.score_counts_quarter_cc = version == "v3"
        self.overtime_burnout = 2 if version == "v3" else 1
        self.network_cc_gain = {"v1": 0, "v2": 1, "v3": 3}[version]
        self.underdog_bonus = version == "v3"


class Player:
    def __init__(self, strategy):
        self.strategy = strategy
        self.rung = 0
        self.banked_p = 0.0
        self.banked_pc = 0.0
        self.burnout = 0
        self.engine_p_rate = 0.0
        self.engine_pc_rate = 0.0
        self.p_investments = 0
        self.pc_investments = 0
        self.projects_completed = 0
        self.lifetime_pp = 0.0     # v1 gate: fed only by completed projects
        self.lifetime_netpc = 0.0  # v1 gate: fed only by Network actions
        self.cc = 0.0              # v2/v3 unified gate
        self.quarter_cc = 0.0      # CC earned this quarter (for review score)
        self.badges = 0
        self.pip = False
        self.skip_rounds = 0
        self.overtime_used_this_round = False
        self.first_vp_round = None
        self.crisis_count = 0

    def project_cost(self):
        return min(9, 3 + self.projects_completed)

    def apply_burnout(self, amount, cfg):
        self.burnout += amount
        if self.burnout >= BURNOUT_MAX:
            self.burnout = BURNOUT_CRISIS_RESET
            self.banked_pc = max(0.0, self.banked_pc - 2)
            self.crisis_count += 1
            self.skip_rounds = max(self.skip_rounds, 1)

    def do_action(self, action, cfg, rng):
        if action == "invest_p":
            self.engine_p_rate += 1.2 / (1 + 0.12 * self.p_investments)
            self.p_investments += 1
        elif action == "invest_pc":
            self.engine_pc_rate += 0.8 / (1 + 0.12 * self.pc_investments)
            self.pc_investments += 1
        elif action == "work_project":
            cost = self.project_cost()
            if self.banked_p >= cost:
                self.banked_p -= cost
                reward_cc = round(cost * 1.4)
                self.lifetime_pp += cost
                if cfg.unified_cc:
                    self.cc += reward_cc
                    self.quarter_cc += reward_cc
                self.projects_completed += 1
                if rng.random() < 0.4:
                    self.apply_burnout(1, cfg)
        elif action == "network":
            self.banked_pc += 2
            self.lifetime_netpc += 1
            if cfg.unified_cc:
                self.cc += cfg.network_cc_gain
                self.quarter_cc += cfg.network_cc_gain
        elif action == "self_care":
            self.burnout = max(0, self.burnout - 2)
        # "noop" falls through silently (couldn't afford chosen action)


# ---------------------------------------------------------------------
# Strategy policies: each returns a list of actions to fill the AP budget
# ---------------------------------------------------------------------
def pick_actions(p, ap, rng):
    strat = p.strategy
    actions = []
    use_overtime = False
    if strat == "Grinder":
        use_overtime = p.burnout < 7
    elif strat == "Politician":
        use_overtime = False
    elif strat == "Balanced":
        use_overtime = p.burnout < 6 and rng.random() < 0.5
    elif strat == "Workaholic":
        use_overtime = p.burnout < 6
    elif strat == "Cautious":
        use_overtime = p.burnout < 5 and rng.random() < 0.10

    for _ in range(ap):
        cost = p.project_cost()
        if strat == "Grinder":
            if p.burnout >= 8 and rng.random() < 0.25:
                actions.append("self_care")
            elif p.banked_p >= cost:
                actions.append("work_project")
            else:
                actions.append("invest_p")
        elif strat == "Politician":
            if p.burnout >= 8 and rng.random() < 0.30:
                actions.append("self_care")
            elif rng.random() < 0.20:
                actions.append("invest_pc")
            else:
                actions.append("network")
        elif strat == "Balanced":
            if p.burnout >= 7:
                actions.append("self_care")
            else:
                r = rng.random()
                if r < 0.30 and p.banked_p >= cost:
                    actions.append("work_project")
                elif r < 0.55:
                    actions.append("network")
                elif r < 0.75:
                    actions.append("invest_p")
                else:
                    actions.append("invest_pc")
        elif strat == "Workaholic":
            if p.burnout >= 7 and rng.random() < 0.40:
                actions.append("self_care")
            elif p.banked_p >= cost:
                actions.append("work_project")
            else:
                actions.append("invest_p")
        elif strat == "Cautious":
            if p.burnout >= 4:
                actions.append("self_care")
            else:
                r = rng.random()
                if r < 0.30 and p.banked_p >= cost:
                    actions.append("work_project")
                elif r < 0.55:
                    actions.append("network")
                elif r < 0.75:
                    actions.append("invest_p")
                else:
                    actions.append("invest_pc")
    return actions, use_overtime


def meets_requirement(p, target_rung, cfg):
    if target_rung in BADGE_REQ and p.badges < BADGE_REQ[target_rung]:
        return False
    if cfg.unified_cc:
        return p.cc >= CC_THRESH[target_rung]
    return (p.lifetime_pp >= PP_THRESH[target_rung] and
            p.lifetime_netpc >= PC_THRESH[target_rung])


def run_review(players, review_num, cfg, rng, stats):
    scores = []
    for p in players:
        if cfg.score_counts_quarter_cc:
            score = p.banked_p + 0.5 * p.banked_pc + 1.3 * p.quarter_cc - (p.burnout // 4)
        else:
            score = p.banked_p + p.banked_pc - (p.burnout // 4)
        scores.append(score)

    order_desc = sorted(range(len(players)), key=lambda i: -scores[i])
    order_asc = sorted(range(len(players)), key=lambda i: scores[i])
    slots = promo_slots(len(players))

    # --- CEO Board Vote (independent of general review ranking) ---
    vp_candidates = [p for p in players if p.rung == 5 and
                     meets_requirement(p, 6, cfg)]
    winner = None
    if vp_candidates:
        winner = max(vp_candidates, key=lambda p: p.banked_pc)
        first_to_vp = min((pl.first_vp_round for pl in players
                            if pl.first_vp_round is not None), default=None)
        if winner.first_vp_round != first_to_vp:
            stats["upsets"] += 1
        winner.rung = 6

    # --- Standard promotions (rungs 1-5) ---
    promoted_idx = set()
    used_slots = 0
    if cfg.eligibility_first:
        # v3 fix: determine WHO QUALIFIES first, then use review score only
        # to rank among the qualified pool. Under the old score-first
        # approach, a candidate's raw quarterly score gated whether their
        # CC was even checked — so a strategy that reliably banks the
        # LOWEST score (because it spends its Productivity down on Projects
        # right before the review) could never reach the front of the
        # queue even while sitting on a mountain of Career Capital.
        eligible = [i for i in order_desc if players[i].rung < 5 and
                    players[i] is not winner and
                    meets_requirement(players[i], players[i].rung + 1, cfg)]
        for i in eligible[:slots]:
            p = players[i]
            target = p.rung + 1
            p.rung = target
            if p.rung == 5 and p.first_vp_round is None:
                p.first_vp_round = review_num
            second = scores[order_desc[1]] if len(order_desc) > 1 else 0
            target2 = min(p.rung + 1, 5)
            if (second > 0 and scores[i] >= 2 * second and
                    target2 > p.rung and meets_requirement(p, target2, cfg)):
                p.rung = target2
                if p.rung == 5 and p.first_vp_round is None:
                    p.first_vp_round = review_num
            promoted_idx.add(i)
            used_slots += 1
    else:
        for i in order_desc:
            if used_slots >= slots:
                break
            p = players[i]
            if p.rung >= 5 or p is winner:
                continue
            target = p.rung + 1
            if meets_requirement(p, target, cfg):
                # exactly one rung per Review — never skip a level
                p.rung = target
                if p.rung == 5 and p.first_vp_round is None:
                    p.first_vp_round = review_num
                promoted_idx.add(i)
                used_slots += 1
            elif not cfg.fallback_promotion:
                # v1: slot wasted if top scorer doesn't qualify, no fallback
                used_slots += 1

    # --- PIP / demotion ---
    used_pip = 0
    for i in order_asc:
        if used_pip >= slots or i in promoted_idx:
            continue
        p = players[i]
        if p is winner:
            continue
        if p.pip:
            if p.rung == 0:
                p.skip_rounds = max(p.skip_rounds, ROUNDS_PER_QUARTER)
            else:
                p.rung -= 1
            p.pip = False
        else:
            p.pip = True
        used_pip += 1

    # --- Mandatory training every 2nd review ---
    if review_num % 2 == 0:
        for p in players:
            p.badges += 1

    for p in players:
        p.banked_p = 0.0
        p.banked_pc = 0.0
        p.quarter_cc = 0.0

    return winner is not None


def simulate_game(strategies, cfg, rng):
    players = [Player(s) for s in strategies]
    stats = {"upsets": 0}
    ceo_crowned = False
    round_num = 0
    while round_num < MAX_ROUNDS and not ceo_crowned:
        round_num += 1
        max_rung = max(p.rung for p in players)
        for p in players:
            if p.skip_rounds > 0:
                p.skip_rounds -= 1
                continue
            p.banked_p += BASE_P_INCOME + p.engine_p_rate
            p.banked_pc += BASE_PC_INCOME + p.engine_pc_rate
            if cfg.underdog_bonus and (max_rung - p.rung) >= 2:
                p.banked_pc += 1
            # small office-chaos noise
            if rng.random() < 0.15:
                p.apply_burnout(1, cfg)
            if rng.random() < 0.15:
                p.banked_pc += 1

            ap = ap_for_rung(p.rung)
            actions, use_ot = pick_actions(p, ap, rng)
            if use_ot:
                p.apply_burnout(cfg.overtime_burnout, cfg)
                extra, _ = pick_actions(p, 1, rng)
                actions += extra
            for a in actions:
                p.do_action(a, cfg, rng)

        if round_num % ROUNDS_PER_QUARTER == 0:
            review_num = round_num // ROUNDS_PER_QUARTER
            ceo_crowned = run_review(players, review_num, cfg, rng, stats)

    crises = sum(p.crisis_count for p in players)
    if ceo_crowned:
        winner = next(p for p in players if p.rung == CEO_RUNG)
        ended_via_ceo = True
    else:
        winner = max(players, key=lambda p: (p.rung, p.cc + p.lifetime_pp +
                                              p.lifetime_netpc, -p.burnout))
        ended_via_ceo = False
    final_rungs = {p.strategy: p.rung for p in players}
    return {
        "winner_strategy": winner.strategy,
        "rounds": round_num,
        "ended_via_ceo": ended_via_ceo,
        "crises": crises,
        "upsets": stats["upsets"],
        "final_rungs": final_rungs,
    }


def run_version(version, n_games=20000, strategies=None):
    if strategies is None:
        strategies = ["Grinder", "Politician", "Balanced", "Workaholic", "Cautious"]
    cfg = Config(version)
    rng = random.Random(1000 + hash(version) % 1000)
    wins = {s: 0 for s in strategies}
    rounds_list = []
    ceo_endings = 0
    crises_list = []
    upsets = 0
    rung_sum = {s: 0 for s in strategies}
    reached_vp = {s: 0 for s in strategies}
    for _ in range(n_games):
        result = simulate_game(strategies, cfg, rng)
        wins[result["winner_strategy"]] += 1
        rounds_list.append(result["rounds"])
        ceo_endings += 1 if result["ended_via_ceo"] else 0
        crises_list.append(result["crises"])
        upsets += result["upsets"]
        for s, rung in result["final_rungs"].items():
            rung_sum[s] += rung
            if rung >= 5:
                reached_vp[s] += 1
    win_pct = {s: 100 * wins[s] / n_games for s in strategies}
    avg_final_rung = {s: rung_sum[s] / n_games for s in strategies}
    pct_reached_vp = {s: 100 * reached_vp[s] / n_games for s in strategies}
    return {
        "version": version,
        "n_games": n_games,
        "win_pct": win_pct,
        "avg_rounds": statistics.mean(rounds_list),
        "pct_ceo_ending": 100 * ceo_endings / n_games,
        "avg_crises": statistics.mean(crises_list),
        "pct_upset": 100 * upsets / max(ceo_endings, 1),
        "avg_final_rung": avg_final_rung,
        "pct_reached_vp": pct_reached_vp,
    }


def print_report(r):
    print(f"\n=== {r['version'].upper()}  ({r['n_games']:,} games, 5-player all-distinct-strategy) ===")
    for s, pct in sorted(r["win_pct"].items(), key=lambda kv: -kv[1]):
        bar = "#" * int(pct / 2)
        print(f"  {s:<12} {pct:5.1f}%  {bar}   avg final rung={r['avg_final_rung'][s]:.2f} ({RUNG_NAMES[min(6,round(r['avg_final_rung'][s]))]})  reached VP+: {r['pct_reached_vp'][s]:.1f}%")
    print(f"  Avg game length:      {r['avg_rounds']:.1f} rounds")
    print(f"  Games ending via CEO: {r['pct_ceo_ending']:.1f}%  (rest hit the 90-round cap)")
    print(f"  Avg Burnout crises:   {r['avg_crises']:.2f} per game")
    print(f"  Board Vote upsets:    {r['pct_upset']:.1f}% of CEO-ending games")


if __name__ == "__main__":
    results = []
    for v in ["v1", "v2", "v3"]:
        r = run_version(v, n_games=20000)
        print_report(r)
        results.append(r)

    print("\n=== Player-count sanity check (v3, mixed random strategies) ===")
    pc_stats = {}
    for n in [2, 3, 4, 6]:
        cfg = Config("v3")
        rng = random.Random(555 + n)
        pool = ["Grinder", "Politician", "Balanced", "Workaholic", "Cautious"]
        rounds_list, ceo_endings = [], 0
        n_games = 5000
        for _ in range(n_games):
            strat_pick = [rng.choice(pool) for _ in range(n)]
            result = simulate_game(strat_pick, cfg, rng)
            rounds_list.append(result["rounds"])
            ceo_endings += 1 if result["ended_via_ceo"] else 0
        avg_r = statistics.mean(rounds_list)
        pct = 100 * ceo_endings / n_games
        pc_stats[n] = (avg_r, pct)
        print(f"  {n} players: avg {avg_r:.1f} rounds, {pct:.1f}% end via CEO promotion")

    import json
    with open("/home/claude/stackranked/results.json", "w") as f:
        json.dump({"iterations": results, "player_count_check": pc_stats}, f, indent=2)
    print("\nSaved results.json")

    # ---------------- Chart: win rate by strategy across iterations -------
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    strategies = ["Grinder", "Politician", "Balanced", "Workaholic", "Cautious"]
    colors = {"v1": "#c0392b", "v2": "#e67e22", "v3": "#27ae60"}
    x = np.arange(len(strategies))
    width = 0.26

    fig, ax = plt.subplots(figsize=(8, 5), dpi=150)
    for idx, r in enumerate(results):
        vals = [r["win_pct"][s] for s in strategies]
        ax.bar(x + (idx - 1) * width, vals, width, label=r["version"].upper(),
               color=colors[r["version"]])

    ax.set_ylabel("Win rate (%)")
    ax.set_title("STACK RANKED — Strategy Win Rates Across Balance Iterations\n"
                  "(20,000 games/iteration, 5-player all-distinct-strategy)")
    ax.set_xticks(x)
    ax.set_xticklabels(strategies)
    ax.axhline(20, color="gray", linestyle="--", linewidth=0.8, label="20% (even split)")
    ax.legend()
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    fig.savefig("/home/claude/stackranked/balance_chart.png")
    print("Saved balance_chart.png")
