// =============================================================================
//  Stage prompts (pure). Each stage's automation is ONE prompt template that
//  receives the run's context artifacts. Keeping them here — instead of inline
//  strings in the page — is what lets a second profile reuse or override a
//  prompt without touching the engine.
//
//  The instructions mirror the SOP's agent briefs (§5): answer with the
//  artifact only, cite canon ids, never invent canon, never claim legal
//  originality.
// =============================================================================

export interface ProcessPrompt {
  system: string
  user: string
}

export interface PromptContext {
  runId: string
  title: string
  /** Artifact name → its text content. */
  artifacts: Record<string, string>
}

const BASE_SYSTEM = [
  'You are a production assistant for an ORIGINAL series. You only work from the material provided in this message: there is no other canon.',
  'Rules:',
  '- Never invent canon facts, character states, world rules or previous events. If data is missing or contradicts, say BLOCKED and name what you need.',
  '- Never state or imply that the output is legally clear of copyright; that is a human review decision.',
  '- Do not copy dialogue, scenes, characters or signature elements from existing works.',
  '- Output ONLY the requested artifact in Markdown, with no preamble, apology or closing note.',
  '- Write in English unless the episode brief explicitly asks for another language.'
].join('\n')

function contextBlock(context: PromptContext): string {
  const parts = Object.entries(context.artifacts)
    .filter(([, value]) => String(value || '').trim())
    .map(([name, value]) => `<<< ${name} >>>\n${value.trim().slice(0, 12_000)}\n<<< /${name} >>>`)
  return parts.length > 0 ? parts.join('\n\n') : '(no artifacts provided)'
}

export function buildStagePrompt(promptId: string, context: PromptContext): ProcessPrompt {
  const header = `Episode ${context.runId} — ${context.title}`
  const body = contextBlock(context)

  switch (promptId) {
    case 'continuity':
      return {
        system: BASE_SYSTEM,
        user: `${header}

Read the episode brief and produce a structured continuity brief as JSON with this exact shape:
{
  "characters": [{ "id": "", "state": "", "knows": [], "hides": [], "wants": "" }],
  "timeline": { "after_previous": "", "elapsed": "" },
  "locations": [{ "id": "", "who_is_there": "", "items": [] }],
  "clues": [{ "id": "", "status": "open|resolved", "note": "" }],
  "open_promises": [],
  "used_set_pieces": [],
  "conflicts": [{ "severity": "CRITICAL|MAJOR|MINOR", "note": "", "source": "" }],
  "blocked": false
}
Only include facts supported by the provided material. Put anything unknown into "conflicts" instead of inventing it.

${body}`
      }

    case 'ideas':
      return {
        system: BASE_SYSTEM,
        user: `${header}

Propose 5 short episode ideas (one section each) with EXACTLY these fields:
logline, central_question, protagonist_goal, opposition, inciting_incident, irreversible_choice, unique_set_piece, character_change, continuity_payoff, new_clue_ids, risks.
Each idea must differ in goal, escalation and consequence — not just names, locations or costumes. End with a table comparing the ideas.

${body}`
      }

    case 'novelty':
      return {
        system: BASE_SYSTEM,
        user: `${header}

You are an internal duplicate-check editor. The series has no produced episodes yet unless the context contains an episode ledger.
Compare the candidate ideas against: previous ideas in this run, the series bible (if provided) and anything present in the context.
Score each candidate 0–5 on these criteria and compute Novelty = Σ(score/5 × weight):
goals_motives 15%, event_chain 20%, clues_twists 15%, choices_consequences 15%, set_pieces 15%, character_change 10%, new_value 10%.
Output a Markdown report per candidate with: the score table, the nearest comparable material, concrete overlap risks, what to change, and a verdict of PASS (>=80) / REVISE (65–79) / REJECT (<65) / HUMAN REVIEW.
Never claim the result proves originality or non-infringement.

${body}`
      }

    case 'outline':
      return {
        system: BASE_SYSTEM,
        user: `${header}

Write the chosen episode outline using the approved idea. Use these beats, and skip a beat only when the story genuinely does not need it:
Hook, Setup, Inciting incident, Escalation (at least two different complications), Revelation, Choice, Climax, Resolution, Series thread.
For every beat state: what the audience learns, the character state before/after, and any clue added or resolved.

${body}`
      }

    case 'script':
      return {
        system: BASE_SYSTEM,
        user: `${header}

Write the episode script from the approved outline. Format:
## <scene_id> — <location> — <time>
Purpose: …
Characters present: …
Action (visible/audible only): …
Dialogue (natural English, no exposition dumps): …
Audience learns: …
Character state before → after: …
Clues added/resolved: …
Keep it filmable and consistent with the continuity brief. Use scene ids like ${context.runId}_SC01.

${body}`
      }

    case 'shots':
      return {
        system: BASE_SYSTEM,
        user: `${header}

Convert the script into a shot list as JSON:
{
  "shots": [{
    "shot_id": "S01E001_SH010",
    "scene_id": "S01E001_SC01",
    "purpose": "",
    "shot_size": "wide|medium|close|extreme-close",
    "camera_move": "",
    "characters": [{ "id": "", "expression": "", "action": "" }],
    "setting": "",
    "lighting": "",
    "costume_items": [],
    "prompt": "",
    "reference_asset_ids": [],
    "audio": "",
    "dialogue": "",
    "duration_sec": 4,
    "priority": "high|normal|low",
    "acceptance": ""
  }]
}
One shot per distinct camera setup. Keep durations filmable and the sum close to a normal episode length only if the script supports it.

${body}`
      }

    default:
      return {
        system: BASE_SYSTEM,
        user: `${header}\n\n${body}`
      }
  }
}

/** Deterministic JSON cleanup for `expectsJson` stages (fenced blocks etc.). */
export function extractJson(raw: string): { ok: true, value: unknown, text: string } | { ok: false, error: string } {
  const text = String(raw || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1]! : text).trim()
  try {
    const value = JSON.parse(candidate)
    return { ok: true, value, text: JSON.stringify(value, null, 2) }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message || err) }
  }
}
