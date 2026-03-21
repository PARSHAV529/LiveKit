import { useRef, useState, useCallback } from "react";
import { SILENCE_MS } from "../constants";


export function useSpeechRecognition({
  silenceMs = SILENCE_MS,
  onSilence,
  onInterrupt,
} = {}) {
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");

  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const silenceTimerRef = useRef(null);
  const statusRef = useRef("idle"); 
  const callbacksRef = useRef({ onSilence, onInterrupt });

  callbacksRef.current = { onSilence, onInterrupt };


  function clearSilenceTimer() {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
  }

  function resetTranscript() {
    transcriptRef.current = "";
    setTranscript("");
  }


  const start = useCallback(() => {
    clearSilenceTimer();
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    recognitionRef.current = null;
    resetTranscript();
    setError("");

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError("SpeechRecognition not supported in this browser.");
      return;
    }

    statusRef.current = "listening";

    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onresult = (e) => {
      if (statusRef.current === "speaking") {
        callbacksRef.current.onInterrupt?.();
        statusRef.current = "listening";
      }

      const text = Array.from(e.results)
        .map((res) => res[0].transcript)
        .join(" ")
        .trim();

      transcriptRef.current = text;
      setTranscript(text);

      if (text) {
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
          if (statusRef.current === "listening" && transcriptRef.current.trim()) {
            callbacksRef.current.onSilence?.(transcriptRef.current);
          }
        }, silenceMs);
      }
    };

    recognition.onerror = (e) => {
      console.warn("SpeechRecognition error:", e.error);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Speech recognition blocked by browser.");
        statusRef.current = "error";
        return;
      }
      if (statusRef.current === "listening" && e.error !== "aborted") {
        setTimeout(() => resume(), 500);
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      if (statusRef.current === "listening") {
        setTimeout(() => {
          if (recognitionRef.current !== recognition) return;
          if (statusRef.current === "listening") {
            try { recognition.start(); } catch { /* ignore */ }
          }
        }, 200);
      }
    };

    try { recognition.start(); } catch { /* ignore */ }
  }, [silenceMs]);


  const stop = useCallback(() => {
    statusRef.current = "idle";
    clearSilenceTimer();
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    recognitionRef.current = null;
    resetTranscript();
  }, []);

 
  const pause = useCallback(() => {
    statusRef.current = "speaking"; 
    clearSilenceTimer();
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  }, []);


  const resume = useCallback(() => {
    clearSilenceTimer();
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    recognitionRef.current = null;
    resetTranscript();

    setTimeout(() => start(), 150);
  }, [start]);
  const setInternalStatus = useCallback((s) => {
    statusRef.current = s;
  }, []);

  return {
    transcript,
    error,
    start,
    stop,
    pause,
    resume,
    setInternalStatus,
  };
}
