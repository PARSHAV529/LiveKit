import { createServer } from "http";
import { WebSocketServer } from "ws";

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

  ws.on("message", (data) => {
    const msg = JSON.parse(data);
    if (msg.type === "text") {
      const answer = getAnswer(msg.text);
      ws.send(JSON.stringify({ type: "answer", text: answer }));
    }
  });

  ws.on("close", () => console.log("client disconnected"));
});

process.loadEnvFile();

const PORT = process.env.PORT;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on port ${PORT}`);
});
