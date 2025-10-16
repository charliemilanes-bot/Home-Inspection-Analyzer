import multer from "multer";
import { readFile } from "fs/promises";
import fs from "fs";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();
const upload = multer({ dest: "/tmp" });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(500).json({ error: err.message });

    try {
      let text = req.body.text || "";

      if (req.file) {
        const buffer = await readFile(req.file.path);

        if (req.file.mimetype === "application/pdf") {
          text += "\n" + (await pdfParse(buffer)).text;
        } else if (
          req.file.mimetype ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          req.file.originalname.endsWith(".docx")
        ) {
          const result = await mammoth.extractRawText({ buffer });
          text += "\n" + result.value;
        } else {
          text += buffer.toString("utf-8");
        }

        fs.unlink(req.file.path, () => {});
      }

      if (!text.trim()) return res.status(400).json({ error: "No text provided" });

      const prompt = `
You are a Home Inspection Analysis Expert GPT.
Analyze the following report text and return structured findings in JSON format:
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
      try { analysis = JSON.parse(analysis); } catch { analysis = { summary: analysis }; }

      res.status(200).json(analysis);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
