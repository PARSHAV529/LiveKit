import { useRef, useEffect, useState, useCallback } from "react";
import "./App.css";

import { WS_URL, V1_COMMANDS, STATUS_LABELS } from "./constants";
import { isMobile } from "./utils/isMobile";
import { useWebSocket } from "./hooks/useWebSocket";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "./hooks/useSpeechSynthesis";
import { useAudioLevel } from "./hooks/useAudioLevel";

export default function App() {
  const [status, setStatus] = useState("idle");
  const [mode, setMode] = useState("v1");
  const [started, setStarted] = useState(false);
  const [aiReply, setAiReply] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [micError, setMicError] = useState("");

  const statusRef = useRef("idle");
  const modeRef = useRef(mode);
  const bufferRef = useRef("");
  const streamRef = useRef(null);

  useEffect(() => { modeRef.current = mode; }, [mode]);

  function setS(s) {
    statusRef.current = s;
    setStatus(s);
  }


  const { connected, send: wsSend } = useWebSocket(WS_URL, {
    onMessage: useCallback((msg) => {
      if (msg.type === "word") bufferRef.current += msg.word;
      if (msg.type === "done") {
        const text = bufferRef.current.trim();
        bufferRef.current = "";
        if (text) {
          setAiReply(text);
          ttsRef.current.speak(text);
        }
      }
    }, []),
  });

  const recognition = useSpeechRecognition({
    onSilence: useCallback((text) => {
      setS("thinking");
      wsSend({ type: "text", text: text.trim(), mode: modeRef.current });
    }, [wsSend]),
    onInterrupt: useCallback(() => {
      ttsRef.current.cancel();
      setS("listening");
    }, []),
  });

  const tts = useSpeechSynthesis({
    onStart: useCallback(() => {
      recognition.pause();
      setS("speaking");
    }, [recognition]),
    onEnd: useCallback(() => {
      if (statusRef.current === "speaking") {
        recognition.resume();
        setS("listening");
      }
    }, [recognition]),
  });

  const ttsRef = useRef(tts);
  useEffect(() => { ttsRef.current = tts; }, [tts]);

  const level = useAudioLevel(started ? streamRef.current : null);


  async function startSession() {
    if (isStarting) return;
    setIsStarting(true);
    setMicError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      recognition.start();
      setStarted(true);
      setS("listening");
    } catch (err) {
      console.error("Mic error:", err);
      setMicError(err.message || "Microphone access denied.");
    } finally {
      setIsStarting(false);
    }
  }

  function stopSession() {
    tts.cancel();
    recognition.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStarted(false);
    setAiReply("");
    setIsStarting(false);
    setS("idle");
  }


  function switchMode(newMode) {
    if (newMode === mode) return;
    tts.cancel();
    bufferRef.current = "";
    setAiReply("");
    setMode(newMode);

    if (started) {
    
      recognition.stop();
      setTimeout(() => {
        recognition.start();
        setS("listening");
      }, 300);
    } else {
      setS("idle");
    }
  }


  function getStatusLabel() {
    if (!connected) return "connecting…";
    if (!started) return "press start";
    return STATUS_LABELS[status] || "ready";
  }

  useEffect(() => { window.speechSynthesis.cancel(); }, []);


  if (isMobile()) {
    return (
      <div className="app mobile-block">
        <p className="mobile-icon">🖥️</p>
        <p className="mobile-title">Desktop Only</p>
        <p className="mobile-msg">
          This app uses browser speech APIs that only work on desktop Chrome.
          Please open this on a desktop computer.
        </p>
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

      {started && recognition.transcript && (
        <p className="transcript">🗣 "{recognition.transcript}"</p>
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

      {(micError || recognition.error) && (
        <p className="error-text" style={{ color: "#ef4444", fontSize: "12px", textAlign: "center", marginTop: "4px" }}>
          {micError || recognition.error}
        </p>
      )}

      <p className="label">
        {!started && connected ? "press to start" : ""}
        {started && status === "listening" ? "speak — auto-sends on pause" : ""}
        {started && status === "speaking" ? "listening paused" : ""}
        {started && status === "thinking" ? "processing…" : ""}
      </p>
    </div>
  );
}
