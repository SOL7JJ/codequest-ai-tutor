import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_URL || "https://codequest-ai-tutor.onrender.com";

const TOKEN_KEY = "codequest_auth_token";
const LAST_EMAIL_KEY = "codequest_last_email";
const CHECKOUT_NOTICE_KEY = "codequest_checkout_notice";
const DEFAULT_WELCOME_MESSAGE = {
  role: "assistant",
  content:
    "👋 Hi! I'm your AI Tutor.\n\nI can:\n• Explain topics step-by-step\n• Help you debug code\n• Give hints (not just answers)\n• Create practice questions\n\nWhat are you working on today?",
};

function isSubscriptionActive(status) {
  return status === "active" || status === "trialing";
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) || "");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [billingStatus, setBillingStatus] = useState("inactive");
  const [billingPlan, setBillingPlan] = useState("free");
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingPeriodEnd, setBillingPeriodEnd] = useState(null);
  const [billingDailyLimit, setBillingDailyLimit] = useState(null);
  const [billingDailyUsed, setBillingDailyUsed] = useState(0);
  const [billingDailyRemaining, setBillingDailyRemaining] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [billingActionLoading, setBillingActionLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState("");
  const [viewMode, setViewMode] = useState("tutor");
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState("");
  const [progressData, setProgressData] = useState(null);

  const [level, setLevel] = useState("KS3");
  const [topic, setTopic] = useState("Python");
  const [mode, setMode] = useState("Explain");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([DEFAULT_WELCOME_MESSAGE]);
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

  const fetchBillingStatus = useCallback(async () => {
    if (!user) return;

    setBillingLoading(true);
    setBillingError("");

    try {
      const { res, data, rawText } = await fetchJson("/api/billing/status", { method: "GET" });

      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        return;
      }

      if (!res.ok) {
        throw new Error(data?.error || rawText || "Failed to load billing status");
      }

      setBillingStatus(data?.billing?.status || "inactive");
      setBillingPlan(data?.billing?.plan || "free");
      setBillingPeriodEnd(data?.billing?.currentPeriodEnd || null);
      setBillingDailyLimit(data?.billing?.usage?.dailyLimit ?? null);
      setBillingDailyUsed(data?.billing?.usage?.dailyUsed ?? 0);
      setBillingDailyRemaining(data?.billing?.usage?.dailyRemaining ?? null);
    } catch (err) {
      setBillingStatus("inactive");
      setBillingPlan("free");
      setBillingPeriodEnd(null);
      setBillingDailyLimit(null);
      setBillingDailyUsed(0);
      setBillingDailyRemaining(null);
      setBillingError(err?.message || "Failed to load billing status");
    } finally {
      setBillingLoading(false);
    }
  }, [fetchJson, user]);

  const fetchProgressOverview = useCallback(async () => {
    if (!user) return;

    setProgressLoading(true);
    setProgressError("");
    try {
      const { res, data, rawText } = await fetchJson("/api/progress/overview", { method: "GET" });

      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        return;
      }

      if (!res.ok) {
        throw new Error(data?.error || rawText || "Failed to load progress dashboard");
      }

      setProgressData(data);
    } catch (err) {
      setProgressError(err?.message || "Failed to load progress dashboard");
    } finally {
      setProgressLoading(false);
    }
  }, [fetchJson, user]);

  const fetchChatHistory = useCallback(async () => {
    if (!user) return;

    setHistoryLoading(true);
    try {
      const { res, data, rawText } = await fetchJson("/api/chat/history?limit=120", { method: "GET" });

      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        return;
      }

      if (!res.ok) {
        throw new Error(data?.error || rawText || "Failed to load chat history");
      }

      const history = Array.isArray(data?.messages) ? data.messages : [];
      if (!history.length) {
        setMessages([DEFAULT_WELCOME_MESSAGE]);
        return;
      }

      setMessages(
        history.map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content || "",
        }))
      );
    } catch (err) {
      console.error("Fetch chat history error:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [fetchJson, user]);

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
      localStorage.setItem(LAST_EMAIL_KEY, data.user?.email || email.trim());
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
    setBillingStatus("inactive");
    setBillingPlan("free");
    setBillingPeriodEnd(null);
    setBillingDailyLimit(null);
    setBillingDailyUsed(0);
    setBillingDailyRemaining(null);
    setBillingError("");
    setCheckoutNotice("");
    sessionStorage.removeItem(CHECKOUT_NOTICE_KEY);
    setViewMode("tutor");
    setProgressData(null);
    setProgressError("");
    setMessages([DEFAULT_WELCOME_MESSAGE]);
  }

  async function handleStartSubscription() {
    setBillingActionLoading(true);
    setBillingError("");
    try {
      const { res, data, rawText } = await fetchJson("/api/billing/create-checkout-session", {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error(data?.error || rawText || `Failed to create checkout (${res.status})`);
      }

      if (!data?.url) {
        throw new Error("No checkout URL returned from server");
      }

      window.location.href = data.url;
    } catch (err) {
      setBillingError(err?.message || "Failed to start subscription checkout");
      setBillingActionLoading(false);
    }
  }

  async function handleManageBilling() {
    setBillingActionLoading(true);
    setBillingError("");
    try {
      const { res, data, rawText } = await fetchJson("/api/billing/create-portal-session", {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error(data?.error || rawText || `Failed to open billing portal (${res.status})`);
      }

      if (!data?.url) {
        throw new Error("No billing portal URL returned from server");
      }

      window.location.href = data.url;
    } catch (err) {
      setBillingError(err?.message || "Failed to open billing portal");
      setBillingActionLoading(false);
    }
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

      if (res.status === 402 || res.status === 403 || res.status === 429) {
        setBillingStatus(data?.billing?.status || "inactive");
        setBillingPlan(data?.billing?.plan || "free");
        setBillingPeriodEnd(data?.billing?.currentPeriodEnd || null);
        setBillingDailyLimit(data?.billing?.usage?.dailyLimit ?? null);
        setBillingDailyUsed(data?.billing?.usage?.dailyUsed ?? 0);
        setBillingDailyRemaining(data?.billing?.usage?.dailyRemaining ?? null);
        throw new Error(data?.error || "This action needs Pro or available free turns.");
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

      if (res.status === 402 || res.status === 403 || res.status === 429) {
        const rawText = await res.text();
        let data = null;
        try {
          data = JSON.parse(rawText);
        } catch {
          // noop
        }
        setBillingStatus(data?.billing?.status || "inactive");
        setBillingPlan(data?.billing?.plan || "free");
        setBillingPeriodEnd(data?.billing?.currentPeriodEnd || null);
        setBillingDailyLimit(data?.billing?.usage?.dailyLimit ?? null);
        setBillingDailyUsed(data?.billing?.usage?.dailyUsed ?? 0);
        setBillingDailyRemaining(data?.billing?.usage?.dailyRemaining ?? null);
        throw new Error(data?.error || "This action needs Pro or available free turns.");
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
      fetchProgressOverview();
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
    if (!user) return;
    fetchBillingStatus();
  }, [user, fetchBillingStatus]);

  useEffect(() => {
    if (!user) return;
    fetchChatHistory();
  }, [user, fetchChatHistory]);

  useEffect(() => {
    if (!user) return;
    fetchProgressOverview();
  }, [user, fetchProgressOverview]);

  useEffect(() => {
    const storedNotice = sessionStorage.getItem(CHECKOUT_NOTICE_KEY);
    if (storedNotice) {
      setCheckoutNotice(storedNotice);
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      const successNotice = getToken()
        ? "Subscription activated successfully. Welcome to CodeQuest Pro."
        : "Payment successful. Log in with the same email to unlock CodeQuest Pro.";
      setCheckoutNotice(successNotice);
      sessionStorage.setItem(CHECKOUT_NOTICE_KEY, successNotice);
      fetchBillingStatus();
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("checkout") === "cancel") {
      const cancelNotice = "Checkout canceled. You can subscribe any time.";
      setCheckoutNotice(cancelNotice);
      sessionStorage.setItem(CHECKOUT_NOTICE_KEY, cancelNotice);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [fetchBillingStatus, getToken]);

  useEffect(() => {
    if (!user || !isSubscriptionActive(billingStatus)) return;
    const successNotice = "Subscription activated successfully. Welcome to CodeQuest Pro.";
    setCheckoutNotice(successNotice);
    sessionStorage.setItem(CHECKOUT_NOTICE_KEY, successNotice);
  }, [user, billingStatus]);

  useEffect(() => {
    const isPro = isSubscriptionActive(billingStatus) || billingPlan === "pro";
    if (!isPro && (mode === "Quiz" || mode === "Mark")) {
      setMode("Explain");
    }
  }, [billingPlan, billingStatus, mode]);

  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  const isFreshSession = messages.length === 1 && messages[0]?.role === "assistant";
  const topTopics = progressData?.topicBreakdown?.slice(0, 5) || [];
  const modeBreakdown = progressData?.modeBreakdown || [];
  const dailyActivity = progressData?.dailyActivity || [];
  const lastActiveLabel = progressData?.summary?.lastActiveAt
    ? new Date(progressData.summary.lastActiveAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "Never";
  const renewalLabel = billingPeriodEnd
    ? new Date(billingPeriodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "TBD";
  const isProPlan = isSubscriptionActive(billingStatus) || billingPlan === "pro";
  const freeTurnsLabel =
    billingDailyLimit == null || billingDailyRemaining == null
      ? null
      : `${billingDailyRemaining}/${billingDailyLimit} free turns left today`;

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
              {checkoutNotice && <p className="paywallNotice authCheckoutNotice">{checkoutNotice}</p>}

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

  if (billingLoading) {
    return (
      <div className="authShell">
        <section className="authCard authLoadingCard">
          <h1>Checking your plan</h1>
          <p>Loading billing status...</p>
        </section>
      </div>
    );
  }

  if (historyLoading) {
    return (
      <div className="authShell">
        <section className="authCard authLoadingCard">
          <h1>Loading your chat history</h1>
          <p>Syncing previous messages...</p>
        </section>
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
            <span className="badge">{isProPlan ? "Pro" : "Free"}</span>
            {isProPlan ? (
              <span className="badge planBadgeInline">Plan active • Renews {renewalLabel}</span>
            ) : (
              <span className="badge freeBadgeInline">{freeTurnsLabel || "Free tier access enabled"}</span>
            )}
            <span className="badge">Session turns: {Math.max(messages.length - 1, 0)}</span>
            <span className="badge">{user.email || "Signed in user"}</span>
            {isProPlan ? (
              <button type="button" className="badge signOutBtn" onClick={handleManageBilling}>
                Billing
              </button>
            ) : (
              <button
                type="button"
                className="badge signOutBtn"
                onClick={handleStartSubscription}
                disabled={billingActionLoading}
              >
                {billingActionLoading ? "Opening..." : "Upgrade"}
              </button>
            )}
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
            <option disabled={!isProPlan}>Quiz{isProPlan ? "" : " (Pro)"}</option>
            <option disabled={!isProPlan}>Mark{isProPlan ? "" : " (Pro)"}</option>
          </select>
        </div>
      </header>

      {checkoutNotice && <p className="paywallNotice inlineNotice">{checkoutNotice}</p>}
      {!isProPlan && (
        <section className="freePlanBanner">
          <div>
            <h3>Free plan</h3>
            <p>
              You can use Explain and Hint with daily limits. Upgrade to unlock Quiz, Mark, and streaming responses.
            </p>
            <p className="freePlanMeta">
              Usage today: {billingDailyUsed}
              {billingDailyLimit == null ? "" : ` / ${billingDailyLimit}`}
            </p>
          </div>
          <button type="button" className="sendBtn" onClick={handleStartSubscription} disabled={billingActionLoading}>
            {billingActionLoading ? "Redirecting..." : "Upgrade to Pro"}
          </button>
        </section>
      )}
      {billingError && <p className="authError">{billingError}</p>}

      <div className="workspaceTabs">
        <button
          type="button"
          className={`modeBtn ${viewMode === "tutor" ? "active" : ""}`}
          onClick={() => setViewMode("tutor")}
        >
          Tutor Workspace
        </button>
        <button
          type="button"
          className={`modeBtn ${viewMode === "dashboard" ? "active" : ""}`}
          onClick={() => {
            setViewMode("dashboard");
            fetchProgressOverview();
          }}
        >
          Progress Dashboard
        </button>
      </div>

      {viewMode === "dashboard" && (
        <section className="dashboard">
          <div className="dashboardHead">
            <h2>Student Progress</h2>
            <button type="button" className="googleBtn" onClick={fetchProgressOverview} disabled={progressLoading}>
              {progressLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {progressError && <p className="authError">{progressError}</p>}

          <div className="metricsGrid">
            <article className="metricCard">
              <span>Total turns</span>
              <strong>{progressData?.summary?.totalTurns || 0}</strong>
            </article>
            <article className="metricCard">
              <span>Topics covered</span>
              <strong>{progressData?.summary?.topicsCovered || 0}</strong>
            </article>
            <article className="metricCard">
              <span>Quizzes taken</span>
              <strong>{progressData?.summary?.quizzesTaken || 0}</strong>
            </article>
            <article className="metricCard">
              <span>Marks requested</span>
              <strong>{progressData?.summary?.marksRequested || 0}</strong>
            </article>
            <article className="metricCard">
              <span>Current streak</span>
              <strong>{progressData?.summary?.currentStreakDays || 0} day(s)</strong>
            </article>
            <article className="metricCard">
              <span>Last active</span>
              <strong>{lastActiveLabel}</strong>
            </article>
          </div>

          <div className="dashboardGrid">
            <article className="dashboardCard">
              <h3>Top topics</h3>
              {topTopics.length === 0 && <p>No topic activity yet.</p>}
              {topTopics.map((item) => {
                const max = topTopics[0]?.count || 1;
                const width = Math.max(8, Math.round((item.count / max) * 100));
                return (
                  <div key={item.topic} className="progressRow">
                    <div className="progressMeta">
                      <span>{item.topic}</span>
                      <strong>{item.count}</strong>
                    </div>
                    <div className="progressTrack">
                      <div className="progressBar" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </article>

            <article className="dashboardCard">
              <h3>Mode usage</h3>
              {modeBreakdown.length === 0 && <p>No mode activity yet.</p>}
              <div className="modeChips">
                {modeBreakdown.map((item) => (
                  <span key={item.mode} className="badge">
                    {item.mode}: {item.count}
                  </span>
                ))}
              </div>
            </article>

            <article className="dashboardCard">
              <h3>Last 7 days activity</h3>
              {dailyActivity.length === 0 && <p>No recent activity yet.</p>}
              {dailyActivity.map((item) => (
                <div key={item.date} className="progressRow">
                  <div className="progressMeta">
                    <span>{item.date.slice(5)}</span>
                    <strong>{item.turns}</strong>
                  </div>
                  <div className="progressTrack">
                    <div
                      className="progressBar"
                      style={{
                        width: `${Math.max(
                          8,
                          Math.round(
                            (item.turns /
                              Math.max(...dailyActivity.map((d) => d.turns), 1)) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </article>
          </div>
        </section>
      )}

      {viewMode === "tutor" && (
        <>
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
                  disabled={!isProPlan}
                >
                  {isProPlan ? "Quiz" : "Quiz (Pro)"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("Mark")}
                  className={`modeBtn ${mode === "Mark" ? "active" : ""}`}
                  disabled={!isProPlan}
                >
                  {isProPlan ? "Mark" : "Mark (Pro)"}
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
        </>
      )}

      {viewMode === "tutor" && (
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
      )}
    </div>
  );
}
