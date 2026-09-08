const state = { account: null, config: null, ethereum: window.ethereum };
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
function setConnected(enabled) {
  ["refresh-button", "mint-button", "burn-button", "create-button"].forEach((id) => { $(id).disabled = !enabled; });
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
  const response = await fetch(`/api${path}`, { headers: { "content-type": "application/json" }, ...options });
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

async function executePrepared(prepared, label) {
  const items = getTransactionItems(prepared);
  const hashes = [];
  for (let index = 0; index < items.length; index += 1) {
    const txId = getTransactionId(prepared, index);
    if (!txId) throw new Error("Brickken did not return a transaction ID.");
    const hash = await state.ethereum.request({ method: "eth_sendTransaction", params: [walletTransaction(items[index])] });
    hashes.push({ txId, hash });
    await api("/brickken/send", { method: "POST", body: JSON.stringify({ txId, txHash: hash }) });
    addActivity(label, `${shortAddress(hash)} submitted`);
  }
  for (const submitted of hashes) await waitForConfirmation(submitted.txId);
  return hashes;
}

async function waitForConfirmation(txId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await api(`/brickken/status?txId=${encodeURIComponent(txId)}`);
    const value = String(status.status || status.state || "").toLowerCase();
    if (["confirmed", "success", "completed", "succeeded"].includes(value)) return status;
    if (["failed", "reverted", "error"].includes(value)) throw new Error(`Transaction ${value}.`);
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("Transaction is still pending. Check the activity on Brickken before retrying.");
}

async function prepareAndExecute(operation, body, label) {
  const prepared = await api("/brickken/prepare", { method: "POST", body: JSON.stringify({ operation, walletAddress: state.account, ...body }) });
  return executePrepared(prepared, label);
}

async function refreshBalance() {
  if (!state.account) return;
  const email = $("investor-email").value.trim() || $("redeem-email").value.trim();
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
  try { await prepareAndExecute("create", { tokenizerEmail: $("tokenizer-email").value.trim() }, "GREEN token deployment"); showToast("GREEN token confirmed on-chain."); }
  catch (error) { addActivity("Token deployment failed", error.message, false); showToast(error.message); }
  finally { setBusy(button, false); }
}
async function mint() {
  const button = $("mint-button"); setBusy(button, true);
  try {
    const email = $("investor-email").value.trim();
    const amount = $("mint-amount").value;
    if (!email) throw new Error("Enter an investor email first.");
    await prepareAndExecute("whitelist", { investorEmail: email }, "Wallet whitelisted");
    await prepareAndExecute("mint", { investorEmail: email, amount }, `Minted ${amount} GREEN`);
    await refreshBalance(); showToast(`${amount} GREEN minted.`);
  } catch (error) { addActivity("Mint failed", error.message, false); showToast(error.message); }
  finally { setBusy(button, false); }
}
async function burn() {
  const button = $("burn-button"); setBusy(button, true);
  try {
    const email = $("redeem-email").value.trim();
    const amount = $("burn-amount").value;
    if (!email) throw new Error("Enter an investor email first.");
    await prepareAndExecute("burn", { investorEmail: email, amount }, `Redeemed ${amount} GREEN`);
    $("investor-email").value = email; await refreshBalance(); showToast(`${amount} GREEN redeemed.`);
  } catch (error) { addActivity("Redemption failed", error.message, false); showToast(error.message); }
  finally { setBusy(button, false); }
}

async function bootstrap() {
  try {
    state.config = await api("/brickken/config");
    $("balance-symbol").textContent = state.config.tokenSymbol;
    $("network-label").textContent = `Sandbox / chain ${state.config.chainId}`;
    $("connect-button").addEventListener("click", () => connectWallet().catch((error) => showToast(error.message)));
    $("refresh-button").addEventListener("click", () => refreshBalance());
    $("create-button").addEventListener("click", createToken);
    $("mint-button").addEventListener("click", mint);
    $("burn-button").addEventListener("click", burn);
    ["investor-email", "redeem-email"].forEach((id) => $(id).addEventListener("change", refreshBalance));
    if (state.ethereum) state.ethereum.on?.("accountsChanged", (accounts) => { state.account = accounts[0] || null; setConnected(Boolean(state.account)); });
  } catch (error) { showToast(error.message); }
}
bootstrap();
