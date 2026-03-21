import { useRef, useEffect, useState } from "react";


export function useAudioLevel(stream) {
  const [level, setLevel] = useState(0);
  const ctxRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!stream) {
      setLevel(0);
      return;
    }

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);
    ctxRef.current = ctx;

    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteFrequencyData(data);
      const voiceBins = data.slice(3, 35);
      const avg = voiceBins.reduce((a, b) => a + b, 0) / voiceBins.length;
      setLevel(Math.min(100, avg * 2));
      rafRef.current = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      cancelAnimationFrame(rafRef.current);
      try { ctx.close(); } catch { /* ignore */ }
      setLevel(0);
    };
  }, [stream]);

  return level;
}
