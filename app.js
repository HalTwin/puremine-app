// PureMine 前端逻辑。零外部库：window.ethereum(钱包签名) + fetch(读链)。
// 安全:全程不碰私钥;用户每笔交易钱包弹窗确认;损失上限=当次那笔 ETH。
"use strict";
const CFG = window.CFG;
const SEL = CFG.SEL;
let account = null;

// ---------- 编码/格式化 ----------
const strip0x = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const enc32Uint = (v) => BigInt(v).toString(16).padStart(64, "0");
const enc32Addr = (a) => strip0x(a).toLowerCase().padStart(64, "0");
function parseEther(str) { // 精确十进制→wei(BigInt)
  str = String(str).trim(); if (!str) return 0n;
  const [i, f = ""] = str.split(".");
  const frac = (f + "0".repeat(18)).slice(0, 18);
  return BigInt(i || "0") * 10n ** 18n + BigInt(frac || "0");
}
function fmtEther(wei, prec = 4) {
  wei = BigInt(wei); const neg = wei < 0n; if (neg) wei = -wei;
  const whole = wei / 10n ** 18n, frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, prec);
  return (neg ? "-" : "") + whole.toString() + (prec ? "." + frac : "");
}
const fmtHbtc = (wei, prec = 2) => fmtEther(wei, prec);

// ---------- 只读 RPC(带回退) ----------
async function rpc(method, params) {
  let lastErr;
  for (const url of CFG.RPCS) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
      lastErr = j.error;
    } catch (e) { lastErr = e; }
  }
  throw new Error("RPC " + method + " 失败: " + JSON.stringify(lastErr));
}
const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const readUint = async (to, data) => BigInt(await ethCall(to, data));

// ---------- 钱包 ----------
async function connect() {
  if (!window.ethereum) { toast("未检测到钱包,请安装 MetaMask 等浏览器钱包"); return; }
  try {
    const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
    account = accs[0];
    await ensureChain();
    onConnected();
  } catch (e) { toast("连接失败: " + (e.message || e)); }
}
async function ensureChain() {
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CFG.CHAIN_HEX }] });
  } catch (e) {
    if (e.code === 4902) { // 链没添加过
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CFG.CHAIN_HEX, chainName: CFG.CHAIN_NAME,
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [CFG.RPCS[0]], blockExplorerUrls: [CFG.EXPLORER],
        }],
      });
    } else throw e;
  }
}
function onConnected() {
  const el = document.getElementById("walletBtn");
  el.innerHTML = `<span class="dot"></span>${account.slice(0, 6)}…${account.slice(-4)}`;
  refreshAccount();
}

// 发一笔交易(钱包签名)
async function sendTx(to, data, valueWei = 0n) {
  if (!account) { await connect(); if (!account) return null; }
  const params = [{ from: account, to, data, value: "0x" + valueWei.toString(16) }];
  const txh = await window.ethereum.request({ method: "eth_sendTransaction", params });
  toast("已提交,等待确认… " + txh.slice(0, 10));
  return txh;
}

// ---------- 读:仪表盘 ----------
let curBlockIndex = 0n, roundEnd = 0;
async function refreshDashboard() {
  try {
    curBlockIndex = await readUint(CFG.HOOK, SEL.currentBlockIndex);
    const W = await readUint(CFG.HOOK, SEL.totalWorkOf + enc32Uint(curBlockIndex));
    const toll = Number(await readUint(CFG.HOOK, SEL.tollRateBps));
    roundEnd = CFG.GENESIS + Number(curBlockIndex + 1n) * CFG.ROUND;
    // 价格:slot0 低 160 位 = sqrtPriceX96
    const slot0 = await ethCall(CFG.PM, SEL.extsload + strip0x(CFG.POOL_SLOT0_KEY));
    const sqrtP = BigInt(slot0) & ((1n << 160n) - 1n);
    const pf = Number(sqrtP) / 2 ** 96;
    const hbtcPerEth = pf * pf;                    // 1 ETH = ? HBTC
    const ethPerHbtc = hbtcPerEth ? 1 / hbtcPerEth : 0; // 1 HBTC = ? ETH
    setText("curBlock", "#" + curBlockIndex);
    setText("curWork", fmtEther(W, 3));
    setText("blockWork", fmtEther(W, 3));
    setText("tollRate", (toll / 100).toFixed(1));
    setText("hbtcPrice", ethPerHbtc.toExponential(3));
    window._W = W; window._toll = toll;           // 供预估用
    updateSingleEstimate();
    refreshBlocks(curBlockIndex);                 // 刷新"近期矿块"横排
  } catch (e) { console.warn("dashboard", e); }
}

// 近期矿块横排:当前块 + 最近 5 个已封存块(全网算力 W + 产量 + 封存时间)
async function refreshBlocks(idx) {
  const row = document.getElementById("blocksRow");
  if (!row) return;
  row.querySelectorAll(".blk.sealed").forEach((e) => e.remove()); // 清旧
  const now = Math.floor(Date.now() / 1000);
  const cards = [];
  for (let i = 1n; i <= 5n; i++) {
    const bi = idx - i;
    if (bi < 0n) break;
    let w = 0n;
    try { w = await readUint(CFG.HOOK, SEL.totalWorkOf + enc32Uint(bi)); } catch (e) { }
    const sealedAt = CFG.GENESIS + Number(bi + 1n) * CFG.ROUND;
    const ago = now - sealedAt;
    const agoStr = ago < 60 ? "刚封存" : ago < 3600 ? Math.floor(ago / 60) + " 分钟前" : Math.floor(ago / 3600) + " 小时前";
    cards.push(
      `<div class="blk sealed"><div class="bt"><span class="bn">#${bi}</span><span class="tag">已封存</span></div>` +
      `<div class="big gold">2430 HBTC</div><div class="sub">${fmtEther(w, 3)} ETH 全网</div>` +
      `<div class="subm">${agoStr}</div></div>`
    );
  }
  row.insertAdjacentHTML("beforeend", cards.join(""));
}
function tickCountdown() {
  if (!roundEnd) return;
  let s = roundEnd - Math.floor(Date.now() / 1000);
  if (s < 0) s = 0;
  const m = Math.floor(s / 60), ss = String(s % 60).padStart(2, "0");
  setText("countdown", `${String(m).padStart(2, "0")}:${ss}`);
}

// ---------- 读:我的账户 ----------
async function refreshAccount() {
  if (!account) return;
  try {
    const [bal, pending, hbtc] = await Promise.all([
      readUint(CFG.SERVICE, SEL.userBalance + enc32Addr(account)),
      readUint(CFG.HOOK, SEL.pendingRewards + enc32Addr(account)),
      readUint(CFG.HBTC, SEL.balanceOf + enc32Addr(account)),
    ]);
    setText("acctBalance", fmtEther(bal, 4));
    setText("pendingReward", fmtHbtc(pending, 1));
    setText("acctHbtc", fmtHbtc(hbtc, 0));
    const wei = BigInt(await rpc("eth_getBalance", [account, "latest"]));
    setText("walletEth", fmtEther(wei, 4));
  } catch (e) { console.warn("account", e); }
}

// 预估奖励(简化:你的份额≈work/(W+work))
function updateSingleEstimate() {
  const v = parseEther(document.getElementById("inpSingle")?.value || "0");
  if (v <= 0n || !window._toll) { setText("estSingle", "—"); return; }
  const budget = v - (v * BigInt(CFG.FEE_BPS)) / 10000n;
  const workEth = Number(fmtEther(budget, 8)) * (1 - 0.005); // 0.5% 缓冲
  const Weth = Number(fmtEther(window._W || 0n, 8));
  const est = CFG.SCHEDULED * workEth / (Weth + workEth || 1);
  setText("estSingle", "≈ " + est.toFixed(0) + " HBTC");
}

// ---------- 动作 ----------
async function doMineOnce() {
  const v = parseEther(document.getElementById("inpSingle").value);
  if (v < parseEther(CFG.MIN_MINE_ETH) || v > parseEther(CFG.MAX_PER_MINE_ETH)) {
    toast(`单次投入需在 ${CFG.MIN_MINE_ETH}~${CFG.MAX_PER_MINE_ETH} ETH`); return;
  }
  try { const h = await sendTx(CFG.SERVICE, SEL.mineOnce, v); if (h) await afterTx(h); }
  catch (e) { toast("挖矿失败: " + short(e)); }
}
async function doDeposit() {
  const v = parseEther(document.getElementById("inpDeposit").value);
  if (v <= 0n) { toast("请输入存入金额"); return; }
  try { const h = await sendTx(CFG.SERVICE, SEL.deposit, v); if (h) await afterTx(h); }
  catch (e) { toast("存入失败: " + short(e)); }
}
async function doWithdraw() {
  const bal = await readUint(CFG.SERVICE, SEL.userBalance + enc32Addr(account));
  if (bal <= 0n) { toast("预存账户余额为 0"); return; }
  const to = account; // 默认取回自己;合约支持自选地址,如需可加输入框
  const data = SEL.withdraw + enc32Uint(bal) + enc32Addr(to);
  try { const h = await sendTx(CFG.SERVICE, data, 0n); if (h) await afterTx(h); }
  catch (e) { toast("赎回失败: " + short(e)); }
}
async function doClaim() {
  try { const h = await sendTx(CFG.HOOK, SEL.claim, 0n); if (h) await afterTx(h); }
  catch (e) { toast("领取失败: " + short(e)); }
}
async function afterTx(txh) {
  // 轮询回执
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const r = await rpc("eth_getTransactionReceipt", [txh]).catch(() => null);
    if (r) {
      const ok = parseInt(r.status, 16) === 1;
      toast(ok ? "✅ 成功 " + txh.slice(0, 10) : "❌ 交易失败(status=0)");
      refreshAccount(); refreshDashboard();
      return;
    }
  }
  toast("回执超时,稍后自查: " + txh.slice(0, 12));
}

// ---------- 多次挖(EIP-712 签名 + 提交 keeper) ----------
async function startBatch() {
  if (!account) { await connect(); if (!account) return; }
  const dep = parseEther(document.getElementById("inpDeposit").value);
  const perMine = parseEther(document.getElementById("inpPerMine").value);
  const count = parseInt(document.getElementById("inpCount").value || "0", 10);
  const buyLine = parseEther(document.getElementById("inpBuyLine").value);
  if (perMine < parseEther(CFG.MIN_MINE_ETH) || perMine > parseEther(CFG.MAX_PER_MINE_ETH)) {
    toast(`单次额度需在 ${CFG.MIN_MINE_ETH}~${CFG.MAX_PER_MINE_ETH} ETH`); return;
  }
  if (count <= 0) { toast("请输入挖矿次数"); return; }
  try {
    // 1) 若填了存入金额,先存款
    if (dep > 0n) { const h = await sendTx(CFG.SERVICE, SEL.deposit, dep); if (h) await waitReceipt(h); }
    // 2) 读当前授权 nonce,构造 MineAuth,签名
    const nonce = await readUint(CFG.SERVICE, SEL.authNonce + enc32Addr(account));
    const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 天有效
    const auth = {
      user: account, perMineMax: perMine.toString(), totalCount: String(count),
      deadline: String(deadline), nonce: nonce.toString(),
    };
    const typedData = {
      types: CFG.EIP712_TYPES, primaryType: "MineAuth",
      domain: { name: CFG.EIP712_DOMAIN_NAME, version: CFG.EIP712_DOMAIN_VERSION, chainId: CFG.CHAIN_ID, verifyingContract: CFG.SERVICE },
      message: auth,
    };
    const sig = await window.ethereum.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(typedData)] });
    // 3) 提交 keeper
    const res = await fetch(CFG.KEEPER_API + "/session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auth, sig, perMineValue: perMine.toString(), buyLine: buyLine.toString() }),
    });
    const j = await res.json();
    if (j.ok) { toast("✅ 已开始自动挖矿,keeper 会在买入线内代挖"); pollBatch(); }
    else toast("提交失败: " + (j.error || "unknown"));
  } catch (e) { toast("开始失败: " + short(e)); }
}
async function stopBatch() {
  try {
    await fetch(CFG.KEEPER_API + "/stop", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: account }),
    });
    // 同时链上撤销授权(不依赖 keeper),更安全
    const h = await sendTx(CFG.SERVICE, SEL.cancelAuth, 0n);
    if (h) await afterTx(h);
    toast("已停止并撤销授权,余额将退回/可自取");
  } catch (e) { toast("停止失败: " + short(e)); }
}
async function pollBatch() {
  try {
    const r = await fetch(CFG.KEEPER_API + "/status").then((x) => x.json());
    const s = r.sessions && r.sessions[account];
    if (s) setText("batchUsed", `已挖 ${s.used} 次`);
  } catch (e) { /* keeper 未连,忽略 */ }
}

// ---------- 工具 ----------
function setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
const short = (e) => String(e.message || e).slice(0, 80);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitReceipt(txh) { for (let i = 0; i < 40; i++) { await sleep(1500); const r = await rpc("eth_getTransactionReceipt", [txh]).catch(() => null); if (r) return r; } }
let toastT;
function toast(msg) {
  const t = document.getElementById("toast"); if (!t) return;
  document.getElementById("toastMsg").textContent = msg;
  t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3200);
}

// ---------- 启动 ----------
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("walletBtn")?.addEventListener("click", connect);
  document.getElementById("btnMineOnce")?.addEventListener("click", doMineOnce);
  document.getElementById("btnDeposit")?.addEventListener("click", doDeposit);
  document.getElementById("btnStartBatch")?.addEventListener("click", startBatch);
  document.getElementById("btnStopBatch")?.addEventListener("click", stopBatch);
  document.getElementById("btnWithdraw")?.addEventListener("click", doWithdraw);
  document.getElementById("btnClaim")?.addEventListener("click", doClaim);
  document.getElementById("inpSingle")?.addEventListener("input", updateSingleEstimate);
  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", (a) => { account = a[0] || null; if (account) onConnected(); });
  }
  refreshDashboard();
  setInterval(tickCountdown, 1000);
  setInterval(refreshDashboard, 30000);
  setInterval(() => { if (account) refreshAccount(); }, 30000);
  setInterval(() => { if (account) pollBatch(); }, 20000);
});
