import { useRef, useCallback } from "react";


export function useSpeechSynthesis({ onStart, onEnd } = {}) {
  const callbacksRef = useRef({ onStart, onEnd });
  callbacksRef.current = { onStart, onEnd };

  const speak = useCallback((text) => {
    window.speechSynthesis.cancel();
    callbacksRef.current.onStart?.();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => callbacksRef.current.onEnd?.();
    utterance.onerror = () => callbacksRef.current.onEnd?.();
    window.speechSynthesis.speak(utterance);
  }, []);

  const cancel = useCallback(() => {
    window.speechSynthesis.cancel();
  }, []);

  return { speak, cancel };
}
