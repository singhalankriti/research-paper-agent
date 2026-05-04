require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

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
- When listing papers, format each as: "Title" by Author(s) (Year) - Journal/Source.
- Always suggest related search terms or adjacent research areas at the end.`;

// ── Chat endpoint ─────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server." });
  }

  // Convert messages to Gemini format
  const geminiMessages = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          contents: geminiMessages,
          tools: [
            {
              google_search: {},
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1500,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || "Gemini API error";
      console.error("Gemini error:", errMsg);
      return res.status(response.status).json({ error: errMsg });
    }

    // Extract text and grounding sources
    let text = "";
    let sources = [];

    const candidate = data.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) text += part.text;
      }
    }

    // Extract grounding metadata (search sources)
    const groundingMeta = candidate?.groundingMetadata;
    if (groundingMeta?.groundingChunks) {
      sources = groundingMeta.groundingChunks
        .filter((c) => c.web?.uri)
        .map((c) => ({ title: c.web.title || c.web.uri, url: c.web.uri }))
        .filter((s) => {
          // Only keep academic sources
          const academicDomains = [
            "scholar.google", "pubmed", "ncbi.nlm.nih.gov", "arxiv.org",
            "semanticscholar.org", "researchgate.net", "jstor.org",
            "springer.com", "nature.com", "science.org", "cell.com",
            "wiley.com", "tandfonline.com", "sciencedirect.com",
            "acm.org", "ieee.org", "ssrn.com", "biorxiv.org",
            "medrxiv.org", "plos.org", "frontiersin.org", "mdpi.com",
            "oup.com", "cambridge.org", "mit.edu", "edu"
          ];
          return academicDomains.some((d) => s.url.includes(d));
        })
        .slice(0, 5);
    }

    if (!text) {
      text = "I could not find relevant academic research on this topic. Please try a more specific query or different keywords.";
    }

    res.json({ text, sources });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Research Paper Agent running at http://localhost:${PORT}`);
});
