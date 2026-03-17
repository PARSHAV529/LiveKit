import { useRef, useEffect, useState, useCallback } from "react";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

function getMimeType() {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
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
  const [isRecording, setIsRecording] = useState(false); // push-to-talk active

  const wsRef = useRef(null);
  const bufferRef = useRef("");
  const statusRef = useRef("idle");
  const modeRef = useRef(mode);
  const isRecordingRef = useRef(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const mimeTypeRef = useRef("");

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { window.speechSynthesis.cancel(); }, []);

  function setS(s) {
    statusRef.current = s;
    setStatus(s);
  }

  const STATUS_LABELS = {
    listening: "🎤 hold Space to speak",
    recording: "🔴 recording…",
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
    setTranscript("");
    setS(started ? "listening" : "idle");
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────
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
        if (msg.type === "transcript") { setTranscript(msg.text); return; }
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
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, []);

  // ── TTS ────────────────────────────────────────────────────────────────────
  function speak(text) {
    window.speechSynthesis.cancel();
    setAiReply(text);
    setS("speaking");
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => { if (statusRef.current === "speaking") setS("listening"); };
    u.onerror = () => { if (statusRef.current === "speaking") setS("listening"); };
    window.speechSynthesis.speak(u);
  }

  // ── Audio level meter (visual only — no VAD logic) ─────────────────────────
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

  // ── Push-to-talk: start recording ─────────────────────────────────────────
  const startRecording = useCallback(() => {
    if (
      !started ||
      isRecordingRef.current ||
      statusRef.current === "thinking" ||
      statusRef.current === "speaking" ||
      !streamRef.current
    ) return;

    const mimeType = mimeTypeRef.current;
    const options = mimeType ? { mimeType } : {};
    const mr = new MediaRecorder(streamRef.current, options);
    audioChunksRef.current = [];

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    mr.onstop = () => {
      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      if (chunks.length === 0) { setS("listening"); return; }

      const audioBlob = new Blob(chunks, { type: mimeType || "audio/webm" });

      // Need at least ~0.3s of audio to be worth sending
      if (audioBlob.size < 3000) { setS("listening"); return; }

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // Send current mode as a text frame first so server knows context
        wsRef.current.send(JSON.stringify({ type: "mode", mode: modeRef.current }));
        wsRef.current.send(audioBlob);
        setS("thinking");
      } else {
        setS("listening");
      }
    };

    mr.start(100);
    mediaRecorderRef.current = mr;
    isRecordingRef.current = true;
    setIsRecording(true);
    setS("recording");
    setTranscript("");
    setAiReply("");
  }, [started]);

  // ── Push-to-talk: stop recording ──────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    try {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop(); // triggers onstop → sends blob
      }
    } catch {}
    mediaRecorderRef.current = null;
  }, []);

  // ── Keyboard: Space = push-to-talk ────────────────────────────────────────
  useEffect(() => {
    if (!started) return;

    function onKeyDown(e) {
      if (e.code === "Space" && !e.repeat && e.target.tagName !== "INPUT") {
        e.preventDefault();
        startRecording();
      }
    }
    function onKeyUp(e) {
      if (e.code === "Space" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        stopRecording();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [started, startRecording, stopRecording]);

  // ── Session ────────────────────────────────────────────────────────────────
  async function startSession() {
    if (isStarting) return;
    setIsStarting(true);
    setMicError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      mimeTypeRef.current = getMimeType();
      startLevelMeter(stream);
      setStarted(true);
      setS("listening");
    } catch (err) {
      setMicError(err.message || "Microphone access denied.");
    } finally {
      setIsStarting(false);
    }
  }

  function stopSession() {
    window.speechSynthesis.cancel();
    stopRecording();
    stopLevelMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    setStarted(false);
    setTranscript("");
    setAiReply("");
    setS("idle");
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <div className="mode-selector">
        <button className={`mode-btn ${mode === "v1" ? "active" : ""}`} onClick={() => switchMode("v1")}>
          <span className="mode-tag">v1</span>Static
        </button>
        <button className={`mode-btn ${mode === "v2" ? "active" : ""}`} onClick={() => switchMode("v2")}>
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
        <div
          className="level-track"
          style={{ cursor: "pointer" }}
        >
          <div
            className="level-fill"
            style={{
              width: `${level}%`,
              background: isRecording ? "#f87171" : "#2a2a2a",
              transition: "background 0.1s",
            }}
          />
        </div>
      )}

      {started && transcript && <p className="transcript">🗣 "{transcript}"</p>}
      {started && aiReply && <p className="transcript ai-reply">🤖 "{aiReply}"</p>}

      <p className="state">{getStatusLabel()}</p>

      {/* Push-to-talk button — hold to record */}
      {started && (
        <button
          className={`btn-mic ${isRecording ? "active" : ""}`}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onMouseLeave={stopRecording}
          onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
          disabled={status === "thinking" || status === "speaking"}
          style={{ userSelect: "none", WebkitUserSelect: "none" }}
        >
          🎤
        </button>
      )}

      {/* Start / Stop session button */}
      <button
        className="btn-mic"
        style={{ marginTop: started ? "8px" : "0", fontSize: "14px", opacity: 0.7 }}
        onClick={started ? stopSession : startSession}
        disabled={!connected || isStarting}
      >
        {isStarting ? "⏳" : started ? "⏹ stop" : "▶ start"}
      </button>

      {micError && (
        <p style={{ color: "#ef4444", fontSize: "12px", textAlign: "center", marginTop: "4px" }}>
          {micError}
        </p>
      )}

      <p className="label">
        {!started && connected && "press start to begin"}
        {started && status === "listening" && "hold 🎤 or Space to speak"}
        {started && status === "recording" && "release to send…"}
        {started && status === "thinking" && "transcribing…"}
        {started && status === "speaking" && "wait for reply to finish…"}
      </p>
    </div>
  );
}