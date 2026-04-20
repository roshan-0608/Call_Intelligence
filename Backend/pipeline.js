
import axios from "axios";

// 🔑 Put your Groq API key here
const API_KEY = process.env.GROQ_API_KEY;

export async function processTranscript(transcript) {
  try {
    const prompt = `
You are an AI analyzing Tamil-English real estate sales calls. Extract structured data and evaluate performance strictly in JSON.

OUTPUT (STRICT JSON ONLY):
{
  "extraction": {
    "unit_configuration": "2BHK | 3BHK | 4BHK | villa | plot | not_discussed",
    "budget_range": {"min_lakhs": number, "max_lakhs": number} OR "not_discussed",
    "timeline": "immediate | 3_to_6_months | 6_to_12_months | exploring | unclear",
    "preferred_locations": [],
    "site_visit_outcome": "committed_with_date | committed_no_date | declined | not_asked | call_cut"
  },
  "quality_scores": {
    "discovery": {"score": 0-5, "reason": ""},
    "pitch": {"score": 0-5, "reason": ""},
    "objection_handling": {"score": 0-5, "reason": ""},
    "next_step": {"score": 0-5, "reason": ""}
  },
  "last_stage_reached": "greeting | discovery | pitch | objection_handling | close_attempt | next_step_confirmed",
  "recommended_next_action": "schedule_callback_3_days | confirm_site_visit | escalate_to_manager | send_brochure_whatsapp | mark_cold | no_action",
  "summary": ""
}

RULES:
- Return ONLY valid JSON. No explanation.
- No null values. Use: "not_discussed", [], "unclear".
- Use only allowed enum values.
- Do not assume missing info.

EXTRACTION:
- unit_configuration: extract from discussion.
- budget_range: if single value → same min & max; else "not_discussed".
- timeline:
  • "6 months", "later", "after marriage" → "6_to_12_months"
  • only "exploring" → "exploring"
  • if both → prefer time-based
- preferred_locations:
  • include only buying preference
  • exclude work location, complaints, agent suggestions
- site_visit_outcome: final state; else "not_asked"

SCORING:
- Score 0–5 with ONE sentence reason referencing transcript and missing aspects.

Discovery:
5=all asked, 4=3 asked, 3=2 asked, 2=1 superficial, 1=vague, 0=none

Pitch:
5=price+amenities+location+credibility
4=any 3
3=price+basic details
2=minimal, 1=weak, 0=none

Objection:
5=multiple strong, 4=clear one, 3=partial, 2=weak, 1=ignored, 0=none

Next Step:
5=visit fixed, 4=strong push, 3=brochure/callback, 2=weak, 1=vague, 0=none

LAST STAGE:
greeting | discovery | pitch | objection_handling | close_attempt | next_step_confirmed  
If only brochure/callback → "close_attempt"

NEXT ACTION:
schedule_callback_3_days | confirm_site_visit | escalate_to_manager | send_brochure_whatsapp | mark_cold | no_action

SUMMARY:
- Exactly 2 sentences
- 1: discussion (unit, price, context)
- 2: outcome + next step

REFERENCE:
- exploring + time → use time
- brochure/callback → send_brochure_whatsapp
- no visit discussion → not_asked
- avoid over-scoring
${transcript}
`;

    let response;

  for (let i = 0; i < 2; i++) {
    try {
      console.log("🤖 Calling Groq API... Attempt:", i + 1);

      response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.2
        },
        {
          headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 30000 // ✅ STEP 3 (timeout)
        }
     );

      break; // ✅ success → exit loop

    } catch (err) {
      console.log("⚠️ Attempt failed:", err.code || err.message);

      if (i === 1) {
        console.log("❌ All retries failed");
        return null;
      }

      console.log("⏳ Retrying in 3s...");
      await new Promise(res => setTimeout(res, 3000));
    }
  }

    let text = response.data.choices[0].message.content;

    // 🧹 Clean markdown if present
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    try {
      return JSON.parse(text); // ✅ return JSON object
    } catch (err) {
      console.log("❌ JSON PARSE ERROR:");
      console.log(text);
      return null;
    }

  } catch (err) {
    console.log("❌ GROQ ERROR FULL:", JSON.stringify(err.response?.data || err, null, 2));


    if (err.response) {
      console.log(err.response.data);
    } else {
      console.log(err.message);
    }

    return null;
  }
}