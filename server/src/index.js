import { createServer } from "http";
import { WebSocketServer } from "ws";
import { writeFile, unlink } from "fs/promises";
import { createReadStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import Groq from "groq-sdk";
import "dotenv/config";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

const QA = {
  hello: "Hey! I'm VoiceAI. How can I help?",
  hi: "Hi! Go ahead, I'm listening.",
  hey: "Hey! What's on your mind?",
  "how are you": "I'm doing great, thanks for asking!",
  "how r u": "I'm doing great, thanks!",
  bye: "Goodbye! Take care!",
  goodbye: "Goodbye! Have a great day!",
};

function getAnswer(text) {
  const lower = text.toLowerCase().trim();
  for (const [key, answer] of Object.entries(QA)) {
    if (lower.includes(key)) return answer;
  }
  return "I'm not sure about that yet!";
}

async function transcribeAudio(buffer) {
  const tmpPath = join(tmpdir(), `${randomUUID()}.webm`);
  try {
    await writeFile(tmpPath, buffer);
    const result = await client.audio.transcriptions.create({
      model: "whisper-large-v3",
      file: createReadStream(tmpPath),
      response_format: "json",
    });
    return result.text?.trim() || "";
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}

async function handleText(ws, text, mode) {
  if (!text) return;

  if (mode === "v1") {
    const answer = getAnswer(text);
    ws.send(JSON.stringify({ type: "word", word: answer }));
    ws.send(JSON.stringify({ type: "done" }));
    return;
  }

  try {
    const stream = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      max_tokens: 150,
      stream: true,
      messages: [
        {
          role: "system",
          content: "You are a helpful voice assistant. Keep replies short — max 2 sentences.",
        },
        { role: "user", content: text },
      ],
    });

    for await (const chunk of stream) {
      const word = chunk.choices[0]?.delta?.content || "";
      ws.send(JSON.stringify({ type: "word", word: word + " " }));
    }
    ws.send(JSON.stringify({ type: "done" }));
  } catch (err) {
    console.error("Groq LLM error:", err.message);
    ws.send(JSON.stringify({ type: "word", word: "Sorry, something went wrong." }));
    ws.send(JSON.stringify({ type: "done" }));
  }
}

const server = createServer((req, res) => {
  res.writeHead(200);
  res.end("voice server running");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("client connected");

  let currentMode = "v1";

  ws.on("message", async (data, isBinary) => {

    // ── Binary: raw audio blob ───────────────────────────────────────────────
    if (isBinary) {
      console.log(`Received audio blob — ${data.length} bytes, mode: ${currentMode}`);
      try {
        const text = await transcribeAudio(data);

        if (!text) {
          console.log("Whisper returned empty — skipping");
          // Tell client to go back to listening
          ws.send(JSON.stringify({ type: "transcript", text: "" }));
          ws.send(JSON.stringify({ type: "done" }));
          return;
        }

        console.log(`Whisper [${currentMode}]: "${text}"`);
        ws.send(JSON.stringify({ type: "transcript", text }));
        await handleText(ws, text, currentMode);
      } catch (err) {
        console.error("Whisper error:", err.message);
        ws.send(JSON.stringify({ type: "word", word: "Sorry, I couldn't understand that." }));
        ws.send(JSON.stringify({ type: "done" }));
      }
      return;
    }

    // ── Text: JSON control frames ────────────────────────────────────────────
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      console.warn("Non-JSON text frame — ignoring");
      return;
    }

    // Mode update sent just before binary blob
    if (msg.type === "mode") {
      currentMode = msg.mode;
      console.log(`Mode set to: ${currentMode}`);
      return;
    }

    // Legacy text path (keep for compatibility)
    if (msg.type === "text") {
      if (msg.mode) currentMode = msg.mode;
      await handleText(ws, msg.text, currentMode);
    }
  });

  ws.on("close", () => console.log("client disconnected"));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on port ${PORT}`);
});