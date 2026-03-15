import { useRef, useEffect, useState } from "react";
import "./App.css";

const WS_URL = "wss://livekit-1-t2mj.onrender.com";

export default function App() {
  const [status, setStatus] = useState("idle");
  const [connected, setConnected] = useState(false);
  const recognitionRef = useRef(null);
  const wsRef = useRef(null);

  const speak = (text) => {
    window.speechSynthesis.cancel();
    setStatus("speaking");
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => setStatus("idle");
    window.speechSynthesis.speak(u);
  };

  const startRecording = () => {
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
        setStatus("thinking");
        wsRef.current.send(JSON.stringify({ type: "text", text }));
      }
    };

    r.onerror = () => setStatus("idle");
    r.onend = () => setStatus((s) => (s === "recording" ? "idle" : s));

    r.start();
    setStatus("recording");
  };

  const stopRecording = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* empty */
    }
  };

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "answer") speak(msg.text);
    };
    ws.onclose = () => setConnected(false);
    return () => ws.close();
  }, []);

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
  }, [status]);

  return (
    <div className="app">
      <p className="state">
        {!connected && "connecting…"}
        {status === "idle" && connected && "ready"}
        {status === "recording" && "🔴 recording…"}
        {status === "thinking" && "💭 thinking…"}
        {status === "speaking" && "🔊 speaking…"}
      </p>

      <button
        className={`btn-mic ${status === "recording" ? "active" : ""}`}
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
