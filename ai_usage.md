# AI Usage

## LLM Provider & Model

- Final Provider: Groq  
- Model Used: `llama-3.1-8b-instant`  
- API: OpenAI-compatible Groq endpoint  

---

## Providers Tried

- Gemini (`gemini-1.5-flash-latest`) → deprecated (404 error)  
- Gemini (`gemini-2.0-flash`) → free tier quota exhausted  
- Groq (`llama3-70b-8192`) → decommissioned  
- Groq (`llama-3.1-8b-instant`) → final working model  

---

## LLM Usage

- Total transcripts: 150  
- LLM calls: ~150 (1 per transcript)  
- Extra calls: small number due to retries  
- Cost: stayed within free tier  

Each call returns:
- extraction fields  
- quality scores  
- last stage  
- recommended action  
- summary  

---

## AI Coding Tools Used

- ChatGPT (primary)

Estimated usage:
- ~60–70% AI-assisted  
- ~30–40% manual coding  

Used AI for:
- designing prompt  
- fixing API errors (rate limits, model issues)  
- implementing retry + caching  
- backend setup (Express)  
- debugging issues  

---

## Prompt Iteration

Prompt went through multiple iterations:

1. Initial → wrong output format  
2. Added JSON schema → better but inconsistent  
3. Final → strict rules + scoring rubric + edge cases  

Main improvements:
- removed null values  
- fixed timeline classification  
- improved scoring consistency  
- handled Tamil-English mix  

---

## AI Suggestions Rejected

### 1. Multiple LLM Calls per Transcript
Suggested splitting extraction and scoring into separate calls.

- Rejected because it increases latency and cost  
- Single call was sufficient and simpler  

---

### 2. Using MongoDB
Suggested storing data in MongoDB.

- Rejected because JSON file was enough for 150 calls  
- Avoided extra setup and deployment complexity  

---

### 3. Using Streamlit for UI
Suggested quick UI using Streamlit.

- Rejected because React gives better control and looks more production-ready  

---

## Notes

- Added retry + timeout to handle API instability  
- Implemented caching to avoid repeated LLM calls  
- Some API failures still occur occasionally, handled gracefully  