# GreenCredits
Turning sustainable actions into tangible rewards

GreenCredits is a simple tokenized rewards application designed to encourage and reward sustainable behavior.

The idea is straightforward: users earn GREEN tokens by completing verified sustainable actions, such as recycling, using public transportation, planting trees, or participating in local environmental initiatives.

These GREEN tokens can then be redeemed for real-world rewards. When a user claims a reward, the required amount of GREEN tokens is burned, creating a clear connection between the sustainable action, the earned reward, and the redemption of that reward.

How it works

1. Create the GREEN token
The application creates a dedicated GREEN token that represents sustainability rewards.

2. Earn GREEN
When a user completes a sustainable action, GREEN tokens are minted to their wallet.

3. Hold GREEN
Users can see their token balance and decide how they want to use their earned credits.

4. Redeem a reward
Users select an available reward, such as a discount, experience, or other sustainable incentive.

5. Burn GREEN
The required amount of GREEN tokens is burned when the reward is redeemed.

Why tokenization?

GreenCredits uses tokenization to create a transparent and traceable reward mechanism. Instead of keeping reward points entirely within a centralized database, the token represents the user’s earned credits on-chain.

The minting and burning of tokens also creates a simple and understandable token lifecycle:

Sustainable action → Mint → Earn → Redeem → Burn

Brickken API

Brickken provides the tokenization infrastructure behind GreenCredits. The application demonstrates how the Brickken API can be used to create a token and manage its lifecycle through minting and burning.

Local sandbox configuration

The API server includes the GreenCredits web app and can run independently. It uses an injected EVM wallet (for example MetaMask) to sign every Brickken transaction. Use Ethereum Sepolia for the sandbox. Create `artifacts/api-server/.env.sandbox` with the sandbox-only configuration:

```dotenv
BRICKKEN_API_KEY=replace-with-your-sandbox-key
BRICKKEN_TOKENIZER_EMAIL=issuer@example.com
BRICKKEN_CHAIN_ID=11155111
BRICKKEN_TOKEN_SYMBOL=GREEN
BRICKKEN_TOKEN_NAME=GreenCredits
```

The `.env.sandbox` file is ignored by git. Start it with `pnpm run dev` from `artifacts/api-server`, then open `http://localhost:8080`. Connect the wallet, deploy GREEN once, and use a separate investor email for minting. Brickken requires the tokenizer and investor email identities to differ.

Production deployments must provide `BRICKKEN_API_KEY` through their environment and must not reuse the sandbox key. The browser never receives the API key.
