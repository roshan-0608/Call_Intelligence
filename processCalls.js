import fs from "fs";
import readline from "readline";
import { processTranscript } from "./pipeline.js";

const inputFile = "./calls.jsonl";
const outputFile = "./processed_calls.json";

async function callWithRetry(transcript, maxRetries = 3) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const result = await processTranscript(transcript);

      if (result) return result;

      throw new Error("Empty result");

    } catch (error) {
      attempt++;

      console.log(`⚠️ Attempt ${attempt} failed`);

      if (attempt >= maxRetries) {
        console.log("❌ Max retries reached. Skipping...");
        return null;
      }

      // wait before retry (increase delay each time)
      const delay = 9000 * attempt; // 5s, 10s, 15s
      console.log(`⏳ Retrying in ${delay / 1000}s...`);

      await new Promise(res => setTimeout(res, delay));
    }
  }
}

// create read stream
const rl = readline.createInterface({
  input: fs.createReadStream(inputFile),
  crlfDelay: Infinity
});

const results = [];

async function processAllCalls() {
  let count = 0;

for await (const line of rl) {
  if (!line.trim()) continue;

  try {
    const data = JSON.parse(line);

    console.log(`Processing ${data.call_id}...`);

    // ✅ use retry
    const aiResult = await callWithRetry(data.transcript);

    if (!aiResult) {
      console.log("⛔ Skipping this call due to repeated failure");
      continue;
    }

    const finalResult = {
      call_id: data.call_id,
      telecaller_name: data.telecaller_name,
      lead_name: data.lead_name,
      timestamp: data.timestamp,
      duration_sec: data.duration_sec,
      transcript: data.transcript,

      extraction: aiResult.extraction,
      quality_scores: aiResult.quality_scores,
      last_stage_reached: aiResult.last_stage_reached,
      recommended_next_action: aiResult.recommended_next_action,
      summary: aiResult.summary
    };

    results.push(finalResult);

    count++;

    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

    if (count % 5 === 0) {
    console.log("⏸ Cooling down for 30 seconds...");
    await new Promise(res => setTimeout(res, 30000));
    }

    const delay = 14000 + Math.random() * 6000;
    await new Promise(resolve => setTimeout(resolve, delay));

  } catch (err) {
    console.log("❌ Error processing line:", err.message);
  }
}

  // final save
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

  console.log("✅ All calls processed successfully!");
}

processAllCalls();