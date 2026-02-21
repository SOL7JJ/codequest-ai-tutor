import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_URL || "https://codequest-ai-tutor.onrender.com";

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
  const chatRef = useRef(null);

  const starterPrompts = useMemo(
    () => [
      { label: "Explain loops", text: "Explain loops in Python with an example." },
      { label: "Arrays", text: "What is an array? Explain for KS3 with an example." },
      {
        label: "Python errors",
        text: "I got a Python error: TypeError. What does it mean and how do I fix it?",
      },
      {
        label: "Quiz me",
        text: "Quiz me on variables (5 questions). Start easy then get harder.",
      },
    ],
    []
  );

  async function sendMessage(e, forcedText) {
    if (e?.preventDefault) e.preventDefault();

    const text = (forcedText ?? input).trim();
    if (!text || loading) return;

    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    const setAssistantContent = (content) => {
      setMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        if (!last || last.role !== "assistant") return m;
        next[next.length - 1] = { ...last, content };
        return next;
      });
    };

    const fallbackToNonStream = async () => {
      const res = await fetch(`${API_BASE}/api/tutor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, level, topic, mode }),
      });

      const rawText = await res.text();
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        // not JSON
      }

      if (!res.ok) {
        throw new Error(data?.error || rawText || `API error (${res.status})`);
      }

      const reply =
        data?.reply ??
        data?.message ??
        data?.content ??
        data?.response ??
        (typeof data === "string" ? data : "");

      setAssistantContent(reply || "I got a response but it had no reply field.");
    };

    try {
      const res = await fetch(`${API_BASE}/api/tutor/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, level, topic, mode }),
      });

      if (!res.ok) {
        await fallbackToNonStream();
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response stream body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let streamedContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let delimiterIndex = buffer.indexOf("\n\n");

        while (delimiterIndex !== -1) {
          const eventBlock = buffer.slice(0, delimiterIndex);
          buffer = buffer.slice(delimiterIndex + 2);
          delimiterIndex = buffer.indexOf("\n\n");

          const dataLine = eventBlock
            .split("\n")
            .find((line) => line.startsWith("data: "));

          if (!dataLine) continue;

          let payload = null;
          try {
            payload = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }

          if (payload?.error) {
            throw new Error(payload.error);
          }

          if (typeof payload?.delta === "string" && payload.delta.length) {
            streamedContent += payload.delta;
            setAssistantContent(streamedContent);
          }
        }
      }

      if (!streamedContent.trim()) {
        setAssistantContent("I got a response but it had no reply text.");
      }
    } catch {
      try {
        await fallbackToNonStream();
      } catch {
        setMessages((m) => [
          ...m.slice(0, -1),
          {
            role: "assistant",
            content:
              "Error calling tutor API. Check backend is running, CORS is enabled, and the endpoint exists.",
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  const isFreshSession = messages.length === 1 && messages[0]?.role === "assistant";

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <h1>CodeQuest AI Tutor</h1>
          <p className="subtitle">
            Learn Computer Science with an AI tutor that explains step-by-step.
          </p>
          <div className="badges">
            <span className="badge">Adaptive tutor</span>
            <span className="badge">Session turns: {Math.max(messages.length - 1, 0)}</span>
          </div>
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
            onClick={() => sendMessage(null, p.text)}
            disabled={loading}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Main 2-column layout */}
      <div className="layout">
        <main className="chat" ref={chatRef}>
          {isFreshSession && (
            <div className="emptyState" aria-hidden="true">
              <div className="emptyOrb emptyOrbOne" />
              <div className="emptyOrb emptyOrbTwo" />
              <div className="emptyStateInner">
                <div className="emptyStateIcon">✦</div>
                <h3>Your learning session starts here</h3>
                <p>Pick a prompt or ask a question to get personalized guidance.</p>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="bubble">
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            </div>
          ))}

          {loading && (
            <div className="msg assistant">
              <div className="bubble typing" aria-live="polite" aria-label="Assistant is thinking">
                <span className="typingDot" />
                <span className="typingDot" />
                <span className="typingDot" />
              </div>
            </div>
          )}
        </main>

        {/* Right-side panel */}
        <aside className="side">
          <h3>Quick actions</h3>

          <div className="actions">
            <button
              type="button"
              onClick={() => setMode("Explain")}
              className={`modeBtn ${mode === "Explain" ? "active" : ""}`}
            >
              Explain
            </button>
            <button
              type="button"
              onClick={() => setMode("Hint")}
              className={`modeBtn ${mode === "Hint" ? "active" : ""}`}
            >
              Hint
            </button>
            <button
              type="button"
              onClick={() => setMode("Quiz")}
              className={`modeBtn ${mode === "Quiz" ? "active" : ""}`}
            >
              Quiz
            </button>
            <button
              type="button"
              onClick={() => setMode("Mark")}
              className={`modeBtn ${mode === "Mark" ? "active" : ""}`}
            >
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
        <button type="submit" disabled={loading} className="sendBtn">
          {loading ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
}
