import { Router, type IRouter, type Response } from "express";
import {
  brickkenRequest,
  BrickkenRequestError,
  getBrickkenConfig,
  type BrickkenOperation,
} from "../lib/brickken";

const router: IRouter = Router();
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

function requireAddress(value: unknown): string {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new Error("A valid EVM wallet address is required.");
  }
  return value;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function requireAmount(value: unknown): string {
  const amount = requireText(value, "amount");
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
    throw new Error("amount must be a positive whole number.");
  }
  return amount;
}

function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Brickken request failed.";
  const status = error instanceof BrickkenRequestError
    ? error.status
    : message.includes("required") || message.includes("valid") || message.includes("positive")
      ? 400
      : 502;
  res.status(status).json({ error: message });
}

router.get("/config", (_req, res) => {
  const config = getBrickkenConfig();
  res.json({
    chainId: config.chainId,
    tokenSymbol: config.tokenSymbol,
    tokenName: config.tokenName,
    apiConfigured: Boolean(config.apiKey),
    tokenizerConfigured: Boolean(config.tokenizerEmail),
  });
});

router.get("/token", async (_req, res) => {
  try {
    const config = getBrickkenConfig();
    const token = await brickkenRequest(
      `/get-token-info?tokenSymbol=${encodeURIComponent(config.tokenSymbol)}`,
      { method: "GET" },
    );
    res.json(token);
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/balance", async (req, res) => {
  try {
    const config = getBrickkenConfig();
    const investorEmail = requireText(req.query.investorEmail, "investorEmail");
    const balance = await brickkenRequest(
      `/get-balance-whitelist?tokenSymbol=${encodeURIComponent(config.tokenSymbol)}&investorEmail=${encodeURIComponent(investorEmail)}`,
      { method: "GET" },
    );
    res.json(balance);
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/whitelist", async (req, res) => {
  try {
    const config = getBrickkenConfig();
    const address = requireAddress(req.query.address);
    const whitelist = await brickkenRequest(
      `/get-whitelist-status?tokenSymbol=${encodeURIComponent(config.tokenSymbol)}&address=${encodeURIComponent(address)}`,
      { method: "GET" },
    );
    res.json(whitelist);
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/prepare", async (req, res) => {
  try {
    const config = getBrickkenConfig();
    const operation = requireText(req.body?.operation, "operation") as BrickkenOperation;
    const walletAddress = requireAddress(req.body?.walletAddress);
    const investorEmail = optionalText(req.body?.investorEmail);
    const common = {
      chainId: config.chainId,
      signerAddress: walletAddress,
      tokenSymbol: config.tokenSymbol,
      executionMode: "client-broadcast",
    };

    let payload: Record<string, unknown>;
    if (operation === "create") {
      payload = {
        method: "newTokenization",
        chainId: config.chainId,
        signerAddress: walletAddress,
        tokenizerEmail: requireText(
          optionalText(req.body?.tokenizerEmail) ?? config.tokenizerEmail,
          "tokenizerEmail",
        ),
        name: config.tokenName,
        tokenSymbol: config.tokenSymbol,
        tokenType: "RWA_TOKEN",
        supplyCap: "1000000",
        executionMode: "client-broadcast",
      };
    } else if (operation === "whitelist") {
      payload = {
        ...common,
        method: "whitelist",
        userToWhitelist: [{
          investorAddress: walletAddress,
          investorEmail: requireText(investorEmail, "investorEmail"),
          whitelistStatus: true,
          needKyc: false,
        }],
      };
    } else if (operation === "mint") {
      payload = {
        ...common,
        method: "mintToken",
        userToMint: [{
          investorAddress: walletAddress,
          investorEmail: requireText(investorEmail, "investorEmail"),
          amount: requireAmount(req.body?.amount),
          needWhitelist: req.body?.needWhitelist !== false,
          needKyc: false,
        }],
      };
    } else if (operation === "burn") {
      payload = {
        ...common,
        method: "burnToken",
        amount: requireAmount(req.body?.amount),
        investorEmail: requireText(investorEmail, "investorEmail"),
      };
    } else {
      throw new Error("operation must be create, whitelist, mint, or burn.");
    }

    const prepared = await brickkenRequest("/prepare-transactions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    res.json(prepared);
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/send", async (req, res) => {
  try {
    const txId = requireText(req.body?.txId, "txId");
    const txHash = requireText(req.body?.txHash, "txHash");
    const sent = await brickkenRequest("/send-transactions", {
      method: "POST",
      body: JSON.stringify({ txId, txHash }),
    });
    res.json(sent);
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/status", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const txId = requireText(req.query.txId, "txId");
    const hash = typeof req.query.hash === "string" ? req.query.hash : undefined;
    const query = hash
      ? `hash=${encodeURIComponent(hash)}`
      : `txId=${encodeURIComponent(txId)}`;
    const status = await brickkenRequest(
      `/get-transaction-status?${query}`,
      { method: "GET" },
    );
    res.json(status);
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
