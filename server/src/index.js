const http = require("http");
const WebSocket = require("ws");

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

// HTTP server so Render detects an open port
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("voice server running");
});

const wss = new WebSocket.Server({ server });

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

// use PORT env var from Render, fallback to 3001 locally
const PORT = process.env.PORT || 3001;

// listen on 0.0.0.0 so Render can detect it
server.listen(PORT, "0.0.0.0", () => {
  console.log(`server running on port ${PORT}`);
});
