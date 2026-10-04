/**
 * Instacart order receipts (sender domain `instacart.com`; ./selectors.json `platforms.instacart`): a subject
 * that says "receipt" (not a refund) → purchase.made with the `Order total` (else `Total`) line, which includes
 * fees, tip and tax. Merchant: the canonical "Instacart". Delivery updates are not receipts.
 */
import { platformParser } from './parser';

export const instacart = platformParser('instacart');
