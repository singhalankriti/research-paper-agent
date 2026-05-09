require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_INSTRUCTION = `You are an expert academic research assistant. Your ONLY job is to help researchers find, summarize, and analyze peer-reviewed academic research papers.

STRICT RULES:
- Only reference peer-reviewed papers, academic journals, conference proceedings, preprints (arXiv, bioRxiv, SSRN), theses, and books from academic publishers.
- Never cite blogs, news articles, Wikipedia, YouTube, or random websites.
- Always include: paper title, authors, year, and journal/conference name when available.
- Structure your answers with: Summary, Key Findings, Methodology (if relevant), and Notable Papers.
- If a topic has no academic research, say so clearly.
- Use academic language but keep explanations accessible.
- When listing papers, ALWAYS format each one exactly as: "Title" by Author(s) (Year) - Journal/Source.
- Always suggest related search terms or adjacent research areas at the end.
- NEVER repeat the same paragraph or sentence twice in your response.
- Always write complete responses, never cut off mid-sentence or mid-paragraph.`;

function deduplicateText(text) {
  const paragraphs = text.split(/\n{2,}/);
  const seen = new Set();
  return paragraphs
    .filter(p => {
      const key = p.trim().slice(0, 80).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n\n');
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(bodyStr) },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { reject(new Error("Parse error: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

app.post("/api/chat", async (req, res) => {
  console.log("POST /api/chat received");
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set on the server." });
  }

  const groqMessages = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    ...messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))
  ];

  try {
    const { status, data } = await httpsPost(
      "api.groq.com",
      "/openai/v1/chat/completions",
      {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      {
        model: "llama-3.3-70b-versatile",
        messages: groqMessages,
        max_tokens: 8000,
        temperature: 0.2,
      }
    );

    console.log("Groq status:", status);

    if (status !== 200) {
      const errMsg = data?.error?.message || "Groq API error";
      console.error("Groq error:", errMsg);
      return res.status(status).json({ error: errMsg });
    }

    let text = data.choices?.[0]?.message?.content || "";
    text = deduplicateText(text);

    if (!text) {
      text = "I could not find relevant academic research on this topic. Please try a more specific query.";
    }

    // Groq doesn't have built-in web search, so no grounding sources
    res.json({ text, sources: [] });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Research Paper Agent running on port ${PORT}`);
});
