# SaveMoney: Path to Real Funds (not yet live)

## Current state (November 2026)
- Sepolia-only demonstration: users deploy a vault, deposit mock mUSDC, and block early withdrawals on-chain.
- Stripe card checkout and Dwolla transfers run independently in sandbox; they **do not** turn payments into USDC.
- Base mainnet read-only wallet balance view uses Circle's native USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (chain ID 8453).
- **No audited mainnet hard-lock contract has been deployed. Do not deposit real money or real USDC to any SaveMoney vault.**
- The app should never claim sandbox balances are insured deposits or represent cash in custody.

## Recommended personal-use architecture
1. The user owns their MetaMask wallet and retains the recovery phrase offline. SaveMoney never receives the phrase or private keys.
2. A regulated onramp (e.g. Coinbase Onramp) handles any real card/ACH fiat purchase of USDC and necessary identity checks. Onramp purchase must first settle to the user's Base wallet; a Stripe Checkout payment does not do this.
3. The user explicitly approves a transfer of verified, native Base USDC into a separately deployed immutable timelock contract with fixed beneficiary and unlock date. The app must verify chain ID 8453, USDC token address, beneficiary, unlock timestamp and known contract code hash on-chain.
4. Only transactions confirmed on Base may count towards the on-chain locked balance. Never credit a smart-contract vault based solely on a pending ACH payment, successful card charge, webhook, server ledger value, or onramp quote.
5. On unlock, only the fixed beneficiary can withdraw to their own wallet, where they can exchange/offramp. The application cannot guarantee a fiat redemption or fixed dollar value.

## Blockers to enabling live funds
- Independently audit **the exact deployment bytecode and factory** or replace the custom contract with a carefully validated, externally audited, immutable timelock implementation that satisfies the user's no-early-release requirement. This repo's browser-compiled Sepolia contract is **not a reviewed production implementation**.
- Contract registration is currently stored in editable Supabase **user_metadata** and can be altered by authenticated users. Migrate it to an immutable, server-validated/on-chain-verified record before any live balance is trusted.
- Add unit/integration, adversarial, and fork tests: unlock boundary, unauthorized beneficiary, malicious token, repeated deposits, double withdrawals, time zone transitions, wrong network/token, wallet change, and failure/retry behavior.
- Review and fix Supabase production security: `apply_stripe_deposit` authenticated RPC trusts user input, direct RLS grants, owner-only account enforcement, service credentials, idempotent transfer reconciliation and webhooks. Never use the existing test ledger to represent real money.
- Set up and validate a provider's authorized onramp production integration. Coinbase Onramp requires its own developer configuration and session/token workflow; don't guess or hard-code checkout URLs. Verify availability, limits and costs for the specific account.
- The user will need Base network fees to deposit/withdraw; account for stablecoin depeg, token freezing, wallet compromise/loss, no FDIC insurance, and irreversibility.
- Auto-pay is disabled for blockchain vaults because fiat payment does not imply crypto delivery; do not silently enable this before an approved recurring onramp process exists.

## November 2026 progress: Base Sepolia test-only candidate
- Added `contracts/BaseSepoliaLockedSavings.sol` with immutable beneficiary and unlock time, repeated deposits, beneficiary-only withdrawals after unlock, no admin bypass, and a hardcoded Base Sepolia chain-ID check to reject Base Mainnet deployments.
- Uses Circle's Base Sepolia test USDC address. It is **not deployed**, **not audited**, and **not connected to the app's real wallet interface**.
- Added 11 Foundry tests in `test/BaseSepoliaLockedSavings.t.sol`, `foundry.toml`, and a GitHub Actions workflow `.github/workflows/base-sepolia-vault.yml` that installs pinned OpenZeppelin and forge-std versions.
- Test execution results have **not been confirmed**; the CI job must pass before this candidate advances.
- No production mainnet deployment or real-money transfer features were enabled.

## Next developer milestone
Verify the Foundry tests and perform additional security review, then wire **Base Sepolia test-only** deposit/withdrawal flows in the app. Mainnet release remains blocked until independent review and verified onramp controls are complete.

Sources:
- Circle native USDC on Base: https://www.circle.com/multi-chain-usdc/base
- Circle supported addresses: https://help.circle.com/support/en/usdc-supported-blockchains-minting-redemption-faqs
- Coinbase Onramp: https://www.coinbase.com/developer-platform/products/onramp
