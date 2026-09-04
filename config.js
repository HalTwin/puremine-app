// PureMine 前端配置。部署合约后，把 SERVICE 和 KEEPER_API 两处填成真实值即可。
// 无任何外部库依赖：前端只用 window.ethereum(钱包) + fetch(读链)。
window.CFG = {
  // —— 部署后必填 ——
  SERVICE: "0x0000000000000000000000000000000000000000", // TODO: 部署后填服务合约地址
  KEEPER_API: "http://127.0.0.1:8899",                    // TODO: 填 keeper 后端地址(多次挖用)

  // —— 链 ——
  CHAIN_ID: 4663,
  CHAIN_HEX: "0x1237",
  CHAIN_NAME: "Robinhood Chain",
  RPCS: ["https://robinhood-rpc.publicnode.com/", "https://rpc.mainnet.chain.robinhood.com"],
  EXPLORER: "https://robinhoodchain.blockscout.com",
  OFFICIAL_POOL: "https://hookedbitcoin.org/hookedpool",

  // —— 合约/资产地址(已核验) ——
  HOOK: "0x8A54Af70908A9E2d1ea09cDaD66358e758E3E0Cc",
  HBTC: "0x8DB244F6Bf052571F4E0C6065b700E714092d4b6",
  PM: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  POOL_SLOT0_KEY: "0x28f197a5a82e99613fe36c9fae115e389e825563602662b4fe7bf0cbf4eff156", // slot0 存储位(常量)

  // —— 挖矿经济参数 ——
  GENESIS: 1787074149,
  ROUND: 600,          // 每块 600s
  SCHEDULED: 2430.5556, // 每块产量(epoch0)
  FEE_BPS: 100,        // 服务费 1%
  MIN_MINE_ETH: 0.001, // 单次挖矿下限(合约同款)
  MAX_PER_MINE_ETH: 0.05, // 单次挖矿上限(合约同款)

  // —— 函数选择器 ——
  SEL: {
    // 服务合约
    mineOnce: "0x0ba88488", deposit: "0xd0e30db0", withdraw: "0x00f714ce", cancelAuth: "0x744b992c",
    userBalance: "0x0103c92b", totalUserBalance: "0xc4c0567b", feePool: "0xae2e933b",
    isSolvent: "0x5ce23950", authNonce: "0x8b524b7a",
    // HOOK
    currentBlockIndex: "0x46e2e35d", totalWorkOf: "0x48ccee07", tollRateBps: "0x312de888",
    claim: "0x4e71d92d", pendingRewards: "0x31d7a262",
    // ERC20 / PM
    balanceOf: "0x70a08231", extsload: "0x1e2eaeaf",
  },

  // —— EIP-712(必须与合约 DOMAIN/typehash 逐字节一致；已用 web3 对拍验证) ——
  EIP712_TYPES: {
    EIP712Domain: [
      { name: "name", type: "string" }, { name: "version", type: "string" },
      { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
    ],
    MineAuth: [
      { name: "user", type: "address" }, { name: "perMineMax", type: "uint256" },
      { name: "totalCount", type: "uint256" }, { name: "deadline", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  },
  EIP712_DOMAIN_NAME: "PureMine",
  EIP712_DOMAIN_VERSION: "1",
};
