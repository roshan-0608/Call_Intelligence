import { useEffect, useState } from "react";
import axios from "axios";

const API_URL = "https://call-intelligence-backend-p4p5.onrender.com";

function App() {
  const [calls, setCalls] = useState([]);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [selectedCall, setSelectedCall] = useState(null);
  const [newTranscript, setNewTranscript] = useState("");
  const [showFormat, setShowFormat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");


  useEffect(() => {
    let timeoutId;

    // Show a message if backend is taking time
    timeoutId = setTimeout(() => {
      setMessage(
        "Backend is starting (Render free tier). Please wait 30–60 seconds..."
      );
    }, 10000); // after 10 seconds

    const fetchCalls = async () => {
      try {
        // Wake up backend first
        await axios.get(`${API_URL}/health`);

        // Fetch calls
        const res = await axios.get(`${API_URL}/calls`, {
          timeout: 90000, // wait up to 90 seconds
        });

        setCalls(res.data);
      } catch (err) {
        console.error(err);

        setError(
          "Unable to connect to the backend. It may be starting up. Please refresh after a few seconds."
        );
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    };

    fetchCalls();

    return () => clearTimeout(timeoutId);
  }, []);

  const handleUpload = async () => {
    try {
      const res = await axios.post(`${API_URL}/upload`, {
        transcript: newTranscript
      });

      // add new call at top
      setCalls(prev => [res.data, ...prev]);

      // clear input
      setNewTranscript("");

    } catch (err) {
      console.log("Upload error:", err);
    }
  };

  // Filter logic
  const filteredCalls = calls.filter((c) => {
    const matchesSearch =
      c.lead_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.telecaller_name?.toLowerCase().includes(search.toLowerCase());

    const matchesStage = stage
      ? c.last_stage_reached === stage
      : true;

    return matchesSearch && matchesStage;
  });

  const leaderboard = Object.values(
    calls.reduce((acc, call) => {
      const name = call.telecaller_name || "Unknown";

      const score =
        ((call.quality_scores?.discovery?.score || 0) +
          (call.quality_scores?.pitch?.score || 0) +
          (call.quality_scores?.objection_handling?.score || 0) +
          (call.quality_scores?.next_step?.score || 0)) / 4;

      if (!acc[name]) {
        acc[name] = {
          name,
          totalScore: 0,
          count: 0
        };
      }

      acc[name].totalScore += score;
      acc[name].count += 1;

      return acc;
    }, {})
  ).map((t) => ({
    name: t.name,
    avgScore: (t.totalScore / t.count).toFixed(2)
  }))
    .sort((a, b) => b.avgScore - a.avgScore);

  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          fontFamily: "Arial",
        }}
      >
        <h2>Loading Dashboard...</h2>

        <p>
          Backend is starting (Render free tier).
          <br />
          First visit may take up to 60 seconds.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          fontFamily: "Arial",
        }}
      >
        <h2>⚠ Unable to connect to the backend</h2>

        <p>{error}</p>

        <button onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Call Intelligence Dashboard</h1>

      {/* Search + Filter */}
      <div style={{ marginBottom: 20 }}>
        <input
          type="text"
          placeholder="Search by lead or telecaller"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: 8, marginRight: 10 }}
        />

        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          style={{ padding: 8 }}
        >
          <option value="">All Stages</option>
          <option value="greeting">Greeting</option>
          <option value="discovery">Discovery</option>
          <option value="pitch">Pitch</option>
          <option value="objection_handling">Objection</option>
          <option value="close_attempt">Close Attempt</option>
          <option value="next_step_confirmed">Next Step</option>
        </select>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3>Upload New Call</h3>

          <span
            onClick={() => setShowFormat(true)}
            style={{
              fontSize: 12,
              color: "blue",
              cursor: "pointer",
              textDecoration: "underline"
            }}
          >
            Format
          </span>
        </div>

        <textarea
          rows="6"
          style={{ width: "100%", padding: 10 }}
          placeholder="[00:00-00:05] Agent: Hello..."
          value={newTranscript}
          onChange={(e) => setNewTranscript(e.target.value)}
        />

        <button
          onClick={handleUpload}
          style={{ marginTop: 10, padding: 10 }}
        >
          Process Call
        </button>
      </div>

      <div style={{ marginBottom: 30 }}>
        <h2>🏆 Telecaller Leaderboard</h2>

        {leaderboard.map((t, index) => (
          <div key={index} style={{
            padding: 8,
            borderBottom: "1px solid #ccc"
          }}>
            <b>#{index + 1}</b> {t.name} — ⭐ {t.avgScore}
          </div>
        ))}
      </div>

      {/* 📊 Data */}
      {filteredCalls.length === 0 ? (
        <p>No calls found</p>
      ) : (
        filteredCalls.map((c, index) => {

          const avgScore = (
            (c.quality_scores?.discovery?.score || 0) +
            (c.quality_scores?.pitch?.score || 0) +
            (c.quality_scores?.objection_handling?.score || 0) +
            (c.quality_scores?.next_step?.score || 0)
          ) / 4;

          return (
            <div
              key={index}
              onClick={() => setSelectedCall(selectedCall?.call_id === c.call_id ? null : c)}
              style={{
                border: selectedCall === c ? "2px solid blue" : "1px solid black",
                padding: 12,
                marginBottom: 10,
                cursor: "pointer"
              }}
            >
              <p><b>Telecaller:</b> {c.telecaller_name}</p>
              <p><b>Lead:</b> {c.lead_name}</p>

              <p><b>Date:</b> {c.timestamp}</p>
              <p><b>Duration:</b> {c.duration_sec} sec</p>

              <p><b>Overall Score:</b> {avgScore.toFixed(1)}</p>

              <p><b>Site Visit:</b> {c.extraction?.site_visit_outcome}</p>

              <p><b>Stage:</b> {c.last_stage_reached}</p>

              <p><b>Recommended Action:</b> {c.recommended_next_action}</p>

              {selectedCall?.call_id === c.call_id && (
                <div style={{
                  marginTop: 30,
                  padding: 20,
                  border: "2px solid blue"
                }}>
                  <h2>Call Details</h2>

                  <p><b>Telecaller:</b> {selectedCall.telecaller_name}</p>
                  <p><b>Lead:</b> {selectedCall.lead_name}</p>

                  <p><b>Stage:</b> {selectedCall.last_stage_reached}</p>
                  <p><b>Next Action:</b> {selectedCall.recommended_next_action}</p>

                  <h3>Summary</h3>
                  <p>{selectedCall.summary}</p>

                  <h3>Transcript</h3>
                  <pre style={{ background: "#f4f4f4", padding: 10, whiteSpace: "pre-wrap" }}>
                    {selectedCall.transcript}
                  </pre>

                  <h3>Extraction</h3>
                  <p><b>Unit:</b> {selectedCall.extraction?.unit_configuration}</p>
                  <p><b>Budget:</b> {selectedCall.extraction?.budget_range?.min_lakhs} - {selectedCall.extraction?.budget_range?.max_lakhs}</p>
                  <p><b>Timeline:</b> {selectedCall.extraction?.timeline}</p>
                  <p><b>Site Visit:</b> {selectedCall.extraction?.site_visit_outcome}</p>

                  <h3>Quality Scores</h3>

                  <p>
                    <b>Discovery:</b> {selectedCall.quality_scores?.discovery?.score}
                    <br />
                    {selectedCall.quality_scores?.discovery?.reason}
                  </p>

                  <p>
                    <b>Pitch:</b> {selectedCall.quality_scores?.pitch?.score}
                    <br />
                    {selectedCall.quality_scores?.pitch?.reason}
                  </p>

                  <p>
                    <b>Objection Handling:</b> {selectedCall.quality_scores?.objection_handling?.score}
                    <br />
                    {selectedCall.quality_scores?.objection_handling?.reason}
                  </p>

                  <p>
                    <b>Next Step:</b> {selectedCall.quality_scores?.next_step?.score}
                    <br />
                    {selectedCall.quality_scores?.next_step?.reason}
                  </p>
                </div>
              )}
            </div>
          );
        })
      )}
      {showFormat && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        }}>
          <div style={{
            background: "white",
            padding: 20,
            width: "500px",
            borderRadius: 8
          }}>
            <h3>Input Format</h3>

            <pre style={{
              background: "#f4f4f4",
              padding: 10,
              whiteSpace: "pre-wrap"
            }}>
              {`[00:00-00:05] Agent: Hello sir, Suresh here from Skyline Properties
      [00:05-00:12] Lead: haan sollunga, ena vishayam?
      [00:12-00:25] Agent: Sir, naanga Velachery-la oru puthusa 3BHK launch pannirukom...`}
            </pre>

            <button
              onClick={() => setShowFormat(false)}
              style={{ marginTop: 10 }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;