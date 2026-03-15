import { useRef, useEffect, useState, useCallback } from "react";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

const V1_COMMANDS = [
  { say: "hello / hi / hey", reply: "greeting" },
  { say: "how are you / how r u", reply: "I'm doing great!" },
  { say: "bye / goodbye", reply: "farewell" },
];

export default function App() {
  const [status, setStatus] = useState("idle");
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState("v1");
  const recognitionRef = useRef(null);
  const wsRef = useRef(null);
  const bufferRef = useRef("");

  function speak(text) {
    if (!text.trim()) return;
    window.speechSynthesis.cancel();
    setStatus("speaking");
    const u = new SpeechSynthesisUtterance(text.trim());
    u.onend = () => setStatus("idle");
    u.onerror = () => setStatus("idle");
    window.speechSynthesis.speak(u);
  }

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "word") bufferRef.current += msg.word;
      if (msg.type === "done") {
        speak(bufferRef.current);
        bufferRef.current = "";
      }
    };
    ws.onclose = () => setConnected(false);
    return () => ws.close();
  }, []);

  const startRecording = useCallback(() => {
    if (!connected || status !== "idle") return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return alert("Use Chrome.");
    const r = new SR();
    r.lang = "en-US";
    r.continuous = false;
    r.interimResults = false;
    recognitionRef.current = r;
    r.onresult = (e) => {
      const text = e.results[0][0].transcript.trim();
      if (text) {
        bufferRef.current = "";
        setStatus("thinking");
        wsRef.current.send(JSON.stringify({ type: "text", text, mode }));
      }
    };
    r.onerror = () => setStatus("idle");
    r.onend = () => setStatus((s) => (s === "recording" ? "idle" : s));
    r.start();
    setStatus("recording");
  }, [connected, status, mode]);

  const stopRecording = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* empty */
    }
  };

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key.toLowerCase() === "r" && !e.repeat && status === "idle")
        startRecording();
    }
    function onKeyUp(e) {
      if (e.key.toLowerCase() === "r" && status === "recording")
        stopRecording();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [startRecording, status]);

  return (
    <div className="app">
      {/* mode selector */}
      <div className="mode-selector">
        <button
          className={`mode-btn ${mode === "v1" ? "active" : ""}`}
          onClick={() => setMode("v1")}
        >
          <span className="mode-tag">v1</span>
          Static
        </button>
        <button
          className={`mode-btn ${mode === "v2" ? "active" : ""}`}
          onClick={() => setMode("v2")}
        >
          <span className="mode-tag ai">v2</span>
          AI
        </button>
      </div>

      {/* v1 commands hint */}
      {mode === "v1" && (
        <div className="commands">
          <p className="commands-title">supported commands</p>
          {V1_COMMANDS.map((c, i) => (
            <div key={i} className="command-row">
              <span className="command-say">"{c.say}"</span>
              <span className="command-arrow">→</span>
              <span className="command-reply">{c.reply}</span>
            </div>
          ))}
        </div>
      )}

      {mode === "v2" && (
        <p className="ai-hint">powered by Groq — ask anything</p>
      )}

      <p className="state">
        {!connected && "connecting…"}
        {connected && status === "idle" && "ready"}
        {status === "recording" && "🔴 recording…"}
        {status === "thinking" && "💭 thinking…"}
        {status === "speaking" && "🔊 speaking…"}
      </p>

      <button
        className={`btn-mic ${status === "recording" ? "active" : ""} ${status === "speaking" ? "speaking" : ""}`}
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={(e) => {
          e.preventDefault();
          startRecording();
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          stopRecording();
        }}
        disabled={!connected || status === "thinking" || status === "speaking"}
      >
        🎙
      </button>

      <p className="label">
        {status === "idle" && connected ? "hold to speak  ·  hold R" : ""}
      </p>
    </div>
  );
}
