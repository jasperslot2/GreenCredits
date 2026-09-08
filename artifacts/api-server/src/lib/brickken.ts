export type BrickkenOperation = "create" | "whitelist" | "mint" | "burn";

type BrickkenRequestOptions = {
  method: "GET" | "POST";
  body?: string;
};

type BrickkenConfig = {
  apiKey: string;
  apiBaseUrl: string;
  chainId: string;
  tokenSymbol: string;
  tokenName: string;
  tokenizerEmail: string;
};

export function getBrickkenConfig(): BrickkenConfig {
  return {
    apiKey: process.env.BRICKKEN_API_KEY ?? "",
    apiBaseUrl: process.env.BRICKKEN_API_BASE_URL ?? "https://api.sandbox.brickken.com",
    chainId: process.env.BRICKKEN_CHAIN_ID ?? "11155111",
    tokenSymbol: process.env.BRICKKEN_TOKEN_SYMBOL ?? "GREEN",
    tokenName: process.env.BRICKKEN_TOKEN_NAME ?? "GreenCredits",
    tokenizerEmail: process.env.BRICKKEN_TOKENIZER_EMAIL ?? "",
  };
}

export async function brickkenRequest(
  endpoint: string,
  options: BrickkenRequestOptions,
): Promise<unknown> {
  const config = getBrickkenConfig();
  if (!config.apiKey) {
    throw new Error("BRICKKEN_API_KEY is not configured.");
  }

  const response = await fetch(`${config.apiBaseUrl}${endpoint}`, {
    method: options.method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": config.apiKey,
    },
    body: options.body,
  });
  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = getBrickkenError(responseBody) ?? `Brickken returned HTTP ${response.status}.`;
    throw new Error(detail);
  }

  return responseBody;
}

function getBrickkenError(responseBody: unknown): string | undefined {
  if (!responseBody || typeof responseBody !== "object") return undefined;
  const body = responseBody as Record<string, unknown>;
  for (const key of ["message", "error", "detail"]) {
    if (typeof body[key] === "string" && body[key].trim()) return body[key].trim();
  }
  if (Array.isArray(body.errors)) {
    const errors = body.errors.filter((error): error is string => typeof error === "string");
    if (errors.length > 0) return errors.join("; ");
  }
  if (body.errors && typeof body.errors === "object") {
    const nestedErrors = body.errors as Record<string, unknown>;
    if (typeof nestedErrors.messages === "string" && nestedErrors.messages.trim()) {
      return nestedErrors.messages.trim();
    }
  }
  return JSON.stringify(responseBody);
}
