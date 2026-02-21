import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_URL || "https://codequest-ai-tutor.onrender.com";

const TOKEN_KEY = "codequest_auth_token";

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

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

  const getToken = useCallback(() => localStorage.getItem(TOKEN_KEY) || "", []);

  const fetchJson = useCallback(async (path, options = {}) => {
    const token = getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    const rawText = await res.text();
    let data = null;

    try {
      data = JSON.parse(rawText);
    } catch {
      // noop
    }

    return { res, data, rawText };
  }, [getToken]);

  async function handleEmailAuth(e) {
    if (e?.preventDefault) e.preventDefault();

    setAuthLoading(true);
    setAuthError("");

    try {
      const endpoint = authMode === "signup" ? "/api/auth/register" : "/api/auth/login";
      const { res, data, rawText } = await fetchJson(endpoint, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!res.ok) {
        throw new Error(data?.error || rawText || `Auth failed (${res.status})`);
      }

      if (!data?.token || !data?.user) {
        throw new Error("Invalid auth response from server");
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      setPassword("");
      setAuthError("");
    } catch (err) {
      setAuthError(err?.message || "Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setMessages([
      {
        role: "assistant",
        content:
          "👋 Hi! I'm your AI Tutor.\n\nI can:\n• Explain topics step-by-step\n• Help you debug code\n• Give hints (not just answers)\n• Create practice questions\n\nWhat are you working on today?",
      },
    ]);
  }

  async function sendMessage(e, forcedText) {
    if (e?.preventDefault) e.preventDefault();

    const text = (forcedText ?? input).trim();
    if (!text || loading) return;

    if (!getToken()) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Please log in again to continue." },
      ]);
      setUser(null);
      return;
    }

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
      const { res, data, rawText } = await fetchJson("/api/tutor", {
        method: "POST",
        body: JSON.stringify({ message: text, level, topic, mode }),
      });

      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        throw new Error("Session expired. Please log in again.");
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
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/tutor/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text, level, topic, mode }),
      });

      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        throw new Error("Session expired. Please log in again.");
      }

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
      } catch (err) {
        setMessages((m) => [
          ...m.slice(0, -1),
          {
            role: "assistant",
            content:
              err?.message ||
              "Error calling tutor API. Check backend is running, CORS is enabled, and the endpoint exists.",
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      const token = getToken();
      if (!token) {
        if (mounted) setAuthChecking(false);
        return;
      }

      try {
        const { res, data } = await fetchJson("/api/auth/me", { method: "GET" });
        if (!res.ok || !data?.user) {
          localStorage.removeItem(TOKEN_KEY);
          if (mounted) setUser(null);
        } else if (mounted) {
          setUser(data.user);
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        if (mounted) setUser(null);
      } finally {
        if (mounted) setAuthChecking(false);
      }
    }

    restoreSession();

    return () => {
      mounted = false;
    };
  }, [fetchJson, getToken]);

  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  const isFreshSession = messages.length === 1 && messages[0]?.role === "assistant";

  if (authChecking) {
    return (
      <div className="authShell">
        <section className="authCard authLoadingCard">
          <h1>CodeQuest AI Tutor</h1>
          <p>Preparing your learning workspace...</p>
        </section>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="authShell">
        <main className="landing">
          <header className="landingTop">
            <div className="landingBrand">
              <span className="landingLogo">CQ</span>
              <span>CodeQuest AI Tutor</span>
            </div>
            <span className="landingTag">Built for KS3 · GCSE · A-Level</span>
          </header>

          <section className="landingHero">
            <div className="landingCopy">
              <p className="heroKicker">AI-Powered Learning Platform</p>
              <h1>Master Computer Science with structured, exam-ready coaching</h1>
              <p className="heroText">
                Get instant explanations, adaptive hints, targeted quizzes, and clear mark-scheme
                feedback in one focused workspace.
              </p>

              <div className="heroStats">
                <article>
                  <strong>4</strong>
                  <span>Learning modes</span>
                </article>
                <article>
                  <strong>24/7</strong>
                  <span>On-demand support</span>
                </article>
                <article>
                  <strong>Step-by-step</strong>
                  <span>Exam-style guidance</span>
                </article>
              </div>

              <div className="trustStrip">
                <span>Explain</span>
                <span>Hint</span>
                <span>Quiz</span>
                <span>Mark</span>
              </div>

              <div className="heroPanels">
                <article>
                  <h3>Adaptive tutoring</h3>
                  <p>Responses are tailored by level, topic, and your current learning mode.</p>
                </article>
                <article>
                  <h3>Exam confidence</h3>
                  <p>Practice with progressively harder tasks and focused improvement feedback.</p>
                </article>
              </div>
            </div>

            <section className="authCard">
              <h2>Start your learning session</h2>
              <p>Login or create an account to access your personalized tutor.</p>

              <div className="authModeRow">
                <button
                  type="button"
                  className={`modeBtn ${authMode === "login" ? "active" : ""}`}
                  onClick={() => setAuthMode("login")}
                >
                  Login
                </button>
                <button
                  type="button"
                  className={`modeBtn ${authMode === "signup" ? "active" : ""}`}
                  onClick={() => setAuthMode("signup")}
                >
                  Sign Up
                </button>
              </div>

              <form className="authForm" onSubmit={handleEmailAuth}>
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <input
                  type="password"
                  placeholder="Password (min 6 chars)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <button type="submit" className="sendBtn" disabled={authLoading}>
                  {authLoading ? "Please wait..." : authMode === "signup" ? "Create account" : "Login"}
                </button>
              </form>

              {authError && <p className="authError">{authError}</p>}
            </section>
          </section>
        </main>
      </div>
    );
  }

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
            <span className="badge">{user.email || "Signed in user"}</span>
            <button type="button" className="badge signOutBtn" onClick={handleSignOut}>
              Log out
            </button>
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
