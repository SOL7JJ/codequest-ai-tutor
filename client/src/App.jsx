import { useState } from "react";
import "./App.css";

export default function App() {
  const [level, setLevel] = useState("KS3");
  const [topic, setTopic] = useState("Python");
  const [mode, setMode] = useState("Explain");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! Tell me what you're stuck on and I’ll help." },
  ]);
  const [loading, setLoading] = useState(false);

  async function sendMessage(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, level, topic, mode }),
      });

      const data = await res.json();
      console.log("API response:", data);
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? "No reply." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Error calling tutor API." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap">
      <header className="top">
        <h1>CodeQuest AI Tutor</h1>
        <div className="controls">
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option>KS3</option>
            <option>GCSE</option>
            <option>A-Level</option>
          </select>
          <select value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option>Python</option>
            <option>Algorithms</option>
            <option>Data Representation</option>
            <option>OOP</option>
            <option>SQL</option>
            <option>Networks</option>
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option>Explain</option>
            <option>Hint</option>
            <option>Quiz</option>
            <option>Mark</option>
          </select>
        </div>
      </header>

      <main className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="msg assistant">
            <div className="bubble">Thinking…</div>
          </div>
        )}
      </main>

      <form className="composer" onSubmit={sendMessage}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a CS question…"
        />
        <button type="submit" disabled={loading}>
          Send
        </button>
      </form>
    </div>
  );
}
