import { customActionProvider, type EvmWalletProvider } from '@coinbase/agentkit';
import { z } from 'zod';
import { payStall, type PayOpts } from './x402';

/**
 * true402 actions for Coinbase AgentKit — give your Base agent pay-per-call on-chain safety over
 * x402 (USDC on Base, no account, no API key; the wallet is the identity). Add them to any AgentKit
 * agent so it can rug-check a token BEFORE it trades.
 *
 *   import { AgentKit } from '@coinbase/agentkit';
 *   import { createTrue402ActionProviders } from '@true402.dev/agentkit';
 *
 *   const agentKit = await AgentKit.from({
 *     walletProvider,
 *     actionProviders: createTrue402ActionProviders({ payerPrivateKey: process.env.PAYER_PRIVATE_KEY! }),
 *   });
 *
 * These are pure HTTP wrappers over the true402 stalls, so we use `customActionProvider` (the function
 * form) — no class, no decorators, no tsconfig changes. `invoke` ignores the walletProvider (payment is
 * signed inside `payStall` with the payer key) and MUST return a string, so we JSON.stringify the result.
 */
export { payStall, type PayOpts } from './x402';

const tokenSchema = z.object({
  token: z.string().describe('A Base ERC-20 token contract address (0x…)'),
});
const addressSchema = z.object({
  address: z.string().describe('Any Base address (0x…) — an EOA or a contract'),
});

/**
 * Build the four true402 safety actions, bound to a payer wallet.
 * @param opts PayOpts — at minimum { payerPrivateKey }. Override baseUrl / rpcUrl / maxAmountUsd if needed.
 */
export function createTrue402ActionProviders(opts: PayOpts) {
  // token-report is the PRIMARY action — the pre-trade gate. List it first.
  const tokenReport = customActionProvider<EvmWalletProvider>({
    name: 'true402_token_report',
    description:
      'Pre-trade rug/honeypot gate for a Base ERC-20: a composite avoid/caution/ok verdict from an ' +
      'on-chain buy/sell honeypot simulation (proves sellability, not just a static scan), liquidity ' +
      'depth, ownership/mint inspection, and deployer reputation. Call BEFORE buying a token. ~$0.01 USDC over x402.',
    schema: tokenSchema,
    invoke: async (_walletProvider, { token }) =>
      JSON.stringify(await payStall('/v1/base/token-report', { token }, opts)),
  });

  const tokenSafety = customActionProvider<EvmWalletProvider>({
    name: 'true402_token_safety',
    description:
      'Structural safety score (0–100) + flags for a Base ERC-20: honeypot simulation, liquidity, ' +
      'mint/ownership/blacklist. Lighter than token_report. ~$0.005 USDC over x402.',
    schema: tokenSchema,
    invoke: async (_walletProvider, { token }) =>
      JSON.stringify(await payStall('/v1/token-safety', { token }, opts)),
  });

  const addressSafety = customActionProvider<EvmWalletProvider>({
    name: 'true402_address_safety',
    description:
      'Profile + risk for any Base address before you send to / approve / call it: EOA-vs-contract, ' +
      'ETH+USDC balance, activity, ownership, and upgradeable-proxy (EIP-1967) detection. ~$0.005 USDC over x402.',
    schema: addressSchema,
    invoke: async (_walletProvider, { address }) =>
      JSON.stringify(await payStall('/v1/base/address-safety', { address }, opts)),
  });

  const deployerCheck = customActionProvider<EvmWalletProvider>({
    name: 'true402_deployer_check',
    description:
      "Deployer reputation for a Base token: resolves who created it and that wallet's track record " +
      '(age, contracts shipped, fresh-throwaway flag) to catch serial ruggers a structural check misses. ~$0.008 USDC over x402.',
    schema: tokenSchema,
    invoke: async (_walletProvider, { token }) =>
      JSON.stringify(await payStall('/v1/base/deployer-check', { token }, opts)),
  });

  return [tokenReport, tokenSafety, addressSafety, deployerCheck];
}
