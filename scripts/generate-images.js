/**
 * Generate food images for the app using xAI (Grok) Image API.
 * Run: node scripts/generate-images.js
 */
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.XAI_API_KEY || 'YOUR_XAI_API_KEY_HERE';
const API_URL = 'https://api.x.ai/v1/images/generations';

const SELLERS_DIR = path.join(__dirname, '..', 'assets', 'images', 'sellers');
const MENU_DIR = path.join(__dirname, '..', 'assets', 'images', 'menu');

const SELLER_PROMPTS = [
  { id: 'demo-1', prompt: 'A warm, inviting Turkish home kitchen scene with traditional pots of stew, viewed from above on a wooden table. Warm lighting, cozy atmosphere. Food photography style.' },
  { id: 'demo-2', prompt: 'Aegean Turkish cuisine spread: olive oil dishes, fresh börek pastry, stuffed grape leaves on a rustic white table. Bright Mediterranean light. Food photography.' },
  { id: 'demo-3', prompt: 'Black Sea Turkish cuisine: fried anchovies (hamsi), cornbread, and muhlama cheese fondue on a dark wooden board. Moody warm food photography.' },
  { id: 'demo-4', prompt: 'Beautiful Turkish desserts and cakes display: chocolate cake, baklava, cookies arranged on elegant plates. Pastel pink bakery aesthetic. Food photography.' },
  { id: 'demo-5', prompt: 'Turkish grill restaurant scene: köfte meatballs, chicken şiş skewers on a charcoal grill with flames. Smoky atmosphere. Food photography.' },
  { id: 'demo-6', prompt: 'Traditional Turkish serpme kahvaltı (spread breakfast): cheese plates, olives, honey, eggs, fresh bread on a large rustic table. Morning sunlight. Food photography.' },
];

const MENU_PROMPTS = [
  { id: 'm1-1', prompt: 'A bowl of Turkish red lentil soup (mercimek çorbası) with a lemon wedge and dried mint on top, served in a ceramic bowl. Top-down food photography, warm tones.' },
  { id: 'm1-2', prompt: 'Turkish kuru fasulye (white bean stew) with buttered rice pilaf on a plate, traditional Turkish home cooking. Food photography, warm lighting.' },
  { id: 'm1-3', prompt: 'İzmir köfte: Turkish meatballs baked in tomato sauce with potatoes and green peppers in a clay dish. Food photography.' },
  { id: 'm1-4', prompt: 'Fresh mixed Turkish salad with tomatoes, cucumbers, olives, red onion, and parsley in a white bowl. Bright food photography.' },
  { id: 'm2-1', prompt: 'Zeytinyağlı enginar: Turkish artichoke hearts cooked in olive oil with carrots and peas, cold served. Elegant food photography.' },
  { id: 'm2-2', prompt: 'Ispanaklı börek: Turkish spinach and cheese pastry (börek) sliced on a wooden board, flaky layers visible. Food photography.' },
  { id: 'm2-3', prompt: 'Zeytinyağlı yaprak sarma: Turkish stuffed grape leaves (dolma) arranged on a plate with lemon. Food photography.' },
  { id: 'm3-1', prompt: 'Hamsi tava: crispy fried Black Sea anchovies arranged in a circle on a plate with arugula and lemon. Food photography.' },
  { id: 'm3-2', prompt: 'Kuymak (muhlama): stretchy melted cheese with cornmeal in a copper pan, Turkish Black Sea dish. Rustic food photography.' },
  { id: 'm3-3', prompt: 'Turkish mısır ekmeği (cornbread) freshly baked, golden color, sliced on a wooden cutting board. Rustic food photography.' },
  { id: 'm3-4', prompt: 'Karalahana çorbası: Turkish Black Sea kale soup in a ceramic bowl, hearty and rustic. Warm food photography.' },
  { id: 'm4-1', prompt: 'A beautiful chocolate layer cake with dark chocolate ganache, decorated with berries on a cake stand. Elegant bakery food photography.' },
  { id: 'm4-2', prompt: 'An assorted box of homemade Turkish cookies: shortbread, chocolate chip, and hazelnut varieties in a gift box. Food photography.' },
  { id: 'm4-3', prompt: 'Fırın sütlaç: Turkish baked rice pudding with caramelized top in a clay ramekin. Warm food photography.' },
  { id: 'm5-1', prompt: 'Turkish grilled köfte meatballs (5 pieces) on a plate with grilled peppers, onion and lavash bread. Food photography.' },
  { id: 'm5-2', prompt: 'Tavuk şiş: Turkish marinated chicken skewers with rice pilaf and grilled vegetables. Food photography.' },
  { id: 'm5-3', prompt: 'Karışık ızgara tabağı: Turkish mixed grill plate with köfte, chicken wings, lamb chops and grilled vegetables. Food photography.' },
  { id: 'm6-1', prompt: 'Turkish serpme kahvaltı for 2: spread breakfast with cheeses, olives, honey, butter, eggs, tomatoes, cucumbers on a large wooden table. Food photography.' },
  { id: 'm6-2', prompt: 'Turkish gözleme: hand-rolled stuffed flatbread with cheese, golden and crispy, on a wooden board with tea. Food photography.' },
  { id: 'm6-3', prompt: 'Menemen: Turkish scrambled eggs with tomatoes, peppers and onions in a small pan, with bread on the side. Food photography.' },
];

async function generateImage(prompt, outputPath) {
  if (fs.existsSync(outputPath)) {
    console.log(`  SKIP (exists): ${path.basename(outputPath)}`);
    return true;
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-imagine-image',
        prompt,
        n: 1,
        response_format: 'b64_json',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`  ERROR ${res.status}: ${err}`);
      return false;
    }

    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      console.error('  ERROR: No image data in response');
      return false;
    }

    fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));
    console.log(`  OK: ${path.basename(outputPath)}`);
    return true;
  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('=== Generating Seller Images ===');
  for (const s of SELLER_PROMPTS) {
    const out = path.join(SELLERS_DIR, `${s.id}.png`);
    console.log(`[${s.id}]`);
    await generateImage(s.prompt, out);
  }

  console.log('\n=== Generating Menu Item Images ===');
  for (const m of MENU_PROMPTS) {
    const out = path.join(MENU_DIR, `${m.id}.png`);
    console.log(`[${m.id}]`);
    await generateImage(m.prompt, out);
  }

  console.log('\nDone!');
}

main();
