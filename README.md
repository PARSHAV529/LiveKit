# 🎙 VoiceAI v1

A simple voice conversation app. Speak to it, it speaks back.

---

## How to run

### Server
```bash
cd server
npm install
node index.js
```

### Client
```bash
cd client
npm install
npm run dev
```

Open `http://localhost:3000` in **Chrome**.

---

## How to use

| Action | How |
|--------|-----|
| Start recording | Hold the 🎙 button |
| Stop recording | Release the 🎙 button |
| Start recording | Hold `R` key on keyboard |
| Stop recording | Release `R` key |

---

## What it understands

| You say | It replies |
|---------|-----------|
| hello | Hey! I'm VoiceAI. How can I help? |
| hi | Hi! Go ahead, I'm listening. |
| hey | Hey! What's on your mind? |
| how are you | I'm doing great, thanks for asking! |
| how r u | I'm doing great, thanks! |
| bye | Goodbye! Take care! |
| goodbye | Goodbye! Have a great day! |
| anything else | I'm not sure about that yet! |

---

## Tech

- **Frontend** — React + Vite
- **Backend** — Node.js + WebSocket (`ws`)
- **Voice in** — Web Speech API (SpeechRecognition)
- **Voice out** — SpeechSynthesis API
- **Transport** — WebSocket (no fetch, no REST)

---

## Flow

```
Hold button → speak → release
      ↓
SpeechRecognition transcribes
      ↓
sent to server over WebSocket
      ↓
server matches keyword → sends answer
      ↓
SpeechSynthesis speaks the answer
      ↓
ready for next message
```

---


## Browser support

Chrome or Edge only. Firefox does not support SpeechRecognition.
