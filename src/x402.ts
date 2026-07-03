// x402.ts — pay any true402 stall and return its JSON. The whole protocol: 402 → sign EIP-3009 → 200.
// No accounts, no API keys; the wallet is the identity. USDC on Base, gas sponsored by the facilitator.
import { randomBytes } from 'node:crypto';
import { createPublicClient, http, getAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const USDC_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export interface PayOpts {
  /** A Base wallet private key holding a little USDC (the payer). */
  payerPrivateKey: string;
  /** true402 API base. Default https://true402.dev/api */
  baseUrl?: string;
  /** Base RPC. Default https://mainnet.base.org */
  rpcUrl?: string;
  /**
   * Hard ceiling, in USDC, on a single signed payment (default 0.10). The client REFUSES to sign a 402
   * that demands more — so a rogue/compromised endpoint (or a MITM past TLS) can't drain the payer. The
   * true402 stalls cost ~$0.003–0.015, so the default leaves headroom while blocking abuse.
   */
  maxAmountUsd?: number;
}

const BASE_USDC = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const BASE_NETWORK = 'eip155:8453';

interface Accept {
  scheme: string; network: string; asset: string; payTo: string;
  amount?: string; maxAmountRequired?: string; maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

/** POST a payload to a true402 stall path (e.g. '/v1/base/token-report'), paying over x402. */
export async function payStall<T = unknown>(path: string, payload: Record<string, unknown>, opts: PayOpts): Promise<T> {
  const baseUrl = opts.baseUrl ?? 'https://true402.dev/api';
  const rpcUrl = opts.rpcUrl ?? 'https://mainnet.base.org';
  const key = (opts.payerPrivateKey.startsWith('0x') ? opts.payerPrivateKey : `0x${opts.payerPrivateKey}`) as Hex;
  const account = privateKeyToAccount(key);
  const url = `${baseUrl}${path}`;
  const body = JSON.stringify(payload);

  const first = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  if (first.status === 200) return (await first.json()) as T;
  if (first.status !== 402) throw new Error(`expected HTTP 402 from ${path}, got ${first.status}`);

  const challenge = (await first.json()) as { accepts?: Accept[] };
  const req = (challenge.accepts ?? []).find((a) => a.scheme === 'exact');
  if (!req) throw new Error('no x402 "exact" payment requirement in the 402');

  // Only sign a USDC-on-Base charge within the caller's cap — a rogue/compromised endpoint (or MITM
  // past TLS) can't make the agent authorize an unexpected asset/network or an excessive amount.
  if (req.network && req.network !== BASE_NETWORK) throw new Error(`unexpected payment network "${req.network}" (expected ${BASE_NETWORK}) — refusing to sign`);
  const usdc = getAddress(req.asset);
  if (usdc !== BASE_USDC) throw new Error(`unexpected payment asset ${usdc} (expected Base USDC) — refusing to sign`);
  const value = BigInt(req.amount ?? req.maxAmountRequired ?? '0');
  const capAtomic = BigInt(Math.round((opts.maxAmountUsd ?? 0.1) * 1e6));
  if (value > capAtomic) throw new Error(`402 demands ${value} USDC base units, over the $${opts.maxAmountUsd ?? 0.1} cap (maxAmountUsd) — refusing to sign`);
  const pub = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const held = (await pub.readContract({ address: usdc, abi: USDC_ABI, functionName: 'balanceOf', args: [account.address] })) as bigint;
  if (held < value) throw new Error(`payer ${account.address} holds ${held} < ${value} USDC base units — fund it`);

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address, to: getAddress(req.payTo), value,
    validAfter: BigInt(now - 60), validBefore: BigInt(now + (req.maxTimeoutSeconds ?? 120)),
    nonce: `0x${randomBytes(32).toString('hex')}` as Hex,
  };
  const signature = await account.signTypedData({
    domain: { name: req.extra?.name ?? 'USD Coin', version: req.extra?.version ?? '2', chainId: base.id, verifyingContract: usdc },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  });
  const xPayment = Buffer.from(JSON.stringify({
    x402Version: 2, scheme: 'exact', network: req.network,
    payload: {
      signature,
      authorization: {
        from: authorization.from, to: authorization.to, value: value.toString(),
        validAfter: authorization.validAfter.toString(), validBefore: authorization.validBefore.toString(), nonce: authorization.nonce,
      },
    },
  })).toString('base64');

  const paid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-PAYMENT': xPayment }, body });
  if (paid.status !== 200) throw new Error(`paid request to ${path} failed (HTTP ${paid.status})`);
  return (await paid.json()) as T;
}
