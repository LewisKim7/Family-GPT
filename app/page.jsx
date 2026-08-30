"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "family-gpt:conversations:v4";
const LEGACY_STORAGE_KEYS = [
  "luna-chat:conversations:v3",
  "luna-chat:conversations:v2",
  "luna-chat:conversations:v1",
];
const PREF_KEY = "family-gpt:preferences:v1";
const MAX_CONVERSATIONS = 200;

const MODEL_OPTIONS = {
  luna: {
    key: "luna",
    name: "Luna",
    fullName: "GPT-5.6 Luna",
    mark: "L",
    icon: "⚡",
    note: "빠르게 · 절약",
    usage: "약 3 credits/작업",
  },
  terra: {
    key: "terra",
    name: "Terra",
    fullName: "GPT-5.6 Terra",
    mark: "T",
    icon: "◆",
    note: "균형 · 기본",
    usage: "약 7 credits/작업",
  },
  sol: {
    key: "sol",
    name: "Sol",
    fullName: "GPT-5.6 Sol",
    mark: "S",
    icon: "🧠",
    note: "깊게 · 사용량↑",
    usage: "약 14 credits/작업",
  },
};

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newConversation() {
  const now = Date.now();
  return { id: makeId(), title: "새 채팅", createdAt: now, updatedAt: now, messages: [] };
}

function titleFrom(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 30 ? `${clean.slice(0, 30)}…` : clean || "새 채팅";
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function windowLabel(window, fallback) {
  const seconds = Number(window?.windowSeconds ?? 0);
  if (seconds >= 6 * 24 * 60 * 60) return "주간";
  if (seconds >= 4 * 60 * 60 && seconds <= 6 * 60 * 60) return "5시간";
  return fallback;
}

function resetLabel(window) {
  if (!window) return "";
  const resetAt = Number(window.resetAt || 0) * 1000;
  if (resetAt > Date.now()) {
    return `${new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(resetAt))} 재설정`;
  }
  const after = Number(window.resetAfterSeconds || 0);
  if (after > 0) {
    const hours = Math.ceil(after / 3600);
    return `${hours}시간 내 재설정`;
  }
  return "";
}

function Icon({ name, size = 20 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "menu") return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
  if (name === "trash") return <svg {...common}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>;
  if (name === "send") return <svg {...common}><path d="m4 4 16 8-16 8 3-8-3-8Z" /><path d="M7 12h13" /></svg>;
  if (name === "stop") return <svg {...common}><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /></svg>;
  if (name === "spark") return <svg {...common}><path d="M12 3l1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" /></svg>;
  if (name === "refresh") return <svg {...common}><path d="M20 6v5h-5" /><path d="M19 11a7 7 0 1 0 1 5" /></svg>;
  if (name === "lock") return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  if (name === "globe") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>;
  if (name === "copy") return <svg {...common}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>;
  return null;
}

function ModelOrb({ model = "terra", size = "normal" }) {
  const option = MODEL_OPTIONS[model] || MODEL_OPTIONS.terra;
  return <div className={`luna-orb ${size}`.trim()}><span>{option.mark}</span></div>;
}

function Message({ message }) {
  const modelKey = MODEL_OPTIONS[message.model] ? message.model : "terra";
  const model = MODEL_OPTIONS[modelKey];

  async function copyText() {
    if (!message.content) return;
    try { await navigator.clipboard.writeText(message.content); } catch {}
  }

  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-inner">
        {message.role === "assistant" && <ModelOrb model={modelKey} size="message-orb" />}
        <div className={`message-stack ${message.role}`}>
          <div className={`message-bubble ${message.role}`}>
            {message.content || <span className="typing"><i /><i /><i /></span>}
          </div>
          {message.role === "assistant" && message.content && (
            <div className="message-meta">
              <span>{model.name}{message.webSearch ? " · 웹검색 가능" : ""}</span>
              <button onClick={copyText} aria-label="답변 복사"><Icon name="copy" size={13} /> 복사</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PinReveal({ pin, onDone }) {
  async function copyPin() {
    try { await navigator.clipboard.writeText(pin); } catch {}
  }

  return (
    <main className="auth-shell">
      <section className="auth-card pin-reveal-card">
        <ModelOrb model="terra" size="large" />
        <p className="eyebrow">FAMILY ACCESS</p>
        <h1>가족 PIN이 생성됐습니다</h1>
        <p className="auth-copy">앞으로 가족은 OpenAI 로그인 없이 이 PIN만 입력하면 Family GPT를 사용할 수 있습니다.</p>
        <button className="device-code family-pin-code" onClick={copyPin}>{pin}</button>
        <button className="primary-button" onClick={copyPin}>PIN 복사</button>
        <button className="text-button pin-confirm" onClick={onDone}>확인했어요</button>
        <p className="auth-note">PIN은 가족에게만 공유하세요.</p>
      </section>
    </main>
  );
}

function PinGate({ onConnected }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!pin.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "PIN 인증에 실패했습니다.");
      onConnected();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PIN 인증에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <ModelOrb model="terra" size="large" />
        <p className="eyebrow">FAMILY GPT</p>
        <h1>가족 PIN</h1>
        <p className="auth-copy">OpenAI 로그인은 필요 없습니다. 가족 PIN만 입력하세요.</p>
        <form className="pin-form" onSubmit={submit}>
          <div className="pin-input-wrap">
            <Icon name="lock" size={18} />
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\s/g, "").toLowerCase().slice(0, 32))}
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              placeholder="가족 PIN"
              aria-label="가족 PIN"
            />
          </div>
          <button className="primary-button" disabled={busy || pin.trim().length < 4}>{busy ? "확인 중…" : "입장"}</button>
        </form>
        {error && <p className="auth-error">{error}</p>}
        <p className="auth-note">ChatGPT 개인 대화와는 완전히 분리되어 있습니다.</p>
      </section>
    </main>
  );
}

function OwnerAuthGate({ onConnected }) {
  const [flow, setFlow] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);

  useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), []);

  async function poll(intervalSeconds) {
    try {
      const response = await fetch("/api/auth/device/poll", { method: "POST" });
      const payload = await response.json();
      if (response.ok && payload.status === "connected") {
        setState("connected");
        onConnected(payload.generatedPin || null);
        return;
      }
      if (response.status === 202 && Date.now() - startedAtRef.current < 15 * 60 * 1000) {
        timerRef.current = setTimeout(() => poll(intervalSeconds), Math.max(intervalSeconds, 5) * 1000);
        return;
      }
      throw new Error(payload.error || "인증 시간이 만료되었습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "인증 연결에 실패했습니다.");
      setState("error");
    }
  }

  async function startLogin() {
    setError("");
    setState("starting");
    try {
      const response = await fetch("/api/auth/device/start", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "인증 코드를 만들지 못했습니다.");
      setFlow(payload);
      setState("waiting");
      startedAtRef.current = Date.now();
      try { await navigator.clipboard.writeText(payload.userCode); } catch {}
      window.open(payload.verificationUrl, "_blank", "noopener,noreferrer");
      timerRef.current = setTimeout(() => poll(payload.interval), Math.max(payload.interval, 5) * 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "인증을 시작하지 못했습니다.");
      setState("error");
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <ModelOrb model="terra" size="large" />
        <p className="eyebrow">OWNER SETUP</p>
        <h1>Family GPT</h1>
        <p className="auth-copy">공용 Codex 세션이 없습니다. 소유자가 ChatGPT Plus를 한 번만 연결하면 이후 가족은 PIN만 사용합니다.</p>
        {!flow ? (
          <button className="primary-button" disabled={state === "starting"} onClick={startLogin}>{state === "starting" ? "연결 준비 중…" : "ChatGPT Plus 연결"}</button>
        ) : (
          <div className="device-box">
            <p>OpenAI 창에 아래 1회용 코드를 입력하세요. 코드는 자동 복사했습니다.</p>
            <button className="device-code" onClick={() => navigator.clipboard?.writeText(flow.userCode)}>{flow.userCode}</button>
            <a className="primary-button" href={flow.verificationUrl} target="_blank" rel="noreferrer">OpenAI 인증 열기</a>
            <p className="waiting-copy">승인 대기 중… 승인되면 자동 연결됩니다.</p>
          </div>
        )}
        {error && <p className="auth-error">{error}</p>}
        <p className="auth-note">브라우저 확장 · OpenAI API key · 별도 API 결제 없음</p>
      </section>
    </main>
  );
}

function UsageMeter({ label, window }) {
  if (!window) return null;
  const used = clampPercent(window.usedPercent);
  return (
    <div className="usage-meter">
      <div className="usage-line"><span>{label}</span><strong>{Math.round(used)}%</strong></div>
      <div className="usage-track"><span style={{ width: `${used}%` }} /></div>
      <div className="usage-reset">{resetLabel(window)}</div>
    </div>
  );
}

function ModelSelector({ model, onChange, disabled }) {
  return (
    <div className="model-selector" role="group" aria-label="모델 선택">
      {Object.values(MODEL_OPTIONS).map((option) => (
        <button
          key={option.key}
          className={`model-option ${model === option.key ? "active" : ""}`}
          onClick={() => onChange(option.key)}
          disabled={disabled}
          aria-pressed={model === option.key}
          title={`${option.fullName} · ${option.note} · ${option.usage}`}
        >
          <span className="model-option-icon">{option.icon}</span>
          <span className="model-option-copy"><strong>{option.name}</strong><small>{option.note}</small></span>
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  const [authState, setAuthState] = useState("checking");
  const [setupPin, setSetupPin] = useState(null);
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("terra");
  const [webSearch, setWebSearch] = useState(true);
  const endRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);

  async function checkAuth() {
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      const payload = await response.json();
      setAuthState(payload.status || (payload.connected ? "connected" : "owner_login_required"));
      if (payload.generatedPin) setSetupPin(payload.generatedPin);
    } catch {
      setAuthState("owner_login_required");
    }
  }

  async function loadUsage() {
    if (authState !== "connected") return;
    setUsageLoading(true);
    try {
      const response = await fetch("/api/usage", { cache: "no-store" });
      if (response.ok) setUsage(await response.json());
    } catch {} finally {
      setUsageLoading(false);
    }
  }

  useEffect(() => { checkAuth(); }, []);

  useEffect(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      if (MODEL_OPTIONS[prefs.model]) setModel(prefs.model);
      if (typeof prefs.webSearch === "boolean") setWebSearch(prefs.webSearch);
    } catch {}

    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        for (const key of LEGACY_STORAGE_KEYS) {
          raw = localStorage.getItem(key);
          if (raw) break;
        }
      }
      const parsed = JSON.parse(raw || "[]");
      if (Array.isArray(parsed) && parsed.length) {
        const limited = parsed.slice(0, MAX_CONVERSATIONS);
        setConversations(limited);
        setActiveId(limited[0].id);
      } else {
        const fresh = newConversation();
        setConversations([fresh]);
        setActiveId(fresh.id);
      }
    } catch {
      const fresh = newConversation();
      setConversations([fresh]);
      setActiveId(fresh.id);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS))); } catch {}
  }, [conversations, ready]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ model, webSearch })); } catch {}
  }, [model, webSearch, ready]);

  useEffect(() => {
    if (authState !== "connected") return undefined;
    loadUsage();
    const timer = setInterval(loadUsage, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [authState]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [conversations, activeId, isGenerating]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  const active = useMemo(() => conversations.find((conversation) => conversation.id === activeId) || conversations[0], [conversations, activeId]);
  const selectedModel = MODEL_OPTIONS[model] || MODEL_OPTIONS.terra;
  const maxUsage = Math.max(Number(usage?.primary?.usedPercent || 0), Number(usage?.secondary?.usedPercent || 0));
  const usageHigh = maxUsage >= 75;

  function updateActive(updater) {
    setConversations((items) => items
      .map((item) => (item.id === activeId ? updater(item) : item))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS));
  }

  function startNewChat() {
    if (isGenerating) abortRef.current?.abort();
    const fresh = newConversation();
    setConversations((items) => [fresh, ...items].slice(0, MAX_CONVERSATIONS));
    setActiveId(fresh.id);
    setDraft("");
    setError("");
    setSidebarOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function deleteConversation(id) {
    setConversations((items) => {
      const remaining = items.filter((item) => item.id !== id);
      if (remaining.length) {
        if (id === activeId) setActiveId(remaining[0].id);
        return remaining;
      }
      const fresh = newConversation();
      setActiveId(fresh.id);
      return [fresh];
    });
  }

  async function requestChat(messages, signal, options, allowReconnect = true) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages,
        model: options.model,
        webSearch: options.webSearch,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      signal,
    });
    if (response.status === 401 && allowReconnect) {
      const authResponse = await fetch("/api/auth/status", { cache: "no-store" });
      const authPayload = await authResponse.json();
      if (authPayload.connected) return requestChat(messages, signal, options, false);
      setAuthState(authPayload.status || "pin_required");
    }
    return response;
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || isGenerating || !active) return;
    setError("");
    setDraft("");

    const turnOptions = { model, webSearch };
    const userMessage = { id: makeId(), role: "user", content: text };
    const assistantMessage = {
      id: makeId(),
      role: "assistant",
      content: "",
      model: turnOptions.model,
      webSearch: turnOptions.webSearch,
    };
    const firstUserMessage = active.messages.every((message) => message.role !== "user");

    updateActive((conversation) => ({
      ...conversation,
      title: firstUserMessage ? titleFrom(text) : conversation.title,
      updatedAt: Date.now(),
      messages: [...conversation.messages, userMessage, assistantMessage],
    }));

    const requestMessages = [...active.messages, userMessage].map(({ role, content }) => ({ role, content }));
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);

    try {
      const response = await requestChat(requestMessages, controller.signal, turnOptions);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "답변을 가져오지 못했습니다.");
      }
      if (!response.body) throw new Error("스트리밍 응답을 열 수 없습니다.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        updateActive((conversation) => ({
          ...conversation,
          updatedAt: Date.now(),
          messages: conversation.messages.map((message) =>
            message.id === assistantMessage.id ? { ...message, content: answer } : message,
          ),
        }));
      }
      loadUsage();
    } catch (caught) {
      if (caught?.name !== "AbortError") {
        const detail = caught instanceof Error ? caught.message : "알 수 없는 오류가 발생했습니다.";
        setError(detail);
        updateActive((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantMessage.id && !message.content
              ? { ...message, content: `오류: ${detail}` }
              : message,
          ),
        }));
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthState("pin_required");
    setUsage(null);
  }

  if (!ready || authState === "checking") return <div className="loading-screen"><ModelOrb model="terra" /></div>;
  if (setupPin) return <PinReveal pin={setupPin} onDone={() => setSetupPin(null)} />;
  if (authState === "pin_required") return <PinGate onConnected={() => setAuthState("connected")} />;
  if (authState !== "connected") return <OwnerAuthGate onConnected={(pin) => { setAuthState("connected"); if (pin) setSetupPin(pin); }} />;

  return (
    <main className="app-shell">
      <div className={`mobile-scrim ${sidebarOpen ? "show" : ""}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <button className="new-chat" onClick={startNewChat}><Icon name="plus" size={18} />새 채팅</button>
        </div>
        <div className="history-label">최근</div>
        <div className="history-list">
          {conversations.map((conversation) => (
            <div key={conversation.id} className={`history-row ${conversation.id === activeId ? "active" : ""}`}>
              <button className="history-item" onClick={() => { setActiveId(conversation.id); setSidebarOpen(false); setError(""); }}>{conversation.title}</button>
              <button className="delete-chat" onClick={() => deleteConversation(conversation.id)} aria-label="대화 삭제"><Icon name="trash" size={16} /></button>
            </div>
          ))}
        </div>

        <div className="usage-card">
          <div className="usage-head">
            <span>Codex 사용량</span>
            <button onClick={loadUsage} disabled={usageLoading} aria-label="사용량 새로고침"><Icon name="refresh" size={14} /></button>
          </div>
          {usage ? (
            <>
              <UsageMeter label={windowLabel(usage.primary, "단기")} window={usage.primary} />
              <UsageMeter label={windowLabel(usage.secondary, "장기")} window={usage.secondary} />
              {!usage.primary && !usage.secondary && <div className="usage-empty">사용량 정보 없음</div>}
              {usageHigh && model !== "luna" && (
                <button className="usage-saver" onClick={() => setModel("luna")}>사용량 높음 · ⚡ Luna로 절약</button>
              )}
            </>
          ) : <div className="usage-empty">{usageLoading ? "확인 중…" : "사용량 정보 없음"}</div>}
        </div>

        <div className="sidebar-account">
          <div className="account-dot" />
          <div className="account-copy"><strong>공용 Plus 연결됨</strong><span>{selectedModel.fullName} · 가족 PIN</span></div>
          <button className="disconnect" onClick={logout}>잠금</button>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="메뉴 열기"><Icon name="menu" size={21} /></button>
          <ModelSelector model={model} onChange={setModel} disabled={isGenerating} />
          <button
            className={`search-toggle ${webSearch ? "active" : ""}`}
            onClick={() => setWebSearch((value) => !value)}
            disabled={isGenerating}
            aria-pressed={webSearch}
            title="최신 정보가 필요할 때 모델이 웹검색을 자동으로 사용합니다."
          >
            <Icon name="globe" size={16} />
            <span>{webSearch ? "검색 자동" : "검색 끔"}</span>
          </button>
        </header>

        <div className={`conversation ${active?.messages.length ? "has-messages" : "empty"}`}>
          {!active?.messages.length ? (
            <div className="empty-state">
              <ModelOrb model={model} size="hero" />
              <h1>무엇을 도와드릴까요?</h1>
              <p>{selectedModel.fullName}가 답합니다. {webSearch ? "최신 정보는 필요할 때 자동 검색합니다." : "웹검색은 꺼져 있습니다."}</p>
              <div className="mode-summary">
                <span>⚡ Luna 절약</span><span>◆ Terra 기본</span><span>🧠 Sol 깊게</span>
              </div>
            </div>
          ) : (
            <div className="messages">
              {active.messages.map((message) => <Message key={message.id} message={message} />)}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {error && <div className="error-banner">{error}</div>}
          <div className="composer">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="메시지를 입력하세요"
              rows={1}
              disabled={isGenerating}
            />
            <div className="composer-footer">
              <div className="composer-status">
                <span><Icon name="spark" size={14} /> {selectedModel.name}</span>
                <span className={webSearch ? "search-on" : ""}><Icon name="globe" size={14} /> {webSearch ? "자동 검색" : "검색 끔"}</span>
              </div>
              {isGenerating ? (
                <button className="send-button" onClick={() => abortRef.current?.abort()} aria-label="답변 중지"><Icon name="stop" size={18} /></button>
              ) : (
                <button className="send-button" onClick={sendMessage} disabled={!draft.trim()} aria-label="보내기"><Icon name="send" size={18} /></button>
              )}
            </div>
          </div>
          <p className="disclaimer">Terra가 기본입니다. Sol은 어려운 질문에만 쓰면 Plus 사용량을 아낄 수 있습니다.</p>
        </div>
      </section>
    </main>
  );
}
