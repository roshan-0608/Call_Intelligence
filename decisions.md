# Decisions

## 1. Single LLM Call per Transcript

**Decision:**  
Use one LLM call to return all outputs (extraction, scoring, stage, action, summary).

**Alternatives:**  
- Multiple calls (separate for extraction, scoring, etc.)

**Why this:**  
- Lower latency  
- Cheaper (fewer tokens)  
- Simpler pipeline  

**What I’d change:**  
Test multi-step pipelines for accuracy improvements.

---

## 2. Choice of Groq API

**Decision:**  
Use Groq with `llama-3.1-8b-instant`.

**Alternatives:**  
- Gemini (tried but failed due to quota/model issues)  
- OpenAI (not used due to cost)

**Why this:**  
- Free tier available  
- Fast inference  
- Easy integration  

**What I’d change:**  
Try larger models (like 70B) for better accuracy.

---

## 3. JSON File Instead of Database

**Decision:**  
Store data in `processed_calls.json`.

**Alternatives:**  
- MongoDB  
- SQL  

**Why this:**  
- Simpler setup  
- Enough for 150 calls  
- Faster development  

**What I’d change:**  
Use MongoDB for scalability and persistence.

---

## 4. In-Memory Caching (Stretch Goal)

**Decision:**  
Use a `Map()` to cache results for repeated transcripts.

**Alternatives:**  
- No caching  
- Redis  

**Why this:**  
- Avoid repeated LLM calls  
- Faster response  
- Reduces API usage  

**What I’d change:**  
Use Redis so cache persists across server restarts.

---

## 5. Keeping Full Transcript (No Hard Trimming)

**Decision:**  
Send full transcript to LLM instead of cutting it.

**Alternatives:**  
- Trimming transcript  
- Sending partial content  

**Why this:**  
- Important info (objections, closing) is often at the end  
- Trimming reduces accuracy  

**Tradeoff:**  
- Larger payload → occasional API errors  

**What I’d change:**  
Implement smarter chunking or summarization for long inputs.

---

## Final Note

The goal was to balance:
- accuracy  
- simplicity  
- performance  

while handling real issues like API limits and failures.