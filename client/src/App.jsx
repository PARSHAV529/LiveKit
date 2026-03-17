import { useRef, useEffect, useState } from "react";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";
const SILENCE_MS = 1500;

function isMobile() {
  const hasTouch = navigator.maxTouchPoints > 1;
  const smallScreen = window.screen.width <= 1024;
  return hasTouch && smallScreen;
}

const V1_COMMANDS = [
  { say: "hello / hi / hey", reply: "greeting" },
  { say: "how are you / how r u", reply: "I'm doing great!" },
  { say: "bye / goodbye", reply: "farewell" },
];

export default function App() {
  const [status, setStatus] = useState("idle");
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState("v1");
  const [started, setStarted] = useState(false);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [aiReply, setAiReply] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [micError, setMicError] = useState("");

  const wsRef = useRef(null);
  const bufferRef = useRef("");
  const statusRef = useRef("idle");
  const modeRef = useRef(mode);
  const recognitionRef = useRef(null);
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const transcriptRef = useRef("");
  const silenceTimerRef = useRef(null);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { window.speechSynthesis.cancel(); }, []);

  function setS(s) {
    statusRef.current = s;
    setStatus(s);
  }

  const STATUS_LABELS = {
    listening: "🎤 listening…",
    thinking: "💭 thinking…",
    speaking: "🔊 speaking…",
  };

  function getStatusLabel() {
    if (!connected) return "connecting…";
    if (!started) return "press start";
    return STATUS_LABELS[status] || "ready";
  }

  function switchMode(newMode) {
    if (newMode === mode) return;
    window.speechSynthesis.cancel();
    bufferRef.current = "";
    setAiReply("");
    setMode(newMode);
    if (started) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
      transcriptRef.current = "";
      setTranscript("");
      resumeRecognition();
    } else {
      setS("idle");
    }
  }

  useEffect(() => {
    let reconnectTimeout;
    
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      
      ws.onopen = () => setConnected(true);
      
      ws.onclose = () => {
        setConnected(false);
        reconnectTimeout = setTimeout(connect, 2000);
      };
      
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "word") bufferRef.current += msg.word;
        if (msg.type === "done") {
          const text = bufferRef.current.trim();
          bufferRef.current = "";
          if (text) speak(text);
        }
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  function speak(text) {
    pauseRecognition();
    window.speechSynthesis.cancel();
    setAiReply(text);
    setS("speaking");

    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => {
      if (statusRef.current === "speaking") resumeRecognition();
    };
    u.onerror = () => {
      if (statusRef.current === "speaking") resumeRecognition();
    };
    window.speechSynthesis.speak(u);
  }

  function send(text) {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;

    if (!text.trim()) return;

    transcriptRef.current = "";
    setTranscript("");
    pauseRecognition();
    setS("thinking");
    wsRef.current.send(
      JSON.stringify({ type: "text", text: text.trim(), mode: modeRef.current }),
    );
  }

  function startLevelMeter(stream) {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    src.connect(analyser);
    audioCtxRef.current = ctx;

    const data = new Uint8Array(analyser.frequencyBinCount);
    function tick() {
      analyser.getByteFrequencyData(data);
      const voiceBins = data.slice(3, 35);
      const avg = voiceBins.reduce((a, b) => a + b, 0) / voiceBins.length;
      setLevel(Math.min(100, avg * 2));
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();
  }

  function stopLevelMeter() {
    cancelAnimationFrame(rafRef.current);
    try { audioCtxRef.current?.close(); } catch {}
    setLevel(0);
  }

  function startRecognition() {
    stopRecognition();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    transcriptRef.current = "";
    setTranscript("");
    setS("listening");

    const r = new SR();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    recognitionRef.current = r;

    r.onresult = (e) => {
      if (statusRef.current === "speaking") {
        window.speechSynthesis.cancel();
        setS("listening");
      }

      const text = Array.from(e.results)
        .map((res) => res[0].transcript)
        .join(" ")
        .trim();

      transcriptRef.current = text;
      setTranscript(text);

      if (text) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          if (statusRef.current === "listening" && transcriptRef.current.trim()) {
            send(transcriptRef.current);
          }
        }, SILENCE_MS);
      }
    };

    r.onerror = (e) => {
      console.warn("Speech recognition error:", e.error);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stopSession();
        setMicError("Speech recognition blocked by browser.");
        return;
      }
      if (statusRef.current === "listening" && e.error !== "aborted") {
        setTimeout(() => resumeRecognition(), 500);
      }
    };

    r.onend = () => {
      if (statusRef.current === "listening") {
        setTimeout(() => {
          if (statusRef.current === "listening") {
            try { r.start(); } catch {}
          }
        }, 200);
      }
    };

    try { r.start(); } catch {}
  }

  function pauseRecognition() {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    try { recognitionRef.current?.stop(); } catch {}
  }

  function resumeRecognition() {
    transcriptRef.current = "";
    setTranscript("");
    setS("listening");
    try { recognitionRef.current?.start(); } catch {
      startRecognition();
    }
  }

  function stopRecognition() {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    try { recognitionRef.current?.abort(); } catch {}
    recognitionRef.current = null;
    transcriptRef.current = "";
    setTranscript("");
  }

  async function startSession() {
    if (isStarting) return;
    setIsStarting(true);
    setMicError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      startLevelMeter(stream);
      startRecognition();
      setStarted(true);
    } catch (err) {
      console.error("Mic error:", err);
      setMicError(err.message || "Microphone access denied.");
    } finally {
      setIsStarting(false);
    }
  }

  function stopSession() {
    window.speechSynthesis.cancel();
    stopRecognition();
    stopLevelMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setStarted(false);
    setTranscript("");
    setAiReply("");
    setIsStarting(false);
    setS("idle");
  }

  if (isMobile()) {
    return (
      <div className="app mobile-block">
        <p className="mobile-icon">🖥️</p>
        <p className="mobile-title">Desktop Only</p>
        <p className="mobile-msg">This app uses browser speech APIs that only work on desktop Chrome. Please open this on a desktop computer.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="mode-selector">
        <button
          className={`mode-btn ${mode === "v1" ? "active" : ""}`}
          onClick={() => switchMode("v1")}
        >
          <span className="mode-tag">v1</span>Static
        </button>
        <button
          className={`mode-btn ${mode === "v2" ? "active" : ""}`}
          onClick={() => switchMode("v2")}
        >
          <span className="mode-tag ai">v2</span>AI
        </button>
      </div>

      {mode === "v1" && !started && (
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

      {mode === "v2" && !started && (
        <p className="ai-hint">powered by Groq — ask anything</p>
      )}

      {started && (
        <div className="level-track">
          <div
            className="level-fill"
            style={{
              width: `${level}%`,
              background: level > 30 ? "#4ade80" : "#2a2a2a",
            }}
          />
        </div>
      )}

      {started && transcript && (
        <p className="transcript">🗣 "{transcript}"</p>
      )}
      {started && aiReply && (
        <p className="transcript ai-reply">🤖 "{aiReply}"</p>
      )}

      <p className="state">{getStatusLabel()}</p>

      <button
        className={`btn-mic ${status === "listening" ? "active" : ""} ${status === "speaking" ? "speaking" : ""}`}
        onClick={started ? stopSession : startSession}
        disabled={!connected || isStarting}
      >
        {isStarting ? "⏳" : started ? "⏹" : "▶"}
      </button>

      {micError && <p className="error-text" style={{ color: "#ef4444", fontSize: "12px", textAlign: "center", marginTop: "4px" }}>{micError}</p>}

      <p className="label">
        {!started && connected ? "press to start" : ""}
        {started && status === "listening" ? "speak — auto-sends on pause" : ""}
        {started && status === "speaking" ? "listening paused" : ""}
        {started && status === "thinking" ? "processing…" : ""}
      </p>
    </div>
  );
}
