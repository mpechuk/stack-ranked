/* =============================================================================
 * STACK RANKED — game engine
 * -----------------------------------------------------------------------------
 * A faithful, DOM-free implementation of the rules in
 * docs/STACK_RANKED_GAME_SPEC.md. This module has NO dependency on the browser
 * so it can be exercised headlessly in Node for correctness/pacing testing.
 *
 * The UI (index.html) drives it through a small set of async "hooks":
 *   hooks.log(entry)          - narrate a game event
 *   hooks.onChange()          - state changed; re-render
 *   hooks.wait(ms)            - pause for animation (no-op in Node)
 *   hooks.humanTurn(player)   - hand control to a human for their Sprint
 *   hooks.decide(request)     - ask a human an in-flight question (returns answer)
 *   hooks.onReview(summary)   - a Quarterly Review resolved; show it
 *   hooks.onGameOver(state)   - the game ended
 *
 * All AI decisions are made inside this module (SR.aiTakeTurn / SR.aiDecide)
 * so the same brains run in Node tests and in the browser.
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------------
   * 1. Raw card data (verbatim from cards.json / spec Section 8)
   * ------------------------------------------------------------------------ */
  const CARDS = {
    "skills": {
      "tier1": [
        {"name": "Copy-Paste from Stack Overflow", "cost": 1, "type": "Permanent", "effect": "+1 Productivity/round.", "flavor": "It worked on someone else's machine in 2019. Good enough."},
        {"name": "Ctrl+F Power User", "cost": 1, "type": "Permanent", "effect": "+1 Productivity/round.", "flavor": "Never reads past the first match."},
        {"name": "Free Snack Hoarder", "cost": 1, "type": "Permanent", "effect": "+1 Political Capital/round.", "flavor": "Keeps granola bars in every drawer for emergency morale trades."},
        {"name": "Office Plant Whisperer", "cost": 1, "type": "Permanent", "effect": "+1 Political Capital/round.", "flavor": "The only living thing in the office that's thriving."},
        {"name": "Reply-All Enthusiast", "cost": 2, "type": "One-Shot", "effect": "Immediately: every other player gains 1 Burnout; you gain 2 Political Capital.", "flavor": "Accidentally cc'd the whole company on a lunch order question. Iconic."},
        {"name": "Emotional Support Rubber Duck", "cost": 2, "type": "Permanent", "effect": "Once per Quarter, take Overtime without gaining Burnout.", "flavor": "It just listens. That's more than your manager does."},
        {"name": "“Let's Take This Offline”", "cost": 2, "type": "Permanent", "effect": "+1 Political Capital/round. Once per Quarter, resolve a Mandatory Training without losing next round's Action Point (you still gain the Badge).", "flavor": "Bought yourself three weeks. The meeting still happens eventually."},
        {"name": "Standing Desk Enthusiast", "cost": 2, "type": "Permanent", "effect": "+1 Productivity/round. Ignore Burnout gained from Office Chaos cards.", "flavor": "Won't stop talking about it, but their back does feel great."},
        {"name": "LinkedIn Thought Leader", "cost": 2, "type": "Permanent", "effect": "+2 Political Capital/round; −1 Productivity/round.", "flavor": "Posted “Hot take: communication is important.” 40,000 impressions."},
        {"name": "Regex Whisperer", "cost": 3, "type": "Permanent", "effect": "+3 Productivity/round; +1 Burnout/round.", "flavor": "Nobody else can read their code. That's job security, right?"},
        {"name": "Actually Reads the Documentation", "cost": 3, "type": "Permanent", "effect": "+1 Productivity/round. Your Projects cost 1 less Productivity (minimum 1).", "flavor": "A hero nobody asked for."},
        {"name": "Master of Small Talk", "cost": 3, "type": "Permanent", "effect": "+2 Political Capital/round.", "flavor": "Knows everyone's dog's name. Cannot recall a single deadline."}
      ],
      "tier2": [
        {"name": "Scrum Master", "cost": 4, "type": "Permanent", "effect": "+2 Political Capital/round; −1 Productivity/round.", "flavor": "Facilitates a 45-minute meeting to schedule a 15-minute meeting."},
        {"name": "Full-Stack, Full-Burnout", "cost": 4, "type": "Permanent", "effect": "+3 Productivity/round; +1 Burnout/round.", "flavor": "Owns the frontend, backend, database, and the on-call phone."},
        {"name": "AI Prompt Engineer", "cost": 4, "type": "Permanent", "effect": "+3 Productivity/round. Each time an Office Chaos card is drawn, flip a coin; on heads, discard 2 Productivity from your bank (a confident hallucination).", "flavor": "Confidently hallucinated the entire Q3 roadmap."},
        {"name": "Toxic Positivity Certification", "cost": 4, "type": "Permanent", "effect": "+2 Political Capital/round. You may not take Self-Care actions.", "flavor": "Everything is a learning opportunity, including this."},
        {"name": "The Brilliant Jerk", "cost": 5, "type": "Permanent", "effect": "+4 Productivity/round; −1 Political Capital/round.", "flavor": "Ships incredible code. Has made three people cry this quarter."},
        {"name": "Master Delegator", "cost": 5, "type": "Permanent", "effect": "+2 Productivity/round; +2 Political Capital/round.", "flavor": "Has not personally touched a keyboard since 2021."},
        {"name": "Buzzword Compiler", "cost": 4, "type": "Permanent", "effect": "+2 Political Capital/round; −1 Productivity/round.", "flavor": "Synergizes core competencies to leverage actionable takeaways."},
        {"name": "Whiteboard Diagram Enthusiast", "cost": 4, "type": "Permanent", "effect": "+2 Productivity/round. If you have 4+ Skill cards in play, your Projects cost 1 less Productivity.", "flavor": "The diagram has 14 boxes. Nobody knows what 6 of them mean."},
        {"name": "On-Call Pager Veteran", "cost": 5, "type": "Permanent", "effect": "+2 Productivity/round. Ignore the first Burnout you'd gain each Quarter.", "flavor": "Has slept through three fire drills and one actual fire."},
        {"name": "Imposter Syndrome (Actually Very Competent)", "cost": 4, "type": "Permanent", "effect": "+2 Productivity/round; +1 Political Capital/round.", "flavor": "Is, statistically, doing better than they think."}
      ],
      "tier3": [
        {"name": "The Bus Factor of One", "cost": 6, "type": "Permanent", "effect": "+3 Productivity/round. If you suffer a Burnout Crisis, lose double the usual Political Capital penalty.", "flavor": "If they quit, nothing ships again. Ever."},
        {"name": "Golden Handcuffs (Fully Vested)", "cost": 7, "type": "Permanent", "effect": "Ignore all PIP and demotion effects for the rest of the game.", "flavor": "The stock options mature in 18 months. So does nothing else."},
        {"name": "Rolodex of Every VP", "cost": 7, "type": "Permanent", "effect": "+4 Political Capital/round.", "flavor": "Knows a guy. Always knows a guy."},
        {"name": "Ships It Friday at 5 PM", "cost": 6, "type": "One-Shot", "effect": "Immediately complete one Project on the Kanban Board at half its listed Productivity cost (round up).", "flavor": "The demo gods are watching. Ship it and pray."},
        {"name": "The Exit Interview Isn't Scary Anymore", "cost": 6, "type": "One-Shot", "effect": "Immediately remove all your Burnout and gain 1 Compliance Badge.", "flavor": "Says everything they wish they'd said in every performance review — on the way out the door."},
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
        {"name": "Clean Up the Shared Drive", "cost": 2, "reward": "3 Career Capital.", "flavor": "Found 40 folders named ‘final_FINAL_v2.’"},
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
      {"name": "Reply-All Apocalypse", "effect": "Every player gains 1 Burnout.", "flavor": "247 replies. 246 said “please remove me from this thread.”"},
      {"name": "All-Hands Meeting (Could Have Been an Email)", "effect": "Every player loses 1 Productivity from this round's income.", "flavor": "It was, in fact, an email."},
      {"name": "Layoffs Loom (Just a Rumor... Probably)", "effect": "Every player gains 1 Burnout. The First Player gains 1 Political Capital out of sheer relief.", "flavor": "HR scheduled a “quick chat.” Nobody is calm."},
      {"name": "Quiet Quitting Goes Mainstream", "effect": "Any player may decline their Overtime option this round to remove 1 Burnout instead.", "flavor": "Doing exactly what's in the job description. Revolutionary."},
      {"name": "Free Bagel Friday", "effect": "Every player gains 1 Political Capital.", "flavor": "Cinnamon raisin again. Someone doesn't respect the group chat's preferences."},
      {"name": "Fire Drill", "effect": "The player who used Overtime most recently gains 1 Burnout.", "flavor": "Now standing in a parking lot with 200 coworkers you've never seen before."},
      {"name": "Surprise Reorg", "effect": "Randomly choose two players; swap one Skill card between them.", "flavor": "Nobody's job changed. Everybody's manager did."},
      {"name": "Engagement Survey (Anonymous, Allegedly)", "effect": "Every player gains 1 Political Capital.", "flavor": "Question 14: ‘I feel my work is valued.’ Strongly Disagree."},
      {"name": "The Office Dog Visits", "effect": "Each player may remove 1 Burnout.", "flavor": "Best coworker on the payroll. Unfortunately unpaid."},
      {"name": "New CEO Announced", "effect": "Each player with 5 or more Skill cards in play discards 1 of their choice.", "flavor": "New broom, new org chart, same problems."},
      {"name": "WiFi Dies Mid-Demo", "effect": "The First Player loses 1 Productivity.", "flavor": "The client watched a loading spinner for four minutes."},
      {"name": "Snack Wall Restocked", "effect": "Every player gains 1 Productivity.", "flavor": "Someone's hoarding the good granola bars again."},
      {"name": "The Chair Finally Gets Fixed", "effect": "Every player may remove 1 Burnout.", "flavor": "After 11 months and 4 support tickets. A quiet miracle."},
      {"name": "Casual Friday Goes Full Week", "effect": "Every player gains 1 Political Capital.", "flavor": "Nobody knows what ‘business casual’ means anymore. Everyone's relieved."},
      {"name": "Unlimited PTO (Policy, Not Practice)", "effect": "No player may use the Self-Care action this round.", "flavor": "Technically infinite. Practically, someone will ask why you're taking it."},
      {"name": "Company Offsite in Cancun", "effect": "The First Player gains 2 Productivity. Every other player gains 1 Burnout (FOMO).", "flavor": "Mandatory fun. Fully mandatory."},
      {"name": "IT Outage", "effect": "Skip the Income Phase for every player this round.", "flavor": "The ticket says ‘Priority: Urgent.’ The queue says ‘Position: 214.’"},
      {"name": "Late-Night CEO Email", "effect": "Every player gains 1 Burnout.", "flavor": "Sent 11:47 PM. Subject line: ‘Quick thought 💡’"},
      {"name": "Company-Wide Chat Outage", "effect": "No player may take the Network action this round.", "flavor": "Turns out everyone was just Slacking each other from three feet away."},
      {"name": "Corporate Wellness Session", "effect": "Every player may remove 1 Burnout, but loses 1 Productivity this round.", "flavor": "A 20-minute breathing exercise squeezed between two deadlines."},
      {"name": "Viral Hustle Culture Post", "effect": "Every player immediately resolves a Mandatory Training card, out of the normal cycle.", "flavor": "‘Sleep is for people who don't want it badly enough’ — 2.1M likes."},
      {"name": "A Colleague's Job Interview (Elsewhere)", "effect": "Each player chooses: gain 2 Political Capital (you covered for them), or gain 2 Productivity (you quietly took their tasks).", "flavor": "They ‘have a dentist appointment.’ Everyone knows."},
      {"name": "Open-Floor-Plan Renovation", "effect": "Every player gains 1 Burnout.", "flavor": "Now you can hear every phone call within 40 feet. Great for focus."},
      {"name": "Catered Lunch (Actually Good This Time)", "effect": "Every player gains 1 Productivity and 1 Political Capital.", "flavor": "The good taco place. Morale is measurably higher."},
      {"name": "Server Room Overheats", "effect": "Whoever has the most Skill cards in play loses 1 Productivity.", "flavor": "It's always the one player with the biggest tableau."},
      {"name": "The Standing Desk Convert", "effect": "Each player who owns “Standing Desk Enthusiast” gains 1 extra Political Capital.", "flavor": "They will tell you about it regardless."},
      {"name": "The Spreadsheet Leaks Early", "effect": "Every player gains 1 Political Capital.", "flavor": "Someone found next Quarter's ranking spreadsheet. Everyone's recalculating."},
      {"name": "Everything Is On Fire (Metaphorically, Probably)", "effect": "Whoever has the most Burnout gains 1 more Burnout. Every other player gains 1 Political Capital in sympathy.", "flavor": "It's always the same person's fire."},
      {"name": "Therapy Benefit Actually Gets Used", "effect": "Any one player may remove 2 Burnout.", "flavor": "Covered at 60% after the deductible. Still worth it."},
      {"name": "National Cybersecurity Awareness Month (It's Also October)", "effect": "Every player gains 1 Compliance Badge.", "flavor": "The phishing test email had 12 typos. 30% of the company still clicked it."}
    ],
    "trainings": [
      {"name": "Anti-Harassment Training (The Annual Awkward One)", "effect": "Standard.", "flavor": "Same video. Same actor. Somehow one year older each time."},
      {"name": "Cybersecurity Awareness: You Clicked the Phishing Link", "effect": "Standard, plus +1 Burnout.", "flavor": "The email was from ‘IT Depatrment.’ It had a countdown timer."},
      {"name": "Data Privacy Training (Promises Retention By Lunch)", "effect": "Standard.", "flavor": "GDPR, CCPA, and six acronyms nobody in the room can define."},
      {"name": "DEI Refresher Course", "effect": "Standard.", "flavor": "The same slide deck as last year, with a new date in the corner."},
      {"name": "Fire Safety Procedures (Nobody Remembers)", "effect": "Standard.", "flavor": "The evacuation map on the wall is for a building that no longer exists."},
      {"name": "The Team Retreat (Trust Falls Included)", "effect": "Standard, plus +1 Burnout.", "flavor": "Someone did not get caught. It has changed the team dynamic permanently."},
      {"name": "Information Security Awareness Month", "effect": "Standard.", "flavor": "Coincidentally also National Cybersecurity Awareness Month. Nobody planned this. Everyone's annoyed regardless."},
      {"name": "New Manager Training (“Good Luck” Sendoff)", "effect": "Gain 2 Compliance Badges instead of the usual 1.", "flavor": "Four hours on feedback techniques. Zero minutes on the raise you were promised."},
      {"name": "Bias Workshop (Everyone Assumes It's About Someone Else)", "effect": "Standard.", "flavor": "Full attendance. Zero self-recognition."},
      {"name": "Phishing Simulation Test (People Actually Failed)", "effect": "Standard. Additionally, whoever has the least Political Capital also gains 1 Burnout.", "flavor": "23% company-wide click rate. HR is ‘concerned.’"},
      {"name": "Ethics Training (Sponsored By the Thing That Caused It)", "effect": "Standard.", "flavor": "Scheduled the same week as the news story. Nobody mentions the news story."},
      {"name": "Unconscious Bias Training, Redux", "effect": "Standard, plus +1 Political Capital.", "flavor": "The sequel nobody asked for. Somehow longer than the original."}
    ],
    "management": [
      {"name": "The Micromanager", "effect": "Your first Action each round must be Work a Project if you can afford one; otherwise it is wasted.", "flavor": "Wants a status update on the status update."},
      {"name": "The Absentee Boss", "effect": "Gain 1 free Action Point each round. You may not take the Network action — your boss is never around to introduce you to anyone.", "flavor": "Hasn't reviewed a time-off request since the reorg. Or approved one. Or seen one."},
      {"name": "The Credit-Stealing Boss", "effect": "Whenever you complete a Project, lose 1 Career Capital but gain 1 Political Capital (sympathetic coworkers notice).", "flavor": "Presented your work at the all-hands. Used the word ‘we’ a lot. Meant ‘I.’"},
      {"name": "The Chaotic Pivot-Happy Visionary", "effect": "At the start of each Quarter, flip a coin: heads, gain 2 Productivity; tails, discard 1 Skill card.", "flavor": "The strategy changed twice during this sentence."},
      {"name": "The Yes-Man Exec", "effect": "Hiring Skill cards costs 1 less Productivity (minimum 1). Mandatory Training costs you 2 lost Action Points next round instead of 1.", "flavor": "Agreed with the last three people who talked to him. In the same meeting."},
      {"name": "The Actually Supportive Manager", "effect": "Gain 1 Political Capital every Income Phase. No drawback.", "flavor": "Asked how you're doing and waited for the actual answer. Suspicious, but in a good way."},
      {"name": "The Results-at-Any-Cost Boss", "effect": "Overtime grants +1 extra Productivity, but also +1 extra Burnout, on top of its normal effect.", "flavor": "Doesn't care how you hit the number. Cares extremely if you don't."},
      {"name": "The Buzzword Machine", "effect": "Network grants +1 extra Political Capital. Your Projects cost 1 more Productivity — nobody can define the deliverable.", "flavor": "Wants to double-click on synergies before we boil the ocean."},
      {"name": "The Founder Who Refuses to Delegate", "effect": "Gain 1 free Action Point each round. Self-Care costs 2 Action Points instead of 1.", "flavor": "“We're moving fast” has justified everything since 2019."},
      {"name": "The Tenure-Not-Talent Manager", "effect": "Compliance Badges count double toward promotion requirements. Hiring Skill cards costs 1 more Productivity.", "flavor": "Been here 14 years. Still can't use the new expense software."}
    ]
  };

  /* ---------------------------------------------------------------------------
   * 2. Constants
   * ------------------------------------------------------------------------ */
  const RUNG_NAMES = ["Intern", "Software Engineer", "Team Lead", "Manager", "Director", "VP", "CEO"];
  const AP_BY_RUNG = [2, 2, 3, 3, 4, 4, 4];
  const CC_THRESHOLD = { 1: 8, 2: 18, 3: 30, 4: 44, 5: 60, 6: 78 };
  const BADGE_REQ = { 4: 2, 5: 4 };
  const CEO_RUNG = 6;
  const CEO_CC_BAR = 78;
  const BURNOUT_MAX = 10;
  const BURNOUT_CRISIS_RESET = 6;
  const LONG_GAME_ROUNDS = 24;
  const SAFETY_CAP = 60; // hard stop so a pathological game can't loop forever

  /* ---------------------------------------------------------------------------
   * 3. Structured effect metadata (hand-encoded, keyed by slug)
   *    Fields default to 0/false when absent.
   * ------------------------------------------------------------------------ */
  const SKILL_META = {
    // Tier 1
    "copy-paste-from-stack-overflow": { p: 1 },
    "ctrl-f-power-user": { p: 1 },
    "free-snack-hoarder": { pc: 1 },
    "office-plant-whisperer": { pc: 1 },
    "reply-all-enthusiast": { oneShot: "replyAll" },
    "emotional-support-rubber-duck": { overtimeNoBurnoutPerQuarter: true },
    "let-s-take-this-offline": { pc: 1, offlineTrainingFreeApPerQuarter: true },
    "standing-desk-enthusiast": { p: 1, ignoreChaosBurnout: true },
    "linkedin-thought-leader": { pc: 2, p: -1 },
    "regex-whisperer": { p: 3, burnout: 1 },
    "actually-reads-the-documentation": { p: 1, projectDiscount: 1 },
    "master-of-small-talk": { pc: 2 },
    // Tier 2
    "scrum-master": { pc: 2, p: -1 },
    "full-stack-full-burnout": { p: 3, burnout: 1 },
    "ai-prompt-engineer": { p: 3, hallucinateOnChaos: true },
    "toxic-positivity-certification": { pc: 2, noSelfCare: true },
    "the-brilliant-jerk": { p: 4, pc: -1 },
    "master-delegator": { p: 2, pc: 2 },
    "buzzword-compiler": { pc: 2, p: -1 },
    "whiteboard-diagram-enthusiast": { p: 2, projectDiscountIf4Skills: 1 },
    "on-call-pager-veteran": { p: 2, ignoreFirstBurnoutPerQuarter: true },
    "imposter-syndrome-actually-very-competent": { p: 2, pc: 1 },
    // Tier 3
    "the-bus-factor-of-one": { p: 3, doubleCrisisPcPenalty: true },
    "golden-handcuffs-fully-vested": { immuneToDemotion: true },
    "rolodex-of-every-vp": { pc: 4 },
    "ships-it-friday-at-5-pm": { oneShot: "shipsItFriday" },
    "the-exit-interview-isn-t-scary-anymore": { oneShot: "exitInterview" },
    "the-fixer": { fixerPcOnOthersCrisis: 2 },
    "vp-whisperer": { p: 3, pc: 2 },
    "golden-parachute-clause": { oneShot: "goldenParachute" }
  };

  const MGMT_META = {
    "the-micromanager": { forceFirstActionProject: true },
    "the-absentee-boss": { freeAp: 1, noNetwork: true },
    "the-credit-stealing-boss": { onProjectComplete: { cc: -1, pc: 1 } },
    "the-chaotic-pivot-happy-visionary": { quarterCoin: true },
    "the-yes-man-exec": { skillHireDelta: -1, trainingApCost: 2 },
    "the-actually-supportive-manager": { pcPerIncome: 1 },
    "the-results-at-any-cost-boss": { overtimeExtraP: 1, overtimeExtraBurnout: 1 },
    "the-buzzword-machine": { networkExtraPc: 1, projectCostDelta: 1 },
    "the-founder-who-refuses-to-delegate": { freeAp: 1, selfCareApCost: 2 },
    "the-tenure-not-talent-manager": { badgesCountDouble: true, skillHireDelta: 1 }
  };

  // Trainings: default is { badges: 1 } plus a one-round Action Point penalty.
  const TRAINING_META = {
    "cybersecurity-awareness-you-clicked-the-phishing-link": { badges: 1, burnout: 1 },
    "the-team-retreat-trust-falls-included": { badges: 1, burnout: 1 },
    "new-manager-training-good-luck-sendoff": { badges: 2 },
    "phishing-simulation-test-people-actually-failed": { badges: 1, leastPcBurnout: 1 },
    "unconscious-bias-training-redux": { badges: 1, pc: 1 }
  };

  /* ---------------------------------------------------------------------------
   * 4. Helpers
   * ------------------------------------------------------------------------ */
  function slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function coin() { return Math.random() < 0.5; }
  function randInt(n) { return Math.floor(Math.random() * n); }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function parseReward(str) {
    const r = { cc: 0, burnout: 0, pc: 0, badges: 0 };
    let m;
    if ((m = str.match(/(\d+)\s+Career Capital/i))) r.cc = +m[1];
    if ((m = str.match(/\+?(\d+)\s+Burnout/i))) r.burnout = +m[1];
    if ((m = str.match(/\+?(\d+)\s+Political Capital/i))) r.pc = +m[1];
    if ((m = str.match(/(\d+)\s+Compliance Badge/i))) r.badges = +m[1];
    return r;
  }

  /* ---------------------------------------------------------------------------
   * 5. Card definition registry (id -> immutable def)
   * ------------------------------------------------------------------------ */
  const DEFS = {};
  function register(def) { DEFS[def.id] = def; return def; }

  (function buildDefs() {
    ["tier1", "tier2", "tier3"].forEach(function (tier) {
      CARDS.skills[tier].forEach(function (c) {
        register({ id: slug(c.name), name: c.name, category: "skill", tier: tier,
          cost: c.cost, type: c.type, effect: c.effect, flavor: c.flavor });
      });
    });
    ["early", "mid", "late", "evergreen"].forEach(function (stage) {
      CARDS.projects[stage].forEach(function (c) {
        register({ id: slug(c.name), name: c.name, category: "project", stage: stage,
          cost: c.cost, reward: parseReward(c.reward), rewardText: c.reward,
          flavor: c.flavor, note: c.note || null, evergreen: stage === "evergreen" });
      });
    });
    CARDS.events.forEach(function (c) {
      register({ id: slug(c.name), name: c.name, category: "event", effect: c.effect, flavor: c.flavor });
    });
    CARDS.trainings.forEach(function (c) {
      register({ id: slug(c.name), name: c.name, category: "training", effect: c.effect, flavor: c.flavor });
    });
    CARDS.management.forEach(function (c) {
      register({ id: slug(c.name), name: c.name, category: "management", effect: c.effect, flavor: c.flavor });
    });
  })();

  function defsByCat(category, tierOrStage) {
    return Object.keys(DEFS).map(function (k) { return DEFS[k]; }).filter(function (d) {
      if (d.category !== category) return false;
      if (!tierOrStage) return true;
      return d.tier === tierOrStage || d.stage === tierOrStage;
    });
  }

  /* ---------------------------------------------------------------------------
   * 6. Logging
   * ------------------------------------------------------------------------ */
  function log(state, text, cls) {
    const entry = { round: state.roundNumber, phase: state.phase, text: text, cls: cls || "info" };
    state.log.push(entry);
    if (state.log.length > 600) state.log.shift();
    if (state._hooks && state._hooks.log) state._hooks.log(entry);
    return entry;
  }

  /* ---------------------------------------------------------------------------
   * 7. Player / GameState construction
   * ------------------------------------------------------------------------ */
  let PLAYER_SEQ = 0;
  function makePlayer(cfg, index) {
    return {
      id: "p" + (index) + "_" + (++PLAYER_SEQ),
      displayName: cfg.name,
      name: cfg.name,
      kind: cfg.kind,               // 'human' | 'ai'
      archetype: cfg.archetype || "balanced",
      seat: index,
      rung: 0,
      productivity: 0,
      politicalCapital: 0,
      burnout: 0,
      careerCapital: 0,
      quarterMarker: 0,
      complianceBadges: 0,
      hasPip: false,
      employeeOfQuarterTokens: 0,
      skipActionRounds: 0,
      backlog: [],                   // [{ card, lockedScope }] — grows by 1 every Stand-Up, paid off (any entry, any order) via Work a Project
      managementStyle: null,        // set at setup
      tableau: [],                  // permanent skill defs
      goldenParachuteArmed: false,
      immuneToDemotion: false,
      firstVpReviewNumber: null,
      overtimeUsedThisRound: false,
      trainingApPenaltyNextRound: 0,
      // per-quarter usage flags
      _rubberDuckUsedThisQuarter: false,
      _offlineUsedThisQuarter: false,
      _pagerUsedThisQuarter: false
    };
  }

  function newGame(config) {
    PLAYER_SEQ = 0;
    const players = config.players.map(makePlayer);
    const n = players.length;

    const skillT1 = defsByCat("skill", "tier1");
    const skillT2 = defsByCat("skill", "tier2");
    const skillT3 = defsByCat("skill", "tier3");
    const projEarly = defsByCat("project", "early");
    const projMid = defsByCat("project", "mid");
    const projLate = defsByCat("project", "late");

    // Tier 1 skills x2, early projects x2 in the initial pools.
    const skillDraw = [];
    skillT1.forEach(function (d) { skillDraw.push(d, d); });
    const projDraw = [];
    projEarly.forEach(function (d) { projDraw.push(d, d); });

    const state = {
      variant: config.variant === "long-game" ? "long-game" : "race-to-ceo",
      roundNumber: 1,
      phase: "INCOME",
      players: players,
      firstPlayerIndex: randInt(n),
      activePlayerId: null,
      promotionSlots: n === 6 ? 2 : 1,
      jobBoardSize: n === 6 ? 10 : 5,
      jobBoard: [],
      kanbanBoard: [],
      // draw / discard piles
      skillDrawPile: shuffle(skillDraw),
      skillDiscardPile: [],
      skillReserve2: skillT2.slice(),
      skillReserve3: skillT3.slice(),
      projectDrawPile: shuffle(projDraw),
      projectDiscardPile: [],
      projectReserveMid: projMid.slice(),
      projectReserveLate: projLate.slice(),
      evergreenDrawPile: shuffle(defsByCat("project", "evergreen")),
      evergreenDiscardPile: [],
      eventDrawPile: shuffle(defsByCat("event")),
      eventDiscardPile: [],
      trainingDrawPile: shuffle(defsByCat("training")),
      trainingDiscardPile: [],
      managementDrawPile: shuffle(defsByCat("management")),
      managementDiscardPile: [],
      tier2Merged: false,
      tier3Merged: false,
      restrictions: {},             // active this round
      nextRoundRestrictions: {},    // set by events, applied next round
      lastOvertimeUserId: null,
      currentEvent: null,
      lastReview: null,
      reviewCount: 0,
      log: [],
      status: "setup",              // setup | running | over
      winnerId: null,
      gameOverAfterRound: null,
      standings: null,
      _hooks: null
    };

    // Management styles
    players.forEach(function (p) { p.managementStyle = drawManagement(state); });

    // Job board
    for (let i = 0; i < state.jobBoardSize; i++) state.jobBoard.push(drawSkill(state));

    // Kanban board: 4 early + evergreen fixed in slot 4
    for (let i = 0; i < 4; i++) {
      state.kanbanBoard.push({ card: drawProject(state), scope: 0, unclaimed: 0, justRefilled: false, evergreen: false });
    }
    state.kanbanBoard.push({ card: drawEvergreen(state), scope: 0, unclaimed: 0, justRefilled: false, evergreen: true });

    return state;
  }

  /* ---------------------------------------------------------------------------
   * 8. Draw helpers (reshuffle discard when a pile is empty)
   * ------------------------------------------------------------------------ */
  function drawFrom(drawKey, discardKey, state) {
    if (state[drawKey].length === 0) {
      if (state[discardKey].length === 0) return null;
      state[drawKey] = shuffle(state[discardKey]);
      state[discardKey] = [];
    }
    return state[drawKey].pop() || null;
  }
  function drawSkill(state) { return drawFrom("skillDrawPile", "skillDiscardPile", state); }
  function drawProject(state) { return drawFrom("projectDrawPile", "projectDiscardPile", state); }
  function drawEvergreen(state) { return drawFrom("evergreenDrawPile", "evergreenDiscardPile", state); }
  function drawEvent(state) { return drawFrom("eventDrawPile", "eventDiscardPile", state); }
  function drawTraining(state) { return drawFrom("trainingDrawPile", "trainingDiscardPile", state); }
  function drawManagement(state) { return drawFrom("managementDrawPile", "managementDiscardPile", state); }

  function redrawManagement(state, player) {
    if (player.managementStyle) state.managementDiscardPile.push(player.managementStyle);
    player.managementStyle = drawManagement(state);
  }

  /* ---------------------------------------------------------------------------
   * 9. Small state queries
   * ------------------------------------------------------------------------ */
  function mm(player) { return MGMT_META[player.managementStyle ? player.managementStyle.id : ""] || {}; }
  function hasSkill(player, id) { return player.tableau.some(function (c) { return c.id === id; }); }
  function skillCount(player) { return player.tableau.length; }
  function leaderRung(state) { return Math.max.apply(null, state.players.map(function (p) { return p.rung; })); }
  function findPlayer(state, id) { return state.players.find(function (p) { return p.id === id; }); }
  function firstPlayer(state) { return state.players[state.firstPlayerIndex]; }
  function turnOrder(state) {
    const out = [];
    const n = state.players.length;
    for (let i = 0; i < n; i++) out.push(state.players[(state.firstPlayerIndex + i) % n]);
    return out;
  }
  function effectiveBadges(player) {
    return player.complianceBadges * (mm(player).badgesCountDouble ? 2 : 1);
  }
  function meetsRequirement(player, targetRung) {
    if (BADGE_REQ[targetRung] && effectiveBadges(player) < BADGE_REQ[targetRung]) return false;
    return player.careerCapital >= CC_THRESHOLD[targetRung];
  }

  /* ---------------------------------------------------------------------------
   * 10. Resource mutation (burnout crisis is an interrupt)
   * ------------------------------------------------------------------------ */
  function removeBurnout(player, n) { player.burnout = Math.max(0, player.burnout - n); }

  function addBurnout(state, player, amount, source) {
    if (amount <= 0) return;
    let amt = amount;
    if (source === "chaos" && hasSkill(player, "standing-desk-enthusiast")) {
      log(state, player.name + " ignores Office Chaos Burnout (Standing Desk Enthusiast).", "muted");
      return;
    }
    if (hasSkill(player, "on-call-pager-veteran") && !player._pagerUsedThisQuarter) {
      player._pagerUsedThisQuarter = true;
      amt -= 1;
      log(state, player.name + " ignores the first Burnout this Quarter (On-Call Pager Veteran).", "muted");
    }
    if (amt <= 0) return;
    player.burnout = Math.min(BURNOUT_MAX, player.burnout + amt);
    if (player.burnout >= BURNOUT_MAX) checkBurnoutCrisis(state, player);
  }

  function checkBurnoutCrisis(state, player) {
    if (player.burnout < BURNOUT_MAX) return;
    player.burnout = BURNOUT_CRISIS_RESET;
    let penalty = 2;
    if (hasSkill(player, "the-bus-factor-of-one")) penalty *= 2;
    player.politicalCapital = Math.max(0, player.politicalCapital - penalty);
    player.skipActionRounds = Math.max(player.skipActionRounds, 1);
    log(state, "🔥 BURNOUT CRISIS: " + player.name + " resets to " + BURNOUT_CRISIS_RESET +
      " Burnout, loses " + penalty + " Political Capital, and skips their next Sprint.", "crisis");
    // The Fixer benefits from other players' crises
    state.players.forEach(function (other) {
      if (other === player) return;
      const om = SKILL_META;
      if (hasSkill(other, "the-fixer")) {
        other.politicalCapital += 2;
        log(state, other.name + " gains 2 Political Capital (The Fixer) from " + player.name + "'s crisis.", "muted");
      }
    });
  }

  /* ---------------------------------------------------------------------------
   * 11. Cost calculators
   * ------------------------------------------------------------------------ */
  function effectiveHireCost(player, card) {
    let c = card.cost + (mm(player).skillHireDelta || 0);
    return Math.max(1, c);
  }
  function effectiveProjectCost(player, slot) {
    if (slot.evergreen) {
      // Evergreen never scope-creeps; discounts/penalties still apply.
      let c = slot.card.cost;
      if (hasSkill(player, "actually-reads-the-documentation")) c -= 1;
      if (hasSkill(player, "whiteboard-diagram-enthusiast") && skillCount(player) >= 4) c -= 1;
      c += (mm(player).projectCostDelta || 0);
      return Math.max(1, c);
    }
    let c = slot.card.cost + slot.scope;
    if (hasSkill(player, "actually-reads-the-documentation")) c -= 1;
    if (hasSkill(player, "whiteboard-diagram-enthusiast") && skillCount(player) >= 4) c -= 1;
    c += (mm(player).projectCostDelta || 0);
    return Math.max(1, c);
  }
  function effectiveBacklogItemCost(player, item) {
    if (!item) return null;
    // lockedScope is frozen at the moment the task was claimed (0 for Evergreen,
    // which never scope-creeps); it does not keep accruing while held.
    let c = item.card.cost + item.lockedScope;
    if (hasSkill(player, "actually-reads-the-documentation")) c -= 1;
    if (hasSkill(player, "whiteboard-diagram-enthusiast") && skillCount(player) >= 4) c -= 1;
    c += (mm(player).projectCostDelta || 0);
    return Math.max(1, c);
  }
  function anyAffordableProject(state, player) {
    return player.backlog.some(function (item) { return player.productivity >= effectiveBacklogItemCost(player, item); });
  }

  /* ---------------------------------------------------------------------------
   * 12. Action functions (synchronous mutations; AP is managed by the driver)
   *     Each returns { ok, reason?, pending? }.
   * ------------------------------------------------------------------------ */
  function applyProjectReward(state, player, card) {
    const r = card.reward;
    player.careerCapital += r.cc;
    if (r.pc) player.politicalCapital += r.pc;
    if (r.badges) player.complianceBadges += r.badges;
    if (r.burnout) addBurnout(state, player, r.burnout, "project");
  }

  function completeProject(state, player, slotIndex, costOverride) {
    const slot = state.kanbanBoard[slotIndex];
    if (!slot || !slot.card) return { ok: false, reason: "No project there." };
    const card = slot.card;
    const cost = costOverride != null ? costOverride : effectiveProjectCost(player, slot);
    if (player.productivity < cost) return { ok: false, reason: "Not enough Productivity." };
    player.productivity -= cost;
    applyProjectReward(state, player, card);
    let extra = "";
    const m = mm(player);
    if (m.onProjectComplete) {
      player.careerCapital = Math.max(0, player.careerCapital + m.onProjectComplete.cc);
      player.politicalCapital += m.onProjectComplete.pc;
      extra = " (Credit-Stealing Boss: " + m.onProjectComplete.cc + " CC, +" + m.onProjectComplete.pc + " PC)";
    }
    log(state, player.name + " completes “" + card.name + "” for " + cost + " P → +" +
      card.reward.cc + " CC" + (card.reward.pc ? ", +" + card.reward.pc + " PC" : "") +
      (card.reward.badges ? ", +" + card.reward.badges + " Badge" : "") +
      (card.reward.burnout ? ", +" + card.reward.burnout + " Burnout" : "") + extra + ".", "action");
    if (slot.evergreen) {
      state.evergreenDiscardPile.push(card);
      state.kanbanBoard[slotIndex] = { card: drawEvergreen(state), scope: 0, unclaimed: 0, justRefilled: false, evergreen: true };
    } else {
      state.projectDiscardPile.push(card);
      state.kanbanBoard[slotIndex] = { card: null, scope: 0, unclaimed: 0, justRefilled: false, evergreen: false };
    }
    return { ok: true };
  }

  // Claim a card from the Kanban Board into a player's backlog, unpaid (no
  // cost yet). Board-slot bookkeeping (Evergreen redraw / empty-until-Postmortem)
  // mirrors completeProject's, since a claim removes the card from the board
  // either way.
  function claimTaskFromBoard(state, player, slotIndex) {
    const slot = state.kanbanBoard[slotIndex];
    if (!slot || !slot.card) return { ok: false, reason: "No project there." };
    const card = slot.card;
    player.backlog.push({ card: card, lockedScope: slot.evergreen ? 0 : slot.scope });
    if (slot.evergreen) {
      state.evergreenDiscardPile.push(card);
      state.kanbanBoard[slotIndex] = { card: drawEvergreen(state), scope: 0, unclaimed: 0, justRefilled: false, evergreen: true };
    } else {
      state.projectDiscardPile.push(card);
      state.kanbanBoard[slotIndex] = { card: null, scope: 0, unclaimed: 0, justRefilled: false, evergreen: false };
    }
    log(state, player.name + " picks up “" + card.name + "” from the Kanban Board.", "muted");
    return { ok: true };
  }

  // Pay off one entry in a player's backlog (claimed earlier, at Stand-Up or
  // a prior round). Only ever called from the Sprint's Work a Project
  // action — Stand-Up claims tasks but never pays for them.
  function completeBacklogItem(state, player, backlogIndex, costOverride) {
    const item = player.backlog[backlogIndex];
    if (!item) return { ok: false, reason: "No task there." };
    const card = item.card;
    const cost = costOverride != null ? costOverride : effectiveBacklogItemCost(player, item);
    if (player.productivity < cost) return { ok: false, reason: "Not enough Productivity." };
    player.productivity -= cost;
    applyProjectReward(state, player, card);
    let extra = "";
    const m = mm(player);
    if (m.onProjectComplete) {
      player.careerCapital = Math.max(0, player.careerCapital + m.onProjectComplete.cc);
      player.politicalCapital += m.onProjectComplete.pc;
      extra = " (Credit-Stealing Boss: " + m.onProjectComplete.cc + " CC, +" + m.onProjectComplete.pc + " PC)";
    }
    log(state, player.name + " completes “" + card.name + "” for " + cost + " P → +" +
      card.reward.cc + " CC" + (card.reward.pc ? ", +" + card.reward.pc + " PC" : "") +
      (card.reward.badges ? ", +" + card.reward.badges + " Badge" : "") +
      (card.reward.burnout ? ", +" + card.reward.burnout + " Burnout" : "") + extra + ".", "action");
    player.backlog.splice(backlogIndex, 1);
    return { ok: true };
  }

  function doWorkProject(state, player, backlogIndex) {
    return completeBacklogItem(state, player, backlogIndex);
  }

  function doHire(state, player, boardIndex) {
    const card = state.jobBoard[boardIndex];
    if (!card) return { ok: false, reason: "No card there." };
    const cost = effectiveHireCost(player, card);
    if (player.productivity < cost) return { ok: false, reason: "Not enough Productivity." };
    const meta = SKILL_META[card.id] || {};

    // Ships It Friday needs an affordable target project or its hire is pointless.
    if (meta.oneShot === "shipsItFriday") {
      const hasTarget = state.kanbanBoard.some(function (slot) {
        return slot.card && player.productivity - cost >= Math.max(1, Math.ceil(slot.card.cost / 2));
      });
      if (!hasTarget) return { ok: false, reason: "No Project you could afford at half cost." };
    }

    player.productivity -= cost;
    state.jobBoard[boardIndex] = null;

    if (card.type === "Permanent") {
      player.tableau.push(card);
      if (meta.immuneToDemotion) player.immuneToDemotion = true;
      log(state, player.name + " hires “" + card.name + "” for " + cost + " P.", "action");
      return { ok: true };
    }

    // One-Shot skills
    if (meta.oneShot === "replyAll") {
      state.players.forEach(function (o) { if (o !== player) addBurnout(state, o, 1, "skill"); });
      player.politicalCapital += 2;
      state.skillDiscardPile.push(card);
      log(state, player.name + " plays “" + card.name + "”: every other player +1 Burnout, " + player.name + " +2 PC.", "action");
      return { ok: true };
    }
    if (meta.oneShot === "exitInterview") {
      player.burnout = 0;
      player.complianceBadges += 1;
      state.skillDiscardPile.push(card);
      log(state, player.name + " plays “" + card.name + "”: Burnout cleared, +1 Compliance Badge.", "action");
      return { ok: true };
    }
    if (meta.oneShot === "goldenParachute") {
      player.goldenParachuteArmed = true;
      log(state, player.name + " arms a Golden Parachute Clause (next demotion averted).", "action");
      return { ok: true, held: true };
    }
    if (meta.oneShot === "shipsItFriday") {
      state.skillDiscardPile.push(card);
      log(state, player.name + " plays “Ships It Friday at 5 PM” — pick a Project to complete at half cost.", "action");
      return { ok: true, pending: "shipsItFriday" };
    }
    return { ok: false, reason: "Unknown one-shot." };
  }

  function applyShipsItFriday(state, player, slotIndex) {
    const slot = state.kanbanBoard[slotIndex];
    if (!slot || !slot.card) return { ok: false, reason: "No project there." };
    const half = Math.max(1, Math.ceil(slot.card.cost / 2));
    return completeProject(state, player, slotIndex, half);
  }

  function canNetwork(state, player) {
    if (state.restrictions.noNetwork) return { ok: false, reason: "Company-Wide Chat Outage: no Network this round." };
    if (mm(player).noNetwork) return { ok: false, reason: "Absentee Boss: you cannot Network." };
    return { ok: true };
  }
  function doNetwork(state, player) {
    const chk = canNetwork(state, player);
    if (!chk.ok) return chk;
    const bonus = mm(player).networkExtraPc || 0;
    player.politicalCapital += 2 + bonus;
    player.careerCapital += 1;
    log(state, player.name + " Networks: +" + (2 + bonus) + " PC, +1 CC.", "action");
    return { ok: true };
  }

  function canSelfCare(state, player) {
    if (state.restrictions.noSelfCare) return { ok: false, reason: "Unlimited PTO (Policy, Not Practice): no Self-Care this round." };
    if (hasSkill(player, "toxic-positivity-certification")) return { ok: false, reason: "Toxic Positivity Certification: you may not Self-Care." };
    return { ok: true };
  }
  function selfCareApCost(player) { return mm(player).selfCareApCost || 1; }
  function doSelfCare(state, player) {
    const chk = canSelfCare(state, player);
    if (!chk.ok) return chk;
    removeBurnout(player, 2);
    log(state, player.name + " takes Self-Care: −2 Burnout.", "action");
    return { ok: true };
  }

  function doOvertime(state, player) {
    if (player.overtimeUsedThisRound) return { ok: false, reason: "Overtime already used this round." };
    player.overtimeUsedThisRound = true;
    state.lastOvertimeUserId = player.id;
    const m = mm(player);
    let burnout = 2;
    if (m.overtimeExtraP) { player.productivity += m.overtimeExtraP; }
    if (m.overtimeExtraBurnout) burnout += m.overtimeExtraBurnout;
    let note = "+1 AP";
    if (m.overtimeExtraP) note += ", +" + m.overtimeExtraP + " P (Results-at-Any-Cost)";
    if (hasSkill(player, "emotional-support-rubber-duck") && !player._rubberDuckUsedThisQuarter) {
      player._rubberDuckUsedThisQuarter = true;
      burnout = 0;
      note += ", Burnout negated (Rubber Duck)";
    }
    log(state, player.name + " works Overtime: " + note + (burnout ? ", +" + burnout + " Burnout" : "") + ".", "action");
    if (burnout > 0) addBurnout(state, player, burnout, "overtime");
    return { ok: true, grantAp: 1 };
  }

  /* ---------------------------------------------------------------------------
   * 13. Turn budget
   * ------------------------------------------------------------------------ */
  function beginTurn(state, player) {
    player.overtimeUsedThisRound = false;
    let ap = AP_BY_RUNG[player.rung] + (mm(player).freeAp || 0) - (player.trainingApPenaltyNextRound || 0);
    player.trainingApPenaltyNextRound = 0;
    if (ap < 0) ap = 0;
    let mustProjectFirst = false;
    if (mm(player).forceFirstActionProject) {
      if (anyAffordableProject(state, player)) {
        mustProjectFirst = true;
      } else if (ap > 0) {
        ap -= 1;
        log(state, player.name + " (Micromanager) can't afford a Project — first Action Point wasted.", "muted");
      }
    }
    return { ap: ap, mustProjectFirst: mustProjectFirst };
  }

  /* ---------------------------------------------------------------------------
   * 14. Round phases
   * ------------------------------------------------------------------------ */
  function startRound(state) {
    state.phase = "INCOME";
    state.restrictions = state.nextRoundRestrictions || {};
    state.nextRoundRestrictions = {};
    state.players.forEach(function (p) { p.overtimeUsedThisRound = false; });
    if (state.roundNumber % 3 === 1) {
      // New Quarter: reset once-per-Quarter usage flags.
      state.players.forEach(function (p) {
        p._rubberDuckUsedThisQuarter = false;
        p._offlineUsedThisQuarter = false;
        p._pagerUsedThisQuarter = false;
      });
    }
  }

  function startQuarterEffects(state) {
    if (state.roundNumber % 3 !== 1) return;
    state.players.forEach(function (p) {
      if (!mm(p).quarterCoin) return;
      if (coin()) {
        p.productivity += 2;
        log(state, p.name + " (Chaotic Pivot-Happy Visionary) flips heads: +2 Productivity.", "muted");
      } else {
        if (p.tableau.length > 0) {
          // Auto-discard the least valuable permanent skill (never Golden Handcuffs).
          const idx = pickWorstSkillIndex(p);
          const removed = p.tableau.splice(idx, 1)[0];
          state.skillDiscardPile.push(removed);
          if (removed.id === "golden-handcuffs-fully-vested") p.immuneToDemotion = false;
          log(state, p.name + " (Chaotic Pivot-Happy Visionary) flips tails: discards “" + removed.name + "”.", "muted");
        } else {
          log(state, p.name + " (Chaotic Pivot-Happy Visionary) flips tails: no Skill to discard.", "muted");
        }
      }
    });
  }

  function pickWorstSkillIndex(player) {
    let best = 0, bestScore = Infinity;
    player.tableau.forEach(function (c, i) {
      if (c.id === "golden-handcuffs-fully-vested") return; // keep protective card
      const meta = SKILL_META[c.id] || {};
      const val = (meta.p || 0) + (meta.pc || 0) - (meta.burnout || 0);
      if (val < bestScore) { bestScore = val; best = i; }
    });
    return best;
  }

  function incomePhase(state) {
    if (state.restrictions.skipIncome) {
      log(state, "IT Outage: the Income Phase is skipped for everyone this round.", "event");
      return;
    }
    const lead = leaderRung(state);
    state.players.forEach(function (p) {
      let dp = 0, dpc = 0, dbr = 0;
      p.tableau.forEach(function (c) {
        const meta = SKILL_META[c.id] || {};
        dp += meta.p || 0; dpc += meta.pc || 0; dbr += meta.burnout || 0;
      });
      const m = mm(p);
      if (m.pcPerIncome) dpc += m.pcPerIncome;
      dp += 1; // "showed up" bonus
      if (lead - p.rung >= 2) { dpc += 1; }
      p.productivity = Math.max(0, p.productivity + dp);
      p.politicalCapital = Math.max(0, p.politicalCapital + dpc);
      if (dbr > 0) addBurnout(state, p, dbr, "round");
    });
    log(state, "Stand-Up Meeting: income collected.", "income");
  }

  // Every player with an empty backlog MUST pick up a card from the Kanban
  // Board (unpaid — claiming is free) — the backlog can never be left at
  // zero. A player who already has at least one backlog entry may instead
  // choose to skip claiming another this round; resolved in First Player
  // order since the board is shared. Paying for backlog entries only
  // happens later, via Work a Project during the Sprint — Stand-Up never
  // completes a task. The backlog has no size cap; it grows by at most 1
  // per player per round, less if they skip.
  async function assignTasks(state, hooks) {
    if (state.restrictions.skipIncome) return; // IT Outage skips all of Stand-Up
    for (const p of turnOrder(state)) {
      state.activePlayerId = p.id;
      if (hooks && hooks.onChange) hooks.onChange();
      const wantsToClaim = p.backlog.length === 0 || await decideClaimOrSkip(state, hooks, p);
      if (wantsToClaim) {
        const slotIndex = await pickTaskToClaim(state, hooks, p);
        if (slotIndex >= 0) claimTaskFromBoard(state, p, slotIndex);
      }
      if (hooks && hooks.onChange) hooks.onChange();
    }
    state.activePlayerId = null;
  }

  // Only asked when the player already has something in the backlog (an
  // empty backlog has no choice — claiming is mandatory). AI always claims,
  // preserving the archetype behavior/balance already measured and
  // documented for the unconditional-claim design (spec Section 9.8) —
  // this is a human-facing capability, not an AI strategy change.
  async function decideClaimOrSkip(state, hooks, player) {
    if (player.kind !== "human" || !hooks || !hooks.decide) return true;
    const answer = await hooks.decide({
      playerId: player.id, action: "claimOrSkip",
      prompt: player.name + " already has " + player.backlog.length +
        " task(s) in the backlog. Pick up another from the Kanban Board?"
    });
    return answer === true || answer === "yes";
  }

  function bestClaimIndex(state) {
    let best = -1, bestVal = -Infinity;
    state.kanbanBoard.forEach(function (slot, i) {
      if (!slot.card) return;
      const val = slot.card.reward.cc - (slot.card.reward.burnout || 0) * 0.6;
      if (val > bestVal) { bestVal = val; best = i; }
    });
    return best;
  }

  async function pickTaskToClaim(state, hooks, player) {
    const heuristic = bestClaimIndex(state);
    if (heuristic < 0) return -1; // nothing available anywhere (all slots empty)
    if (player.kind !== "human" || !hooks || !hooks.decide) return heuristic;
    const answer = await hooks.decide({
      playerId: player.id, action: "claimTask",
      prompt: player.name + " picks up a Project from the Kanban Board for the backlog.",
      options: state.kanbanBoard.map(function (slot, i) {
        return slot.card ? { key: String(i), label: slot.card.name + " (" + effectiveProjectCost(player, slot) + " P)" } : null;
      }).filter(Boolean)
    });
    const idx = typeof answer === "number" ? answer : parseInt(answer, 10);
    return (Number.isInteger(idx) && state.kanbanBoard[idx] && state.kanbanBoard[idx].card) ? idx : heuristic;
  }

  /* --- Lunch ------------------------------------------------------------------ */
  async function lunch(state, hooks) {
    const card = drawEvent(state);
    state.currentEvent = card;
    if (!card) { log(state, "Office Chaos deck is empty.", "event"); return; }
    log(state, "🍽️ Office Chaos — " + card.name + ": " + card.effect, "event");

    // AI Prompt Engineer hallucination triggers whenever an Office Chaos card is drawn.
    state.players.forEach(function (p) {
      if (hasSkill(p, "ai-prompt-engineer") && coin()) {
        const lost = Math.min(2, p.productivity);
        p.productivity = Math.max(0, p.productivity - 2);
        log(state, p.name + " (AI Prompt Engineer) hallucinates: discards " + lost + " Productivity.", "muted");
      }
    });

    await resolveEvent(state, card, hooks);
    state.eventDiscardPile.push(card);
  }

  async function askEach(state, hooks, request) {
    // Resolve a per-player decision: humans via hook, AI via aiDecide.
    const p = findPlayer(state, request.playerId);
    if (p.kind === "human" && hooks && hooks.decide) return await hooks.decide(request);
    return aiDecide(state, p, request);
  }

  async function resolveEvent(state, card, hooks) {
    const players = state.players;
    const fp = firstPlayer(state);
    switch (card.id) {
      case "reply-all-apocalypse":
      case "late-night-ceo-email":
      case "open-floor-plan-renovation":
        players.forEach(function (p) { addBurnout(state, p, 1, "chaos"); });
        break;
      case "all-hands-meeting-could-have-been-an-email":
        players.forEach(function (p) { p.productivity = Math.max(0, p.productivity - 1); });
        log(state, "Everyone loses 1 Productivity.", "muted");
        break;
      case "layoffs-loom-just-a-rumor-probably":
        players.forEach(function (p) { addBurnout(state, p, 1, "chaos"); });
        fp.politicalCapital += 1;
        log(state, fp.name + " (First Player) gains 1 PC out of relief.", "muted");
        break;
      case "quiet-quitting-goes-mainstream":
        for (const p of players) {
          if (p.overtimeUsedThisRound) continue;
          const yes = await askEach(state, hooks, { playerId: p.id, action: "quietQuit",
            prompt: "Quiet Quitting: forgo Overtime this round to remove 1 Burnout?" });
          if (yes) { removeBurnout(p, 1); log(state, p.name + " quiet-quits: −1 Burnout.", "muted"); }
        }
        break;
      case "free-bagel-friday":
      case "engagement-survey-anonymous-allegedly":
      case "casual-friday-goes-full-week":
      case "the-spreadsheet-leaks-early":
        players.forEach(function (p) { p.politicalCapital += 1; });
        log(state, "Everyone gains 1 Political Capital.", "muted");
        break;
      case "fire-drill": {
        const u = state.lastOvertimeUserId ? findPlayer(state, state.lastOvertimeUserId) : null;
        if (u) { addBurnout(state, u, 1, "chaos"); log(state, u.name + " (most recent Overtime) gains 1 Burnout.", "muted"); }
        else log(state, "No one has worked Overtime yet — nothing happens.", "muted");
        break;
      }
      case "surprise-reorg": {
        if (players.length >= 2) {
          const idxs = shuffle(players.map(function (_, i) { return i; })).slice(0, 2);
          const a = players[idxs[0]], b = players[idxs[1]];
          if (a.tableau.length && b.tableau.length) {
            const ai = randInt(a.tableau.length), bi = randInt(b.tableau.length);
            const ac = a.tableau[ai], bc = b.tableau[bi];
            a.tableau[ai] = bc; b.tableau[bi] = ac;
            syncImmunity(a); syncImmunity(b);
            log(state, "Surprise Reorg: " + a.name + " and " + b.name + " swap “" + ac.name + "” ↔ “" + bc.name + "”.", "muted");
          } else {
            log(state, "Surprise Reorg: not enough Skill cards to swap.", "muted");
          }
        }
        break;
      }
      case "the-office-dog-visits":
      case "the-chair-finally-gets-fixed":
        for (const p of players) {
          if (p.burnout <= 0) continue;
          const yes = await askEach(state, hooks, { playerId: p.id, action: "removeBurnout",
            prompt: card.name + ": remove 1 Burnout?" });
          if (yes) { removeBurnout(p, 1); log(state, p.name + " removes 1 Burnout.", "muted"); }
        }
        break;
      case "new-ceo-announced":
        for (const p of players) {
          if (skillCount(p) < 5) continue;
          const id = await askEach(state, hooks, { playerId: p.id, action: "discardSkill",
            prompt: "New CEO Announced: discard one of your Skill cards.",
            candidates: p.tableau.map(function (c) { return { id: c.id, name: c.name }; }) });
          const idx = p.tableau.findIndex(function (c) { return c.id === id; });
          const rem = idx >= 0 ? idx : 0;
          const removed = p.tableau.splice(rem, 1)[0];
          state.skillDiscardPile.push(removed);
          syncImmunity(p);
          log(state, p.name + " discards “" + removed.name + "” (New CEO Announced).", "muted");
        }
        break;
      case "wifi-dies-mid-demo":
        fp.productivity = Math.max(0, fp.productivity - 1);
        log(state, fp.name + " (First Player) loses 1 Productivity.", "muted");
        break;
      case "snack-wall-restocked":
        players.forEach(function (p) { p.productivity += 1; });
        log(state, "Everyone gains 1 Productivity.", "muted");
        break;
      case "unlimited-pto-policy-not-practice":
        state.nextRoundRestrictions.noSelfCare = true;
        log(state, "No Self-Care next round.", "muted");
        break;
      case "company-offsite-in-cancun":
        fp.productivity += 2;
        players.forEach(function (p) { if (p !== fp) addBurnout(state, p, 1, "chaos"); });
        log(state, fp.name + " (First Player) gains 2 Productivity; everyone else +1 Burnout.", "muted");
        break;
      case "it-outage":
        state.nextRoundRestrictions.skipIncome = true;
        log(state, "Income Phase will be skipped next round.", "muted");
        break;
      case "company-wide-chat-outage":
        state.nextRoundRestrictions.noNetwork = true;
        log(state, "No Network next round.", "muted");
        break;
      case "corporate-wellness-session":
        for (const p of players) {
          const yes = await askEach(state, hooks, { playerId: p.id, action: "wellness",
            prompt: "Corporate Wellness Session: remove 1 Burnout at the cost of 1 Productivity?" });
          if (yes) {
            removeBurnout(p, 1);
            p.productivity = Math.max(0, p.productivity - 1);
            log(state, p.name + " attends wellness: −1 Burnout, −1 Productivity.", "muted");
          }
        }
        break;
      case "viral-hustle-culture-post":
        for (const p of players) {
          const t = drawTraining(state);
          if (t) { resolveTraining(state, p, t); state.trainingDiscardPile.push(t); }
        }
        break;
      case "a-colleague-s-job-interview-elsewhere":
        for (const p of players) {
          const choice = await askEach(state, hooks, { playerId: p.id, action: "colleagueInterview",
            prompt: "A Colleague's Job Interview: choose your reward.",
            options: [{ key: "pc", label: "+2 Political Capital" }, { key: "prod", label: "+2 Productivity" }] });
          if (choice === "prod") { p.productivity += 2; log(state, p.name + " takes +2 Productivity.", "muted"); }
          else { p.politicalCapital += 2; log(state, p.name + " takes +2 Political Capital.", "muted"); }
        }
        break;
      case "catered-lunch-actually-good-this-time":
        players.forEach(function (p) { p.productivity += 1; p.politicalCapital += 1; });
        log(state, "Everyone gains 1 Productivity and 1 Political Capital.", "muted");
        break;
      case "server-room-overheats": {
        const max = Math.max.apply(null, players.map(skillCount));
        if (max > 0) {
          players.forEach(function (p) {
            if (skillCount(p) === max) { p.productivity = Math.max(0, p.productivity - 1); }
          });
          log(state, "Most Skill cards (" + max + ") → lose 1 Productivity.", "muted");
        }
        break;
      }
      case "the-standing-desk-convert":
        players.forEach(function (p) {
          if (hasSkill(p, "standing-desk-enthusiast")) { p.politicalCapital += 1; log(state, p.name + " (+1 PC, Standing Desk Convert).", "muted"); }
        });
        break;
      case "everything-is-on-fire-metaphorically-probably": {
        const max = Math.max.apply(null, players.map(function (p) { return p.burnout; }));
        players.forEach(function (p) {
          if (p.burnout === max && max > 0) addBurnout(state, p, 1, "chaos");
          else p.politicalCapital += 1;
        });
        log(state, "Highest Burnout gains 1 more; everyone else +1 PC.", "muted");
        break;
      }
      case "therapy-benefit-actually-gets-used": {
        // House rule: the First Player designates any one player.
        const targetId = await askEach(state, hooks, { playerId: fp.id, action: "therapyTarget",
          prompt: "Therapy Benefit: choose one player to remove 2 Burnout (or decline).",
          candidates: players.map(function (p) { return { id: p.id, name: p.name, burnout: p.burnout }; }) });
        if (targetId) {
          const t = findPlayer(state, targetId);
          removeBurnout(t, 2);
          log(state, fp.name + " sends " + t.name + " to therapy: −2 Burnout.", "muted");
        } else {
          log(state, fp.name + " declines the therapy benefit.", "muted");
        }
        break;
      }
      case "national-cybersecurity-awareness-month-it-s-also-october":
        players.forEach(function (p) { p.complianceBadges += 1; });
        log(state, "Everyone gains 1 Compliance Badge.", "muted");
        break;
      default:
        log(state, "(No mechanical effect implemented for this card.)", "muted");
        break;
    }
  }

  function syncImmunity(player) {
    player.immuneToDemotion = hasSkill(player, "golden-handcuffs-fully-vested");
  }

  /* --- Training ------------------------------------------------------------- */
  function resolveTraining(state, player, card) {
    const meta = TRAINING_META[card.id] || { badges: 1 };
    const badges = meta.badges || 1;
    player.complianceBadges += badges;
    let parts = ["+" + badges + " Compliance Badge" + (badges > 1 ? "s" : "")];
    if (meta.pc) { player.politicalCapital += meta.pc; parts.push("+" + meta.pc + " PC"); }
    if (meta.burnout) { addBurnout(state, player, meta.burnout, "training"); parts.push("+" + meta.burnout + " Burnout"); }
    // Action-Point penalty next round (Yes-Man doubles it; Let's Take This Offline can waive it).
    let apCost = mm(player).trainingApCost || 1;
    if (hasSkill(player, "let-s-take-this-offline") && !player._offlineUsedThisQuarter && apCost > 0) {
      player._offlineUsedThisQuarter = true;
      apCost = 0;
      parts.push("no AP lost (Let's Take This Offline)");
    }
    player.trainingApPenaltyNextRound += apCost;
    if (apCost > 0) parts.push("−" + apCost + " AP next round");
    log(state, "📚 " + player.name + " resolves Mandatory Training “" + card.name + "”: " + parts.join(", ") + ".", "muted");
    // Global side-effect: least Political Capital gains 1 Burnout.
    if (meta.leastPcBurnout) {
      const min = Math.min.apply(null, state.players.map(function (p) { return p.politicalCapital; }));
      state.players.forEach(function (p) {
        if (p.politicalCapital === min) addBurnout(state, p, meta.leastPcBurnout, "training");
      });
      log(state, "Phishing fallout: lowest Political Capital gains 1 Burnout.", "muted");
    }
  }

  /* --- Postmortem + tier gating ----------------------------------------------- */
  function maybeMergeTiers(state) {
    // Postmortem of round N fills the boards used in round N+1. Tier 2 / Mid must be
    // available starting round 7 (Q3), Tier 3 / Late starting round 13 (Q5).
    if (!state.tier2Merged && state.roundNumber >= 6) {
      state.skillDrawPile = shuffle(state.skillDrawPile.concat(state.skillReserve2));
      state.projectDrawPile = shuffle(state.projectDrawPile.concat(state.projectReserveMid));
      state.skillReserve2 = []; state.projectReserveMid = [];
      state.tier2Merged = true;
      log(state, "🔓 Tier 2 Skills and Mid Projects are now in circulation (Q3).", "info");
    }
    if (!state.tier3Merged && state.roundNumber >= 12) {
      state.skillDrawPile = shuffle(state.skillDrawPile.concat(state.skillReserve3));
      state.projectDrawPile = shuffle(state.projectDrawPile.concat(state.projectReserveLate));
      state.skillReserve3 = []; state.projectReserveLate = [];
      state.tier3Merged = true;
      log(state, "🔓 Tier 3 Skills and Late Projects are now in circulation (Q5).", "info");
    }
  }

  async function postmortem(state, hooks) {
    state.phase = "POSTMORTEM";
    maybeMergeTiers(state);

    // 1. Refill boards
    for (let i = 0; i < state.jobBoardSize; i++) {
      if (!state.jobBoard[i]) state.jobBoard[i] = drawSkill(state);
    }
    state.kanbanBoard.forEach(function (slot) {
      if (slot.evergreen) return;
      if (!slot.card) {
        slot.card = drawProject(state);
        slot.scope = 0; slot.unclaimed = 0; slot.justRefilled = true;
      } else {
        slot.justRefilled = false;
      }
    });

    // 2. Scope Creep: slots left unclaimed accrue; +1 cost every 2 rounds unclaimed.
    state.kanbanBoard.forEach(function (slot) {
      if (slot.evergreen || !slot.card) return;
      if (slot.justRefilled) { slot.justRefilled = false; return; }
      slot.unclaimed += 1;
      if (slot.unclaimed % 2 === 0) {
        slot.scope += 1;
        log(state, "Scope Creep: “" + slot.card.name + "” now costs " + (slot.card.cost + slot.scope) + " P.", "muted");
      }
    });

    // 3. Advance First Player
    state.firstPlayerIndex = (state.firstPlayerIndex + 1) % state.players.length;

    // 4. Quarterly Review
    let summary = null;
    if (state.roundNumber % 3 === 0) {
      summary = runReview(state);
      // 5. Mandatory Training on even-numbered reviews
      if (state.reviewCount % 2 === 0) {
        log(state, "Mandatory Training round (every player draws one).", "info");
        state.players.forEach(function (p) {
          const t = drawTraining(state);
          if (t) { resolveTraining(state, p, t); state.trainingDiscardPile.push(t); }
        });
      }
    }
    return summary;
  }

  /* ---------------------------------------------------------------------------
   * 15. Quarterly Performance Review (spec Section 6, exact ordering)
   * ------------------------------------------------------------------------ */
  function runReview(state) {
    state.phase = "REVIEW";
    state.reviewCount += 1;
    const players = state.players;

    // Step 1 — Review Score (uses quarterMarker from the PREVIOUS review)
    const score = {};
    players.forEach(function (p) {
      const ccGained = p.careerCapital - p.quarterMarker;
      score[p.id] = ccGained + p.politicalCapital - Math.floor(p.burnout / 4);
    });

    const summary = {
      reviewNumber: state.reviewCount, round: state.roundNumber,
      rows: players.map(function (p) {
        return { id: p.id, name: p.name, score: score[p.id], ccGained: p.careerCapital - p.quarterMarker,
          pc: p.politicalCapital, burnout: p.burnout, rungBefore: p.rung, rungAfter: p.rung };
      }),
      newCeoId: null, promotedIds: [], demotedIds: [], pipIds: [], eoqIds: []
    };
    const rowById = {};
    summary.rows.forEach(function (r) { rowById[r.id] = r; });

    // Step 2 — CEO Board Vote (independent of Review Score; resolve first)
    let newCeo = null;
    const ceoCandidates = players.filter(function (p) { return p.rung === 5 && p.careerCapital >= CEO_CC_BAR; });
    if (ceoCandidates.length === 1) newCeo = ceoCandidates[0];
    else if (ceoCandidates.length > 1) {
      newCeo = ceoCandidates.slice().sort(function (a, b) {
        if (b.politicalCapital !== a.politicalCapital) return b.politicalCapital - a.politicalCapital;
        return a.seat - b.seat;
      })[0];
    }
    if (newCeo) {
      newCeo.rung = CEO_RUNG;
      rowById[newCeo.id].rungAfter = CEO_RUNG;
      summary.newCeoId = newCeo.id;
      log(state, "👑 CEO BOARD VOTE: " + newCeo.name + " is promoted to CEO!", "win");
      if (state.variant === "race-to-ceo") {
        state.winnerId = newCeo.id;
        state.gameOverAfterRound = state.roundNumber;
      }
    }

    // Precompute the 2nd-highest score among ALL players (for Meteoric Rise)
    const allScoresDesc = players.map(function (p) { return score[p.id]; }).sort(function (a, b) { return b - a; });
    const secondHighest = allScoresDesc.length > 1 ? allScoresDesc[1] : 0;

    // Step 3 — Standard Promotions (eligible-first, then rank by score)
    const eligible = players.filter(function (p) {
      return p.rung < 5 && p !== newCeo && meetsRequirement(p, p.rung + 1);
    }).sort(function (a, b) {
      if (score[b.id] !== score[a.id]) return score[b.id] - score[a.id];
      if (b.careerCapital !== a.careerCapital) return b.careerCapital - a.careerCapital;
      return a.seat - b.seat;
    });
    const promoted = eligible.slice(0, state.promotionSlots);
    const promotedSet = new Set(promoted.map(function (p) { return p.id; }));

    promoted.forEach(function (p) {
      p.rung += 1;
      const nextTarget = Math.min(p.rung + 1, 5);
      if (secondHighest > 0 && score[p.id] >= 2 * secondHighest &&
          nextTarget > p.rung && meetsRequirement(p, nextTarget)) {
        log(state, "⭐ Meteoric Rise: " + p.name + " leaps an extra rung!", "promote");
        p.rung = nextTarget;
      }
      if (p.rung === 5 && p.firstVpReviewNumber == null) p.firstVpReviewNumber = state.reviewCount;
      rowById[p.id].rungAfter = p.rung;
      summary.promotedIds.push(p.id);
      log(state, "⬆️ " + p.name + " is promoted to " + RUNG_NAMES[p.rung] + ".", "promote");
    });

    // Eligible but no slot: Employee of the Quarter consolation
    eligible.forEach(function (p) {
      if (promotedSet.has(p.id)) return;
      p.employeeOfQuarterTokens += 1;
      p.politicalCapital += 1;
      summary.eoqIds.push(p.id);
      log(state, "🏅 " + p.name + " earns Employee of the Quarter (+1 token, +1 PC).", "muted");
    });

    // Step 4 — PIP and Demotion
    const pipPool = players.filter(function (p) { return !promotedSet.has(p.id) && p !== newCeo; })
      .sort(function (a, b) {
        if (score[a.id] !== score[b.id]) return score[a.id] - score[b.id];
        return a.seat - b.seat;
      });
    const forReview = pipPool.slice(0, state.promotionSlots);
    forReview.forEach(function (p) {
      if (p.immuneToDemotion) {
        log(state, "🔒 " + p.name + " ignores PIP/demotion (Golden Handcuffs).", "muted");
        return;
      }
      if (p.hasPip) {
        if (p.goldenParachuteArmed) {
          p.goldenParachuteArmed = false;
          p.hasPip = false;
          log(state, "🪂 " + p.name + " uses a Golden Parachute Clause — demotion averted.", "muted");
          return;
        }
        p.hasPip = false;
        if (p.rung === 0) {
          p.skipActionRounds = Math.max(p.skipActionRounds, 3);
          summary.demotedIds.push(p.id);
          log(state, "⬇️ " + p.name + " enters Freelance Purgatory (skips the next Quarter).", "demote");
        } else {
          p.rung -= 1;
          rowById[p.id].rungAfter = p.rung;
          redrawManagement(state, p);
          syncImmunity(p);
          summary.demotedIds.push(p.id);
          log(state, "⬇️ " + p.name + " is DEMOTED to " + RUNG_NAMES[p.rung] + ".", "demote");
        }
      } else {
        p.hasPip = true;
        summary.pipIds.push(p.id);
        log(state, "⚠️ " + p.name + " is put on a PIP (Performance Improvement Plan).", "demote");
      }
    });

    // Step 5 — Reset (move Quarter Marker LAST; redraw styles for promoted/demoted)
    players.forEach(function (p) { p.quarterMarker = p.careerCapital; });
    promoted.forEach(function (p) { redrawManagement(state, p); syncImmunity(p); });
    players.forEach(function (p) { p.productivity = 0; p.politicalCapital = 0; });

    state.lastReview = summary;
    return summary;
  }

  /* ---------------------------------------------------------------------------
   * 16. End-of-game scoring
   * ------------------------------------------------------------------------ */
  function finalScore(p) {
    return (p.rung * 10) + (p.careerCapital / 2) + p.politicalCapital - p.burnout + (5 * p.employeeOfQuarterTokens);
  }
  function computeStandings(state) {
    return state.players.map(function (p) { return { id: p.id, name: p.name, rung: p.rung, score: finalScore(p) }; })
      .sort(function (a, b) { return b.score - a.score; });
  }
  function finalizeLongGame(state) {
    const standings = computeStandings(state);
    state.standings = standings;
    state.winnerId = standings[0].id;
    log(state, "🏁 Final scores tallied. Winner: " + standings[0].name +
      " (" + standings[0].score.toFixed(1) + " points).", "win");
  }

  /* ---------------------------------------------------------------------------
   * 17. AI
   * ------------------------------------------------------------------------ */
  const ARCH = {
    grinder:    { p: 2.2, pc: 0.4, cc: 3.0, net: 1.2, selfCareAt: 7, overtime: true, label: "Grinder" },
    politician: { p: 0.5, pc: 2.2, cc: 1.7, net: 3.2, selfCareAt: 5, overtime: false, label: "Politician" },
    balanced:   { p: 1.3, pc: 1.1, cc: 2.3, net: 1.8, selfCareAt: 6, overtime: false, label: "Balanced" },
    workaholic: { p: 2.0, pc: 0.3, cc: 2.7, net: 0.8, selfCareAt: 8, overtime: true, label: "Workaholic" },
    cautious:   { p: 1.0, pc: 1.0, cc: 1.9, net: 1.5, selfCareAt: 4, overtime: false, label: "Cautious" }
  };

  function skillHireValue(state, player, card, w) {
    const meta = SKILL_META[card.id] || {};
    if (card.type !== "Permanent") {
      // AI only bothers with one Exit Interview when very burnt out.
      if (meta.oneShot === "exitInterview" && player.burnout >= 6) return 6;
      return -Infinity;
    }
    if (meta.immuneToDemotion || meta.fixerPcOnOthersCrisis) {
      // Situationally handy but hard for a greedy bot to value; skip unless senior.
      return player.rung >= 4 ? 2.5 : -Infinity;
    }
    let v = (meta.p || 0) * w.p + (meta.pc || 0) * w.pc;
    if (v <= 0) return -Infinity;
    v -= (meta.burnout || 0) * 0.8;
    v -= effectiveHireCost(player, card) * 0.15;
    // Encourage building an engine early.
    if (skillCount(player) < 4) v += 0.6;
    return v;
  }

  // There's only ever one Project a player can Work: whatever's in their
  // hand (Sprint no longer picks a Kanban Board slot directly — that choice
  // is made when the task is claimed, at Stand-Up). `index` is kept as a
  // found/not-found flag (0 vs -1) so existing call sites don't need to change.
  // Best AFFORDABLE entry in the player's own backlog to Work right now.
  // `index` is a backlog index (not a board index) — Sprint picks from what
  // was already claimed at Stand-Up, not from the shared Kanban Board.
  function pickBestProject(state, player) {
    let best = -1, bestVal = -Infinity;
    player.backlog.forEach(function (item, i) {
      if (player.productivity < effectiveBacklogItemCost(player, item)) return;
      const val = item.card.reward.cc - (item.card.reward.burnout || 0) * 0.6;
      if (val > bestVal) { bestVal = val; best = i; }
    });
    return { index: best, value: bestVal };
  }

  async function aiTakeTurn(state, player, hooks) {
    const w = ARCH[player.archetype] || ARCH.balanced;
    const turn = beginTurn(state, player);
    let ap = turn.ap;
    let mustProjectFirst = turn.mustProjectFirst;

    // Opening Overtime consideration for aggressive archetypes.
    if (w.overtime && !player.overtimeUsedThisRound && player.burnout <= 5 && anyAffordableProject(state, player)) {
      const r = doOvertime(state, player);
      if (r.ok) { ap += r.grantAp; if (hooks && hooks.onChange) hooks.onChange(); await wait(hooks); }
    }

    let guard = 0;
    while (ap > 0 && guard++ < 40) {
      // Micromanager forced project first
      if (mustProjectFirst) {
        const proj = pickBestProject(state, player);
        if (proj.index >= 0) { doWorkProject(state, player, proj.index); ap -= 1; mustProjectFirst = false; }
        else { mustProjectFirst = false; } // safety
        if (hooks && hooks.onChange) hooks.onChange(); await wait(hooks);
        continue;
      }

      // Self-Care when burnt out
      if (player.burnout >= w.selfCareAt && canSelfCare(state, player).ok) {
        const cost = selfCareApCost(player);
        if (ap >= cost) { doSelfCare(state, player); ap -= cost; if (hooks && hooks.onChange) hooks.onChange(); await wait(hooks); continue; }
      }

      // Score candidate actions
      const proj = pickBestProject(state, player);
      const projVal = proj.index >= 0 ? proj.value * w.cc / 3.0 + 1.2 : -Infinity;

      let bestSkill = -1, bestSkillVal = -Infinity;
      state.jobBoard.forEach(function (card, i) {
        if (!card) return;
        if (player.productivity < effectiveHireCost(player, card)) return;
        const v = skillHireValue(state, player, card, w);
        if (v > bestSkillVal) { bestSkillVal = v; bestSkill = i; }
      });

      const netOk = canNetwork(state, player).ok;
      const netVal = netOk ? w.net : -Infinity;

      const best = Math.max(projVal, bestSkillVal, netVal, 0);
      if (best <= 0) break;

      if (best === projVal && proj.index >= 0) {
        doWorkProject(state, player, proj.index); ap -= 1;
      } else if (best === bestSkillVal && bestSkill >= 0) {
        const r = doHire(state, player, bestSkill); ap -= 1;
        if (r.pending === "shipsItFriday") {
          const p2 = pickBestHalfProject(state, player);
          if (p2 >= 0) applyShipsItFriday(state, player, p2);
        }
      } else if (best === netVal && netOk) {
        doNetwork(state, player); ap -= 1;
      } else {
        break;
      }
      if (hooks && hooks.onChange) hooks.onChange();
      await wait(hooks);
    }

    // Spend any leftover AP on Network (never wasteful: +1 CC, +2 PC).
    let safety = 0;
    while (ap > 0 && canNetwork(state, player).ok && safety++ < 10) {
      doNetwork(state, player); ap -= 1;
      if (hooks && hooks.onChange) hooks.onChange(); await wait(hooks);
    }
    // Otherwise decompress if possible.
    while (ap > 0 && player.burnout > 0 && canSelfCare(state, player).ok && ap >= selfCareApCost(player) && safety++ < 20) {
      const c = selfCareApCost(player); doSelfCare(state, player); ap -= c;
      if (hooks && hooks.onChange) hooks.onChange(); await wait(hooks);
    }
  }

  function pickBestHalfProject(state, player) {
    let best = -1, bestVal = -Infinity;
    state.kanbanBoard.forEach(function (slot, i) {
      if (!slot.card) return;
      const half = Math.max(1, Math.ceil(slot.card.cost / 2));
      if (player.productivity < half) return;
      if (slot.card.reward.cc > bestVal) { bestVal = slot.card.reward.cc; best = i; }
    });
    return best;
  }

  function aiDecide(state, player, request) {
    switch (request.action) {
      case "removeBurnout": return player.burnout > 0;
      case "quietQuit": return player.burnout > 0 && !player.overtimeUsedThisRound;
      case "wellness": return player.burnout >= 2;
      case "colleagueInterview": {
        const w = ARCH[player.archetype] || ARCH.balanced;
        return w.pc >= w.p ? "pc" : "prod";
      }
      case "therapyTarget":
        return player.burnout > 0 ? player.id : null;
      case "discardSkill": {
        const idx = pickWorstSkillIndex(player);
        return player.tableau[idx] ? player.tableau[idx].id : (request.candidates[0] && request.candidates[0].id);
      }
      default:
        return false;
    }
  }

  function wait(hooks) {
    if (hooks && hooks.wait) return hooks.wait();
    return Promise.resolve();
  }

  /* ---------------------------------------------------------------------------
   * 18. Main game loop
   * ------------------------------------------------------------------------ */
  async function play(state, hooks) {
    state._hooks = hooks || {};
    state.status = "running";
    while (true) {
      startRound(state);
      startQuarterEffects(state);
      if (hooks.onChange) hooks.onChange();
      await pause(hooks, "phase");

      incomePhase(state);
      if (hooks.onChange) hooks.onChange();
      await pause(hooks, "income");

      await assignTasks(state, hooks);
      if (hooks.onChange) hooks.onChange();
      await pause(hooks, "income");

      // Action phase
      state.phase = "ACTION";
      const order = turnOrder(state);
      for (const p of order) {
        if (state.status !== "running") break;
        state.activePlayerId = p.id;
        if (p.skipActionRounds > 0) {
          p.skipActionRounds -= 1;
          log(state, p.name + " skips their Sprint (" + p.skipActionRounds + " left).", "muted");
          if (hooks.onChange) hooks.onChange();
          await pause(hooks, "phase");
          continue;
        }
        if (p.kind === "human" && hooks.humanTurn) {
          await hooks.humanTurn(p);
        } else {
          await aiTakeTurn(state, p, hooks);
        }
        if (hooks.onChange) hooks.onChange();
      }
      state.activePlayerId = null;

      // Lunch
      state.phase = "LUNCH";
      if (hooks.onChange) hooks.onChange();
      await pause(hooks, "phase");
      await lunch(state, hooks);
      if (hooks.onChange) hooks.onChange();
      await pause(hooks, "event");

      // Postmortem (+ review)
      const summary = await postmortem(state, hooks);
      if (hooks.onChange) hooks.onChange();
      if (summary && hooks.onReview) await hooks.onReview(summary);

      // End conditions
      if (state.variant === "race-to-ceo" && state.winnerId) { state.status = "over"; break; }
      if (state.variant === "long-game" && state.roundNumber >= LONG_GAME_ROUNDS) { finalizeLongGame(state); state.status = "over"; break; }
      if (state.roundNumber >= SAFETY_CAP) { finalizeLongGame(state); state.status = "over"; break; }

      state.roundNumber += 1;
    }
    if (!state.standings) state.standings = computeStandings(state);
    state.phase = "GAME_OVER";
    if (hooks.onChange) hooks.onChange();
    if (hooks.onGameOver) await hooks.onGameOver(state);
    return state;
  }

  function pause(hooks, key) {
    if (hooks && hooks.wait) return hooks.wait(key);
    return Promise.resolve();
  }

  /* ---------------------------------------------------------------------------
   * 19. Public API
   * ------------------------------------------------------------------------ */
  const SR = {
    CARDS: CARDS,
    DEFS: DEFS,
    SKILL_META: SKILL_META,
    MGMT_META: MGMT_META,
    TRAINING_META: TRAINING_META,
    ARCH: ARCH,
    constants: {
      RUNG_NAMES: RUNG_NAMES, AP_BY_RUNG: AP_BY_RUNG, CC_THRESHOLD: CC_THRESHOLD,
      BADGE_REQ: BADGE_REQ, CEO_CC_BAR: CEO_CC_BAR, LONG_GAME_ROUNDS: LONG_GAME_ROUNDS
    },
    newGame: newGame,
    play: play,
    aiTakeTurn: aiTakeTurn,
    aiDecide: aiDecide,
    // action functions for the UI
    actions: {
      hire: doHire,
      workProject: doWorkProject,
      network: doNetwork,
      selfCare: doSelfCare,
      overtime: doOvertime,
      applyShipsItFriday: applyShipsItFriday
    },
    helpers: {
      beginTurn: beginTurn,
      effectiveHireCost: effectiveHireCost,
      effectiveProjectCost: effectiveProjectCost,
      effectiveBacklogItemCost: effectiveBacklogItemCost,
      selfCareApCost: selfCareApCost,
      canNetwork: canNetwork,
      canSelfCare: canSelfCare,
      anyAffordableProject: anyAffordableProject,
      hasSkill: hasSkill,
      skillCount: skillCount,
      meetsRequirement: meetsRequirement,
      effectiveBadges: effectiveBadges,
      leaderRung: leaderRung,
      turnOrder: turnOrder,
      firstPlayer: firstPlayer,
      finalScore: finalScore,
      computeStandings: computeStandings,
      mm: mm,
      slug: slug
    },
    // Internal functions exposed for unit testing.
    _internal: {
      runReview: runReview, addBurnout: addBurnout, resolveTraining: resolveTraining,
      claimTaskFromBoard: claimTaskFromBoard, completeBacklogItem: completeBacklogItem,
      assignTasks: assignTasks
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SR;
  if (typeof window !== "undefined") window.SR = SR;
  if (typeof globalThis !== "undefined") globalThis.SR = SR;
})();
