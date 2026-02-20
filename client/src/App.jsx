import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

export default function App() {
  const [level, setLevel] = useState("KS3");
  const [topic, setTopic] = useState("Python");
  const [mode, setMode] = useState("Explain");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "👋 Hi! I'm your AI Tutor.\n\nI can:\n• Explain topics step-by-step\n• Help you debug code\n• Give hints (not just answers)\n• Create practice questions\n\nWhat are you working on today?",
    },
  ]);
  const [loading, setLoading] = useState(false);

  const starterPrompts = useMemo(
    () => [
      { label: "Explain loops", text: "Explain loops in Python with an example." },
      { label: "Arrays", text: "What is an array? Explain for KS3 with an example." },
      { label: "Python errors", text: "I got a Python error: TypeError. What does it mean and how do I fix it?" },
      { label: "Quiz me", text: "Quiz me on variables (5 questions). Start easy then get harder." },
    ],
    []
  );

  function usePrompt(text) {
    setInput(text);
    // Optional: focus the input after clicking a prompt
    setTimeout(() => {
      const el = document.querySelector(".composer input");
      el?.focus();
    }, 0);
  }

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

  const rawText = await res.text(); // read as text first
  let data = null;

  try {
    data = JSON.parse(rawText);
  } catch {
    // not JSON
  }

  if (!res.ok) {
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content:
          `API error (${res.status}). ` +
          (data?.error ? `\n${data.error}` : rawText || "No response body."),
      },
    ]);
    return;
  }

  const reply =
    data?.reply ??
    data?.message ??
    data?.content ??
    data?.response ??
    (typeof data === "string" ? data : null);

  setMessages((m) => [
    ...m,
    { role: "assistant", content: reply || "I got a response but it had no reply field." },
  ]);
} catch (err) {
  setMessages((m) => [
    ...m,
    { role: "assistant", content: "Error calling tutor API. Check backend is running and /api/tutor exists." },
  ]);
} finally {
  setLoading(false);
}
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <h1>CodeQuest AI Tutor</h1>
          <p className="subtitle">
            Learn Computer Science with an AI tutor that explains step-by-step.
          </p>
        </div>

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

      {/* Starter prompts */}
      <div className="starters">
  <span className="startersLabel">Try:</span>
  {starterPrompts.map((p) => (
    <button
      key={p.label}
      type="button"
      onClick={() => {
        setInput(p.text);
        setTimeout(() => {
          const fakeEvent = { preventDefault: () => {} };
          sendMessage(fakeEvent);
        }, 0);
      }}
    >
      {p.label}
    </button>
  ))}
</div>

      {/* Main 2-column layout */}
      <div className="layout">
        <main className="chat">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="bubble">
  <ReactMarkdown>{m.content}</ReactMarkdown>
</div>

            </div>
          ))}

          {loading && (
            <div className="msg assistant">
              <div className="bubble">Thinking…</div>
            </div>
          )}
        </main>

        {/* Right-side panel */}
        <aside className="side">
          <h3>Quick actions</h3>

          <div className="actions">
            <button type="button" onClick={() => setMode("Explain")}>
              Explain
            </button>
            <button type="button" onClick={() => setMode("Hint")}>
              Hint
            </button>
            <button type="button" onClick={() => setMode("Quiz")}>
              Quiz
            </button>
            <button type="button" onClick={() => setMode("Mark")}>
              Mark
            </button>
          </div>

          <div className="tips">
            <h4>Tip</h4>
            <p>
              Paste your code and tell me what it should do vs what it does.
              I’ll guide you step-by-step.
            </p>
          </div>

          <div className="meta">
            <h4>Current settings</h4>
            <p>
              <strong>Level:</strong> {level}
              <br />
              <strong>Topic:</strong> {topic}
              <br />
              <strong>Mode:</strong> {mode}
            </p>
          </div>
        </aside>
      </div>

      {/* Composer */}
      <form className="composer" onSubmit={sendMessage}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a CS question…"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
  async function sendText(text) {
  const trimmed = text.trim();
  if (!trimmed || loading) return;

  setMessages((m) => [...m, { role: "user", content: trimmed }]);
  setInput("");
  setLoading(true);

  try {
    const res = await fetch("https://codequest-ai-tutor.onrender.com/api/chat") ;

    const rawText = await res.text();
    let data = null;
    try { data = JSON.parse(rawText); } catch {}

    if (!res.ok) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            `API error (${res.status}). ` +
            (data?.error ? `\n${data.error}` : rawText || "No response body."),
        },
      ]);
      return;
    }

    const reply =
      data?.reply ?? data?.message ?? data?.content ?? data?.response ??
      (typeof data === "string" ? data : null);

    setMessages((m) => [
      ...m,
      { role: "assistant", content: reply || "I got a response but it had no reply field." },
    ]);
  } catch {
    setMessages((m) => [
      ...m,
      { role: "assistant", content: "Error calling tutor API. Check backend is running and /api/tutor exists." },
    ]);
  } finally {
    setLoading(false);
  }
}
}
