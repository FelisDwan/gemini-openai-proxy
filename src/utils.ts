import type { Content, GenerateContentRequest, Part } from "./gemini-api-client/types.ts"
import { HarmBlockThreshold, HarmCategory } from "./gemini-api-client/types.ts"
import type { Any } from "./log.ts"
import type { OpenAI } from "./types.ts"

export interface ApiParam {
  apikey: string
  useBeta: boolean
}

export function getToken(headers: Headers): ApiParam | null {
  for (const [k, v] of headers.entries()) {
    if (k.toLowerCase() !== "authorization") continue

    const rawApikey = v.substring(v.indexOf(" ") + 1)

    if (!rawApikey.includes("#")) {
      return {
        apikey: rawApikey,
        useBeta: false,
      }
    }

    // todo read config from apikey
    const apikey = rawApikey.substring(0, rawApikey.indexOf("#"))
    const params = new URLSearchParams(rawApikey.substring(rawApikey.indexOf("#") + 1))
    return {
      apikey,
      useBeta: params.has("useBeta"),
    }
  }
  return null
}

function parseBase64(base64: string): Part {
  if (!base64.startsWith("data:")) {
    return { text: "" }
  }
  const [m, data, ..._arr] = base64.split(",")
  const mimeType = m.match(/:(?<mime>.*?);/)?.groups?.mime ?? "img/png"
  return {
    inlineData: {
      mimeType,
      data,
    },
  }
}

export function openAiMessageToGeminiMessage(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Content[] {
  const result: Content[] = messages
    .flatMap(({ role, content }) => {
      if (role === "system") {
        return [
          { role: "user", parts: [{ text: content }] },
          { role: "model", parts: [{ text: "" }] },
        ]
      }

      const parts: Part[] =
        content == null || typeof content === "string"
          ? [{ text: content?.toString() ?? "" }]
          : content.map((item) => (item.type === "text" ? { text: item.text } : parseBase64(item.image_url.url)))

      return [{ role: "user" === role ? "user" : "model", parts: parts }]
    })
    .flatMap((item, idx, arr) => {
      if (item.role === arr.at(idx + 1)?.role && item.role === "user") {
        return [item, { role: "model", parts: [{ text: "" }] }]
      }
      return [item]
    })

  return result
}

function hasImageMessage(messages: OpenAI.Chat.ChatCompletionMessageParam[]): boolean {
  return messages.some((msg) => {
    const content = msg.content
    if (content == null) {
      return false
    }
    if (typeof content === "string") {
      return false
    }
    return content.some((it) => it.type === "image_url")
  })
}

export function genModel(req: OpenAI.Chat.ChatCompletionCreateParams): [GeminiModel, GenerateContentRequest] {
  const model = hasImageMessage(req.messages) ? GeminiModel.GEMINI_PRO_VISION : GeminiModel.GEMINI_PRO

  const generateContentRequest: GenerateContentRequest = {
    contents: openAiMessageToGeminiMessage(req.messages),
    generationConfig: {
      maxOutputTokens: req.max_tokens ?? undefined,
      temperature: req.temperature ?? undefined,
      topP: req.top_p ?? undefined,
    },
    safetySettings: [
      HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      HarmCategory.HARM_CATEGORY_HARASSMENT,
    ].map((category) => ({
      category,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    })),
  }
  return [model, generateContentRequest]
}
export enum GeminiModel {
  GEMINI_PRO = "gemini-pro",
  GEMINI_PRO_VISION = "gemini-pro-vision",
}

export function getRuntimeKey() {
  const global = globalThis as typeof globalThis & Record<string, undefined | Any>
  if (global?.Deno !== undefined) {
    return "deno"
  }
  if (global?.Bun !== undefined) {
    return "bun"
  }
  if (typeof global?.WebSocketPair === "function") {
    return "workerd"
  }
  if (typeof global?.EdgeRuntime === "string") {
    return "edge-light"
  }
  if (global?.fastly !== undefined) {
    return "fastly"
  }
  if (global?.process?.release?.name === "node") {
    return "node"
  }
  return "other"
}
