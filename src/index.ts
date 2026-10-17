import { customActionProvider, type EvmWalletProvider } from '@coinbase/agentkit';
import { z } from 'zod';
import { payStall, type PayOpts } from './x402';

/**
 * true402 actions for Coinbase AgentKit — give your Base agent pay-per-call on-chain safety AND
 * search/SEO data over x402 (USDC on Base, no account, no API key; the wallet is the identity). Add
 * them to any AgentKit agent so it can rug-check a token BEFORE it trades, and pull backlink /
 * keyword data for SEO work.
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
const historySchema = z.object({
  token: z.string().describe('A Base ERC-20 token contract address (0x…)'),
  limit: z.number().int().min(1).max(200).optional().describe('Max removal events to return (1–200, default 50)'),
});
// An UNSIGNED transaction. The wallet provider is NOT used to sign it — see the action description.
const preflightSchema = z.object({
  from: z.string().describe('Sender address (0x…). Asserted, never proven — no signature is taken.'),
  to: z.string().describe('Destination contract or address (0x…)'),
  data: z.string().optional().describe('Calldata hex (0x…). Omit for a plain native transfer.'),
  value: z.string().optional().describe('Native value in wei, decimal string. Default 0.'),
});
const backlinksSchema = z.object({
  target: z.string().describe('A domain, or any URL on it'),
});
const keywordVolumeSchema = z.object({
  keywords: z.array(z.string()).describe('Up to 200 keywords — the call is priced flat, not per keyword (see the action description)'),
  location: z.number().int().optional().describe('Location code (default 2840 = US)'),
  language: z.string().optional().describe('Language code (default "en")'),
});
const rankedKeywordsSchema = z.object({
  target: z.string().describe('A domain to pull ranked organic keywords for'),
  limit: z.number().int().min(1).max(200).optional().describe('Max keywords to return (1–200, default 50)'),
  location: z.number().int().optional().describe('Location code (default 2840 = US)'),
  language: z.string().optional().describe('Language code (default "en")'),
});
const keywordIdeasSchema = z.object({
  seed: z.string().max(80).describe('A seed term (max 80 chars) to generate related/long-tail keyword ideas from'),
  limit: z.number().int().min(1).max(200).optional().describe('Max ideas to return (1–200, default 50)'),
  location: z.number().int().optional().describe('Location code (default 2840 = US)'),
  language: z.string().optional().describe('Language code (default "en")'),
});

/**
 * Build the true402 safety actions, bound to a payer wallet.
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

  // The last check before signing. Note it does NOT take the wallet provider's key: the stall
  // inspects an unsigned transaction, so an AgentKit agent can preflight what it is about to sign
  // without handing the signing material to anyone.
  const txPreflight = customActionProvider<EvmWalletProvider>({
    name: 'true402_tx_preflight',
    description:
      'Check a Base transaction BEFORE signing it. Pass the UNSIGNED transaction (from, to, data, value) ' +
      'and get three lenses: a simulation against current state (does it revert?), the decoded intent ' +
      '(is this an unlimited approval that outlives the trade?), and the counterparty\'s liquidity-removal ' +
      'history. Takes NO private key and NO signature, so it cannot broadcast or front-run the transaction ' +
      'it inspects. Never returns "safe" — a clean result means these checks found nothing, and every ' +
      'response states its limits. Call this LAST, immediately before signing. ~$0.008 USDC over x402.',
    schema: preflightSchema,
    invoke: async (_walletProvider, { from, to, data, value }) =>
      JSON.stringify(
        await payStall(
          '/v1/base/tx-preflight',
          { from, to, ...(data !== undefined ? { data } : {}), ...(value !== undefined ? { value } : {}) },
          opts
        )
      ),
  });

  const liquidityHistory = customActionProvider<EvmWalletProvider>({
    name: 'true402_liquidity_history',
    description:
      "What has ALREADY happened to a Base token's liquidity, from true402's own DEX archive: every " +
      'removal event with the amount, block and transaction hash, plus the other tokens drained in the ' +
      'SAME transaction (one actor, several pools). A live honeypot simulation cannot see this — a pool ' +
      'drained last month simulates fine today if it was re-seeded. Every answer carries the block range ' +
      'the index covers, so "none observed" is not a claim of safety. ~$0.005 USDC over x402.',
    schema: historySchema,
    invoke: async (_walletProvider, { token, limit }) =>
      JSON.stringify(await payStall('/v1/base/liquidity-history', { token, ...(limit !== undefined ? { limit } : {}) }, opts)),
  });

  const backlinks = customActionProvider<EvmWalletProvider>({
    name: 'true402_backlinks',
    description:
      "A domain's backlink profile: referring domains and pages, the dofollow split that actually " +
      'carries authority, authority rank and spam score. The one SEO signal an agent cannot compute ' +
      'from a page fetch — it needs a crawled link graph. ~$0.10 USDC over x402.',
    schema: backlinksSchema,
    invoke: async (_walletProvider, { target }) =>
      JSON.stringify(await payStall('/v1/backlinks', { target }, opts)),
  });

  const keywordVolume = customActionProvider<EvmWalletProvider>({
    name: 'true402_keyword_volume',
    description:
      'Search volume, CPC and competition for up to 200 keywords in ONE call. Priced PER CALL, not ' +
      'per keyword — batch every keyword you need into a single request; looping one keyword per call ' +
      'buys the identical data for up to 200x the money. ~$0.15 USDC over x402.',
    schema: keywordVolumeSchema,
    invoke: async (_walletProvider, { keywords, location, language }) =>
      JSON.stringify(
        await payStall(
          '/v1/keyword-volume',
          { keywords, ...(location !== undefined ? { location } : {}), ...(language !== undefined ? { language } : {}) },
          opts
        )
      ),
  });

  const rankedKeywords = customActionProvider<EvmWalletProvider>({
    name: 'true402_ranked_keywords',
    description:
      'Which keywords a domain already ranks for in organic search, with position and the exact URL ' +
      'that ranks. Works on any domain, so it is competitor research as much as self-audit. ~$0.05 USDC over x402.',
    schema: rankedKeywordsSchema,
    invoke: async (_walletProvider, { target, limit, location, language }) =>
      JSON.stringify(
        await payStall(
          '/v1/ranked-keywords',
          {
            target,
            ...(limit !== undefined ? { limit } : {}),
            ...(location !== undefined ? { location } : {}),
            ...(language !== undefined ? { language } : {}),
          },
          opts
        )
      ),
  });

  const keywordIdeas = customActionProvider<EvmWalletProvider>({
    name: 'true402_keyword_ideas',
    description:
      'Related and long-tail keyword ideas for a seed term, each with search volume and search intent ' +
      '— measured candidates rather than ones a language model invented. ~$0.05 USDC over x402.',
    schema: keywordIdeasSchema,
    invoke: async (_walletProvider, { seed, limit, location, language }) =>
      JSON.stringify(
        await payStall(
          '/v1/keyword-ideas',
          {
            seed,
            ...(limit !== undefined ? { limit } : {}),
            ...(location !== undefined ? { location } : {}),
            ...(language !== undefined ? { language } : {}),
          },
          opts
        )
      ),
  });

  return [
    tokenReport,
    tokenSafety,
    addressSafety,
    deployerCheck,
    liquidityHistory,
    txPreflight,
    backlinks,
    keywordVolume,
    rankedKeywords,
    keywordIdeas,
  ];
}
