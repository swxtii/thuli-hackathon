require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const clothingData = require("../clothing_data.json");

const app = express();
const PORT = 4000;

app.use(cors());
app.use(bodyParser.json());

// Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Attribute Weights
const ATTRIBUTE_WEIGHTS = {
  pattern: 0.25,
  "print or pattern type": 0.25,
  fabric: 0.20,
  fit: 0.20,
  type: 0.20,
  shape: 0.15,
  occasion: 0.10,
  neck: 0.05,
  sleeve: 0.10,
  colour: 0.10,
  length: 0.05,
  hemline: 0.05,
  "surface styling": 0.05,
  ornamentation: 0.05,
  "main trend": 0.10,
  "sub trend": 0.10,
};

// Parse attributes into tokens
function parseAttributes(attrInput) {
  if (!attrInput) return [];
  if (typeof attrInput === "object")
    return Object.values(attrInput).map((v) => String(v).toLowerCase().trim());
  if (typeof attrInput === "string")
    return attrInput
      .split(/[;,]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  return [];
}

const stripQuotes = (str) => str.replace(/^['"]+|['"]+$/g, "").trim();

// Build StyleDNA
function buildStyleDNAFromMaps(likedMap, dislikedMap) {
  const dna = {};
  const updateDNA = (map, weightSign) => {
    Object.entries(map).forEach(([token, category]) => {
      if (!category || category === "null") return;
      const baseWeight = ATTRIBUTE_WEIGHTS[category] || 0.1;
      if (!dna[category]) dna[category] = {};
      if (!dna[category][token]) dna[category][token] = 0;
      dna[category][token] += weightSign * baseWeight;
    });
  };
  updateDNA(likedMap, +1);
  updateDNA(dislikedMap, -1);
  return dna;
}

// Sanitize LLM response
function sanitizeLLMResponse(text) {
  if (!text) return "{}";
  let cleanText = text.trim();
  if (cleanText.toLowerCase().startsWith("json"))
    cleanText = cleanText.slice(4).trim();
  cleanText = cleanText.replace(/^`+|`+$/g, "");
  const match = cleanText.match(/\{[\s\S]*\}/);
  if (match) cleanText = match[0];
  return cleanText;
}

// Categorize tokens with LLM
async function categorizeTokens(tokens, label) {
  if (!tokens || tokens.length === 0) return {};

  const prompt = `
You are a fashion data analyst.
Categorize these fashion attribute values into one of the following categories:
[${Object.keys(ATTRIBUTE_WEIGHTS).join(", ")}].
Return JSON where key = token, value = category. If unknown, use "null".
Input values: ${JSON.stringify(tokens)}
`;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const sanitized = sanitizeLLMResponse(result.response.text());
    return JSON.parse(sanitized);
  } catch (err) {
    console.error(`Failed to categorize tokens for ${label}:`, err.message);
    return {};
  }
}

// ==========================
// Preferences endpoint
// ==========================
app.post("/preferences", async (req, res) => {
  try {
    const { liked, disliked } = req.body;

    const cleanLiked = liked.map((item) => ({
      colour: item.colour,
      description: item.description,
      p_attributes: item.p_attributes,
    }));
    const cleanDisliked = disliked.map((item) => ({
      colour: item.colour,
      description: item.description,
      p_attributes: item.p_attributes,
    }));

    const likedTokens = cleanLiked.flatMap((item) =>
      parseAttributes(item.p_attributes)
    );
    const dislikedTokens = cleanDisliked.flatMap((item) =>
      parseAttributes(item.p_attributes)
    );

    const cleanLikedTokens = likedTokens.map((t) =>
      stripQuotes(t.split(":").slice(1).join(":") || t)
    );
    const cleanDislikedTokens = dislikedTokens.map((t) =>
      stripQuotes(t.split(":").slice(1).join(":") || t)
    );

    const likedMap = await categorizeTokens(cleanLikedTokens, "liked");
    const dislikedMap = await categorizeTokens(cleanDislikedTokens, "disliked");

    const styleDNA = buildStyleDNAFromMaps(likedMap, dislikedMap);

    // Generate archetype summary with LLM
    const interpretPrompt = `
You are an expert fashion stylist and psychologist.
Summarize user's style interests and categorize into top 3 archetypes [Street Style, Old Money, Minimal, Chic, 80's, Desi, Bohemian, Sporty, Beachy, Glam].
Input Data:
- Liked items: ${JSON.stringify(cleanLiked)}
- Disliked items: ${JSON.stringify(cleanDisliked)}
- StyleDNA: ${JSON.stringify(styleDNA)}
Return JSON with keys: "summary", "archetype_spectrum" [{name, percentage}], "styleDNA_interpretation"
`;

    let parsed = {};
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(interpretPrompt);
      parsed = JSON.parse(sanitizeLLMResponse(result.response.text()));
    } catch (err) {
      console.warn("⚠️ Archetype parsing failed:", err.message);
      parsed = {
        summary: "Could not generate summary",
        archetype_spectrum: [],
        styleDNA_interpretation: {},
      };
    }

    res.status(200).json({
      likedMap,
      dislikedMap,
      styleDNA,
      liked: cleanLiked,
      disliked: cleanDisliked,
      ...parsed,
    });
  } catch (error) {
    console.error("Error processing preferences:", error.message);
    res.status(500).json({ error: "Failed to process preferences" });
  }
});

// ==========================
// Recommendations endpoint
// ==========================
app.post("/recommendations", async (req, res) => {
  try {
    const { liked = [], disliked = [] } = req.body;

    if (!liked.length && !disliked.length) {
      return res.status(400).json({ error: "Liked or Disliked items required" });
    }

    const scored = clothingData.map((item) => {
      let score = 0;

      const itemTokens = parseAttributes(item.p_attributes);

      liked.forEach((l) => {
        const likedTokens = parseAttributes(l.p_attributes);
        likedTokens.forEach((t) => {
          if (itemTokens.includes(t.toLowerCase().trim())) score += 1;
        });
      });

      disliked.forEach((d) => {
        const dislikedTokens = parseAttributes(d.p_attributes);
        dislikedTokens.forEach((t) => {
          if (itemTokens.includes(t.toLowerCase().trim())) score -= 1;
        });
      });

      return { ...item, score };
    });

    const filtered = scored
      .filter(
        (item) =>
          !liked.some((l) => l.description === item.description) &&
          !disliked.some((d) => d.description === item.description)
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    console.log(
      "🎯 Top recommendations:",
      filtered.map((i) => ({ name: i.name, score: i.score }))
    );

    res.json({ recommendations: filtered });
  } catch (error) {
    console.error("Error generating recommendations:", error.message);
    res.status(500).json({ error: "Failed to generate recommendations" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
