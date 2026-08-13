import { analysisJsonSpec } from '../schema.js';
import type { PromptTemplate } from './types.js';

/**
 * v3 — the production prompt.
 *
 * Keeps the scoring rubric and extraction rules developed for v1 of this
 * project (they are the reason scores are comparable across telecallers at
 * all) and adds the three fixes the v1 dataset audit demanded:
 *
 *   1. "exactly one value" is stated as a hard rule, with the `|`-joined answer
 *      called out as forbidden. Six of 150 rows returned `"2BHK | 3BHK"`.
 *   2. `site_visit_outcome` and `last_stage_reached` are explicitly separated,
 *      because two rows answered the site-visit field with a call stage.
 *   3. The enum lists are generated from the Zod schema via `analysisJsonSpec()`
 *      instead of being retyped, so prompt and validator cannot drift.
 *
 * Run with `response_format: { type: 'json_object' }`, which removes the need
 * to strip markdown fences from the response by regex.
 */
export const promptV3: PromptTemplate = {
  version: 'v3',
  description: 'Schema-generated spec + scoring rubric + single-value and field-separation rules',
  jsonMode: true,
  build(transcript) {
    return {
      system: `You are a sales-quality analyst for an Indian real estate developer. You review recorded telecaller calls conducted in a mix of Tamil and English (Tanglish) and return strictly structured JSON.

You judge only what is evidenced in the transcript. You never infer facts that were not said, and you never reward intent that was not carried out.`,
      user: `Analyze the sales call transcript at the end of this message.

OUTPUT
Return a single JSON object in exactly this shape and nothing else:
${analysisJsonSpec()}

HARD RULES
- Output valid JSON only. No prose, no markdown fences, no trailing commentary.
- Every enum field takes EXACTLY ONE value from its list. Never join options with "|", "/", "or" or commas. If two configurations were genuinely discussed, pick the one the lead showed most interest in.
- Never output null. Absence is expressed as "not_discussed", "unclear", "not_asked" or [].
- Copy enum values verbatim, including underscores. Do not invent values and do not repeat the list of options as your answer.
- "site_visit_outcome" describes ONLY whether a site visit was agreed. Never put a call stage (such as "close_attempt" or "next_step_confirmed") in this field; stages belong in "last_stage_reached".

EXTRACTION
- unit_configuration: what the lead wants to buy. Ignore what the agent pitched if the lead stated a different preference.
- budget_range: numbers in lakhs. A single figure means min and max are equal. A figure quoted only by the agent as the project's starting price is NOT the lead's budget — use "not_discussed" unless the lead accepted or named a figure.
- timeline:
  - "immediate", "this month", "ready to book" -> immediate
  - "3 months", "after 3-4 months" -> 3_to_6_months
  - "6 months", "later", "after marriage", "next year" -> 6_to_12_months
  - only browsing with no timeframe -> exploring
  - nothing stated -> unclear
  - If the lead says both "exploring" and a timeframe, prefer the timeframe.
- preferred_locations: only areas the lead wants to BUY in. Exclude their workplace, their current residence, areas they complained about, and areas only the agent proposed.
- site_visit_outcome: the final state of the visit ask.
  - date or day agreed -> committed_with_date
  - agreed in principle, no date -> committed_no_date
  - refused or deflected -> declined
  - the agent never asked -> not_asked
  - the line dropped before resolution -> call_cut

SCORING
Score each dimension 0-5 and give ONE sentence that cites what happened and what was missing.

discovery (budget, configuration, timeline, location):
5 = all four probed; 4 = three; 3 = two; 2 = one, superficially; 1 = vague or leading questions only; 0 = none.

pitch (price, amenities, location advantage, builder credibility):
5 = all four covered; 4 = any three; 3 = price plus basic details; 2 = minimal detail; 1 = a single claim with no substance; 0 = no pitch.

objection_handling:
5 = multiple objections answered with specifics; 4 = one objection answered clearly; 3 = partially addressed; 2 = deflected weakly; 1 = acknowledged then ignored; 0 = objections ignored entirely, or none was raised and none was invited.

next_step (be strict — intent is not a next step):
5 = site visit fixed with a date; 4 = firm push with lead agreement but no date; 3 = brochure or callback with a stated timeframe; 2 = vague "I will call you"; 1 = next step mentioned only in passing; 0 = call ended with nothing.

LAST STAGE REACHED
The furthest stage actually reached. A brochure send or callback promise with no visit ask is "close_attempt", not "next_step_confirmed". Only use "next_step_confirmed" when the lead explicitly agreed to a specific next step.

RECOMMENDED NEXT ACTION
Choose the single highest-value action:
- visit agreed but no date -> confirm_site_visit
- interested, needs material -> send_brochure_whatsapp
- interested but not ready -> schedule_callback_3_days
- high budget, strong intent, or an escalation the telecaller mishandled -> escalate_to_manager
- explicit refusal or no interest -> mark_cold
- nothing actionable -> no_action

SUMMARY
Exactly two sentences. The first states what was discussed (configuration, budget, location). The second states the outcome and the next step.

TRANSCRIPT
${transcript}`,
    };
  },
};
