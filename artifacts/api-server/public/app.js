const state = { account: null, config: null, ethereum: window.ethereum, tokenDeploymentConfirmed: false };
const $ = (id) => document.getElementById(id);

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 5000);
}

function shortAddress(address) { return `${address.slice(0, 6)}...${address.slice(-4)}`; }
function setBusy(button, busy) { button.disabled = busy || !state.account; button.dataset.original = button.dataset.original || button.textContent; button.textContent = busy ? "Waiting for wallet..." : button.dataset.original; }
function updateCreationProgress(percent, label, detail) {
  $("creation-progress").hidden = false;
  $("creation-progress-bar").style.width = `${percent}%`;
  $("creation-progress-percent").textContent = `${percent}%`;
  $("creation-progress-label").textContent = label;
  $("creation-progress-detail").textContent = detail;
}
function setConnected(enabled) {
  ["refresh-button", "create-button", ...document.querySelectorAll(".initiative-button, .reward-button")].forEach((control) => {
    const element = typeof control === "string" ? $(control) : control;
    if (element) element.disabled = !enabled;
  });
  $("connect-button").textContent = enabled ? shortAddress(state.account) : "Connect wallet";
  $("wallet-address").textContent = enabled ? state.account : "Wallet not connected";
  $("wallet-state").lastElementChild.textContent = enabled ? "Wallet connected. You are ready to act." : "Connect your wallet to enter the app";
}
function addActivity(label, detail, success = true) {
  const log = $("activity-log");
  if (log.querySelector(".empty-state")) log.innerHTML = "";
  const item = document.createElement("div");
  item.className = "activity-item";
  item.innerHTML = `<span class="status-dot" style="background:${success ? "var(--moss)" : "var(--orange)"}"></span><span>${label}</span><span class="activity-meta">${detail}</span>`;
  log.prepend(item);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { cache: "no-store", headers: { "content-type": "application/json" }, ...options });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || raw || `API request failed with HTTP ${response.status}.`);
  return data;
}

async function connectWallet() {
  if (!state.ethereum) throw new Error("No browser wallet found. Install MetaMask or another EVM wallet.");
  const accounts = await state.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("No wallet account was selected.");
  state.account = accounts[0];
  await ensureNetwork();
  setConnected(true);
  await refreshBalance();
}

async function ensureNetwork() {
  const chainId = Number(state.config.chainId);
  const targetHex = `0x${chainId.toString(16)}`;
  const current = await state.ethereum.request({ method: "eth_chainId" });
  if (current.toLowerCase() === targetHex.toLowerCase()) return;
  try {
    await state.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetHex }] });
  } catch (error) {
    throw new Error(`Switch your wallet to chain ${state.config.chainId} before continuing.`);
  }
}

function getTransactionItems(prepared) {
  const list = Array.isArray(prepared.transactions) ? prepared.transactions : [prepared.transactions];
  return list.filter(Boolean);
}
function getTransactionId(prepared, index) {
  return Array.isArray(prepared.txId) ? prepared.txId[index] : prepared.txId;
}
function unwrapTransaction(item) { return item.transaction || item.rawTransaction || item; }
function asHex(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && value.startsWith("0x")) return value;
  return `0x${BigInt(value).toString(16)}`;
}
function walletTransaction(item) {
  const tx = unwrapTransaction(item);
  if (!tx.to || !tx.data) throw new Error("Brickken returned an incomplete wallet transaction.");
  return { from: state.account, to: tx.to, data: tx.data, value: asHex(tx.value), gas: asHex(tx.gas ?? tx.gasLimit) };
}

async function executePrepared(prepared, label, progress) {
  const items = getTransactionItems(prepared);
  const hashes = [];
  for (let index = 0; index < items.length; index += 1) {
    const txId = getTransactionId(prepared, index);
    if (!txId) throw new Error("Brickken did not return a transaction ID.");
    if (progress) progress(45, "Confirm in your wallet", "Approve the GREEN deployment in your wallet.");
    const hash = await state.ethereum.request({ method: "eth_sendTransaction", params: [walletTransaction(items[index])] });
    hashes.push({ txId, hash });
    await api("/brickken/send", { method: "POST", body: JSON.stringify({ txId, txHash: hash }) });
    addActivity(label, `${shortAddress(hash)} submitted`);
    if (progress) progress(65, "Confirming on-chain", "Your wallet transaction was submitted. Waiting for the blockchain receipt.");
  }
  for (const submitted of hashes) await waitForConfirmation(submitted.txId, submitted.hash, progress);
  return hashes;
}

async function waitForWalletReceipt(hash) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const receipt = await state.ethereum.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("The wallet transaction was reverted on-chain.");
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error("The wallet transaction is still pending. Check your wallet before retrying.");
}

async function waitForConfirmation(txId, hash, progress) {
  await waitForWalletReceipt(hash);
  if (progress) progress(82, "Indexing with Brickken", "The blockchain receipt is confirmed. Brickken is registering the GREEN token.");
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const status = await api(`/brickken/status?txId=${encodeURIComponent(txId)}&poll=${Date.now()}`);
    const value = String(status.status || status.state || "").toLowerCase();
    if (["confirmed", "success", "completed", "succeeded"].includes(value)) {
      state.tokenDeploymentConfirmed = true;
      return waitForTokenRecord(progress);
    }
    if (["failed", "reverted", "rejected", "error"].includes(value)) {
      const detail = status.error || status.message || "No additional error details were provided.";
      const reference = status.transactionHash ? ` (${shortAddress(status.transactionHash)})` : "";
      throw new Error(`Transaction ${value}${reference}: ${detail}`);
    }
    if (progress && attempt % 5 === 0) progress(82 + Math.min(16, Math.floor(attempt / 5)), "Indexing with Brickken", "The transaction is confirmed. Waiting for Brickken to finish registering GREEN.");
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("Brickken is taking longer than expected to index GREEN. The wallet transaction is confirmed; check again shortly before retrying.");
}

async function waitForTokenRecord(progress) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const token = await api(`/brickken/token?poll=${Date.now()}`);
      if (token && token.tokenSymbol === state.config.tokenSymbol) {
        if (progress) progress(100, "GREEN is ready", "The token has been created and is ready for rewards.");
        return token;
      }
    } catch (error) {
      if (progress && attempt % 5 === 0) progress(82 + Math.min(16, Math.floor(attempt / 5)), "Indexing with Brickken", "The blockchain transaction is confirmed. Waiting for GREEN to appear in Brickken.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("The blockchain transaction is confirmed, but Brickken has not registered GREEN yet. Do not deploy again; wait for the token record to appear.");
}

async function prepareAndExecute(operation, body, label, progress) {
  const prepared = await api("/brickken/prepare", { method: "POST", body: JSON.stringify({ operation, walletAddress: state.account, ...body }) });
  return executePrepared(prepared, label, progress);
}

async function refreshBalance() {
  if (!state.account) return;
  const email = $("investor-email").value.trim();
  if (!email) { $("balance-source").textContent = "Enter your investor email to read the Brickken balance."; return; }
  try {
    const result = await api(`/brickken/balance?investorEmail=${encodeURIComponent(email)}`);
    $("balance-value").textContent = result.tokenBalance ?? result.balance ?? "0";
    $("balance-symbol").textContent = state.config.tokenSymbol;
    $("balance-source").textContent = `On-chain balance for ${email}`;
  } catch (error) { $("balance-source").textContent = error.message; }
}

async function createToken() {
  const button = $("create-button"); setBusy(button, true);
  updateCreationProgress(15, "Preparing token deployment", "Brickken is preparing the GREEN token transaction.");
  try {
    await prepareAndExecute("create", { tokenizerEmail: $("tokenizer-email").value.trim() }, "GREEN token deployment", updateCreationProgress);
    $("setup-panel").hidden = true;
    showToast("GREEN token confirmed on-chain.");
  }
  catch (error) {
    if (state.tokenDeploymentConfirmed) {
      updateCreationProgress(96, "Blockchain confirmed", error.message);
      $("create-button").disabled = true;
      showToast(error.message);
    } else {
      updateCreationProgress(0, "Token deployment failed", error.message);
      $("creation-progress-bar").classList.add("progress-error");
      addActivity("Token deployment failed", error.message, false);
      showToast(error.message);
    }
  }
  finally { setBusy(button, false); }
}
async function mint(amount, button) {
  setBusy(button, true);
  try {
    const email = $("investor-email").value.trim();
    if (!email) throw new Error("Enter an investor email first.");
    const whitelist = await api(`/brickken/whitelist?address=${encodeURIComponent(state.account)}`);
    const isWhitelisted = whitelist.isWhitelisted === true;
    await prepareAndExecute("mint", {
      investorEmail: email,
      amount,
      needWhitelist: !isWhitelisted,
    }, `Minted ${amount} GREEN`);
    await refreshBalance(); showToast(`${amount} GREEN minted.`);
  } catch (error) { addActivity("Mint failed", error.message, false); showToast(error.message); }
  finally { setBusy(button, false); }
}
async function burn(amount, button) {
  setBusy(button, true);
  try {
    const email = $("investor-email").value.trim();
    if (!email) throw new Error("Enter an investor email first.");
    await prepareAndExecute("burn", { investorEmail: email, amount }, `Redeemed ${amount} GREEN`);
    await refreshBalance(); showToast(`${amount} GREEN redeemed.`);
  } catch (error) { addActivity("Redemption failed", error.message, false); showToast(error.message); }
  finally { setBusy(button, false); }
}

async function initializeTokenState() {
  try {
    await api("/brickken/token");
    $("setup-panel").hidden = true;
  } catch (error) {
    $("setup-panel").hidden = false;
  }
}

async function bootstrap() {
  try {
    state.config = await api("/brickken/config");
    $("balance-symbol").textContent = state.config.tokenSymbol;
    $("network-label").textContent = `Sandbox / chain ${state.config.chainId}`;
    await initializeTokenState();
    $("connect-button").addEventListener("click", () => connectWallet().catch((error) => showToast(error.message)));
    $("refresh-button").addEventListener("click", () => refreshBalance());
    $("create-button").addEventListener("click", createToken);
    document.querySelectorAll(".initiative-button").forEach((button) => button.addEventListener("click", () => mint(button.dataset.amount, button)));
    document.querySelectorAll(".reward-button").forEach((button) => button.addEventListener("click", () => burn(button.dataset.amount, button)));
    $("investor-email").addEventListener("change", refreshBalance);
    if (state.ethereum) state.ethereum.on?.("accountsChanged", (accounts) => { state.account = accounts[0] || null; setConnected(Boolean(state.account)); });
  } catch (error) { showToast(error.message); }
}
bootstrap();
