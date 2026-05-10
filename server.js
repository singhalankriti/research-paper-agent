require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── System prompts ────────────────────────────────────────────────────────────
const BASE_SYSTEM = `You are an expert academic research assistant helping university researchers, students, and colleagues.

STRICT RULES:
- Only reference peer-reviewed papers, journals, conference proceedings, preprints (arXiv, bioRxiv, SSRN), theses, and academic books.
- Never cite blogs, news articles, Wikipedia, YouTube, or random websites.
- Always include: paper title, authors, year, journal/conference when available.
- When listing papers, ALWAYS format as: "Title" by Author(s) (Year) - Journal/Source.
- Structure answers with: Summary, Key Findings, Methodology (if relevant), Notable Papers.
- Always suggest related search terms at the end.
- NEVER repeat the same paragraph or sentence twice.
- Always write complete responses — never cut off mid-sentence.`;

const PDF_SYSTEM = `You are an expert academic paper analyst. A researcher has uploaded a PDF paper and you have been given its full text.

Your job is to help the researcher understand this paper deeply. When asked:
- SUMMARISE: Give a structured summary with: Title, Authors, Year, Journal, Abstract Summary, Key Findings, Methodology, Limitations, Contributions to Field.
- FINDINGS: Extract and list the key findings with evidence from the paper.
- METHODOLOGY: Explain the research design, data collection, analysis methods in plain language.
- LIMITATIONS: Identify what the authors acknowledge as limitations plus any you observe.
- CITATION: Generate citations in the requested format.
- COMPARE: Compare this paper with others mentioned in the conversation.
- QUESTIONS: Answer specific questions about the paper content.
Always refer back to specific sections, page numbers, or quotes from the paper when possible.`;

const LITERATURE_REVIEW_SYSTEM = `You are an expert academic writer specialising in literature reviews. You will be given a collection of paper summaries and titles. 

Generate a structured, formal literature review with:
1. Introduction — overview of the research area and why it matters
2. Thematic sections — group papers by theme/approach/finding
3. Synthesis — what do the papers collectively show? Where do they agree/disagree?
4. Research gaps — what is missing from the existing literature?
5. Conclusion — summary and future research directions

Write in formal academic English. Cite papers as (Author, Year) inline. Minimum 600 words.`;

function deduplicateText(text) {
  const paragraphs = text.split(/\n{2,}/);
  const seen = new Set();
  return paragraphs.filter(p => {
    const key = p.trim().slice(0, 80).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('\n\n');
}

function httpsPost(hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname, path: urlPath, method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(bodyStr) },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
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

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, { headers: { "User-Agent": "ScholarByAlankriti/1.0 (research tool)" } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

async function callGroq(messages, systemPrompt, maxTokens = 8000) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");

  const { status, data } = await httpsPost(
    "api.groq.com",
    "/openai/v1/chat/completions",
    { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.2,
    }
  );

  if (status !== 200) throw new Error(data?.error?.message || "Groq API error");
  return deduplicateText(data.choices?.[0]?.message?.content || "");
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Standard chat
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "messages required" });
  try {
    const text = await callGroq(
      messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      BASE_SYSTEM
    );
    res.json({ text, sources: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PDF analysis — text extracted in browser, sent here
app.post("/api/analyze-pdf", async (req, res) => {
  const { pdfText, question, messages } = req.body;
  if (!pdfText) return res.status(400).json({ error: "pdfText required" });

  const truncated = pdfText.slice(0, 28000); // Groq context limit safety
  const userMsg = question || "Please provide a comprehensive summary of this paper including: title, authors, year, journal, key findings, methodology, limitations, and how it contributes to its field.";

  const msgs = [
    { role: "user", content: `Here is the full text of an academic paper:\n\n---\n${truncated}\n---\n\n${userMsg}` },
    ...(messages || []).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))
  ];

  try {
    const text = await callGroq(msgs, PDF_SYSTEM);
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DOI / URL lookup using CrossRef + arXiv APIs
app.post("/api/lookup", async (req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: "input required" });

  let metadata = null;
  let abstractText = "";

  try {
    // arXiv ID detection e.g. 2301.07041 or arxiv.org/abs/2301.07041
    const arxivMatch = input.match(/(?:arxiv\.org\/abs\/|arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (arxivMatch) {
      const id = arxivMatch[1];
      const { body } = await httpsGet(`https://export.arxiv.org/abs/${id}`);
      const titleMatch = body.match(/<title>([^<]+)<\/title>/);
      const abstractMatch = body.match(/class="abstract[^"]*"[^>]*>([\s\S]+?)<\/blockquote>/);
      const authorsMatch = body.match(/class="authors"[^>]*>([\s\S]+?)<\/div>/);
      metadata = {
        title: titleMatch?.[1]?.replace(/\[.*?\]/, "").trim() || "Unknown Title",
        authors: authorsMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || "Unknown Authors",
        year: id.slice(0, 2) > "90" ? "19" + id.slice(0, 2) : "20" + id.slice(0, 2),
        journal: "arXiv",
        doi: `arXiv:${id}`,
        url: `https://arxiv.org/abs/${id}`,
      };
      abstractText = abstractMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
    }

    // DOI detection
    if (!metadata) {
      const doiMatch = input.match(/(?:doi\.org\/|doi:)?(10\.\d{4,}\/[^\s]+)/i);
      if (doiMatch) {
        const doi = doiMatch[1];
        const { body } = await httpsGet(`https://api.crossref.org/works/${doi}`);
        const d = JSON.parse(body);
        const w = d.message;
        metadata = {
          title: w.title?.[0] || "Unknown Title",
          authors: (w.author || []).slice(0, 5).map(a => `${a.given || ""} ${a.family || ""}`.trim()).join(", "),
          year: w.published?.["date-parts"]?.[0]?.[0] || w["published-print"]?.["date-parts"]?.[0]?.[0] || "Unknown",
          journal: w["container-title"]?.[0] || w.publisher || "Unknown Journal",
          doi: doi,
          url: w.URL || `https://doi.org/${doi}`,
        };
        abstractText = w.abstract?.replace(/<[^>]+>/g, "") || "";
      }
    }

    if (!metadata) {
      return res.status(400).json({ error: "Could not recognise this as a DOI or arXiv ID. Try formats like: 10.1038/nature12373 or 2301.07041" });
    }

    // Ask Groq to summarise what we know
    const prompt = `I found metadata for this academic paper:
Title: ${metadata.title}
Authors: ${metadata.authors}
Year: ${metadata.year}
Journal/Source: ${metadata.journal}
DOI/ID: ${metadata.doi}
${abstractText ? `Abstract: ${abstractText}` : ""}

Please provide:
1. A clear summary of what this paper is about
2. Its likely key contributions to the field
3. Who would benefit from reading it
4. A suggested citation in APA format`;

    const summary = await callGroq([{ role: "user", content: prompt }], PDF_SYSTEM);
    res.json({ metadata, abstractText, summary });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Literature review generator
app.post("/api/literature-review", async (req, res) => {
  const { papers, topic } = req.body;
  if (!papers?.length) return res.status(400).json({ error: "papers array required" });

  const papersText = papers.map((p, i) =>
    `Paper ${i + 1}: "${p.title}" by ${p.authors || "Unknown"} (${p.year || "n.d."})${p.journal ? ` - ${p.journal}` : ""}${p.summary ? `\nSummary: ${p.summary}` : ""}`
  ).join("\n\n");

  const prompt = `Topic: ${topic || "the research area covered by these papers"}

Papers to review:
${papersText}

Generate a comprehensive academic literature review of these papers.`;

  try {
    const text = await callGroq([{ role: "user", content: prompt }], LITERATURE_REVIEW_SYSTEM, 8000);
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Compare papers
app.post("/api/compare", async (req, res) => {
  const { papers } = req.body;
  if (!papers || papers.length < 2) return res.status(400).json({ error: "At least 2 papers required" });

  const papersText = papers.map((p, i) =>
    `Paper ${i + 1}: "${p.title}" by ${p.authors || "Unknown"} (${p.year || "n.d."})${p.summary ? `\n${p.summary}` : ""}`
  ).join("\n\n---\n\n");

  const prompt = `Compare these ${papers.length} academic papers in detail:

${papersText}

Provide a structured comparison covering:
1. Research Questions — what each paper tries to answer
2. Methodology — how each paper conducts its research
3. Key Findings — what each paper concludes
4. Similarities — where they agree or complement each other
5. Differences — where they diverge or contradict
6. Strengths & Limitations of each
7. Which paper is more relevant for what purpose`;

  try {
    const text = await callGroq([{ role: "user", content: prompt }], PDF_SYSTEM);
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Scholar by Alankriti running on port ${PORT}`));
