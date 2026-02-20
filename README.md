📘 CodeQuest AI Tutor
🚀 Overview
CodeQuest AI Tutor is an AI-powered web app that helps students learn Computer Science step-by-step.
Built for KS3, GCSE, and A-Level learners.
✨ Features
AI-powered tutoring
Explain / Hint / Quiz / Mark modes
Markdown responses
Topic & level selection
Full-stack deployment
🧱 Tech Stack
Frontend
React (Vite)
CSS
React Markdown
Backend
Node.js
Express
OpenAI API
Deployment
Vercel (frontend)
Render (backend)
🏗️ Architecture
Frontend (Vercel)
        ↓
Express API (Render)
        ↓
OpenAI API
⚙️ Setup (Local Development)
Clone
git clone https://github.com/SOL7JJ/codequest-ai-tutor.git
cd codequest-ai-tutor
Backend
cd server
npm install
Create .env:
OPENAI_API_KEY=your_key_here
Start server:
npm run dev
Frontend
cd client
npm install
npm run dev
🌍 Live Demo
Frontend:
https://codequest-ai-tutor.vercel.app
Backend:
https://codequest-ai-tutor.onrender.com
🎯 Future Improvements
Streaming responses (ChatGPT-style)
User accounts
Progress tracking
Saved lessons
Teacher dashboard
👨‍💻 Author
Jonathan James 
