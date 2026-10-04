/**
 * Amazon.com order confirmations (sender domain `amazon.com`; ./selectors.json `platforms.amazon`). Subject
 * "Your Amazon.com order #…" or "Ordered: …", and not a shipping, delivery, cancellation or refund notice. The
 * amount is the `Order Total` (else `Grand Total`) line, never the item price, the subtotal or the tax. Merchant:
 * the canonical "Amazon". Other Amazon storefronts (amazon.ca, amazon.co.uk) are not in the registry: their
 * receipts are not parsed rather than read with the wrong currency (Hard Rule 5).
 */
import { platformParser } from './parser';

export const amazon = platformParser('amazon');
