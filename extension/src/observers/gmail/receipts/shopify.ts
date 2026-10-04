/**
 * Shopify store order confirmations (sender domain `shopifyemail.com`, e.g. `store+…@t.shopifyemail.com`;
 * ./selectors.json `platforms.shopify`): "Order #1047 confirmed", "Order confirmation …", "Thank you for your
 * order" → purchase.made with the `Total` line ("$52.45 USD"). The merchant is the store: the sender's display
 * name. Shipping and refund notices are not receipts.
 */
import { platformParser } from './parser';

export const shopify = platformParser('shopify');
