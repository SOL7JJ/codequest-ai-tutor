import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
console.log("Key loaded?", Boolean(process.env.OPENAI_API_KEY));
console.log("Key prefix:", process.env.OPENAI_API_KEY?.slice(0, 8));

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/api/tutor", async (req, res) => {
  try {
    const { message, level = "KS3", topic = "Python", mode = "Explain" } = req.body || {};

    const system = `You are a ${level} Computer Science tutor.
Topic: ${topic}
Mode: ${mode}
Teach clearly and step-by-step.`;

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
    });

    const reply = response.output_text || "(No output_text returned)";
    return res.json({ reply, raw: response });
  } catch (e) {
    console.error("Tutor error:", e);
    return res.status(500).json({ error: "LLM failed", details: String(e) });
  }
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});



app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
