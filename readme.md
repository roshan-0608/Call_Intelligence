# Call Intelligence Dashboard

This project analyzes real estate sales call transcripts and converts them into structured insights using an AI pipeline. It also provides a dashboard for managers to view and evaluate calls.

---

## Live Project

Frontend: https://callintelligence-orcin.vercel.app/ 
Backend: https://call-intelligence-backend-p4p5.onrender.com/

---

## Features

### AI Pipeline

Each transcript is processed using a language model to generate:

- Structured extraction:
  - unit configuration
  - budget range
  - timeline
  - preferred locations
  - site visit outcome

- Quality scores (0–5):
  - discovery
  - pitch
  - objection handling
  - next step

- Last stage reached  
- Recommended next action  
- 2-sentence summary  

All outputs are generated in a single LLM call.

---

### Manager Dashboard

#### List View
- Displays all 150 calls
- Shows:
  - telecaller name
  - lead name
  - date
  - duration
  - overall score
  - site visit outcome
  - last stage
  - recommended action

#### Features
- Search by lead or telecaller
- Filter by stage
- Click a call to expand details

---

### Detail View

When a call is selected:

- Full transcript with timestamps
- Extracted fields
- All quality scores with reasons
- Last stage reached
- Recommended next action
- Summary

---

### Upload Feature

Users can paste a new transcript in this format:


[00:00-00:05] Agent: Hello sir...
[00:05-00:12] Lead: ...


The system:
- processes it using the AI pipeline
- displays results
- adds it to the dashboard

---

## Stretch Goals Implemented

### Telecaller Leaderboard
- Calculates average score per telecaller
- Ranks from best to worst performer

### Caching and Idempotency
- Same transcript is not processed again
- Uses in-memory cache
- Reduces API calls and improves speed

---

## Tech Stack

Frontend:
- React
- Axios

Backend:
- Node.js
- Express

AI:
- Groq API
- Model: llama-3.1-8b-instant

---

## How It Works

1. Transcript is sent to backend  
2. Backend sends request to LLM  
3. LLM returns structured JSON  
4. Backend processes response  
5. Frontend displays results  

Caching avoids repeated LLM calls for the same transcript.

---

## Setup Instructions

### Clone Repository


git clone https://github.com/roshan-0608/Call_Intelligence.git

cd Call_Intelligence


---

### Backend Setup


cd Backend
npm install


Create `.env` file:


GROQ_API_KEY=your_api_key


Run backend:


npm start


---

### Frontend Setup


cd frontend
npm install
npm start


---

## Deployment

- Backend deployed on Render  
- Frontend deployed on Vercel  

Frontend is configured to use deployed backend URL.

---

## Limitations

- LLM responses may vary slightly  
- Occasional API failures (handled using retry and timeout)  
- Cache resets on server restart  
- No database (uses JSON file)

---

## Notes

The main goal of this project was to build a working system that handles real-world issues like API limits while keeping the implementation simple. The UI is basic but designed for usability.

---

## Author

Built as part of an assignment on AI-based call analysis.