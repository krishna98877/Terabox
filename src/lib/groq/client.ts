/**
 * Groq AI Client — Ultra-fast LLM for intelligent analysis.
 * Used for: email content parsing, verification extraction, smart suggestions.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * Call Groq API with a prompt. Returns the assistant's response text.
 */
export async function callGroq(
  messages: GroqMessage[],
  options: { model?: string; maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model || DEFAULT_MODEL,
      messages,
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature || 0.3,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as GroqResponse;
  return data.choices?.[0]?.message?.content || '';
}

/**
 * AI-powered email content analysis.
 * Extracts verification codes, links, and action items from email content.
 */
export async function analyzeEmailContent(
  subject: string,
  htmlBody: string,
  textBody: string
): Promise<{
  verificationCode: string | null;
  verificationLink: string | null;
  emailType: string;
  summary: string;
  actionRequired: string | null;
}> {
  try {
    const prompt = `Analyze this email and extract verification information.

Subject: ${subject}
Text: ${textBody.substring(0, 2000)}

Respond in JSON format only:
{
  "verificationCode": "the code if found, null if not",
  "verificationLink": "the verification/confirmation link if found, null if not",
  "emailType": "verification|welcome|notification|password_reset|other",
  "summary": "brief 1-line summary of the email",
  "actionRequired": "what action user needs to take, null if none"
}`;

    const response = await callGroq([
      { role: 'system', content: 'You are an expert email parser. Always respond with valid JSON only. No markdown, no code blocks.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 512, temperature: 0.1 });

    const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch (error) {
    console.error('[Groq] Email analysis failed:', (error as Error).message);
    return {
      verificationCode: null,
      verificationLink: null,
      emailType: 'other',
      summary: 'AI analysis unavailable',
      actionRequired: null,
    };
  }
}

/**
 * AI-powered smart suggestions for configuration optimization.
 */
export async function getSmartSuggestions(
  stats: {
    totalSignups: number;
    verifiedSignups: number;
    failedSignups: number;
    todaySignups: number;
    interval: number;
    maxPerDay: number;
  }
): Promise<string> {
  try {
    const prompt = `Based on these referral signup stats, give 2-3 actionable suggestions to improve success rate:
- Total signups: ${stats.totalSignups}
- Verified: ${stats.verifiedSignups}
- Failed: ${stats.failedSignups}
- Today: ${stats.todaySignups}
- Current interval: ${stats.interval} min
- Max per day: ${stats.maxPerDay}

Success rate: ${stats.totalSignups > 0 ? ((stats.verifiedSignups / stats.totalSignups) * 100).toFixed(1) : 0}%

Keep it concise and actionable. 2-3 bullet points only.`;

    const response = await callGroq([
      { role: 'system', content: 'You are a referral marketing optimization expert. Give brief, actionable suggestions.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 300, temperature: 0.5 });

    return response;
  } catch (error) {
    console.error('[Groq] Suggestions failed:', (error as Error).message);
    return '• Consider increasing signup interval to avoid rate limits\n• Check referral link validity regularly';
  }
}

/**
 * AI-powered error diagnosis.
 */
export async function diagnoseError(
  errorMessage: string,
  context: string
): Promise<string> {
  try {
    const prompt = `Diagnose this signup error and suggest a fix:
Error: ${errorMessage}
Context: ${context}

Give a brief diagnosis and one specific fix suggestion in 1-2 sentences.`;

    const response = await callGroq([
      { role: 'system', content: 'You are a debugging expert. Be concise and specific.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 200, temperature: 0.3 });

    return response;
  } catch (error) {
    console.error('[Groq] Diagnosis failed:', (error as Error).message);
    return 'Unable to diagnose. Check the error log for details.';
  }
}

/**
 * Check if Groq API is configured.
 */
export function isGroqConfigured(): boolean {
  return !!process.env.GROQ_API_KEY;
}
