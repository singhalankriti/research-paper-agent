# 📚 Research Paper Agent

An AI-powered academic research assistant that **only** surfaces peer-reviewed papers, journals, and conference proceedings. Powered by Google Gemini (free).

Searches: arXiv, PubMed, Google Scholar, IEEE, Nature, Springer, JSTOR, ScienceDirect, Semantic Scholar, and more.

---

## 🔑 Step 1 — Get your FREE Gemini API Key

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with your Google account
3. Click **Create API Key**
4. Copy the key — it's free, no credit card needed

---

## 🚀 Deploy to Render (Free)

### 1. Push to GitHub
1. Create a repo at github.com/new
2. Run:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/research-paper-agent.git
git push -u origin main
```

### 2. Deploy on Render
1. Go to **render.com** → sign up with GitHub
2. Click **New +** → **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Click **Advanced** → **Add Environment Variable**:
   - Key: `GEMINI_API_KEY`
   - Value: your key from Step 1
6. Click **Create Web Service**
7. Wait ~2 min → get your live URL 🎉

---

## 💻 Run Locally

```bash
npm install
cp .env.example .env
# Add your GEMINI_API_KEY to .env
npm start
# Open http://localhost:3000
```

---

## 📁 Project Structure

```
research-paper-agent/
├── server.js         ← Node.js backend
├── public/
│   └── index.html    ← Frontend UI
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## ✨ Features

- 🔬 Academic sources only (no blogs or random articles)
- 📖 Searches arXiv, PubMed, IEEE, Nature, Springer & more
- 🔗 Clickable source links for every answer
- 💬 Multi-turn conversation (follow-up questions work)
- 🆓 100% free to run (Gemini free tier)
