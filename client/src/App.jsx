import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_URL || "https://codequest-ai-tutor.onrender.com";
const TOKEN_KEY = "codequest_auth_token";
const LAST_EMAIL_KEY = "codequest_last_email";
const CHECKOUT_NOTICE_KEY = "codequest_checkout_notice";
const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const JS_RUN_TIMEOUT_MS = 4000;
const DEMO_MAX_TRIES = 5;
const DEMO_QUESTIONS = [
  "How do Python loops work?",
  "What is a JavaScript variable?",
  "Explain arrays for a beginner with one coding example.",
  "How do functions return values in Python?",
  "What is the difference between while and for loops?",
];
const IDE_TEMPLATES = {
  python: `# Python starter
name = "CodeQuest"
print(f"Hello, {name}!")

for i in range(1, 4):
    print("Step", i)
`,
  javascript: `// JavaScript starter
const name = "CodeQuest";
console.log(\`Hello, ${name}!\`);

for (let i = 1; i <= 3; i += 1) {
  console.log("Step", i);
}
`,
};

const TOPICS_BY_LEVEL = {
  KS3: [
    "Programming Basics",
    "Algorithms",
    "Data Representation",
    "Computer Systems",
    "Networks",
    "Cyber Security",
  ],
  GCSE: [
    "Computational Thinking",
    "Programming Techniques",
    "Data Representation (Binary/Hex)",
    "Computer Architecture",
    "Networks and Protocols",
    "Cyber Security and Threats",
    "Databases and SQL",
    "Ethics and Legal Issues",
  ],
  "A-Level": [
    "Advanced Algorithms",
    "Data Structures",
    "Object-Oriented Programming",
    "Functional Programming",
    "Boolean Algebra and Logic",
    "Processors and Assembly",
    "Networks and Communication",
    "Databases and Normalisation",
    "Theory of Computation",
  ],
};

const DEFAULT_WELCOME_MESSAGE = {
  role: "assistant",
  content:
    "Hi! I am your AI Tutor. Ask coding questions, paste code for feedback, or track your progress in dashboards.",
};

function isSubscriptionActive(status) {
  return status === "active" || status === "trialing";
}

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname || "/");
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [signupRole, setSignupRole] = useState("student");
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) || "");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth <= 768);
  const [mobileStartUnlocked, setMobileStartUnlocked] = useState(() => window.innerWidth > 768);
  const [demoQuestion, setDemoQuestion] = useState(DEMO_QUESTIONS[0]);
  const [demoQuestionIndex, setDemoQuestionIndex] = useState(0);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoReply, setDemoReply] = useState("");
  const [demoError, setDemoError] = useState("");
  const [demoUsageCount, setDemoUsageCount] = useState(0);

  const [billingStatus, setBillingStatus] = useState("inactive");
  const [billingPlan, setBillingPlan] = useState("free");
  const [billingPeriodEnd, setBillingPeriodEnd] = useState(null);
  const [billingDailyLimit, setBillingDailyLimit] = useState(null);
  const [billingDailyUsed, setBillingDailyUsed] = useState(0);
  const [billingDailyRemaining, setBillingDailyRemaining] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingActionLoading, setBillingActionLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState("");

  const [viewMode, setViewMode] = useState("tutor");
  const [studentDashTab, setStudentDashTab] = useState("overview");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [topMenuOpen, setTopMenuOpen] = useState(false);

  const [level, setLevel] = useState("KS3");
  const [topic, setTopic] = useState(TOPICS_BY_LEVEL.KS3[0]);
  const [mode, setMode] = useState("Explain");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([DEFAULT_WELCOME_MESSAGE]);
  const [loading, setLoading] = useState(false);
  const chatRef = useRef(null);
  const topMenuRef = useRef(null);
  const authCardRef = useRef(null);
  const landingCopyRef = useRef(null);
  const sideRef = useRef(null);
  const demoQuestionTimerRef = useRef(null);

  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState("");
  const [progressData, setProgressData] = useState(null);

  const [lessons, setLessons] = useState([]);
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonTopic, setLessonTopic] = useState("");
  const [lessonSaving, setLessonSaving] = useState(false);

  const [quizTopic, setQuizTopic] = useState("Python");
  const [quizScore, setQuizScore] = useState("8");
  const [quizMaxScore, setQuizMaxScore] = useState("10");
  const [quizSaving, setQuizSaving] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [taskSavingId, setTaskSavingId] = useState(null);

  const [codeLanguage, setCodeLanguage] = useState("python");
  const [ideDrafts, setIdeDrafts] = useState(() => ({ ...IDE_TEMPLATES }));
  const [codeEvalLoading, setCodeEvalLoading] = useState(false);
  const [codeEvalError, setCodeEvalError] = useState("");
  const [codeEvalResult, setCodeEvalResult] = useState(null);
  const [ideRunLoading, setIdeRunLoading] = useState(false);
  const [ideRunError, setIdeRunError] = useState("");
  const [ideOutput, setIdeOutput] = useState("");
  const pyodideRef = useRef(null);
  const pyodideLoadPromiseRef = useRef(null);
  const jsWorkerRef = useRef(null);
  const jsWorkerTimeoutRef = useRef(null);

  const [teacherTopic, setTeacherTopic] = useState("Python");
  const [teacherLevel, setTeacherLevel] = useState("KS3");
  const [teacherQuestionCount, setTeacherQuestionCount] = useState("5");
  const [teacherQuizTitle, setTeacherQuizTitle] = useState("");
  const [teacherQuizLoading, setTeacherQuizLoading] = useState(false);
  const [teacherQuizResult, setTeacherQuizResult] = useState(null);

  const [assignEmail, setAssignEmail] = useState("");
  const [assignTitle, setAssignTitle] = useState("");
  const [assignTopic, setAssignTopic] = useState("Python");
  const [assignDueDate, setAssignDueDate] = useState("");
  const [assignDescription, setAssignDescription] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignNotice, setAssignNotice] = useState("");

  const [teacherResults, setTeacherResults] = useState([]);
  const [teacherLoading, setTeacherLoading] = useState(false);
  const [teacherError, setTeacherError] = useState("");

  const starterPrompts = useMemo(
    () => [
      { label: "Explain loops", text: "Explain loops in Python with an example." },
      { label: "Arrays", text: "What is an array? Explain for KS3 with an example." },
      { label: "Python errors", text: "I got TypeError in Python. Help me debug." },
      { label: "Hint me", text: "Give me a hint to solve FizzBuzz without giving full code." },
    ],
    []
  );
  const levelTopics = useMemo(() => TOPICS_BY_LEVEL[level] || TOPICS_BY_LEVEL.KS3, [level]);
  const codeInput = ideDrafts[codeLanguage] || "";

  const getToken = useCallback(() => localStorage.getItem(TOKEN_KEY) || "", []);

  const fetchJson = useCallback(
    async (path, options = {}) => {
      const token = getToken();
      const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      };
      if (token) headers.Authorization = `Bearer ${token}`;

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
    },
    [getToken]
  );

  const goToPath = useCallback((path) => {
    if (window.location.pathname === path) return;
    window.history.pushState({}, "", path);
    setCurrentPath(path);
  }, []);

  const clearDemoQuestionTimer = useCallback(() => {
    if (demoQuestionTimerRef.current) {
      window.clearTimeout(demoQuestionTimerRef.current);
      demoQuestionTimerRef.current = null;
    }
  }, []);

  const advanceDemoQuestion = useCallback(() => {
    setDemoQuestionIndex((prev) => {
      const next = (prev + 1) % DEMO_QUESTIONS.length;
      setDemoQuestion(DEMO_QUESTIONS[next]);
      return next;
    });
  }, []);

  const isPaidPlan = isSubscriptionActive(billingStatus) || billingPlan === "pro" || billingPlan === "premium";
  const isPremiumPlan = billingPlan === "premium";

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
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to load billing status");

      setBillingStatus(data?.billing?.status || "inactive");
      setBillingPlan(data?.billing?.plan || "free");
      setBillingPeriodEnd(data?.billing?.currentPeriodEnd || null);
      setBillingDailyLimit(data?.billing?.usage?.dailyLimit ?? null);
      setBillingDailyUsed(data?.billing?.usage?.dailyUsed ?? 0);
      setBillingDailyRemaining(data?.billing?.usage?.dailyRemaining ?? null);
    } catch (err) {
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
      const { res, data, rawText } = await fetchJson("/api/progress/summary", { method: "GET" });
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        return;
      }
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to load progress summary");
      setProgressData(data);
    } catch (err) {
      setProgressError(err?.message || "Failed to load progress summary");
    } finally {
      setProgressLoading(false);
    }
  }, [fetchJson, user]);

  const fetchChatHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const { res, data, rawText } = await fetchJson("/api/chat/history?limit=40", { method: "GET" });
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        return;
      }
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to load chat history");
      const history = Array.isArray(data?.messages) ? data.messages : [];
      if (!history.length) {
        setMessages([DEFAULT_WELCOME_MESSAGE]);
        return;
      }
      setMessages(
        history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content || "" }))
      );
    } catch (err) {
      console.error("Fetch chat history error:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [fetchJson, user]);

  const fetchLessons = useCallback(async () => {
    if (!user) return;
    try {
      const { res, data, rawText } = await fetchJson("/api/student/lessons", { method: "GET" });
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to load lessons");
      setLessons(Array.isArray(data?.lessons) ? data.lessons : []);
    } catch (err) {
      console.error("Lessons error:", err);
    }
  }, [fetchJson, user]);

  const fetchStudentTasks = useCallback(async () => {
    if (!user) return;
    try {
      const { res, data, rawText } = await fetchJson("/api/student/tasks", { method: "GET" });
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to load tasks");
      setTasks(Array.isArray(data?.tasks) ? data.tasks : []);
    } catch (err) {
      console.error("Tasks error:", err);
    }
  }, [fetchJson, user]);

  const fetchTeacherResults = useCallback(async () => {
    if (!user || user.role !== "teacher") return;
    setTeacherLoading(true);
    setTeacherError("");
    try {
      const { res, data, rawText } = await fetchJson("/api/teacher/results", { method: "GET" });
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to load teacher results");
      setTeacherResults(Array.isArray(data?.students) ? data.students : []);
    } catch (err) {
      setTeacherError(err?.message || "Failed to load teacher results");
    } finally {
      setTeacherLoading(false);
    }
  }, [fetchJson, user]);

  const ensurePyodide = useCallback(async () => {
    if (pyodideRef.current) return pyodideRef.current;
    if (pyodideLoadPromiseRef.current) return pyodideLoadPromiseRef.current;

    pyodideLoadPromiseRef.current = (async () => {
      if (!window.loadPyodide) {
        await new Promise((resolve, reject) => {
          const existingScript = document.querySelector('script[data-pyodide="true"]');
          if (existingScript) {
            existingScript.addEventListener("load", () => resolve(), { once: true });
            existingScript.addEventListener("error", () => reject(new Error("Failed to load Python runtime")), {
              once: true,
            });
            return;
          }

          const script = document.createElement("script");
          script.src = `${PYODIDE_INDEX_URL}pyodide.js`;
          script.async = true;
          script.dataset.pyodide = "true";
          script.addEventListener("load", () => resolve(), { once: true });
          script.addEventListener("error", () => reject(new Error("Failed to load Python runtime")), {
            once: true,
          });
          document.head.appendChild(script);
        });
      }

      const pyodide = await window.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
      pyodideRef.current = pyodide;
      return pyodide;
    })().catch((err) => {
      pyodideLoadPromiseRef.current = null;
      throw err;
    });

    return pyodideLoadPromiseRef.current;
  }, []);

  const stopJavaScriptRunner = useCallback(() => {
    if (jsWorkerTimeoutRef.current) {
      window.clearTimeout(jsWorkerTimeoutRef.current);
      jsWorkerTimeoutRef.current = null;
    }
    if (jsWorkerRef.current) {
      jsWorkerRef.current.terminate();
      jsWorkerRef.current = null;
    }
  }, []);

  const runJavaScriptInWorker = useCallback(
    (code) =>
      new Promise((resolve, reject) => {
        stopJavaScriptRunner();

        const output = [];
        let settled = false;
        const workerScript = `
          const emit = (type, payload) => self.postMessage({ type, payload });
          const format = (value) => {
            if (typeof value === "string") return value;
            try {
              return JSON.stringify(value);
            } catch {
              return String(value);
            }
          };

          console.log = (...args) => emit("log", args.map(format).join(" "));
          console.error = (...args) => emit("log", args.map(format).join(" "));
          console.warn = (...args) => emit("log", args.map(format).join(" "));

          self.onmessage = async (event) => {
            if (event?.data?.type !== "run") return;
            try {
              const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
              const runner = new AsyncFunction(event.data.code);
              const result = await runner();
              if (typeof result !== "undefined") emit("log", format(result));
              emit("done");
            } catch (error) {
              emit("error", error?.stack || error?.message || String(error));
            }
          };
        `;

        const workerUrl = URL.createObjectURL(new Blob([workerScript], { type: "application/javascript" }));
        const worker = new Worker(workerUrl);
        jsWorkerRef.current = worker;

        const cleanup = () => {
          if (jsWorkerTimeoutRef.current) {
            window.clearTimeout(jsWorkerTimeoutRef.current);
            jsWorkerTimeoutRef.current = null;
          }
          if (jsWorkerRef.current === worker) {
            jsWorkerRef.current = null;
          }
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
        };

        worker.onmessage = (event) => {
          const { type, payload } = event.data || {};
          if (type === "log") {
            output.push(String(payload || ""));
            return;
          }
          if (settled) return;
          if (type === "done") {
            settled = true;
            cleanup();
            resolve(output.join("\n").trim());
            return;
          }
          if (type === "error") {
            settled = true;
            cleanup();
            reject(new Error(String(payload || "JavaScript runtime error")));
          }
        };

        worker.onerror = (event) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(event?.message || "Failed to execute JavaScript"));
        };

        jsWorkerTimeoutRef.current = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(`Execution timed out after ${JS_RUN_TIMEOUT_MS / 1000}s.`));
        }, JS_RUN_TIMEOUT_MS);

        worker.postMessage({ type: "run", code });
      }),
    [stopJavaScriptRunner]
  );

  async function handleEmailAuth(e) {
    if (e?.preventDefault) e.preventDefault();
    if (authLoading) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setAuthError("Email and password are required.");
      return;
    }

    setAuthLoading(true);
    setAuthError("");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);

    try {
      const endpoint = authMode === "signup" ? "/api/auth/register" : "/api/auth/login";
      const payload =
        authMode === "signup"
          ? { email: trimmedEmail, password, role: signupRole }
          : { email: trimmedEmail, password };

      const { res, data, rawText } = await fetchJson(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(data?.error || rawText || `Auth failed (${res.status})`);
      if (!data?.token || !data?.user) throw new Error("Invalid auth response from server");

      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(LAST_EMAIL_KEY, data.user?.email || trimmedEmail);
      setUser(data.user);
      setPassword("");
    } catch (err) {
      if (err?.name === "AbortError") {
        setAuthError("Login is taking too long. Please try again.");
      } else {
        setAuthError(err?.message || "Authentication failed.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      setAuthLoading(false);
    }
  }

  async function handleDemoAsk(e) {
    if (e?.preventDefault) e.preventDefault();
    if (demoLoading) return;
    clearDemoQuestionTimer();

    let questionToAsk = demoQuestion.trim();
    if (demoReply) {
      const nextIndex = (demoQuestionIndex + 1) % DEMO_QUESTIONS.length;
      const nextQuestion = DEMO_QUESTIONS[nextIndex];
      setDemoQuestionIndex(nextIndex);
      setDemoQuestion(nextQuestion);
      questionToAsk = nextQuestion;
    }

    if (!questionToAsk) return;
    if (demoUsageCount >= DEMO_MAX_TRIES) {
      setDemoError("Demo limit reached (5/5). Upgrade or create an account to continue.");
      return;
    }

    setDemoLoading(true);
    setDemoReply("");
    setDemoError("");
    try {
      const { res, data, rawText } = await fetchJson("/api/demo/tutor", {
        method: "POST",
        body: JSON.stringify({ message: questionToAsk }),
      });
      if (!res.ok) {
        const fallback =
          rawText?.includes("Cannot POST /api/demo/tutor")
            ? "Demo endpoint is not deployed on the backend yet. Please redeploy backend."
            : "Failed to run demo";
        throw new Error(data?.error || fallback);
      }
      setDemoReply(data?.reply || "No demo response returned.");
      setDemoUsageCount((count) => count + 1);
      demoQuestionTimerRef.current = window.setTimeout(() => {
        advanceDemoQuestion();
        demoQuestionTimerRef.current = null;
      }, 10000);
    } catch (err) {
      setDemoError(err?.message || "Failed to run demo");
    } finally {
      setDemoLoading(false);
    }
  }

  function handleResetDemoQuestion() {
    clearDemoQuestionTimer();
    advanceDemoQuestion();
  }

  useEffect(() => clearDemoQuestionTimer, [clearDemoQuestionTimer]);

  async function handleSignOut() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(CHECKOUT_NOTICE_KEY);
    setUser(null);
    setMessages([DEFAULT_WELCOME_MESSAGE]);
    setCheckoutNotice("");
    setBillingError("");
    setViewMode("tutor");
    setCodeEvalResult(null);
  }

  function handleClearChat() {
    setMessages([DEFAULT_WELCOME_MESSAGE]);
    setInput("");
  }

  function handleGetStarted() {
    setMobileStartUnlocked(true);
    authCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleBackToIntro() {
    setMobileStartUnlocked(false);
    landingCopyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openAuthPage(nextMode = "login") {
    setAuthMode(nextMode);
    goToPath("/auth");
  }

  useEffect(() => {
    const updateViewport = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobileViewport(mobile);
      if (!mobile) setMobileStartUnlocked(true);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  async function handleStartSubscription(targetPlan = "pro") {
    setBillingActionLoading(true);
    setBillingError("");
    try {
      const { res, data, rawText } = await fetchJson("/api/billing/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan: targetPlan }),
      });
      if (!res.ok) throw new Error(data?.error || rawText || `Failed to create checkout (${res.status})`);
      if (!data?.url) throw new Error("No checkout URL returned from server");
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
      const { res, data, rawText } = await fetchJson("/api/billing/create-portal-session", { method: "POST" });
      if (!res.ok) throw new Error(data?.error || rawText || `Failed to open billing portal (${res.status})`);
      if (!data?.url) throw new Error("No billing portal URL returned from server");
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

    const nonStreamCall = async () => {
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

      if (!res.ok) throw new Error(data?.error || rawText || `API error (${res.status})`);
      const reply = data?.reply ?? data?.message ?? data?.content ?? "No reply returned.";
      setAssistantContent(reply);
    };

    try {
      if (!isPaidPlan) {
        await nonStreamCall();
      } else {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/tutor/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: text, level, topic, mode }),
        });

        if (!res.ok || !res.body) {
          await nonStreamCall();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx = buffer.indexOf("\n\n");
          while (idx !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            idx = buffer.indexOf("\n\n");

            const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
            if (!dataLine) continue;

            let payload = null;
            try {
              payload = JSON.parse(dataLine.slice(6));
            } catch {
              continue;
            }

            if (payload?.error) throw new Error(payload.error);
            if (typeof payload?.delta === "string") {
              streamedContent += payload.delta;
              setAssistantContent(streamedContent);
            }
          }
        }

        if (!streamedContent.trim()) setAssistantContent("I got a response but it was empty.");
      }
    } catch (err) {
      setMessages((m) => [
        ...m.slice(0, -1),
        { role: "assistant", content: err?.message || "Failed to get tutor response." },
      ]);
    } finally {
      setLoading(false);
      fetchProgressOverview();
      fetchBillingStatus();
    }
  }

  async function handleEvaluateCode() {
    if (!codeInput.trim()) {
      setCodeEvalError("Paste code to evaluate.");
      return;
    }
    setCodeEvalLoading(true);
    setCodeEvalError("");
    try {
      const { res, data, rawText } = await fetchJson("/api/code/evaluate", {
        method: "POST",
        body: JSON.stringify({ code: codeInput, language: codeLanguage, topic }),
      });
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to evaluate code");
      setCodeEvalResult(data?.evaluation || null);
      fetchProgressOverview();
    } catch (err) {
      setCodeEvalError(err?.message || "Failed to evaluate code");
    } finally {
      setCodeEvalLoading(false);
    }
  }

  function handleLanguageChange(nextLanguage) {
    setCodeLanguage(nextLanguage);
    setIdeOutput("");
    setIdeRunError("");
  }

  function handleCodeInputChange(value) {
    setIdeDrafts((prev) => ({ ...prev, [codeLanguage]: value }));
  }

  async function handleRunCode() {
    if (!codeInput.trim()) {
      setIdeRunError("Write some code first.");
      return;
    }

    setIdeRunLoading(true);
    setIdeRunError("");
    setIdeOutput("Running...");

    try {
      if (codeLanguage === "javascript") {
        const jsOutput = await runJavaScriptInWorker(codeInput);
        setIdeOutput(jsOutput || "No output (use console.log(...) to display values).");
        return;
      }

      const pyodide = await ensurePyodide();
      const escapedCode = JSON.stringify(codeInput);
      const execution = await pyodide.runPythonAsync(`
import io
import sys
import traceback

code = ${escapedCode}
stdout_capture = io.StringIO()
stderr_capture = io.StringIO()
runtime_error = ""

sys.stdout = stdout_capture
sys.stderr = stderr_capture

try:
    exec(code, {})
except Exception:
    runtime_error = traceback.format_exc()
finally:
    sys.stdout = sys.__stdout__
    sys.stderr = sys.__stderr__

output_text = stdout_capture.getvalue()
error_text = stderr_capture.getvalue() + runtime_error
(output_text, error_text)
      `);

      const result = execution?.toJs ? execution.toJs() : execution;
      execution?.destroy?.();

      const outputText = String(result?.[0] || "");
      const errorText = String(result?.[1] || "");
      if (errorText.trim()) {
        setIdeRunError(errorText.trim());
      }
      setIdeOutput(outputText.trim() ? outputText : "No output (use print(...) to display values).");
    } catch (err) {
      setIdeRunError(err?.message || `Failed to run ${codeLanguage} code.`);
      setIdeOutput("");
    } finally {
      setIdeRunLoading(false);
    }
  }

  async function handleCreateLesson(e) {
    e.preventDefault();
    if (!lessonTitle.trim()) return;
    setLessonSaving(true);
    try {
      const { res, data, rawText } = await fetchJson("/api/student/lessons", {
        method: "POST",
        body: JSON.stringify({ title: lessonTitle.trim(), topic: lessonTopic.trim() || topic }),
      });
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to create lesson");
      setLessons((prev) => [data.lesson, ...prev]);
      setLessonTitle("");
      setLessonTopic("");
      fetchProgressOverview();
    } catch (err) {
      setProgressError(err?.message || "Failed to create lesson");
    } finally {
      setLessonSaving(false);
    }
  }

  async function handleToggleLesson(lessonId, completed) {
    try {
      const { res, data, rawText } = await fetchJson(`/api/student/lessons/${lessonId}`, {
        method: "PATCH",
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to update lesson");
      setLessons((prev) => prev.map((lesson) => (lesson.id === lessonId ? data.lesson : lesson)));
      fetchProgressOverview();
    } catch (err) {
      setProgressError(err?.message || "Failed to update lesson");
    }
  }

  async function handleSaveQuizAttempt(e) {
    e.preventDefault();
    setQuizSaving(true);
    try {
      const { res, data, rawText } = await fetchJson("/api/student/quiz-attempts", {
        method: "POST",
        body: JSON.stringify({ topic: quizTopic, score: Number(quizScore), maxScore: Number(quizMaxScore) }),
      });
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to save quiz score");
      if (data?.attempt) {
        setQuizScore("8");
        setQuizMaxScore("10");
      }
      fetchProgressOverview();
    } catch (err) {
      setProgressError(err?.message || "Failed to save quiz score");
    } finally {
      setQuizSaving(false);
    }
  }

  async function handleUpdateTaskStatus(taskId, status) {
    setTaskSavingId(taskId);
    try {
      const { res, data, rawText } = await fetchJson(`/api/student/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to update task status");
      setTasks((prev) => prev.map((task) => (task.id === taskId ? data.task : task)));
    } catch (err) {
      setProgressError(err?.message || "Failed to update task status");
    } finally {
      setTaskSavingId(null);
    }
  }

  async function handleGenerateTeacherQuiz(e) {
    e.preventDefault();
    setTeacherQuizLoading(true);
    setTeacherError("");
    try {
      const { res, data, rawText } = await fetchJson("/api/teacher/quizzes/generate", {
        method: "POST",
        body: JSON.stringify({
          topic: teacherTopic,
          level: teacherLevel,
          numQuestions: Number(teacherQuestionCount),
          title: teacherQuizTitle.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to generate quiz");
      setTeacherQuizResult(data?.quiz || null);
    } catch (err) {
      setTeacherError(err?.message || "Failed to generate quiz");
    } finally {
      setTeacherQuizLoading(false);
    }
  }

  async function handleAssignTask(e) {
    e.preventDefault();
    setAssignLoading(true);
    setTeacherError("");
    setAssignNotice("");
    try {
      const { res, data, rawText } = await fetchJson("/api/teacher/tasks/assign", {
        method: "POST",
        body: JSON.stringify({
          studentEmail: assignEmail,
          title: assignTitle,
          topic: assignTopic,
          description: assignDescription,
          dueDate: assignDueDate || null,
        }),
      });
      if (!res.ok) throw new Error(data?.error || rawText || "Failed to assign task");
      setAssignNotice(`Task assigned to ${data?.student?.email || assignEmail}.`);
      setAssignTitle("");
      setAssignDescription("");
      setAssignDueDate("");
      fetchTeacherResults();
    } catch (err) {
      setTeacherError(err?.message || "Failed to assign task");
    } finally {
      setAssignLoading(false);
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
    // Keep login fast: load only essentials up front.
    fetchBillingStatus();
    fetchChatHistory();
  }, [user, fetchBillingStatus, fetchChatHistory]);

  useEffect(() => {
    if (!user || viewMode !== "dashboard") return;
    fetchProgressOverview();
    fetchLessons();
    fetchStudentTasks();
  }, [user, viewMode, fetchProgressOverview, fetchLessons, fetchStudentTasks]);

  useEffect(() => {
    if (!user || user.role !== "teacher" || viewMode !== "teacher") return;
    fetchTeacherResults();
  }, [user, viewMode, fetchTeacherResults]);

  useEffect(() => {
    const onPopState = () => setCurrentPath(window.location.pathname || "/");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const storedNotice = sessionStorage.getItem(CHECKOUT_NOTICE_KEY);
    if (storedNotice) setCheckoutNotice(storedNotice);

    const path = window.location.pathname;
    if (path === "/billing/success") {
      const notice = getToken()
        ? "Subscription activated successfully. Welcome to CodeQuest Pro."
        : "Payment successful. Log in with the same email to unlock CodeQuest Pro.";
      setCheckoutNotice(notice);
      sessionStorage.setItem(CHECKOUT_NOTICE_KEY, notice);
      if (getToken()) fetchBillingStatus();
      window.history.replaceState({}, "", "/");
      setCurrentPath("/");
      return;
    }

    if (path === "/billing/cancel") {
      const notice = "Checkout canceled. You can subscribe any time.";
      setCheckoutNotice(notice);
      sessionStorage.setItem(CHECKOUT_NOTICE_KEY, notice);
      window.history.replaceState({}, "", "/");
      setCurrentPath("/");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      const notice = getToken()
        ? "Subscription activated successfully. Welcome to CodeQuest Pro."
        : "Payment successful. Log in with the same email to unlock CodeQuest Pro.";
      setCheckoutNotice(notice);
      sessionStorage.setItem(CHECKOUT_NOTICE_KEY, notice);
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (params.get("checkout") === "cancel") {
      const notice = "Checkout canceled. You can subscribe any time.";
      setCheckoutNotice(notice);
      sessionStorage.setItem(CHECKOUT_NOTICE_KEY, notice);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [fetchBillingStatus, getToken]);

  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (!levelTopics.includes(topic)) {
      setTopic(levelTopics[0]);
    }
  }, [levelTopics, topic]);

  useEffect(() => {
    if (!topMenuOpen) return;

    const handlePointerDown = (event) => {
      if (topMenuRef.current && !topMenuRef.current.contains(event.target)) {
        setTopMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setTopMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [topMenuOpen]);

  useEffect(() => () => stopJavaScriptRunner(), [stopJavaScriptRunner]);

  const isFreshSession = messages.length === 1 && messages[0]?.role === "assistant";
  const topTopics = progressData?.topTopics || [];
  const topicCounts = progressData?.topicCounts || [];
  const recentActivity = progressData?.recentActivity || [];
  const thisWeekActivityCount = progressData?.summary?.thisWeekActivityCount || 0;
  const streakDays = progressData?.summary?.streakDays || 0;
  const totalSessions = progressData?.summary?.totalSessions || 0;

  const renewalLabel = billingPeriodEnd
    ? new Date(billingPeriodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "TBD";

  const freeTurnsLabel =
    billingDailyLimit == null || billingDailyRemaining == null
      ? null
      : `${billingDailyRemaining}/${billingDailyLimit} free turns left today`;
  const demoRemaining = Math.max(DEMO_MAX_TRIES - demoUsageCount, 0);
  const demoReachedLimit = demoUsageCount >= DEMO_MAX_TRIES;

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

  if (currentPath === "/pricing") {
    return (
      <div className="authShell">
        <main className="landing pricingPage">
          <header className="landingTop">
            <div className="landingBrand">
              <span className="landingLogo">CQ</span>
              <span>CodeQuest AI Tutor</span>
            </div>
            <button type="button" className="modeBtn" onClick={() => goToPath("/")}>
              Back
            </button>
          </header>

          <section className="authCard">
            <h2>Pricing</h2>
            <p>Choose the plan that matches your learning pace.</p>
            <div className="pricingGrid">
              <article className="pricingCard">
                <h3>Free</h3>
                <p className="pricingPrice">£0 / month</p>
                <ul>
                  <li>5 sessions/day</li>
                  <li>Basic tutor (Explain + Hint)</li>
                </ul>
                <button type="button" className="modeBtn" onClick={() => goToPath("/")}>
                  Start Free
                </button>
              </article>

              <article className="pricingCard pricingCardPro">
                <h3>Pro</h3>
                <p className="pricingPrice">£4.99 / month</p>
                <ul>
                  <li>Unlimited tutor sessions</li>
                  <li>Exam-style marking</li>
                  <li>Progress tracking dashboard</li>
                  <li>Saved history</li>
                </ul>
                <button
                  type="button"
                  className="sendBtn"
                  onClick={() => {
                    if (!user) {
                      setAuthMode("signup");
                      setCheckoutNotice("Create your account, then choose Pro or Premium.");
                      goToPath("/");
                      return;
                    }
                    handleStartSubscription("pro");
                  }}
                  disabled={billingActionLoading}
                >
                  {billingActionLoading ? "Redirecting..." : "Choose Pro"}
                </button>
              </article>

              <article className="pricingCard pricingCardPro">
                <h3>Premium</h3>
                <p className="pricingPrice">£9.99 / month</p>
                <ul>
                  <li>Personalized learning path</li>
                  <li>Progress tracking + insights</li>
                  <li>Advanced AI explanations</li>
                  <li>Priority response</li>
                  <li>Parent progress reports</li>
                </ul>
                <button
                  type="button"
                  className="sendBtn"
                  onClick={() => {
                    if (!user) {
                      setAuthMode("signup");
                      setCheckoutNotice("Create your account, then choose Pro or Premium.");
                      goToPath("/");
                      return;
                    }
                    handleStartSubscription("premium");
                  }}
                  disabled={billingActionLoading}
                >
                  {billingActionLoading ? "Redirecting..." : "Choose Premium"}
                </button>
              </article>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (!user) {
    if (currentPath === "/auth") {
      return (
        <div className="authShell">
          <main className="landing authOnlyPage">
            <header className="landingTop">
              <div className="landingBrand">
                <span className="landingLogo">CQ</span>
                <span>CodeQuest AI Tutor</span>
              </div>
              <button type="button" className="modeBtn" onClick={() => goToPath("/")}>
                Back
              </button>
            </header>

            <section className="authCard authOnlyCard">
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
                <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <input
                  type="password"
                  placeholder="Password (min 6 chars)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                {authMode === "signup" && (
                  <select value={signupRole} onChange={(e) => setSignupRole(e.target.value)}>
                    <option value="student">Student account</option>
                    <option value="teacher">Teacher account</option>
                  </select>
                )}
                <button type="submit" className="sendBtn" disabled={authLoading}>
                  {authLoading ? "Please wait..." : authMode === "signup" ? "Create account" : "Login"}
                </button>
              </form>

              {authError && <p className="authError">{authError}</p>}
            </section>
          </main>
        </div>
      );
    }

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
            <div
              className={`landingCopy ${isMobileViewport && mobileStartUnlocked ? "landingCopyLocked" : ""}`}
              ref={landingCopyRef}
            >
              <p className="heroKicker">AI-Powered Learning Platform</p>
              <h1>Master Computer Science and Programming with structured coaching</h1>
              <p className="heroText">Learn coding faster with tutor chat, code evaluation, lesson tracking, and dashboards.</p>
              <div className="heroActions">
                <button type="button" className="sendBtn heroStartBtn" onClick={handleGetStarted}>
                  Let's get started
                </button>
                <button type="button" className="modeBtn" onClick={() => goToPath("/pricing")}>
                  View Pricing
                </button>
              </div>
              <div className="heroLimitShell">
                {demoReachedLimit && (
                  <div className="heroLimitCta">
                    <p>You reached the 5-question demo limit. Continue by upgrading or creating an account.</p>
                    <div className="heroLimitActions">
                      <button type="button" className="modeBtn" onClick={() => goToPath("/pricing")}>
                        Upgrade
                      </button>
                      <button type="button" className="modeBtn" onClick={() => setAuthMode("signup")}>
                        Create account
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <section
              className={`authCard ${isMobileViewport && !mobileStartUnlocked ? "authCardLocked" : ""}`}
              ref={authCardRef}
            >
              {isMobileViewport && mobileStartUnlocked && (
                <div className="authCardTopRow">
                  <button type="button" className="modeBtn authBackBtn" onClick={handleBackToIntro}>
                    Back to intro
                  </button>
                  <button type="button" className="modeBtn authQuickBtn" onClick={() => openAuthPage("login")}>
                    Login
                  </button>
                  <button type="button" className="modeBtn authQuickBtn" onClick={() => openAuthPage("signup")}>
                    Sign Up
                  </button>
                </div>
              )}
              <h2>Start your learning session</h2>
              <p>Try a demo question first. Use Login or Sign Up to continue in your full workspace.</p>

              <div className="demoCard">
                <h3>Try one question first</h3>
                <p className="demoGuide">
                  How to use this demo : press button.
                  <br />
                  try demo, clear chat , reset question
                </p>
                <form className="inlineForm" onSubmit={handleDemoAsk}>
                  <textarea
                    className="demoQuestionInput"
                    value={demoQuestion}
                    onChange={(e) => setDemoQuestion(e.target.value)}
                    placeholder="Ask a coding question..."
                    disabled={demoReachedLimit}
                    rows={2}
                  />
                  <button type="submit" className="modeBtn demoTryBtn" disabled={demoLoading || demoReachedLimit}>
                    {demoLoading ? "Thinking..." : "Try demo"}
                  </button>
                </form>
                <p className="demoMeta">Demo questions left: {demoRemaining}/{DEMO_MAX_TRIES}</p>
                <div className="demoReplyShell">
                  {demoError && <p className="authError">{demoError}</p>}
                  {demoReply ? (
                    <div className="demoReply">
                      <ReactMarkdown>{demoReply}</ReactMarkdown>
                      <p className="demoHint">Create a free account to continue learning with saved progress.</p>
                    </div>
                  ) : (
                    <p className="demoPlaceholder">Demo response will appear here.</p>
                  )}
                </div>
                <div className="demoActions">
                  <button
                    type="button"
                    className="modeBtn"
                    onClick={() => {
                      setDemoReply("");
                      setDemoError("");
                    }}
                    disabled={!demoReply && !demoError}
                  >
                    Clear chat
                  </button>
                  <button
                    type="button"
                    className="modeBtn"
                    onClick={handleResetDemoQuestion}
                  >
                    Reset question
                  </button>
                </div>
              </div>
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
          <p className="subtitle">Learn Computer Science with an AI tutor that explains step-by-step.</p>
        </div>

        <div className="topMenuWrap" ref={topMenuRef}>
          <button
            type="button"
            className={`topMenuToggle ${topMenuOpen ? "open" : ""}`}
            aria-expanded={topMenuOpen}
            aria-label="Open account and settings menu"
            onClick={() => setTopMenuOpen((prev) => !prev)}
          >
            <span />
            <span />
            <span />
          </button>

          {topMenuOpen && (
            <div className="topMenuPanel">
              <div className="badges">
                <span className="badge">{isPremiumPlan ? "Premium" : isPaidPlan ? "Pro" : "Free"}</span>
                <span className="badge">Role: {user.role || "student"}</span>
                {isPaidPlan ? (
                  <span className="badge planBadgeInline">Plan active • Renews {renewalLabel}</span>
                ) : (
                  <span className="badge freeBadgeInline">{freeTurnsLabel || "Free tier access enabled"}</span>
                )}
                <span className="badge">Session turns: {Math.max(messages.length - 1, 0)}</span>
                <span className="badge">{user.email}</span>
                <button
                  type="button"
                  className="badge signOutBtn"
                  onClick={() => {
                    setTopMenuOpen(false);
                    if (isPaidPlan) handleManageBilling();
                    else goToPath("/pricing");
                  }}
                  disabled={billingActionLoading}
                >
                  {isPaidPlan ? "Billing" : billingActionLoading ? "Opening..." : "Upgrade"}
                </button>
                <button
                  type="button"
                  className="badge signOutBtn"
                  onClick={() => {
                    setTopMenuOpen(false);
                    goToPath("/pricing");
                  }}
                >
                  Pricing
                </button>
                <button
                  type="button"
                  className="badge signOutBtn"
                  onClick={() => {
                    setTopMenuOpen(false);
                    handleSignOut();
                  }}
                >
                  Log out
                </button>
              </div>

              <div className="controls">
                <select value={level} onChange={(e) => setLevel(e.target.value)}>
                  <option>KS3</option>
                  <option>GCSE</option>
                  <option>A-Level</option>
                </select>
                <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                  {levelTopics.map((topicOption) => (
                    <option key={topicOption}>{topicOption}</option>
                  ))}
                </select>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option>Explain</option>
                  <option>Hint</option>
                  <option disabled={!isPaidPlan}>Quiz{isPaidPlan ? "" : " (Pro)"}</option>
                  <option disabled={!isPaidPlan}>Mark{isPaidPlan ? "" : " (Pro)"}</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </header>

      {checkoutNotice && <p className="paywallNotice inlineNotice">{checkoutNotice}</p>}
      {!isPaidPlan && (
        <section className="freePlanBanner">
          <div>
            <h3>Free plan</h3>
            <p>Use Explain + Hint with daily limits. Upgrade for unlimited tutoring and advanced features.</p>
            <p className="freePlanMeta">Usage today: {billingDailyUsed}{billingDailyLimit == null ? "" : ` / ${billingDailyLimit}`}</p>
          </div>
          <button type="button" className="sendBtn" onClick={() => goToPath("/pricing")} disabled={billingActionLoading}>
            {billingActionLoading ? "Redirecting..." : "View plans"}
          </button>
        </section>
      )}
      {billingError && <p className="authError">{billingError}</p>}
      {(billingLoading || historyLoading) && (
        <p className="inlineLoadingBanner">Syncing your workspace data...</p>
      )}

      <div className="workspaceTabs">
        <button type="button" className={`modeBtn ${viewMode === "tutor" ? "active" : ""}`} onClick={() => setViewMode("tutor")}>Tutor Workspace</button>
        <button type="button" className={`modeBtn ${viewMode === "dashboard" ? "active" : ""}`} onClick={() => { setViewMode("dashboard"); setStudentDashTab("overview"); fetchProgressOverview(); }}>Student Dashboard</button>
        {user.role === "teacher" && (
          <button type="button" className={`modeBtn ${viewMode === "teacher" ? "active" : ""}`} onClick={() => { setViewMode("teacher"); fetchTeacherResults(); }}>Teacher Dashboard</button>
        )}
      </div>

      {viewMode === "dashboard" && (
        <section className="dashboard">
          <div className="dashboardHead">
            <h2>Student Progress</h2>
            <button type="button" className="googleBtn" onClick={() => { fetchProgressOverview(); fetchLessons(); fetchStudentTasks(); }} disabled={progressLoading}>Refresh</button>
          </div>
          {progressError && <p className="authError">{progressError}</p>}

          <div className="metricsGrid">
            <article className="metricCard"><span>This week activity</span><strong>{thisWeekActivityCount}</strong></article>
            <article className="metricCard"><span>Top topics tracked</span><strong>{topTopics.length}</strong></article>
            <article className="metricCard"><span>Streak</span><strong>{streakDays} day(s)</strong></article>
            <article className="metricCard"><span>Total sessions</span><strong>{totalSessions}</strong></article>
          </div>

          <div className="dashboardSectionTabs">
            <button type="button" className={`modeBtn ${studentDashTab === "overview" ? "active" : ""}`} onClick={() => setStudentDashTab("overview")}>Overview</button>
            <button type="button" className={`modeBtn ${studentDashTab === "lessons" ? "active" : ""}`} onClick={() => setStudentDashTab("lessons")}>Lessons</button>
            <button type="button" className={`modeBtn ${studentDashTab === "quizzes" ? "active" : ""}`} onClick={() => setStudentDashTab("quizzes")}>Quizzes</button>
            <button type="button" className={`modeBtn ${studentDashTab === "tasks" ? "active" : ""}`} onClick={() => setStudentDashTab("tasks")}>Tasks</button>
            <button type="button" className={`modeBtn ${studentDashTab === "code" ? "active" : ""}`} onClick={() => setStudentDashTab("code")}>Code Review</button>
          </div>

          {studentDashTab === "overview" && (
            <div className="dashboardGrid">
              <article className="dashboardCard">
                <h3>Top 3 topics practiced</h3>
                {topTopics.length === 0 && <p>No topic activity yet.</p>}
                {topTopics.map((item) => {
                  const max = topTopics[0]?.count || 1;
                  const width = Math.max(8, Math.round((item.count / max) * 100));
                  return (
                    <div key={item.topic} className="progressRow">
                      <div className="progressMeta"><span>{item.topic}</span><strong>{item.count}</strong></div>
                      <div className="progressTrack"><div className="progressBar" style={{ width: `${width}%` }} /></div>
                    </div>
                  );
                })}
              </article>

              <article className="dashboardCard">
                <h3>Counts by topic</h3>
                {topicCounts.length === 0 && <p>No topic activity yet.</p>}
                <div className="modeChips">
                  {topicCounts.map((item) => (
                    <span key={item.topic} className="badge">{item.topic}: {item.count}</span>
                  ))}
                </div>
              </article>

              <article className="dashboardCard">
                <h3>Recent sessions</h3>
                {recentActivity.length === 0 && <p>No sessions yet.</p>}
                <div className="simpleList">
                  {recentActivity.map((session) => (
                    <div key={session.id} className="listCol">
                      <strong>{session.topic || "General"}</strong> · {session.mode || "Explain"} · {session.level || "KS3"}
                      <p>{new Date(session.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          )}

          {studentDashTab === "lessons" && (
            <article className="dashboardCard">
              <h3>Track lessons</h3>
              <form className="inlineForm" onSubmit={handleCreateLesson}>
                <input value={lessonTitle} onChange={(e) => setLessonTitle(e.target.value)} placeholder="Lesson title" />
                <input value={lessonTopic} onChange={(e) => setLessonTopic(e.target.value)} placeholder="Topic" />
                <button className="modeBtn" type="submit" disabled={lessonSaving}>{lessonSaving ? "Saving..." : "Add lesson"}</button>
              </form>
              <div className="simpleList">
                {lessons.slice(0, 16).map((lesson) => (
                  <div key={lesson.id} className="listRow">
                    <span>{lesson.title} {lesson.topic ? `(${lesson.topic})` : ""}</span>
                    <button type="button" className="modeBtn" onClick={() => handleToggleLesson(lesson.id, !lesson.completed)}>
                      {lesson.completed ? "Completed" : "Mark done"}
                    </button>
                  </div>
                ))}
                {!lessons.length && <p>No lessons yet. Add your first lesson above.</p>}
              </div>
            </article>
          )}

          {studentDashTab === "quizzes" && (
            <article className="dashboardCard">
              <h3>Log quiz score</h3>
              <form className="inlineForm" onSubmit={handleSaveQuizAttempt}>
                <input value={quizTopic} onChange={(e) => setQuizTopic(e.target.value)} placeholder="Topic" />
                <input value={quizScore} onChange={(e) => setQuizScore(e.target.value)} placeholder="Score" type="number" />
                <input value={quizMaxScore} onChange={(e) => setQuizMaxScore(e.target.value)} placeholder="Max" type="number" />
                <button className="modeBtn" type="submit" disabled={quizSaving}>{quizSaving ? "Saving..." : "Save score"}</button>
              </form>
            </article>
          )}

          {studentDashTab === "tasks" && (
            <article className="dashboardCard">
              <h3>Assigned tasks</h3>
              <div className="simpleList">
                {tasks.slice(0, 16).map((task) => (
                  <div key={task.id} className="listRow">
                    <span>{task.title} ({task.topic || "General"})</span>
                    <select value={task.status} onChange={(e) => handleUpdateTaskStatus(task.id, e.target.value)} disabled={taskSavingId === task.id}>
                      <option value="pending">Pending</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                ))}
                {!tasks.length && <p>No tasks assigned yet.</p>}
              </div>
            </article>
          )}

          {studentDashTab === "code" && (
            <article className="dashboardCard">
              <h3>Code review</h3>
              <p>Use the Tutor Workspace side panel for full code evaluation feedback with score and tips.</p>
              {codeEvalResult ? (
                <div className="meta">
                  <p><strong>Latest score:</strong> {codeEvalResult.score}/10</p>
                  <p>{codeEvalResult.summary}</p>
                </div>
              ) : (
                <p>No code review yet. Open Tutor Workspace and evaluate code.</p>
              )}
            </article>
          )}
        </section>
      )}

      {viewMode === "teacher" && user.role === "teacher" && (
        <section className="dashboard">
          <div className="dashboardHead">
            <h2>Teacher Dashboard</h2>
            <button type="button" className="googleBtn" onClick={fetchTeacherResults} disabled={teacherLoading}>Refresh</button>
          </div>
          {teacherError && <p className="authError">{teacherError}</p>}
          {assignNotice && <p className="paywallNotice inlineNotice">{assignNotice}</p>}

          <div className="dashboardGrid">
            <article className="dashboardCard">
              <h3>Generate coding quiz</h3>
              <form className="inlineForm" onSubmit={handleGenerateTeacherQuiz}>
                <input value={teacherQuizTitle} onChange={(e) => setTeacherQuizTitle(e.target.value)} placeholder="Quiz title (optional)" />
                <input value={teacherTopic} onChange={(e) => setTeacherTopic(e.target.value)} placeholder="Topic" />
                <select value={teacherLevel} onChange={(e) => setTeacherLevel(e.target.value)}>
                  <option>KS3</option>
                  <option>GCSE</option>
                  <option>A-Level</option>
                </select>
                <input type="number" value={teacherQuestionCount} onChange={(e) => setTeacherQuestionCount(e.target.value)} placeholder="Questions" min={1} max={10} />
                <button type="submit" className="modeBtn" disabled={teacherQuizLoading}>{teacherQuizLoading ? "Generating..." : "Generate"}</button>
              </form>
              {teacherQuizResult?.questions?.length > 0 && (
                <div className="simpleList">
                  {teacherQuizResult.questions.map((q) => (
                    <div key={q.id} className="listCol"><strong>Q{q.id}.</strong> {q.question}</div>
                  ))}
                </div>
              )}
            </article>

            <article className="dashboardCard">
              <h3>Assign task</h3>
              <form className="inlineForm" onSubmit={handleAssignTask}>
                <input value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)} placeholder="Student email" required />
                <input value={assignTitle} onChange={(e) => setAssignTitle(e.target.value)} placeholder="Task title" required />
                <input value={assignTopic} onChange={(e) => setAssignTopic(e.target.value)} placeholder="Topic" />
                <input type="date" value={assignDueDate} onChange={(e) => setAssignDueDate(e.target.value)} />
                <textarea value={assignDescription} onChange={(e) => setAssignDescription(e.target.value)} placeholder="Task details" rows={3} />
                <button type="submit" className="modeBtn" disabled={assignLoading}>{assignLoading ? "Assigning..." : "Assign"}</button>
              </form>
            </article>

            <article className="dashboardCard" style={{ gridColumn: "1 / -1" }}>
              <h3>Student results</h3>
              {teacherLoading && <p>Loading teacher analytics...</p>}
              {!teacherLoading && (
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Tasks</th>
                        <th>Completed</th>
                        <th>Avg quiz %</th>
                        <th>Avg code /10</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teacherResults.map((row) => (
                        <tr key={row.student_id}>
                          <td>{row.student_email}</td>
                          <td>{row.assigned_tasks}</td>
                          <td>{row.completed_tasks}</td>
                          <td>{row.avg_quiz_percent}</td>
                          <td>{row.avg_code_score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </div>
        </section>
      )}

      {viewMode === "tutor" && (
        <>
          {currentPath !== "/tools" && (
            <div className="starters">
              <span className="startersLabel">Try:</span>
              {starterPrompts.map((p) => (
                <button key={p.label} type="button" onClick={() => sendMessage(null, p.text)} disabled={loading}>{p.label}</button>
              ))}
              {isMobileViewport && (
                <button type="button" className="modeBtn starterLogoutBtn" onClick={handleSignOut}>
                  Log out
                </button>
              )}
            </div>
          )}

          <div className="layout">
            <div className={`chatColumn ${isMobileViewport && currentPath === "/tools" ? "mobileHidden" : ""}`}>
              <main className="chat" ref={chatRef}>
                <div className={`chatStream ${isFreshSession ? "freshSession" : ""}`}>
                  {historyLoading && <p className="inlineLoadingText">Loading your recent chat history...</p>}
                  {isFreshSession && !isMobileViewport && (
                    <div className="emptyState" aria-hidden="true">
                      <div className="emptyStateInner">
                        <h3>Your learning session starts here</h3>
                        <p>Pick a prompt or ask a question to get personalized guidance.</p>
                      </div>
                    </div>
                  )}

                  {messages.map((m, i) => (
                    <div key={i} className={`msg ${m.role}`}>
                      <div className="bubble"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                    </div>
                  ))}

                  {loading && (
                    <div className="msg assistant">
                      <div className="bubble typing" aria-live="polite">
                        <span className="typingDot" />
                        <span className="typingDot" />
                        <span className="typingDot" />
                      </div>
                    </div>
                  )}
                </div>
              </main>

              <div className={`chatDock ${isMobileViewport ? "mobile" : ""}`}>
                <form className="composer" onSubmit={sendMessage}>
                  <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a CS question..." />
                  <button
                    type="button"
                    className="modeBtn clearComposerBtn"
                    onClick={handleClearChat}
                    disabled={loading || isFreshSession}
                  >
                    Clear chat
                  </button>
                  <button type="submit" disabled={loading} className="sendBtn">{loading ? "Sending..." : "Send"}</button>
                </form>

                {isMobileViewport && (
                  <button
                    type="button"
                    className="modeBtn mobileToolsToggle"
                    onClick={() => {
                      goToPath("/tools");
                      sideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    Show tools & IDE
                  </button>
                )}
              </div>
            </div>

            {(!isMobileViewport || currentPath === "/tools") && (
            <aside className="side" ref={sideRef}>
              {isMobileViewport && currentPath === "/tools" && (
                <button
                  type="button"
                  className="modeBtn mobileBackToChatBtn"
                  onClick={() => {
                    goToPath("/");
                    chatRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  Back to chat
                </button>
              )}
              {currentPath !== "/tools" && (
                <>
                  <h3>Quick actions</h3>
                  <div className="actions">
                    <button type="button" onClick={() => setMode("Explain")} className={`modeBtn ${mode === "Explain" ? "active" : ""}`}>Explain</button>
                    <button type="button" onClick={() => setMode("Hint")} className={`modeBtn ${mode === "Hint" ? "active" : ""}`}>Hint</button>
                    <button type="button" onClick={() => setMode("Quiz")} className={`modeBtn ${mode === "Quiz" ? "active" : ""}`} disabled={!isPaidPlan}>{isPaidPlan ? "Quiz" : "Quiz (Pro)"}</button>
                    <button type="button" onClick={() => setMode("Mark")} className={`modeBtn ${mode === "Mark" ? "active" : ""}`} disabled={!isPaidPlan}>{isPaidPlan ? "Mark" : "Mark (Pro)"}</button>
                  </div>
                </>
              )}

              <div className="tips">
                <h4>Student IDE</h4>
                <p>Run Python or JavaScript code in-browser and inspect the output.</p>
                <div className="ideLanguageTabs">
                  <button
                    type="button"
                    className={`modeBtn ${codeLanguage === "python" ? "active" : ""}`}
                    onClick={() => handleLanguageChange("python")}
                  >
                    Python
                  </button>
                  <button
                    type="button"
                    className={`modeBtn ${codeLanguage === "javascript" ? "active" : ""}`}
                    onClick={() => handleLanguageChange("javascript")}
                  >
                    JavaScript
                  </button>
                </div>
                <div className="ideShell">
                  <div className="ideHead">
                    <strong>{codeLanguage === "python" ? "main.py" : "main.js"}</strong>
                    <span>{codeLanguage === "python" ? "print(...)" : "console.log(...)"}</span>
                  </div>
                  <textarea
                    className="ideEditor"
                    value={codeInput}
                    onChange={(e) => handleCodeInputChange(e.target.value)}
                    spellCheck="false"
                    placeholder={codeLanguage === "python" ? "Write Python code..." : "Write JavaScript code..."}
                    rows={11}
                  />
                  <div className="ideActions">
                    <button type="button" className="modeBtn active" onClick={handleRunCode} disabled={ideRunLoading}>
                      {ideRunLoading ? "Running..." : `Run ${codeLanguage === "python" ? "Python" : "JavaScript"}`}
                    </button>
                    <button
                      type="button"
                      className="modeBtn"
                      onClick={() => {
                        setIdeOutput("");
                        setIdeRunError("");
                      }}
                    >
                      Clear output
                    </button>
                    <button
                      type="button"
                      className="modeBtn"
                      onClick={() =>
                        setIdeDrafts((prev) => ({
                          ...prev,
                          [codeLanguage]: IDE_TEMPLATES[codeLanguage],
                        }))
                      }
                    >
                      Reset starter
                    </button>
                  </div>
                  <pre className="miniIdeOutput">{ideOutput || "Output will appear here..."}</pre>
                  {ideRunError && <pre className="miniIdeError">{ideRunError}</pre>}
                </div>
                <div className="inlineForm">
                  <button type="button" className="modeBtn" onClick={handleEvaluateCode} disabled={codeEvalLoading}>
                    {codeEvalLoading ? "Evaluating..." : "Evaluate with AI"}
                  </button>
                </div>
                {codeEvalError && <p className="authError">{codeEvalError}</p>}
                {codeEvalResult && (
                  <div className="meta">
                    <p><strong>Score:</strong> {codeEvalResult.score}/10</p>
                    <p>{codeEvalResult.summary}</p>
                    <p><strong>Improvements:</strong></p>
                    <ul>
                      {codeEvalResult.improvements?.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    <p><strong>Tips:</strong></p>
                    <ul>
                      {codeEvalResult.tips?.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </aside>
            )}
          </div>
        </>
      )}
    </div>
  );
}
