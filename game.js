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
 *   hooks.onEvent(card)       - an Office Chaos card was drawn; announce it (awaited)
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
      {"name": "Surprise Reorg", "effect": "Everyone returns their Management Style card. Shuffle the Management deck and deal each player a new one.", "flavor": "Nobody's job changed. Everybody's manager did."},
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
      {"name": "The Tenure-Not-Talent Manager", "effect": "Compliance Badges count double toward promotion requirements. Hiring Skill cards costs 1 more Productivity.", "flavor": "Been here 14 years. Still can't use the new expense software."},
      {"name": "The Seagull Manager", "effect": "At the start of each Quarter, flip a coin: heads, every other player gains 1 Burnout — you swooped in and stirred things up; tails, you gain 1 Political Capital — you flew off before anyone noticed.", "flavor": "Flies in, makes a lot of noise, craps on the roadmap, and is gone before the retro."},
      {"name": "The Mushroom Manager", "effect": "+2 Productivity/round (fed on nothing, somehow still growing); −1 Political Capital/round (kept in the dark — nobody tells you anything).", "flavor": "Kept in the dark and fed manure. Thriving, weirdly."},
      {"name": "The Peter Principle", "effect": "Your Action Points are always 2, no matter your rung — promoted well past their competence. Hiring Skill cards costs 1 less Productivity (overcompensates by throwing tools at the problem).", "flavor": "Promoted three times. Still can't find the deploy script."},
      {"name": "The Always-On Boss", "effect": "Overtime grants +1 extra Burnout, on top of its normal effect (always expects a same-night reply). Self-Care costs 2 Action Points instead of 1 (there's no such thing as fully logging off).", "flavor": "Texts you at 11 PM. Reacts with a 👍 to your out-of-office reply."},
      {"name": "The Nepotism Hire", "effect": "+2 Political Capital/round (knows people); Hiring Skill cards costs 1 more Productivity (couldn't approve a headcount request to save their life).", "flavor": "Turns out the CEO is their uncle. Nobody has said this out loud."},
      {"name": "The Consultant-Turned-Manager", "effect": "Your Projects cost 1 less Productivity (loves a framework for everything); −1 Political Capital/round (nobody trusts the person who charges by the hour).", "flavor": "Drew a 2x2 matrix. Nobody asked for the 2x2 matrix."}
    ],
    "feedback": [
        {"name": "Exceeds Expectations", "polarity": "positive", "value": 2, "effect": "+2 Political points during the Review to whoever holds this card.", "flavor": "Hit every goal and then invented three more to hit. Nobody asked, but here we are."},
        {"name": "Goes Above and Beyond", "polarity": "positive", "value": 2, "effect": "+2 Political points during the Review to whoever holds this card.", "flavor": "Answered a Slack at 2 a.m. once. It comes up in every review now."},
        {"name": "A True Team Player", "polarity": "positive", "value": 2, "effect": "+2 Political points during the Review to whoever holds this card.", "flavor": "Brought donuts to the retro. The retro was about layoffs, but still."},
        {"name": "Highly Visible Impact", "polarity": "positive", "value": 2, "effect": "+2 Political points during the Review to whoever holds this card.", "flavor": "The dashboard is green. Nobody checks what it measures, but it's green."},
        {"name": "Strong Executive Presence", "polarity": "positive", "value": 2, "effect": "+2 Political points during the Review to whoever holds this card.", "flavor": "Says 'let me push back on that' with total confidence and no follow-up."},
        {"name": "Consistently Delivers", "polarity": "positive", "value": 2, "effect": "+2 Political points during the Review to whoever holds this card.", "flavor": "Delivers consistently, if not necessarily what was asked for."},
        {"name": "Great Culture Add", "polarity": "positive", "value": 2, "effect": "+2 Political points during the Review to whoever holds this card.", "flavor": "Laughs at the CEO's jokes at exactly the right volume."},
        {"name": "Promotion-Ready", "polarity": "positive", "value": 2, "effect": "+2 Political points during the Review to whoever holds this card.", "flavor": "Has been promotion-ready for six quarters. The ladder is just crowded."},
        {"name": "The Team Depends on Them", "polarity": "positive", "value": 2, "effect": "+2 Political points during the Review to whoever holds this card.", "flavor": "Load-bearing employee. HR has flagged this as a risk, admiringly."},
        {"name": "Needs to Improve Communication", "polarity": "constructive", "value": -2, "effect": "-2 Political points during the Review to whoever holds this card.", "flavor": "Sends a 400-word Slack that could have been 'ok.' Or vice versa."},
        {"name": "Struggles with Ambiguity", "polarity": "constructive", "value": -2, "effect": "-2 Political points during the Review to whoever holds this card.", "flavor": "Asked for 'requirements.' In this economy."},
        {"name": "Not a Culture Fit", "polarity": "constructive", "value": -2, "effect": "-2 Political points during the Review to whoever holds this card.", "flavor": "Logs off at 5. Suspicious. Un-American, even."},
        {"name": "Lacks Executive Presence", "polarity": "constructive", "value": -2, "effect": "-2 Political points during the Review to whoever holds this card.", "flavor": "Said 'I don't know' in a meeting. Out loud. On purpose."},
        {"name": "Room for Growth", "polarity": "constructive", "value": -2, "effect": "-2 Political points during the Review to whoever holds this card.", "flavor": "Endless, breathtaking room. Vistas of it. So much room."},
        {"name": "Doesn't Take Feedback Well", "polarity": "constructive", "value": -2, "effect": "-2 Political points during the Review to whoever holds this card.", "flavor": "Took the feedback fine. Just didn't agree, which is worse."},
        {"name": "Siloed and Territorial", "polarity": "constructive", "value": -2, "effect": "-2 Political points during the Review to whoever holds this card.", "flavor": "Owns the one system nobody else understands. Weirdly protective of the job security."},
        {"name": "Missed Key Deliverables", "polarity": "constructive", "value": -2, "effect": "-2 Political points during the Review to whoever holds this card.", "flavor": "The deliverable was 'vibes.' The vibes were, per the review, off."},
        {"name": "Let's Circle Back on This", "polarity": "constructive", "value": -2, "effect": "-2 Political points during the Review to whoever holds this card.", "flavor": "We will not be circling back. We both know that."}
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

  /* Rule toggles + tuning knobs for the two variant rules (Feedback deck and
   * Collaborative Projects). Defaults ON. Every numeric here is a balance dial
   * exercised by the Monte-Carlo harness (stack_ranked_montecarlo.js); the
   * values below are the tuned defaults that harness settled on. */
  const DEFAULT_RULES = {
    // Tuned defaults, validated by stack_ranked_montecarlo.js (see docs §9.9/§9.10).
    feedback: true,          // deal ±2 Feedback cards at each Review
    feedbackMode: 'classic', // 'classic' — deal ONE card each, keep-or-give [default]
                             // 'give-one' — "360° Review": deal one Positive + one
                             //   Constructive each; give one away (face-down /
                             //   simultaneous) and discard the other
    feedbackValue: 2,        // political points per held card (magnitude)
    feedbackNetCap: 4,       // clamp each player's net feedback swing to ±this per Review
                             //   (research: keep it ≤~25-30% of a typical Review Score)
    feedbackNegLeaderOnly: false, // constructive cards may only be given to the current front-runner
    feedbackTarget: 'score', // who AI dumps constructive cards on:
                             //   'score' — whoever tops THIS Review (self-balancing vs the PC
                             //             strategy; BEST archetype balance) [default]
                             //   'rung'  — the ladder / Career-Capital leader (STRONGER comeback,
                             //             at some archetype-balance cost — "aggressive rubber-band")
                             //   'blend'/'spread' — hybrids (see feedbackNegTarget)
    feedbackBlendPcWeight: 6,// PC weight when blending CC+PC for 'blend'/'spread' targeting
    collaboration: true,     // let players pool Productivity into one Project
    collabOwnerPcCap: 3,     // cap on the owner's PC bonus, max(cc-2,1) then capped here
    collabMinContributors: 2,// distinct contributors needed to count as collaborative
    collabLeaderCannotReceive: false, // the current leader can't recruit outside help
    collabOwnerMustContribute: true   // owner earns the PC bonus only if it paid ≥1 P itself
                                       //   (kills the "own it, pay nothing, bank PC" exploit)
  };
  function buildRules(over) {
    const r = {};
    Object.keys(DEFAULT_RULES).forEach(function (k) { r[k] = DEFAULT_RULES[k]; });
    if (over) Object.keys(over).forEach(function (k) { if (over[k] !== undefined) r[k] = over[k]; });
    return r;
  }

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
    "the-tenure-not-talent-manager": { badgesCountDouble: true, skillHireDelta: 1 },
    "the-seagull-manager": { seagullQuarterCoin: true },
    "the-mushroom-manager": { pPerIncome: 2, pcPerIncome: -1 },
    "the-peter-principle": { apFixed: 2, skillHireDelta: -1 },
    "the-always-on-boss": { overtimeExtraBurnout: 1, selfCareApCost: 2 },
    "the-nepotism-hire": { pcPerIncome: 2, skillHireDelta: 1 },
    "the-consultant-turned-manager": { projectCostDelta: -1, pcPerIncome: -1 }
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
    (CARDS.feedback || []).forEach(function (c) {
      register({ id: slug(c.name), name: c.name, category: "feedback",
        polarity: c.polarity, value: c.value, effect: c.effect, flavor: c.flavor });
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
      _pagerUsedThisQuarter: false,
      _transferUsedThisQuarter: false,
      _managerChoice: null           // transient: 2 candidates held mid-transfer
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
      rules: buildRules(config.rules),
      feedbackDeck: defsByCat("feedback"),   // the 18 designs; reshuffled fresh each Review
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

  // Rough "how good is this boss for me?" score (positive = helpful). Used by the
  // AI to decide whether to Request a Transfer and which of two candidates to keep,
  // and by the UI to hint at a swap. Deliberately heuristic — manager effects are
  // heterogeneous and contextual (rung, archetype), so this only needs to be good
  // enough to leave a clearly-bad boss and pick the better of two.
  function managerValue(player, mgrDef) {
    if (!mgrDef) return 0;
    const m = MGMT_META[mgrDef.id] || {};
    const w = ARCH[player.archetype] || ARCH.balanced;
    let v = 0;
    // Action-point economy
    if (m.freeAp) v += m.freeAp * 2.0;
    if (m.apFixed != null) v += (m.apFixed - AP_BY_RUNG[player.rung]) * 1.5;
    // Income (per round)
    if (m.pcPerIncome) v += m.pcPerIncome * w.pc * 0.8;
    if (m.pPerIncome) v += m.pPerIncome * w.p * 0.8;
    // Costs — a positive delta is a penalty
    if (m.skillHireDelta) v -= m.skillHireDelta * 1.0;
    if (m.projectCostDelta) v -= m.projectCostDelta * 1.2;
    if (m.selfCareApCost) v -= (m.selfCareApCost - 1) * 0.6;
    if (m.trainingApCost) v -= (m.trainingApCost - 1) * 0.4;
    // Network
    if (m.networkExtraPc) v += m.networkExtraPc * w.net * 0.3;
    if (m.noNetwork) v -= w.net * 0.6;
    // Overtime
    if (m.overtimeExtraP) v += m.overtimeExtraP * (w.overtime ? 0.8 : 0.2) * w.p * 0.5;
    if (m.overtimeExtraBurnout) v -= m.overtimeExtraBurnout * (w.overtime ? 1.0 : 0.5);
    // Restrictions / per-Quarter risk
    if (m.forceFirstActionProject) v -= 1.5;
    if (m.quarterCoin) v -= 1.0;            // 50% chance to discard a Skill
    if (m.seagullQuarterCoin) v += 0.3;     // mild net-positive for the holder
    // Compliance badges only pay off near the rung 4-5 gates
    if (m.badgesCountDouble) v += player.rung >= 3 ? 1.0 : 0.2;
    // Credit-Stealing Boss: CC drain per project taxes the promotion gate
    if (m.onProjectComplete) {
      v += (m.onProjectComplete.cc || 0) * w.cc * 0.5;
      v += (m.onProjectComplete.pc || 0) * w.pc * 0.3;
    }
    return v;
  }
  function hasSkill(player, id) { return player.tableau.some(function (c) { return c.id === id; }); }
  function skillCount(player) { return player.tableau.length; }
  function leaderRung(state) { return Math.max.apply(null, state.players.map(function (p) { return p.rung; })); }
  // The player closest to winning (rung, then Career Capital, then Political
  // Capital) — the natural target for negative Feedback and the player barred
  // from recruiting collaborators when catch-up gating is on.
  function threatLeader(state, excludeId) {
    let best = null;
    state.players.forEach(function (p) {
      if (excludeId && p.id === excludeId) return;
      if (!best) { best = p; return; }
      if (p.rung !== best.rung) { if (p.rung > best.rung) best = p; return; }
      if (p.careerCapital !== best.careerCapital) { if (p.careerCapital > best.careerCapital) best = p; return; }
      if (p.politicalCapital > best.politicalCapital) best = p;
    });
    return best;
  }
  // Where a rational player sends a constructive-feedback card. 'score' targets
  // whoever is about to top THIS Review (provisional Review Score = CC gained
  // this Quarter + PC − burnout tax), which naturally lands on the political
  // front-runner; 'rung' targets the ladder/Career-Capital leader.
  function feedbackNegTarget(state, giverId) {
    if (state.rules.feedbackTarget === 'rung') return threatLeader(state, giverId);
    const mode = state.rules.feedbackTarget;
    const kPc = state.rules.feedbackBlendPcWeight != null ? state.rules.feedbackBlendPcWeight : 2;
    let best = null, bestScore = -Infinity;
    state.players.forEach(function (p) {
      if (p.id === giverId) return;
      let sc;
      if (mode === 'blend') {
        // Both the ladder front-runner (Career Capital) AND a surging political
        // player (Political Capital + CC gained this Quarter) are in range.
        sc = p.careerCapital + kPc * p.politicalCapital + (p.careerCapital - p.quarterMarker);
      } else { // 'score' — whoever tops THIS Review
        sc = (p.careerCapital - p.quarterMarker) + p.politicalCapital - Math.floor(p.burnout / 4);
      }
      if (sc > bestScore) { bestScore = sc; best = p; }
    });
    return best || threatLeader(state, giverId);
  }
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
    player.backlog.push({ card: card, lockedScope: slot.evergreen ? 0 : slot.scope,
      owner: player.id, shared: false, paid: 0, contribs: {} });
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
    const item = player.backlog[backlogIndex];
    // A shared project is funded via contributions (the owner Working it just
    // pours their own Productivity in as one of the contributors); a normal
    // backlog entry completes solo exactly as before.
    if (state.rules.collaboration && item && item.shared) {
      const cost = effectiveBacklogItemCost(player, item);
      const need = cost - item.paid;
      return contributeToProject(state, player, player, backlogIndex, Math.min(player.productivity, need));
    }
    return completeBacklogItem(state, player, backlogIndex);
  }

  /* ---------------------------------------------------------------------------
   * 12b. Collaborative Projects (variant rule)
   *   Any player may pour Productivity into another player's *shared* backlog
   *   entry. When cumulative contributions reach the owner's effective cost,
   *   the Project completes: Career Capital is split proportional to each
   *   contributor's Productivity, and the original owner instead banks
   *   Political Capital = max(cardCC - 2, 1) (capped by rules.collabOwnerPcCap).
   *   The owner is accountable for delivery, so absorbs the Project's Burnout,
   *   Compliance Badge, and its own +PC reward. Fewer than
   *   rules.collabMinContributors distinct payers collapses to a solo
   *   completion (full CC to the owner, no PC bonus) — so nothing changes
   *   unless someone actually helps.
   * ------------------------------------------------------------------------ */
  function sharedProjects(state, excludePlayerId) {
    const out = [];
    const blockLeader = state.rules.collabLeaderCannotReceive ? threatLeader(state, null) : null;
    state.players.forEach(function (owner) {
      if (owner.id === excludePlayerId) return;
      if (blockLeader && owner.id === blockLeader.id) return;
      owner.backlog.forEach(function (item, i) {
        if (!item.shared) return;
        const cost = effectiveBacklogItemCost(owner, item);
        if (item.paid >= cost) return;
        out.push({ owner: owner, backlogIndex: i, item: item, cost: cost, need: cost - item.paid });
      });
    });
    return out;
  }

  function contributeToProject(state, contributor, owner, backlogIndex, amount) {
    const item = owner.backlog[backlogIndex];
    if (!item) return { ok: false, reason: "No task there." };
    if (!item.shared) return { ok: false, reason: "That Project isn't open for collaboration." };
    const cost = effectiveBacklogItemCost(owner, item);
    const need = cost - item.paid;
    if (need <= 0) return { ok: false, reason: "Already fully funded." };
    const pay = Math.min(amount, need, contributor.productivity);
    if (pay <= 0) return { ok: false, reason: "Not enough Productivity." };
    contributor.productivity -= pay;
    item.paid += pay;
    item.contribs[contributor.id] = (item.contribs[contributor.id] || 0) + pay;
    log(state, contributor.name + " contributes " + pay + " P to " + owner.name +
      "’s “" + item.card.name + "” (" + item.paid + "/" + cost + ").",
      contributor === owner ? "action" : "muted");
    if (item.paid >= cost) return completeCollaborative(state, owner, backlogIndex);
    return { ok: true, funded: false };
  }

  function completeCollaborative(state, owner, backlogIndex) {
    const item = owner.backlog[backlogIndex];
    const card = item.card;
    const cost = Math.max(1, item.paid);
    const contributorIds = Object.keys(item.contribs);

    // Career Capital ALWAYS follows the Productivity that paid for it — a
    // non-contributing owner never harvests someone else's work.
    const others = contributorIds.filter(function (id) { return id !== owner.id; });
    const m0 = mm(owner);
    const totalCc = card.reward.cc;

    // Case 1 — only the owner paid → a plain solo completion (unchanged).
    if (others.length === 0) {
      applyProjectReward(state, owner, card);
      if (m0.onProjectComplete) {
        owner.careerCapital = Math.max(0, owner.careerCapital + m0.onProjectComplete.cc);
        owner.politicalCapital += m0.onProjectComplete.pc;
      }
      log(state, owner.name + " completes “" + card.name + "” solo for " + cost + " P → +" + totalCc + " CC.", "action");
      owner.backlog.splice(backlogIndex, 1);
      return { ok: true, funded: true, collaborative: false };
    }

    // Case 2 — a lone OUTSIDE funder did all the work (owner paid nothing and
    // it's below the collaborative threshold): they simply take the whole
    // Project as if it were theirs. Owner gets nothing (they didn't work it).
    if (contributorIds.length < state.rules.collabMinContributors) {
      const solo = findPlayer(state, others[0]);
      applyProjectReward(state, solo, card);
      const ms = mm(solo);
      if (ms.onProjectComplete) {
        solo.careerCapital = Math.max(0, solo.careerCapital + ms.onProjectComplete.cc);
        solo.politicalCapital += ms.onProjectComplete.pc;
      }
      log(state, solo.name + " single-handedly finishes " + owner.name + "’s “" + card.name + "” → +" + totalCc + " CC.", "action");
      owner.backlog.splice(backlogIndex, 1);
      return { ok: true, funded: true, collaborative: false };
    }

    // Case 3 — genuine collaboration. The CONTRIBUTORS split the Career Capital
    // proportional to the Productivity each paid; the ORIGINAL OWNER takes
    // Political Capital in lieu of any CC share (the user's rule: "CC shared
    // proportional to productivity, BUT the owner gets PC = max(cc-2,1)"). The
    // owner's own Productivity helped fund it but earns PC, not CC — the
    // coordination cost. This is what stops collaboration from siphoning CC
    // into a coordinator who barely worked.
    const parts = [];
    others.forEach(function (pid) {
      const pl = findPlayer(state, pid);
      const share = Math.floor(totalCc * item.contribs[pid] / cost); // owner's fraction of CC is forfeit → PC
      pl.careerCapital += share;
      const m = mm(pl);
      if (m.onProjectComplete) {
        pl.careerCapital = Math.max(0, pl.careerCapital + m.onProjectComplete.cc);
        pl.politicalCapital += m.onProjectComplete.pc;
      }
      parts.push(pl.name + " " + item.contribs[pid] + "P→+" + share + "CC");
    });

    let ownerPc = Math.max(totalCc - 2, 1);
    if (state.rules.collabOwnerPcCap != null) ownerPc = Math.min(ownerPc, state.rules.collabOwnerPcCap);
    if (state.rules.collabOwnerMustContribute && !(item.contribs[owner.id] > 0)) ownerPc = 0;
    owner.politicalCapital += ownerPc;
    if (card.reward.pc) owner.politicalCapital += card.reward.pc;
    if (card.reward.badges) owner.complianceBadges += card.reward.badges;
    if (card.reward.burnout) addBurnout(state, owner, card.reward.burnout, "project");

    log(state, "🤝 " + owner.name + "’s “" + card.name + "” ships collaboratively (" + parts.join(", ") +
      "); " + owner.name + " takes +" + ownerPc + " PC in lieu of CC" + (card.reward.pc ? " (+" + card.reward.pc + " PC)" : "") +
      (card.reward.badges ? " +" + card.reward.badges + " Badge" : "") + ".", "action");
    owner.backlog.splice(backlogIndex, 1);
    return { ok: true, funded: true, collaborative: true };
  }

  // AI owner: open the single most valuable Project it can't bankroll alone
  // (or, for a PC-hungry archetype, any it can't afford) for collaboration.
  function maybeOpenCollaboration(state, player, w) {
    if (!state.rules.collaboration) return;
    let bestIdx = -1, bestScore = -Infinity;
    player.backlog.forEach(function (item, i) {
      if (item.shared) return;
      const cost = effectiveBacklogItemCost(player, item);
      const cantAfford = player.productivity < cost;
      const expensive = cost >= 5;
      const pcHungry = w.pc >= w.p;
      if (!(cantAfford && (expensive || pcHungry))) return;
      if (item.card.reward.cc > bestScore) { bestScore = item.card.reward.cc; bestIdx = i; }
    });
    if (bestIdx >= 0) {
      player.backlog[bestIdx].shared = true;
      log(state, player.name + " opens “" + player.backlog[bestIdx].card.name + "” up for collaboration.", "muted");
    }
  }

  // Public wrappers for the UI: toggle a backlog entry open/closed for
  // collaboration (no AP cost), and contribute Productivity to any player's
  // shared entry (costs the contributor 1 AP, managed by the driver).
  function doShareProject(state, player, backlogIndex) {
    if (!state.rules.collaboration) return { ok: false, reason: "Collaboration is turned off." };
    const item = player.backlog[backlogIndex];
    if (!item) return { ok: false, reason: "No task there." };
    item.shared = !item.shared;
    log(state, player.name + (item.shared
      ? " opens “" + item.card.name + "” up for collaboration."
      : " closes “" + item.card.name + "” to collaboration."), "muted");
    return { ok: true, shared: item.shared };
  }
  function doContribute(state, contributor, ownerId, backlogIndex, amount) {
    if (!state.rules.collaboration) return { ok: false, reason: "Collaboration is turned off." };
    const owner = findPlayer(state, ownerId);
    if (!owner) return { ok: false, reason: "No such owner." };
    const item = owner.backlog[backlogIndex];
    if (!item || !item.shared) return { ok: false, reason: "That Project isn't open for collaboration." };
    if (state.rules.collabLeaderCannotReceive) {
      const lead = threatLeader(state, null);
      if (lead && lead.id === owner.id) return { ok: false, reason: "The front-runner can't recruit help right now." };
    }
    const cost = effectiveBacklogItemCost(owner, item);
    const need = cost - item.paid;
    return contributeToProject(state, contributor, owner, backlogIndex, amount != null ? amount : Math.min(contributor.productivity, need));
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

  // Request a Transfer — escape a punishing boss. Costs the caller 1 AP (charged
  // by the driver) plus 2 Burnout here. Draws 2 replacement managers, holds them
  // on the player, and returns { pending:"chooseManager" } so the driver can let
  // the player keep one (via applyChooseManager). Once per Quarter.
  function doSwitchManager(state, player) {
    if (state._noTransfer) {   // test-only kill switch (never set by newGame or the UI)
      return { ok: false, reason: "Transfers are disabled." };
    }
    if (player._transferUsedThisQuarter) {
      return { ok: false, reason: "You've already requested a transfer this Quarter." };
    }
    if (state.managementDrawPile.length + state.managementDiscardPile.length < 1) {
      return { ok: false, reason: "No other managers are available." };
    }
    // Draw candidates BEFORE discarding the current boss, so a near-empty deck
    // can never strand the player with no manager.
    const candidates = [];
    let c = drawManagement(state);
    if (c) candidates.push(c);
    c = drawManagement(state);
    if (c) candidates.push(c);
    if (candidates.length === 0) return { ok: false, reason: "No other managers are available." };

    if (player.managementStyle) state.managementDiscardPile.push(player.managementStyle);
    const leaving = player.managementStyle;
    player.managementStyle = null;      // held pending choice; effects read {} until chosen
    player._managerChoice = candidates;
    player._transferUsedThisQuarter = true;
    log(state, player.name + " requests a transfer" + (leaving ? " out from “" + leaving.name + "”" : "") +
      " (+2 Burnout).", "action");
    addBurnout(state, player, 2, "transfer");
    // Exactly one candidate available → nothing to choose; resolve immediately.
    if (candidates.length === 1) {
      applyChooseManager(state, player, candidates[0].id);
      return { ok: true };
    }
    return { ok: true, pending: "chooseManager" };
  }

  // Resolve a pending transfer: keep the chosen candidate, discard the rest.
  function applyChooseManager(state, player, chosenId) {
    const cands = player._managerChoice || [];
    let chosen = cands.filter(function (c) { return c.id === chosenId; })[0] || cands[0] || null;
    cands.forEach(function (c) { if (c !== chosen) state.managementDiscardPile.push(c); });
    player.managementStyle = chosen;
    player._managerChoice = null;
    syncImmunity(player);
    if (chosen) log(state, player.name + " now reports to “" + chosen.name + ".”", "muted");
    return { ok: true };
  }

  /* ---------------------------------------------------------------------------
   * 13. Turn budget
   * ------------------------------------------------------------------------ */
  function beginTurn(state, player) {
    player.overtimeUsedThisRound = false;
    const m = mm(player);
    const baseAp = m.apFixed != null ? m.apFixed : AP_BY_RUNG[player.rung];
    let ap = baseAp + (m.freeAp || 0) - (player.trainingApPenaltyNextRound || 0);
    player.trainingApPenaltyNextRound = 0;
    if (ap < 0) ap = 0;
    let mustProjectFirst = false;
    if (m.forceFirstActionProject) {
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
        p._transferUsedThisQuarter = false;
      });
    }
  }

  function startQuarterEffects(state) {
    if (state.roundNumber % 3 !== 1) return;
    state.players.forEach(function (p) {
      const m = mm(p);
      if (m.quarterCoin) {
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
      }
      if (m.seagullQuarterCoin) {
        if (coin()) {
          state.players.forEach(function (other) {
            if (other === p) return;
            addBurnout(state, other, 1, "management");
          });
          log(state, p.name + " (Seagull Manager) swoops in: every other player gains 1 Burnout.", "muted");
        } else {
          p.politicalCapital += 1;
          log(state, p.name + " (Seagull Manager) flies off before anyone notices: +1 Political Capital.", "muted");
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
      if (m.pPerIncome) dp += m.pPerIncome;
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
      const mandatory = p.backlog.length === 0;
      const slotIndex = await pickTaskToClaim(state, hooks, p, mandatory);
      if (slotIndex >= 0) claimTaskFromBoard(state, p, slotIndex);
      if (hooks && hooks.onChange) hooks.onChange();
    }
    state.activePlayerId = null;
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

  // `mandatory` is false only when the player already has at least one
  // backlog entry — in that case the request offers a "skip" choice
  // alongside the board options. AI always claims (never voluntarily
  // skips), preserving the archetype behavior/balance already measured and
  // documented for the unconditional-claim design (spec Section 9.8) —
  // skipping is a human-facing capability, not an AI strategy change.
  async function pickTaskToClaim(state, hooks, player, mandatory) {
    const heuristic = bestClaimIndex(state);
    if (heuristic < 0) return -1; // nothing available anywhere (all slots empty)
    if (player.kind !== "human" || !hooks || !hooks.decide) return heuristic;
    const answer = await hooks.decide({
      playerId: player.id, action: "claimTask",
      prompt: mandatory
        ? player.name + " has no task in hand — pick up a Project from the Kanban Board."
        : player.name + " already has " + player.backlog.length + " task(s) — pick up another, or skip.",
      allowSkip: !mandatory,
      options: state.kanbanBoard.map(function (slot, i) {
        return slot.card ? { key: String(i), label: slot.card.name + " (" + effectiveProjectCost(player, slot) + " P)" } : null;
      }).filter(Boolean)
    });
    if (answer === "skip") return -1;
    const idx = typeof answer === "number" ? answer : parseInt(answer, 10);
    return (Number.isInteger(idx) && state.kanbanBoard[idx] && state.kanbanBoard[idx].card) ? idx : heuristic;
  }

  /* --- Lunch ------------------------------------------------------------------ */
  async function lunch(state, hooks) {
    const card = drawEvent(state);
    state.currentEvent = card;
    if (!card) { log(state, "Office Chaos deck is empty.", "event"); return; }
    log(state, "🍽️ Office Chaos — " + card.name + ": " + card.effect, "event");

    // Announce the drawn card (modal in the UI) before its effects resolve, so
    // players get a beat to read it. Awaited: the host holds the game here until
    // the card is dismissed. No-op headlessly / when the hook is absent.
    if (hooks && hooks.onChange) hooks.onChange();
    if (hooks && hooks.onEvent) await hooks.onEvent(card);

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
        // Everyone returns their Management (boss) card; the whole Management
        // deck is reshuffled; everyone draws a fresh one. Managers aren't a
        // persistent gate (immunity comes from a Skill, so syncImmunity is a
        // no-op here) — this just re-rolls each player's ongoing boss effect.
        players.forEach(function (p) {
          if (p.managementStyle) { state.managementDiscardPile.push(p.managementStyle); p.managementStyle = null; }
        });
        // Fold every Management card (unheld draw pile + returned discards) into
        // one pile and shuffle, so "reshuffle the deck" means the whole deck.
        state.managementDrawPile = shuffle(state.managementDrawPile.concat(state.managementDiscardPile));
        state.managementDiscardPile = [];
        log(state, "🔄 Surprise Reorg: everyone returns their manager; the deck is reshuffled and new managers are dealt.", "event");
        players.forEach(function (p) {
          p.managementStyle = drawManagement(state);
          syncImmunity(p);
          log(state, p.name + " now reports to “" + (p.managementStyle ? p.managementStyle.name : "—") + ".”", "muted");
        });
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
      await resolveFeedbackPhase(state, hooks);   // deal/give Feedback cards, then score
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
   * 14b. Feedback phase (variant rule) — runs at the top of every Review,
   *   before scoring. Held cards are worth ±feedbackValue "political points"
   *   folded into the Review Score (and the CEO Board Vote tiebreak), with each
   *   player's net swing clamped to ±feedbackNetCap. Political-Capital-adjacent
   *   but NOT persistent PC: the effect is entirely transient to this Review,
   *   which the quarterly PC reset would erase anyway.
   *
   *   Two modes (`rules.feedbackMode`):
   *   - `'classic'` (default) — shuffle the 18-card deck fresh, deal ONE to each
   *     player, then each player keeps their card or gives it to another player.
   *   - `'give-one'` ("360° Review") — deal each player ONE Positive and ONE
   *     Constructive card; each must give exactly one away (face-down, revealed
   *     simultaneously) and discard the other. See `resolveFeedbackGiveOne`.
   *
   *   Returns nothing; writes state._pendingFeedback (a playerId→points map)
   *   plus a per-player held-card list for the Review summary/log. Async so a
   *   human can be asked where to send their card; AI decides inline.
   * ------------------------------------------------------------------------ */
  async function resolveFeedbackPhase(state, hooks) {
    state._pendingFeedback = {};
    state._feedbackHeld = {};
    if (!state.rules.feedback || !state.feedbackDeck || !state.feedbackDeck.length) return;
    state.players.forEach(function (p) { state._feedbackHeld[p.id] = []; });
    if (state.rules.feedbackMode === "give-one") await resolveFeedbackGiveOne(state, hooks);
    else await resolveFeedbackClassic(state, hooks);
    tallyFeedback(state);
  }

  // 'spread' targeting: rank everyone by blended threat, so successive
  // Constructive cards land on successive front-runners (the ladder leader AND
  // a surging political player) instead of all piling on one — what a table of
  // rational humans, each worried about a different rival, actually produces.
  // Returns null unless feedbackTarget==='spread'. Shared by both modes.
  function feedbackSpreadRanked(state) {
    if (state.rules.feedbackTarget !== "spread") return null;
    const kPc = state.rules.feedbackBlendPcWeight != null ? state.rules.feedbackBlendPcWeight : 6;
    return state.players.slice().sort(function (a, b) {
      const va = a.careerCapital + kPc * a.politicalCapital + (a.careerCapital - a.quarterMarker);
      const vb = b.careerCapital + kPc * b.politicalCapital + (b.careerCapital - b.quarterMarker);
      return vb - va;
    });
  }

  // Tally net points per holder, clamped to the configured swing cap. Shared by
  // both modes; reads state._feedbackHeld, writes state._pendingFeedback.
  function tallyFeedback(state) {
    state.players.forEach(function (p) {
      const held = state._feedbackHeld[p.id] || [];
      let pts = held.reduce(function (s, c) {
        return s + (c.value > 0 ? state.rules.feedbackValue : -state.rules.feedbackValue);
      }, 0);
      const capMag = state.rules.feedbackNetCap;
      if (capMag != null) pts = Math.max(-capMag, Math.min(capMag, pts));
      state._pendingFeedback[p.id] = pts;
      if (held.length) {
        log(state, "📝 " + p.name + " holds " + held.map(function (c) { return c.name; }).join(", ") +
          " → " + (pts >= 0 ? "+" : "") + pts + " political points this Review.", "muted");
      }
    });
  }

  // Classic mode: deal one card per player from a freshly shuffled deck; each
  // recipient keeps it or gives it away (AI keeps Positives, dumps Constructive
  // cards on a front-runner). Fills state._feedbackHeld.
  async function resolveFeedbackClassic(state, hooks) {
    const players = state.players;
    const deck = shuffle(state.feedbackDeck.slice());
    let cap = state.rules.feedbackDealCap;
    const nDeal = cap == null ? players.length : Math.min(cap, players.length);
    const dealt = [];
    const order = turnOrder(state);
    for (let i = 0; i < order.length && dealt.length < nDeal; i++) {
      const card = deck[i % deck.length];
      dealt.push({ dealtTo: order[i], card: card });
    }
    const spreadRanked = feedbackSpreadRanked(state);
    let spreadIdx = 0;

    // Each dealt card: its recipient decides the final holder (keep or give).
    for (const d of dealt) {
      const giver = d.dealtTo;
      let targetId = giver.id;
      const negative = d.card.value < 0;
      if (giver.kind === "human" && hooks && hooks.decide) {
        const opts = players.filter(function (p) {
          if (state.rules.feedbackNegLeaderOnly && negative) {
            const lead = feedbackNegTarget(state, giver.id);
            return p.id === giver.id || (lead && p.id === lead.id);
          }
          return true;
        }).map(function (p) { return { key: p.id, label: p.name + (p.id === giver.id ? " (keep)" : "") }; });
        const ans = await hooks.decide({
          playerId: giver.id, action: "giveFeedback",
          prompt: giver.name + " received “" + d.card.name + "” (" + (negative ? "−" : "+") +
            state.rules.feedbackValue + "). Keep it or give it to someone.",
          card: { name: d.card.name, polarity: d.card.polarity, value: d.card.value },
          options: opts
        });
        if (ans && findPlayer(state, ans)) targetId = ans;
      } else {
        // AI: keep positives; give negatives to a front-runner.
        if (negative) {
          if (spreadRanked) {
            // advance to the next ranked threat that isn't the giver
            let picked = null;
            for (let k = 0; k < spreadRanked.length; k++) {
              const cand = spreadRanked[(spreadIdx + k) % spreadRanked.length];
              if (cand.id !== giver.id) { picked = cand; spreadIdx = (spreadIdx + k + 1) % spreadRanked.length; break; }
            }
            if (picked) targetId = picked.id;
          } else {
            const lead = feedbackNegTarget(state, giver.id);
            if (lead) targetId = lead.id;
          }
        }
      }
      state._feedbackHeld[targetId].push(d.card);
    }
  }

  /* ---------------------------------------------------------------------------
   * 14c. "360° Review" feedback mode (`rules.feedbackMode === 'give-one'`).
   *   Each player is dealt ONE Positive (+feedbackValue) and ONE Constructive
   *   (−feedbackValue) card, then MUST give exactly one of them to another
   *   player and DISCARD the other (they keep neither of their own). Gifts are
   *   chosen from the pre-phase board state — face-down and revealed together,
   *   so nobody reacts to anyone else's gift — then assigned all at once.
   *
   *   A self-interested player throws the Constructive card at the front-runner
   *   and discards the Positive (helping a rival is never in your interest), so
   *   in AI play this is a reliable-but-bounded leader-bash: every non-leader
   *   pitches −feedbackValue at the leader (clamped to −feedbackNetCap) and the
   *   leader pitches theirs at the runner-up. A human may instead gift a Positive
   *   to an ally. `feedbackTarget`/`feedbackNegLeaderOnly`/`feedbackNetCap` all
   *   apply exactly as in classic mode.
   * ------------------------------------------------------------------------ */
  async function resolveFeedbackGiveOne(state, hooks) {
    const players = state.players;
    const order = turnOrder(state);
    // Separate Positive / Constructive piles (9 each supports up to 9 players).
    const posPile = shuffle(state.feedbackDeck.filter(function (c) { return c.value > 0; }));
    const negPile = shuffle(state.feedbackDeck.filter(function (c) { return c.value < 0; }));
    const hands = {};
    order.forEach(function (p, i) {
      hands[p.id] = { pos: posPile[i % posPile.length], neg: negPile[i % negPile.length] };
    });
    const spreadRanked = feedbackSpreadRanked(state);
    let spreadIdx = 0;

    // Resolve every gift into `gifts` FIRST (all decisions read the same
    // pre-phase state — the "face-down, simultaneous" part), then reveal.
    const gifts = [];   // { toId, card }
    for (const giver of order) {
      const hand = hands[giver.id];
      let gift = null;
      if (giver.kind === "human" && hooks && hooks.decide) {
        const leadOnly = state.rules.feedbackNegLeaderOnly;
        const lead = leadOnly ? feedbackNegTarget(state, giver.id) : null;
        const opts = [];
        players.forEach(function (p) {
          if (p.id === giver.id) return;
          if (!leadOnly || (lead && p.id === lead.id)) {
            opts.push({ key: "neg:" + p.id, label: "Give “" + hand.neg.name + "” (−" +
              state.rules.feedbackValue + ") to " + p.name });
          }
          opts.push({ key: "pos:" + p.id, label: "Give “" + hand.pos.name + "” (+" +
            state.rules.feedbackValue + ") to " + p.name });
        });
        const ans = await hooks.decide({
          playerId: giver.id, action: "giveFeedbackChoose",
          prompt: giver.name + " holds “" + hand.pos.name + "” (+" + state.rules.feedbackValue +
            ") and “" + hand.neg.name + "” (−" + state.rules.feedbackValue +
            "). Give ONE to another player; the other is discarded.",
          cards: { positive: { name: hand.pos.name }, constructive: { name: hand.neg.name } },
          options: opts
        });
        if (typeof ans === "string" && ans.indexOf(":") > 0) {
          const parts = ans.split(":");
          const tgt = findPlayer(state, parts[1]);
          if (tgt && tgt.id !== giver.id) gift = { toId: tgt.id, card: parts[0] === "pos" ? hand.pos : hand.neg };
        }
      }
      if (!gift) {
        // AI / fallback: sling the Constructive card at the top threat; discard the Positive.
        let target = null;
        if (spreadRanked) {
          for (let k = 0; k < spreadRanked.length; k++) {
            const cand = spreadRanked[(spreadIdx + k) % spreadRanked.length];
            if (cand.id !== giver.id) { target = cand; spreadIdx = (spreadIdx + k + 1) % spreadRanked.length; break; }
          }
        } else {
          target = feedbackNegTarget(state, giver.id);
        }
        if (target) gift = { toId: target.id, card: hand.neg };
      }
      if (gift) gifts.push(gift);
    }

    // Simultaneous reveal: assign every gift to its recipient's held pile now.
    gifts.forEach(function (g) {
      if (state._feedbackHeld[g.toId]) state._feedbackHeld[g.toId].push(g.card);
    });
  }

  /* ---------------------------------------------------------------------------
   * 15. Quarterly Performance Review (spec Section 6, exact ordering)
   * ------------------------------------------------------------------------ */
  function runReview(state) {
    state.phase = "REVIEW";
    state.reviewCount += 1;
    const players = state.players;

    // Step 1 — Review Score (uses quarterMarker from the PREVIOUS review).
    // Feedback points (variant rule) fold straight into the political term.
    const fb = state._pendingFeedback || {};
    const score = {};
    players.forEach(function (p) {
      const ccGained = p.careerCapital - p.quarterMarker;
      score[p.id] = ccGained + p.politicalCapital + (fb[p.id] || 0) - Math.floor(p.burnout / 4);
    });

    const summary = {
      reviewNumber: state.reviewCount, round: state.roundNumber,
      rows: players.map(function (p) {
        return { id: p.id, name: p.name, score: score[p.id], ccGained: p.careerCapital - p.quarterMarker,
          pc: p.politicalCapital, feedback: (fb[p.id] || 0), burnout: p.burnout, rungBefore: p.rung, rungAfter: p.rung };
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
      // Feedback counts as political points here too — a well-placed
      // constructive card can swing the board vote.
      newCeo = ceoCandidates.slice().sort(function (a, b) {
        const pa = a.politicalCapital + (fb[a.id] || 0), pb = b.politicalCapital + (fb[b.id] || 0);
        if (pb !== pa) return pb - pa;
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
      // Exactly one rung per Review — a player must climb the ladder one level
      // at a time and can never skip a rung, no matter how high their score.
      p.rung += 1;
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

    state._pendingFeedback = null;
    state._feedbackHeld = null;
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

    // Open an unaffordable Project up for collaboration (variant rule).
    maybeOpenCollaboration(state, player, w);

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

      // Collaborate: strictly a salvage channel. A bot only helps when it has
      // surplus Productivity but NO affordable Project of its own (proj.index
      // < 0), and only by FINISHING a shared Project outright — so it never
      // strands Productivity in a half-funded one — and never props up the
      // current front-runner. This keeps collaboration a catch-up tool rather
      // than a way to bleed the productivity-rich archetypes dry.
      let collab = null, collabVal = -Infinity;
      if (state.rules.collaboration && player.productivity > 0 && proj.index < 0) {
        const lead = threatLeader(state, null);
        sharedProjects(state, player.id).forEach(function (sp) {
          if (lead && sp.owner.id === lead.id) return;   // don't fund the front-runner
          if (player.productivity < sp.need) return;     // must complete it this turn
          const ccShare = sp.item.card.reward.cc * sp.need / sp.cost;
          const val = ccShare * w.cc / 3.0 + 0.5;
          if (val > collabVal) { collabVal = val; collab = { sp: sp, pay: sp.need }; }
        });
      }

      // Request a Transfer: an escape valve, not a routine action. Only worth an
      // Action Point when the current boss is clearly hurting THIS archetype, and
      // only when Burnout has room for the +2 cost. Drawing 2 and keeping the
      // better makes the expected replacement roughly neutral, so the value is
      // the swing away from a bad boss.
      let switchVal = -Infinity;
      const canSwitch = !state._noTransfer && !player._transferUsedThisQuarter && player.burnout <= 6 &&
        (state.managementDrawPile.length + state.managementDiscardPile.length >= 1);
      if (canSwitch) {
        const curVal = managerValue(player, player.managementStyle);
        if (curVal < -0.5) switchVal = Math.min(0.5 - curVal, 3) + 0.3;
      }

      const best = Math.max(projVal, bestSkillVal, netVal, collabVal, switchVal, 0);
      if (best <= 0) break;

      if (best === projVal && proj.index >= 0) {
        doWorkProject(state, player, proj.index); ap -= 1;
      } else if (best === collabVal && collab) {
        contributeToProject(state, player, collab.sp.owner, collab.sp.backlogIndex, collab.pay); ap -= 1;
      } else if (best === bestSkillVal && bestSkill >= 0) {
        const r = doHire(state, player, bestSkill); ap -= 1;
        if (r.pending === "shipsItFriday") {
          const p2 = pickBestHalfProject(state, player);
          if (p2 >= 0) applyShipsItFriday(state, player, p2);
        }
      } else if (best === switchVal) {
        const r = doSwitchManager(state, player);
        if (r.ok) {
          ap -= 1;
          if (r.pending === "chooseManager") {
            const cands = player._managerChoice || [];
            let pick = cands[0], pv = -Infinity;
            cands.forEach(function (cd) { const v = managerValue(player, cd); if (v > pv) { pv = v; pick = cd; } });
            applyChooseManager(state, player, pick ? pick.id : null);
          }
        } else break;   // couldn't switch (e.g. deck empty) — stop looping on it
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
      case "giveFeedback": {
        const card = request.card;
        if (!card || card.value >= 0) return player.id; // keep positive feedback
        const lead = feedbackNegTarget(state, player.id); // dump negatives on the front-runner
        return lead ? lead.id : player.id;
      }
      case "discardSkill": {
        const idx = pickWorstSkillIndex(player);
        return player.tableau[idx] ? player.tableau[idx].id : (request.candidates[0] && request.candidates[0].id);
      }
      case "chooseManager": {
        const cands = request.candidates || [];
        let pick = cands[0], pv = -Infinity;
        cands.forEach(function (c) { const v = managerValue(player, c); if (v > pv) { pv = v; pick = c; } });
        return pick ? pick.id : null;
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
      applyShipsItFriday: applyShipsItFriday,
      shareProject: doShareProject,
      contribute: doContribute,
      switchManager: doSwitchManager,
      chooseManager: applyChooseManager
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
      sharedProjects: sharedProjects,
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
      managerValue: managerValue,
      slug: slug
    },
    // Internal functions exposed for unit testing.
    _internal: {
      runReview: runReview, addBurnout: addBurnout, resolveTraining: resolveTraining,
      claimTaskFromBoard: claimTaskFromBoard, completeBacklogItem: completeBacklogItem,
      assignTasks: assignTasks, resolveFeedbackPhase: resolveFeedbackPhase,
      resolveFeedbackGiveOne: resolveFeedbackGiveOne, resolveFeedbackClassic: resolveFeedbackClassic,
      contributeToProject: contributeToProject, completeCollaborative: completeCollaborative,
      sharedProjects: sharedProjects, threatLeader: threatLeader, buildRules: buildRules
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SR;
  if (typeof window !== "undefined") window.SR = SR;
  if (typeof globalThis !== "undefined") globalThis.SR = SR;
})();
