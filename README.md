# @true402.dev/agentkit

[![npm version](https://img.shields.io/npm/v/@true402.dev/agentkit)](https://www.npmjs.com/package/@true402.dev/agentkit) &nbsp; **Stable · production-ready** — semver-stable public API (v1.0).

true402 actions for **Coinbase AgentKit** — give your Base agent **pay-per-call on-chain safety** over [x402](https://x402.org): rug/honeypot checks, address safety, and deployer reputation. No account, no API key — the wallet is the identity (USDC on Base, gas sponsored by the facilitator).

```bash
npm i @true402.dev/agentkit @coinbase/agentkit
```

```ts
import { AgentKit } from '@coinbase/agentkit';
import { createTrue402ActionProviders } from '@true402.dev/agentkit';

const agentKit = await AgentKit.from({
  walletProvider, // your configured WalletProvider (Base)
  actionProviders: createTrue402ActionProviders({
    payerPrivateKey: process.env.PAYER_PRIVATE_KEY!,
  }),
});
// → surface to your LLM with getLangChainTools(agentKit) or getVercelAITools(agentKit)
```

The agent can now call, before it trades:

| Action | What it does | ~price |
|---|---|---|
| `true402_token_report` | **Primary — pre-trade gate.** Composite **avoid / caution / ok** verdict for a Base ERC-20 (buy/sell honeypot sim + liquidity + ownership + deployer) | $0.01 |
| `true402_token_safety` | Structural safety score 0–100 + flags | $0.005 |
| `true402_address_safety` | Profile + risk for any address before you send/approve/call it (proxy detection) | $0.005 |
| `true402_tx_preflight` | Check an **unsigned** transaction before signing: does it revert, does it grant an unlimited approval, has the counterparty been draining liquidity. Takes no key and no signature | $0.008 |
| `true402_liquidity_history` | What already happened to a token's liquidity — every removal with amount/block/tx, plus the tokens drained in the same transaction | $0.005 |
| `true402_deployer_check` | Deployer reputation — who made the token + their track record | $0.008 |

These are built with AgentKit's `customActionProvider` (function form), so there are **no decorators and no tsconfig changes**. Each action's `invoke` ignores the `walletProvider` — payment is signed inside the bundled x402 payer using `payerPrivateKey` — and returns a JSON string.

`payerPrivateKey` is a Base wallet holding a little USDC. Payments are signed with EIP-3009; the client **refuses to sign** anything that isn't USDC-on-Base or exceeds `maxAmountUsd` (default `0.10`). Safety stalls have a small free daily trial, so a call may return `200` without paying. Override `baseUrl` / `rpcUrl` in the options if self-hosting.

## FAQ

**Which action should the agent call before buying a token?**
`true402_token_report` — the composite avoid/caution/ok verdict. It is the pre-trade gate and is listed first.

**How does it differ from a static scanner?**
true402 runs a real on-chain buy/sell honeypot simulation (state-override `eth_call`), so it proves sellability rather than only reading contract bytecode.

**Do I need an account or API key?**
No. The wallet is the identity. Payment is per-call over x402 (USDC on Base); the facilitator sponsors gas.

**Do I need `experimentalDecorators` in tsconfig?**
No. This package uses the `customActionProvider` function form, not the `@CreateAction` class form, so no decorator settings are required.

**What stops a rogue endpoint from draining the payer?**
The bundled payer only signs a USDC-on-Base charge within `maxAmountUsd` (default `$0.10`) and checks the payer balance first; anything else is refused.

**Checking tokens by hand?** Send any Base token address to [@True402bot](https://t.me/True402bot) on Telegram — same on-chain checks, free, no wallet.

Powered by [true402](https://true402.dev) — the machine-native x402 marketplace on Base. Browse every stall at [/catalog](https://true402.dev/catalog).

## Also available for

MCP (Claude Code / Desktop, Cursor, **Hermes**) · **Hermes Agent** · **OpenClaw** · **ElizaOS** ·
**LangChain** · **CrewAI** · **Vercel AI SDK** · **Coinbase AgentKit** · **Virtuals GAME** · CLI —
same on-chain checks, one install command each:
**[true402.dev/integrations](https://true402.dev/integrations)**

## Paying, exactly

The rules below are the service's, not this package's — they bite whatever client you use, and they
are the ones that surprise people writing their own payer.

- **Pay the EXACT amount quoted in the 402.** Underpaying is rejected. **Overpaying is refused with
  403 and never credited** — settlement submits the signed value and there is no refund path, so a
  surplus would simply be swept. Equality is also what binds an authorization to the resource it was
  quoted for.
- **One authorization buys exactly one response.** A replay is refused, not double-charged.
- **You are charged on success only.** Settlement is submitted only when the endpoint returns 2xx; if
  it errors or times out, your signed authorization is never submitted, so there is nothing to refund.
- Some endpoints serve a few free calls per day per client IP, with no wallet. The per-operation
  description in the [OpenAPI spec](https://true402.dev/api/openapi.json) says which.

Full rules: **[true402.dev/terms](https://true402.dev/terms)** · what is logged and kept:
**[true402.dev/privacy](https://true402.dev/privacy)**
