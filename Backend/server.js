import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import fs from "fs";
import { processTranscript } from "./pipeline.js";

console.log("Starting server...");

const app = express();
const cache = new Map();

app.use(cors());
app.use(express.json());

let data = [];
try {
  data = JSON.parse(fs.readFileSync("./processed_calls.json", "utf-8"));
} catch {
  data = [];
}

app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

app.get("/health", (req, res) => {
  res.json({
    status: "Backend Running",
    uptime: process.uptime(),
  });
});

app.get("/calls", (req, res) => {
  res.json(data);
});

app.get("/calls/:id", (req, res) => {
  const call = data.find(c => c.call_id === req.params.id);

  if (!call) return res.status(404).send("Not found");

  res.json(call);
});

app.post("/upload", async (req, res) => {
  try {
    const transcript =
      req.body.transcript ||
      req.body.text ||
      req.body.content ||
      req.body.call_transcript;


    if (!transcript || transcript.trim().length === 0) {
      return res.status(400).json({
        error: "Transcript is required"
      });
    }


    const key = transcript
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();


    if (cache.has(key)) {
      console.log("⚡ Cache hit");

      return res.json(cache.get(key));
    }

    console.log("🤖 Calling AI...");

    const aiResult = await processTranscript(transcript);

    if (!aiResult) {
      console.log("❌ AI returned null");
      return res.status(500).json({
        error: "AI processing failed"
      });
    }

    const newCall = {
      call_id: "UPLOAD_" + Date.now(),
      telecaller_name: "Unknown",
      lead_name: "Unknown",
      timestamp: new Date().toISOString(),
      duration_sec: 0,
      transcript: transcript,

      extraction: aiResult.extraction,
      quality_scores: aiResult.quality_scores,
      last_stage_reached: aiResult.last_stage_reached,
      recommended_next_action: aiResult.recommended_next_action,
      summary: aiResult.summary
    };

    cache.set(key, newCall);

    res.json(newCall);

  } catch (error) {
    console.error("❌ Upload error:", error);
    res.status(500).json({
      error: "Processing failed"
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});