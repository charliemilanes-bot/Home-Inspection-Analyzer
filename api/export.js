import { Parser } from "json2csv";
import { jsPDF } from "jspdf";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

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
    res.status(500).send(err.message);
  }
}
