export const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

export const SILENCE_MS = 1500;

export const V1_COMMANDS = [
  { say: "hello / hi / hey", reply: "greeting" },
  { say: "how are you / how r u", reply: "I'm doing great!" },
  { say: "bye / goodbye", reply: "farewell" },
];

export const STATUS_LABELS = {
  listening: "🎤 listening…",
  thinking: "💭 thinking…",
  speaking: "🔊 speaking…",
};
