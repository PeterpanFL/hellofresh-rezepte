// Reads a scanned HelloFresh recipe card (front + back page as JPEG) with Claude and returns structured JSON.
//
// Same security model as `meter-ocr` in meine-finanzen: deploy with `verify_jwt: false` and let the function
// verify the caller itself via GET /auth/v1/user, so only a signed-in user gets through before any Claude call.
// Secrets: ANTHROPIC_API_KEY (required), RECIPE_OCR_MODEL (optional, defaults to claude-haiku-5-5, which costs
// about a fortieth of claude-opus-5-5 per card; set it to claude-opus-5-5 for the most careful reading).
// If the chosen model rejects the request outright (400), the card is read once more with claude-opus-5-5.
// Called from the web app, so it answers CORS preflight requests.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import Anthropic from "npm:@anthropic-ai/sdk@^1.7.0"
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@^1.7.0/helpers/zod"
import { z } from "npm:zod@^4.1.0"

const MODEL = Deno.env.get("RECIPE_OCR_MODEL") || "claude-haiku-5-5"
const FALLBACK_MODEL = "claude-opus-5-5"
const MAX_BODY_BYTES = 12 * 1024 * 1024 // two pages as base64; the app sends ~0.5–2 MB
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS })
}

/** The signed-in user the bearer token belongs to, or null. Fails closed on any error. */
async function signedInUserId(req: Request): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  const baseUrl = Deno.env.get("SUPABASE_URL")
  if (!token || !baseUrl) return null
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  try {
    const res = await fetch(`${baseUrl}/auth/v1/user`, { headers: { authorization: `Bearer ${token}`, apikey } })
    if (!res.ok) return null
    const user = await res.json()
    return typeof user?.id === "string" ? user.id : null
  } catch {
    return null
  }
}

export const RecipeSchema = z.object({
  card_number: z.number().int().nullable().describe("Zahl im orangefarbenen Kasten oben rechts auf der Vorderseite"),
  title: z.string(),
  subtitle: z.string().nullable().describe("Zeile unter dem Titel, z. B. 'dazu frischer Salat'"),
  tags: z.array(z.string()).describe("Etiketten wie 'Extra schnell', 'Vegetarisch', 'Kalorienarm'"),
  minutes_min: z.number().int().nullable(),
  minutes_max: z.number().int().nullable(),
  kcal: z.number().int().nullable().describe("kcal pro Portion von der Vorderseite"),
  pantry_items: z.array(z.string()).describe("Basiszutaten aus Deiner Küche, ohne Sternchen, z. B. 'Butter', 'Salz'"),
  ingredients: z.array(z.object({
    original_name: z.string().describe("Name wie gedruckt, mit Allergen-Nummern und Herkunftsländern"),
    name: z.string().describe("Kurzer Grundbegriff im Singular oder üblicher Form, ohne Adjektive wie frisch/rot/Bio, ohne Nummern, z. B. 'Spätzle', 'Kirschtomaten', 'Mozzarella', 'Frühlingszwiebel'"),
    amount_2p: z.string().nullable().describe("Menge für 2 Personen wie gedruckt, z. B. '400 g'"),
    amount_3p: z.string().nullable(),
    amount_4p: z.string().nullable(),
  })),
  steps: z.array(z.object({
    step_number: z.number().int(),
    title: z.string(),
    body: z.string().describe("Vollständiger Anleitungstext des Schritts, Absätze mit \\n getrennt"),
  })),
  nutrition: z.array(z.object({
    name: z.string(),
    per_100g: z.string().nullable(),
    per_portion: z.string().nullable(),
  })),
  allergens: z.string().nullable().describe("Allergen-Zeile wie gedruckt"),
})

const PROMPT = [
  "Die beiden Bilder sind die Vorder- und Rückseite einer HelloFresh-Rezeptkarte (deutsch).",
  "Lies alle Angaben genau so ab, wie sie gedruckt sind, und erfinde nichts.",
  "Vorderseite: Titel, Untertitel, Rezeptnummer, Etiketten, Zubereitungszeit (z. B. '15 – 25 Min' → 15 und 25), kcal.",
  "Rückseite links: Basiszutaten, Zutatentabelle für 2P/3P/4P, Nährwerte, Allergene. Rückseite rechts: nummerierte Schritte mit Überschrift und Text.",
  "In der Anleitung stehen Mengen oft als '1 EL [1,5 EL | 2 EL]': übernimm sie unverändert.",
  "Fehlt eine Angabe, setze null.",
].join(" ")

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)
  if (!(await signedInUserId(req))) return json({ error: "Sign in required" }, 401)
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500)
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "Images too large" }, 413)

  let body: { front?: unknown; back?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }
  const { front, back } = body
  if (typeof front !== "string" || typeof back !== "string" || !front || !back) {
    return json({ error: "front and back (base64 JPEG) are required" }, 400)
  }

  // Send the key as x-api-key, exactly like meter-ocr does (the SDK would otherwise send it as a bearer token).
  const client = new Anthropic({
    apiKey: null,
    authToken: null,
    defaultHeaders: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!.trim() },
  })
  // Reading printed text needs little reasoning, so low effort keeps the (billed) thinking short.
  const read = (model: string) => client.messages.parse({
    model,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(RecipeSchema) },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: front } },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: back } },
        { type: "text", text: PROMPT },
      ],
    }],
  })
  try {
    let response
    try {
      response = await read(MODEL)
    } catch (error) {
      if (!(error instanceof Anthropic.BadRequestError) || MODEL === FALLBACK_MODEL) throw error
      console.error("model rejected request, falling back", MODEL, error.message)
      response = await read(FALLBACK_MODEL)
    }
    const u = response.usage
    console.log(JSON.stringify({ model: response.model, input_tokens: u.input_tokens, output_tokens: u.output_tokens }))
    if (response.stop_reason === "refusal") return json({ error: "Recognition refused" }, 422)
    if (!response.parsed_output) return json({ error: "Recognition returned no data" }, 502)
    return json({ recipe: response.parsed_output, model: response.model })
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "Rate limited, try again later" }, 429)
    if (error instanceof Anthropic.APIError) {
      console.error("Anthropic API error", error.status, error.message)
      const hint = error.status === 401 ? "ANTHROPIC_API_KEY ungültig (Secret prüfen)" : `Claude-Fehler ${error.status}`
      return json({ error: hint }, 502)
    }
    console.error("recipe-ocr failed", error)
    return json({ error: "Recognition failed" }, 500)
  }
})
