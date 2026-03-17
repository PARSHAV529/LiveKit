import { useRef, useEffect, useState } from "react";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";
const SILENCE_MS = 1500; // ms of silence after speech → auto-send

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
  const [transcript, setTranscript] = useState(""); // live debug text
  const [aiReply, setAiReply] = useState(""); // AI response text

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

  // Keep modeRef in sync
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Cancel leftover speech on page load
  useEffect(() => { window.speechSynthesis.cancel(); }, []);

  function setS(s) {
    statusRef.current = s;
    setStatus(s);
  }

  // ── WebSocket ──────────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "word") bufferRef.current += msg.word;
      if (msg.type === "done") {
        const text = bufferRef.current.trim();
        bufferRef.current = "";
        if (text) speak(text);
      }
    };
    return () => ws.close();
  }, []);

  // ── Speak AI reply, then resume listening ──────────────
  function speak(text) {
    // Pause recognition while AI speaks to prevent looping
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

  // ── Send transcript to server ──────────────────────────
  function send(text) {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;

    if (!text.trim()) return; // nothing to send

    transcriptRef.current = "";
    setTranscript("");
    pauseRecognition();
    setS("thinking");
    wsRef.current.send(
      JSON.stringify({ type: "text", text: text.trim(), mode: modeRef.current }),
    );
  }

  // ── Mic level meter (visual only) ──────────────────────
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

  // ── SpeechRecognition — continuous, always-on ──────────
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
      // If AI is still speaking and user talks, interrupt
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
        // Reset silence timer — send after user pauses
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          if (statusRef.current === "listening" && transcriptRef.current.trim()) {
            send(transcriptRef.current);
          }
        }, SILENCE_MS);
      }
    };

    r.onerror = (e) => {
      if (["no-speech", "aborted"].includes(e.error)) return;
      console.warn("SpeechRecognition error:", e.error);
    };

    r.onend = () => {
      // Auto-restart if we're supposed to be listening
      if (statusRef.current === "listening") {
        try { r.start(); } catch {}
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
      // If stop() destroyed it, recreate
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

  // ── Start / Stop session ───────────────────────────────
  async function startSession() {
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
    } catch {
      alert("Microphone access denied.");
    }
  }

  function stopSession() {
    window.speechSynthesis.cancel();
    stopRecognition();
    stopLevelMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setStarted(false);
    setS("idle");
  }

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="app">
      <div className="mode-selector">
        <button
          className={`mode-btn ${mode === "v1" ? "active" : ""}`}
          onClick={() => { setMode("v1"); window.speechSynthesis.cancel(); bufferRef.current = ""; }}
        >
          <span className="mode-tag">v1</span>Static
        </button>
        <button
          className={`mode-btn ${mode === "v2" ? "active" : ""}`}
          onClick={() => { setMode("v2"); window.speechSynthesis.cancel(); bufferRef.current = ""; }}
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

      {/* Debug: live transcript & AI reply */}
      {started && transcript && (
        <p className="transcript">🗣 "{transcript}"</p>
      )}
      {started && aiReply && (
        <p className="transcript ai-reply">🤖 "{aiReply}"</p>
      )}

      <p className="state">
        {!connected && "connecting…"}
        {connected && !started && "press start"}
        {started && status === "idle" && "ready"}
        {status === "listening" && "🎤 listening…"}
        {status === "thinking" && "💭 thinking…"}
        {status === "speaking" && "🔊 speaking…"}
      </p>

      <button
        className={`btn-mic ${status === "listening" ? "active" : ""} ${status === "speaking" ? "speaking" : ""}`}
        onClick={started ? stopSession : startSession}
        disabled={!connected}
      >
        {started ? "⏹" : "▶"}
      </button>

      <p className="label">
        {!started && connected ? "press to start" : ""}
        {started && status === "listening" ? "speak — auto-sends on pause" : ""}
        {started && status === "speaking" ? "listening paused" : ""}
        {started && status === "thinking" ? "processing…" : ""}
      </p>
    </div>
  );
}
