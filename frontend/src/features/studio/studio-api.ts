import { runtimeConfig } from "@/shared/config/runtime-config";

export type PublicModelDTO = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
};

export type ResponseContentItem = {
  type?: string;
  text?: string;
};

export type ResponseOutputItem = {
  id?: string;
  type?: string;
  role?: string;
  status?: string;
  content?: ResponseContentItem[];
};

export type TextGenerationResult = {
  id?: string;
  output_text?: string;
  output?: ResponseOutputItem[];
  status?: string;
};

export type ImageGenerationItem = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

export type ImageGenerationResult = {
  created?: number;
  data: ImageGenerationItem[];
};

export type VideoGenerationResult = {
  id?: string;
  request_id?: string;
  status?: string;
  url?: string;
  download_url?: string;
  error?: {
    code?: string;
    message?: string;
  };
};


export async function listPublicModels(apiKey: string): Promise<PublicModelDTO[]> {
  const response = await fetch(`${runtimeConfig.apiBaseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json().catch(() => null) as { data?: PublicModelDTO[]; error?: { message?: string } } | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  return payload?.data ?? [];
}


export async function generateText(apiKey: string, input: { model: string; prompt: string }): Promise<TextGenerationResult> {
  const response = await fetch(`${runtimeConfig.apiBaseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: input.model, input: input.prompt, stream: false }),
  });
  const payload = await response.json().catch(() => null) as TextGenerationResult & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

export async function generateImage(apiKey: string, input: { model: string; prompt: string; n: number; aspectRatio: string; responseFormat: "url" | "b64_json" }): Promise<ImageGenerationResult> {
  const response = await fetch(`${runtimeConfig.apiBaseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      n: input.n,
      aspect_ratio: input.aspectRatio,
      response_format: input.responseFormat,
    }),
  });
  const payload = await response.json().catch(() => null) as ImageGenerationResult & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

export async function generateVideo(apiKey: string, input: { model: string; prompt: string; aspectRatio: string; imageUrl?: string }): Promise<VideoGenerationResult> {
  const response = await fetch(`${runtimeConfig.apiBaseUrl}/v1/videos/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio,
      image: input.imageUrl ? { url: input.imageUrl } : undefined,
    }),
  });
  const payload = await response.json().catch(() => null) as VideoGenerationResult & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

export async function getVideo(apiKey: string, requestId: string): Promise<VideoGenerationResult> {
  const response = await fetch(`${runtimeConfig.apiBaseUrl}/v1/videos/${requestId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json().catch(() => null) as VideoGenerationResult & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

export function extractOutputText(result: TextGenerationResult): string {
  if (typeof result.output_text === "string" && result.output_text.trim()) {
    return result.output_text.trim();
  }
  const text = result.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n").trim();
  return text || "";
}

export function toImageSource(item: ImageGenerationItem): string | null {
  if (item.url) {
    if (item.url.startsWith("http://") || item.url.startsWith("https://")) {
      return item.url;
    }
    return `${runtimeConfig.apiBaseUrl}${item.url}`;
  }
  if (item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }
  return null;
}

