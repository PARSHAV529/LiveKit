import { createServer } from "http";
import { WebSocketServer } from "ws";
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

const server = createServer((req, res) => {
  res.writeHead(200);
  res.end("voice server running");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("client connected");

  ws.on("message", async (data) => {
    const msg = JSON.parse(data);
    if (msg.type !== "text") return;

    const mode = msg.mode || "v1";

    if (mode === "v1") {
      const answer = getAnswer(msg.text);
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
            content:
              "You are a helpful voice assistant. Keep replies short — max 2 sentences.",
          },
          { role: "user", content: msg.text },
        ],
      });

      for await (const chunk of stream) {
        const word = chunk.choices[0]?.delta?.content || "";

        ws.send(JSON.stringify({ type: "word", word: word + " " }));
      }

      ws.send(JSON.stringify({ type: "done" }));
    } catch (err) {
      console.error("Groq error:", err.message);
      ws.send(
        JSON.stringify({ type: "word", word: "Sorry, something went wrong." }),
      );
      ws.send(JSON.stringify({ type: "done" }));
    }
  });

  ws.on("close", () => console.log("client disconnected"));
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on port ${PORT}`);
});
