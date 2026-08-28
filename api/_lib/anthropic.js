// ════════════════════════════════════════════════════════════════
//  api/_lib/anthropic.js  —  Client Anthropic partagé (fetch brut)
//
//  Centralise ce qui était copié-collé dans 10 endpoints :
//  modèle, headers, timeout, retry, extraction de texte, parse JSON.
//  Le préfixe "_" empêche Vercel d'exposer ce fichier comme endpoint.
//
//  Prompt caching : le system prompt est envoyé en bloc avec
//  cache_control ephemeral → les tours suivants d'une même
//  conversation relisent le prompt depuis le cache (coût réduit).
//  Sans effet (et sans erreur) sous le seuil minimal de tokens.
// ════════════════════════════════════════════════════════════════

export const MODEL = 'claude-haiku-4-5-20251001';

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_TIMEOUT_MS = 25_000;

export class AnthropicHttpError extends Error {
  constructor(status, body) {
    super(`Anthropic ${status}`);
    this.status = status;
    this.body = body;
  }
}

// Un retry uniquement sur les erreurs transitoires (réseau, 429, 5xx).
function isRetryable(err) {
  if (err instanceof AnthropicHttpError) {
    return err.status === 429 || err.status >= 500;
  }
  return true; // erreur réseau / timeout
}

export async function callClaude({
  system,
  messages,
  maxTokens = 1024,
  temperature,
  tools,
  toolChoice,
  model = MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 1,
}) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages,
  };
  if (system) {
    body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  }
  if (temperature !== undefined) body.temperature = temperature;
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Anthropic error ${response.status}:`, errText.slice(0, 500));
        throw new AnthropicHttpError(response.status, errText.slice(0, 500));
      }

      return await response.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isRetryable(err)) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Concatène tous les blocs texte de la réponse (ignore thinking/tool_use).
export function extractText(data) {
  return (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

// Renvoie l'input du premier bloc tool_use, ou null.
export function extractToolUse(data) {
  const block = (data.content || []).find(b => b.type === 'tool_use');
  return block ? block.input : null;
}

// Parse défensif d'un JSON renvoyé en texte : strip des fences
// markdown puis isolement du premier objet {…}. Throw si illisible.
export function safeParseJson(raw) {
  let txt = (raw || '').trim();
  txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const first = txt.indexOf('{');
  const last = txt.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) txt = txt.slice(first, last + 1);
  return JSON.parse(txt);
}
