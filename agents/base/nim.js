// Minimal OpenAI-compatible client for NVIDIA NIM (or any compatible endpoint).
// We avoid the official SDK to keep the image small and the dependency surface flat.

export async function chat({ baseUrl, apiKey, model, system, user, temperature = 0.8, maxTokens = 400, signal }) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NIM ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("NIM: no content in response");
  return content;
}

// Strip markdown code fences and prose around the actual code.
// The model often wraps output in ```js ... ``` or adds commentary.
export function extractCode(raw) {
  const fence = raw.match(/```(?:[a-zA-Z]+)?\n([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  return raw.trim();
}
