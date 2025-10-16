import express from "express";
import multer from "multer";
import { readFile } from "fs/promises";
import fs from "fs";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import OpenAI from "openai";
import dotenv from "dotenv";
import { jsPDF } from "jspdf";
import { Parser } from "json2csv";

dotenv.config();
const app = express();
const upload = multer({ dest: "uploads/" });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.static("public"));
app.use(express.json());

// ---- Helper Functions ----
async function extractTextFromFile(file) {
  const buffer = await readFile(file.path);

  if (file.mimetype === "application/pdf") {
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (
    file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.originalname.endsWith(".docx")
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  return buffer.toString("utf-8");
}

// ---- Main Route ----
app.post("/analyze", upload.single("file"), async (req, res) => {
  try {
    let text = req.body.text || "";

    if (req.file) {
      text += "\n" + (await extractTextFromFile(req.file));
      fs.unlink(req.file.path, () => {}); // cleanup
    }

    if (!text.trim()) {
      return res.status(400).json({ error: "No text provided" });
    }

    const prompt = `
You are a Home Inspection Analysis Expert GPT.
Analyze the following report text and return structured findings in this JSON format:
{
  "summary": "Brief overview of the property condition",
  "categories": [
    {"name": "Structural", "issues": ["..."], "recommendations": ["..."]},
    {"name": "Plumbing", "issues": ["..."], "recommendations": ["..."]},
    {"name": "Electrical", "issues": ["..."], "recommendations": ["..."]}
  ],
  "priority_repairs": ["...", "..."]
}
Text: ${text}
`;

    const completion = await client.responses.create({
      model: "gpt-5",
      input: prompt,
      temperature: 0.4,
    });

    let analysis = completion.output_text;
    try {
      analysis = JSON.parse(analysis);
    } catch {
      // fallback if GPT returns text instead of JSON
      analysis = { summary: analysis };
    }

    res.json(analysis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---- CSV and PDF Export ----
app.post("/export", express.json(), async (req, res) => {
  try {
    const { data, type } = req.body;
    if (!data) return res.status(400).send("No data to export");

    if (type === "csv") {
      const parser = new Parser();
      const csv = parser.parse(data);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=report.csv");
      return res.send(csv);
    }

    if (type === "pdf") {
      const doc = new jsPDF();
      doc.text("Home Inspection Analysis Report", 10, 10);
      doc.text(JSON.stringify(data, null, 2), 10, 20);
      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=report.pdf");
      return res.send(pdfBuffer);
    }

    res.status(400).send("Invalid export type");
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

// ---- Frontend UI ----
app.get("/", (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Home Inspection Analyzer</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; max-width: 700px; margin: auto; }
      textarea { width: 100%; height: 150px; margin-bottom: 10px; }
      button { padding: 8px 16px; margin-top: 10px; }
      .results { margin-top: 20px; }
      pre { background: #f5f5f5; padding: 10px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>🏠 Home Inspection Analyzer</h1>
    <form id="form">
      <textarea name="text" placeholder="Paste inspection text here..."></textarea><br>
      <input type="file" name="file" accept=".txt,.pdf,.docx"><br>
      <button type="submit">Analyze</button>
    </form>
    <div class="results"></div>
    <script>
      const form = document.getElementById('form');
      const resultsDiv = document.querySelector('.results');
      let latestData = null;

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        resultsDiv.innerHTML = "⏳ Analyzing...";
        const res = await fetch('/analyze', { method: 'POST', body: fd });
        const json = await res.json();
        latestData = json;
        resultsDiv.innerHTML = "<h2>Results</h2><pre>" + JSON.stringify(json, null, 2) + "</pre>" +
          '<button onclick="downloadExport(\'csv\')">⬇️ Download CSV</button>' +
          '<button onclick="downloadExport(\'pdf\')">⬇️ Download PDF</button>';
      });

      async function downloadExport(type) {
        const res = await fetch('/export', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ data: latestData, type })
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'report.' + type;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    </script>
  </body>
  </html>
  `);
});

// ---- Server ----
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Running on port ${port}`));
