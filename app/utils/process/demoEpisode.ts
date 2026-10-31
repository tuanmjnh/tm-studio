// =============================================================================
//  Demo episode S01E001 — original sample content for the production pipeline.
//
//  The user has no produced episodes yet, so the first run would otherwise be
//  an empty twelve-stage wall. These artifacts are ORIGINAL sample material
//  (written for this demo, no adaptation of any existing work) that let every
//  screen and gate be exercised end to end: five stages are pre-approved and
//  the pipeline stops at `script`, which the user runs with their own model.
// =============================================================================

import type { ProcessArtifactSeed } from './types'

export const DEMO_RUN_ID = 'S01E001'
export const DEMO_RUN_TITLE = 'The Signal Beneath'

/** Stages the demo run already passed (each one gets its gate signed). */
export const DEMO_APPROVED_STAGES = ['brief', 'continuity', 'ideas', 'novelty', 'outline']

export const DEMO_ARTIFACTS: ProcessArtifactSeed[] = [
  {
    name: 'series-bible.md',
    content: `# Series Bible — Static Horizon (excerpt)

## Core promise
A grounded mystery series about people who can hear a signal that should not exist,
and the cost of answering it. International audience, English-first.

## Tone
Restrained action, quiet dread, dry humour between two leads. No gore, no fanservice.

## World rules
- RULE-001 — The Signal can only be heard near running water; distance scales the strain.
- RULE-002 — Every answer costs the listener a memory they cannot choose.
- RULE-003 — Machines cannot record the Signal; only a human ear can carry it.
- RULE-004 — A memory given to the Signal is not erased from the world, only from the giver.

## Characters
- CHAR-001 Mira Okonkwo — audio engineer, 31, hears the Signal after a maintenance dive.
  Wants: proof she is not losing her mind. Fears: being the unreliable witness again.
- CHAR-002 Dan Reyes — salvage diver, 38, transactional, keeps a paper log because
  "machines forget on purpose". Wants: to sell the location and leave the coast.
- CHAR-003 Supervisor Adler — harbour authority, believes the Signal is a smuggling channel.

## Locations
- LOC-001 Kelp Basin — flooded turbine hall, cold green water, one working lamp.
- LOC-002 Harbour office — fluorescent light, paper charts, a kettle nobody cleans.

## Themes
Memory as currency, who gets believed, the difference between proof and permission.
`
  },
  {
    name: 'episode-brief.md',
    content: `# Episode Brief — S01E001 "The Signal Beneath"

- **Series Bible version:** 1.0.0 (excerpt in series-bible.md)
- **Target length:** 8–10 minutes
- **Language:** English (subtitles: Vietnamese, English)
- **Format:** 16:9 master; vertical cut for Shorts planned separately
- **Production goal:** one self-contained mystery with a real choice and a cost,
  establishing the Signal without explaining it away.

## Scope lock
- Two speaking characters (Mira, Dan) and one voice-only character (Adler).
- One location in two states (dry office / flooded hall).
- No new world rules beyond RULE-001..004.
`
  },
  {
    name: 'continuity-brief.json',
    content: JSON.stringify({
      characters: [
        {
          id: 'CHAR-001',
          state: 'Audio engineer on night shift, reputation already damaged by an earlier false alarm',
          knows: ['RULE-001 from a colleague\'s warning', 'the turbine hall is scheduled for demolition'],
          hides: ['she has been hearing the Signal for three days', 'her recording equipment failed'],
          wants: 'proof she is not losing her mind'
        },
        {
          id: 'CHAR-002',
          state: 'Salvage diver with a buyer lined up for the site',
          knows: ['the demolition date', 'the buyer pays for coordinates, not for stories'],
          hides: ['he has heard the Signal once and told no one'],
          wants: 'to sell the location and leave the coast'
        }
      ],
      timeline: { after_previous: 'series opening', elapsed: 'three nights' },
      locations: [
        { id: 'LOC-001', who_is_there: 'Mira, then Dan', items: ['portable recorder (dead)', 'paper dive log'] },
        { id: 'LOC-002', who_is_there: 'Adler alone', items: ['paper charts', 'demolition notice'] }
      ],
      clues: [
        { id: 'CLUE-001', status: 'open', note: 'The Signal answers only near running water' },
        { id: 'CLUE-002', status: 'open', note: 'Mira\'s recorder erases the same minute every time' }
      ],
      open_promises: ['What the Signal wants', 'What Adler is protecting'],
      used_set_pieces: [],
      conflicts: [],
      blocked: false
    }, null, 2)
  },
  {
    name: 'ideas.md',
    content: `# Episode Ideas — S01E001 candidates

## IDEA-001-A — "Hearsay"
- **Logline:** A sceptical audio engineer records a sound that erases itself, and must decide whether to publish proof she cannot keep.
- **Central question:** Is evidence that deletes itself still evidence?
- **Protagonist goal:** Capture the Signal on a medium that survives.
- **Opposition:** Every device fails; her only witness wants to sell the site.
- **Inciting incident:** The recorder wipes the same 60 seconds three nights running.
- **Irreversible choice:** She plays the Signal live over the harbour radio to force witnesses.
- **Unique set piece:** A flooded turbine hall where sound behaves wrongly.
- **Character change:** From needing permission to be believed → accepting the cost of being believed.
- **Continuity payoff:** Establishes RULE-003 (machines cannot record it).
- **New clue ids:** CLUE-001, CLUE-003 (the wiped minute is always her own voice).
- **Risks:** Could read as a ghost story if the mechanism stays vague.

## IDEA-001-B — "Buyer's Water"
- **Logline:** A salvage diver sells coordinates to a buyer who already knows what is down there.
- **Central question:** Who is the buyer, and why does he never come ashore?
- **Protagonist goal:** Complete the sale before demolition.
- **Opposition:** Mira keeps diving the site and documenting it.
- **Inciting incident:** The buyer pays double for silence, not for access.
- **Irreversible choice:** Dan floods the hall to hide it, with Mira still inside.
- **Unique set piece:** A sabotage dive with one working lamp.
- **Character change:** From transactional → complicit.
- **Continuity payoff:** Sets up Adler's smuggling theory as a red herring.
- **New clue ids:** CLUE-004 (the buyer's voice is heard in the Signal).
- **Risks:** Turns the series into a crime plot too early.

## IDEA-001-C — "The Kettle"
- **Logline:** A night-shift supervisor realises the demolition notice was signed by a dead man.
- **Central question:** Who authorised the demolition?
- **Protagonist goal:** Stop the demolition from inside the authority.
- **Opposition:** Her own signature is on the file.
- **Inciting incident:** The kettle boils at the same time every night.
- **Irreversible choice:** She files a report that incriminates herself to buy time.
- **Unique set piece:** A records room with a decade of misfiled paperwork.
- **Character change:** From bureaucrat → whistleblower.
- **Continuity payoff:** Makes Adler a protagonist of season one.
- **New clue ids:** CLUE-005 (a signature that repeats across decades).
- **Risks:** Almost no visual action; expensive to make interesting.

## Comparison

| Criterion | A | B | C |
| --- | --- | --- | --- |
| Goal clarity | high | high | medium |
| Escalation variety | high | medium | low |
| Consequence weight | high | medium | high |
| Production cost | medium | high | low |
| Series value | high | medium | high |
`
  },
  {
    name: 'novelty-report.md',
    content: `# Novelty Report — S01E001 candidates

**Compared against:** this run's own ideas (no produced episodes exist yet), series bible v1.0.0.
**Method:** structural comparison (goal, event chain, clue function, choice/consequence, set piece, character change). Scores are an internal priority signal, NOT proof of originality and NOT a legal opinion.

## IDEA-001-A — "Hearsay"

| Criterion | Score (0–5) | Weight |
| --- | --- | --- |
| Goals & motives | 4 | 15% |
| Event chain / structure | 4 | 20% |
| Clues & twists | 5 | 15% |
| Choice & consequence | 5 | 15% |
| Set piece & resolution | 4 | 15% |
| Character change | 4 | 10% |
| New value for the series | 5 | 10% |

**Novelty Score: 88** → PASS (still requires human review)

- **Nearest material:** IDEA-001-B (same location, same demolition clock).
- **Overlap risk:** Both use the buyer as pressure. Difference: A's choice is public and irreversible; B's is private and criminal.
- **Change if chosen:** keep the radio broadcast as the ONLY public act in the episode.

## IDEA-001-B — "Buyer's Water"

| Criterion | Score (0–5) | Weight |
| --- | --- | --- |
| Goals & motives | 3 | 15% |
| Event chain / structure | 3 | 20% |
| Clues & twists | 3 | 15% |
| Choice & consequence | 4 | 15% |
| Set piece & resolution | 4 | 15% |
| Character change | 3 | 10% |
| New value for the series | 3 | 10% |

**Novelty Score: 66** → REVISE

- **Overlap risk:** the "sell the secret" engine is the most generic option here and would pre-empt a later season arc.
- **Change if chosen:** make the buyer absent for the whole episode; the pressure must come from Dan's own debt.

## IDEA-001-C — "The Kettle"

| Criterion | Score (0–5) | Weight |
| --- | --- | --- |
| Goals & motives | 4 | 15% |
| Event chain / structure | 3 | 20% |
| Clues & twists | 5 | 15% |
| Choice & consequence | 5 | 15% |
| Set piece & resolution | 2 | 15% |
| Character change | 4 | 10% |
| New value for the series | 4 | 10% |

**Novelty Score: 76** → REVISE

- **Weakness:** the clue is strong, the episode has no visual escalation.
- **Change if chosen:** pair it with a physical intrusion into the records room.

## Decision
Select **IDEA-001-A**. B is rejected as a season-level plot spent too early; C is parked as a mid-season Adler episode.
`
  },
  {
    name: 'outline.md',
    content: `# Outline — S01E001 "The Signal Beneath"

## Hook
Black frame, then underwater sound: a low pulse under turbine noise. Mira's recorder display reads 00:00 and keeps reading 00:00.

## Setup
Harbour office. Adler signs the demolition notice. Mira asks for one more maintenance dive to retrieve her own equipment; Adler refuses twice, then agrees to one hour. Audience learns: nobody is allowed to record in the basin.

## Inciting incident
In the flooded hall the Signal answers her lamp flicker. Her recorder wipes the same minute for the third night — and this time the wiped minute is her own voice saying something she has not said yet.

## Escalation
1. Dan arrives to survey the site for his buyer and finds her there. He is not surprised by the sound — he has heard it before and logged it on paper.
2. The paper log contradicts the recorder: the log keeps the minute the machine erased.

## Revelation
The Signal is not in the water. It is in the listening. RULE-003 confirmed: no machine can carry it, which is why every device fails and why Adler's "no recording" rule exists.

## Choice
Mira can keep the only surviving evidence (Dan's paper log, which he will sell) or broadcast it live over the harbour radio so the whole coast becomes a witness — knowing RULE-002 will take a memory from her, and she will not get to choose which.

## Climax
She broadcasts. The harbour lights stutter in time with the pulse. Dan, listening, forgets the buyer's name mid-sentence and cannot remember why he is holding the log.

## Resolution
Adler arrives to shut the broadcast down. Mira is still employed, still not believed, and now missing three days she cannot account for. She keeps the log. The demolition proceeds.

## Series thread
Adler's demolition notice has two signatures; the second one is in her own handwriting, dated next year.
`
  }
]
