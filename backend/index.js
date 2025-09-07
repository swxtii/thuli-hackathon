require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai"); // ✅ Gemini SDK
const clothingData = require("../clothing_data.json"); 

const app = express();
const PORT = 4000;

app.use(cors());
app.use(bodyParser.json());

// 🔑 Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 🎯 Attribute Weights
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
  "sub trend": 0.10
};

// 🛠 Parse raw attributes into tokens
function parseAttributes(attrInput) {
  if (!attrInput) return [];
  if (typeof attrInput === "object") return Object.values(attrInput).map(v => String(v).toLowerCase());
  if (typeof attrInput === "string")
    return attrInput.split(/[;,]/).map(t => t.trim().toLowerCase()).filter(Boolean);
  return [];
}

const stripQuotes = str => str.replace(/^['"]+|['"]+$/g, "").trim();

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

async function categorizeTokens(tokens, label) {
  if (!tokens || tokens.length === 0) return {};

  const prompt = `
You are a fashion data analyst.
Categorize these fashion attribute values into one of the following categories:
[${Object.keys(ATTRIBUTE_WEIGHTS).join(", ")}].

Return Rules:
- JSON format starting with '{' and end with '}'.
- Each input value must appear exactly once as the key (double-quoted).
- Values must be double-quoted strings.
- If you cannot categorize, set the value as "null".

Input values: ${JSON.stringify(tokens)}
`;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-lite" });
    const result = await model.generateContent(prompt);

    let text = result.response.text().trim();
    if (text.toLowerCase().startsWith("json")) text = text.slice(4).trim();

    return JSON.parse(text);
  } catch (err) {
    console.error(`Failed to categorize tokens for ${label}:`, err);
    return {};
  }
}

// ==========================
// Preferences endpoint
// ==========================
app.post("/preferences", async (req, res) => {
  try {
    const { liked, disliked } = req.body;

    const cleanLiked = liked.map(item => ({ colour: item.colour, description: item.description, p_attributes: item.p_attributes }));
    const cleanDisliked = disliked.map(item => ({ colour: item.colour, description: item.description, p_attributes: item.p_attributes }));

    const liked_tokens = cleanLiked.flatMap(item => parseAttributes(item.p_attributes));
    const disliked_tokens = cleanDisliked.flatMap(item => parseAttributes(item.p_attributes));

    const clean_liked_tokens = liked_tokens.map(t => stripQuotes(t.split(":").slice(1).join(":") || t));
    const clean_disliked_tokens = disliked_tokens.map(t => stripQuotes(t.split(":").slice(1).join(":") || t));

    const likedMap = await categorizeTokens(clean_liked_tokens, "liked");
    const dislikedMap = await categorizeTokens(clean_disliked_tokens, "disliked");

    const styleDNA = buildStyleDNAFromMaps(likedMap, dislikedMap);

    const interpretPrompt = `
You are an expert fashion stylist and psychologist.
Interpret the user's Style DNA (aggregate attribute scores).
Summarize their style interests in two lines.

Categorize the user into an Archetype Spectrum (distribution across multiple archetypes) based on this list [Street Style, Old Money, Minimal, Chic, 80's, Desi, Bohemian, Sporty, Beachy, Glam].
Requirements:
- Select the top 3 archetypes.
- Assign each a percentage score (must total 100%).
- Provide a natural-language explanation.

Input Data:
- Liked items: ${JSON.stringify(cleanLiked, null, 2)}
- Disliked items: ${JSON.stringify(cleanDisliked, null, 2)}
- StyleDNA: ${JSON.stringify(styleDNA, null, 2)}

Output strict JSON only with keys:
- "summary" (string),
- "archetype_spectrum" (array of objects: { "name": string, "percentage": number }),
- "styleDNA_interpretation" (string).
`;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-lite" });
    const result = await model.generateContent(interpretPrompt);

    let text = result.response.text().trim();
    if (text.toLowerCase().startsWith("json")) text = text.slice(4).trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    res.status(200).json({ likedMap, dislikedMap, styleDNA, ...parsed });
  } catch (error) {
    console.error("Error processing preferences:", error);
    res.status(500).json({ error: "Failed to process preferences" });
  }
});

// ==========================
// Style Summary endpoint
// ==========================
app.post("/style-summary", async (req, res) => {
  try {
    const { interpretation } = req.body;
    const archetypes = interpretation.archetype_spectrum?.map(a => a.name).join(", ") || "";
    const message = `We are learning that you lean towards ${archetypes} styles.`;
    res.status(200).json({ message });
  } catch (error) {
    console.error("Error generating style summary:", error);
    res.status(500).json({ error: "Failed to generate style summary" });
  }
});

// ==========================
// Recommendations endpoint
// ==========================
app.post("/recommendations", async (req, res) => {
  try {
    const { liked = [], disliked = [], styleDNA = {} } = req.body;

    if (!styleDNA || Object.keys(styleDNA).length === 0) {
      return res.status(400).json({ error: "StyleDNA is required" });
    }

    // Score each outfit based on StyleDNA matches
    const scored = clothingData.map((item) => {
      let score = 0;
      const tokens = parseAttributes(item.p_attributes);

      tokens.forEach((t) => {
        for (let category in styleDNA) {
          if (styleDNA[category][t]) {
            score += styleDNA[category][t];
          }
        }
      });

      return { ...item, score };
    });

    // Remove already swiped items (liked or disliked)
    const filtered = scored.filter(
      (item) =>
        !liked.some((l) => l.description === item.description) &&
        !disliked.some((d) => d.description === item.description)
    );

    // Sort by score descending
    const topRecommendations = filtered.sort((a, b) => b.score - a.score).slice(0, 15);

    res.json({ recommendations: topRecommendations });
  } catch (error) {
    console.error("Error generating recommendations:", error);
    res.status(500).json({ error: "Failed to generate recommendations" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});


