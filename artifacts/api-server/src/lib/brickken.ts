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
    const detail =
      responseBody && typeof responseBody === "object" && "message" in responseBody
        ? String(responseBody.message)
        : `Brickken returned HTTP ${response.status}.`;
    throw new Error(detail);
  }

  return responseBody;
}
