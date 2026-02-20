import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { message, level = "KS3", topic = "Python", mode = "Explain" } = req.body ?? {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing 'message' string" });
    }

    const system = `
You are a ${level} Computer Science tutor.
Topic: ${topic}
Mode: ${mode}

Rules:
- Be clear, structured, and step-by-step.
- Ask 1 clarifying question if needed.
- If Mode=Hint: give progressive hints (Hint 1, Hint 2, Hint 3), then offer solution if asked.
- If Mode=Quiz: ask 3 questions (easy/medium/hard) and wait for answers.
- If Mode=Mark: score /10, give strengths, improvements, and a model answer.
`.trim();

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
    });

    return res.status(200).json({ reply: response.output_text });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "OpenAI call failed" });
  }
}
