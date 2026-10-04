/**
 * Stripe-hosted receipts (sender domain `stripe.com`, e.g. `receipts+acct_…@stripe.com`; ./selectors.json
 * `platforms.stripe`). Stripe sends on behalf of the business that charged, so the merchant is the sender's
 * display name (the business), never "Stripe". Kinds: "Your receipt from <business> #…" → purchase.made with the
 * `Amount paid` (else `Amount charged`, `Total`) line; "Your <plan> subscription has been updated" →
 * subscription.changed with its amount; a cancelled subscription → subscription.changed, with an amount only when
 * the message shows one.
 */
import { platformParser } from './parser';

export const stripe = platformParser('stripe');
