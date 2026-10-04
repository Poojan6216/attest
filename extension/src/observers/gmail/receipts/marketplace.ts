/**
 * Facebook Marketplace "Your listing is live: <item>" (sender domain `facebookmail.com`; ./selectors.json
 * `platforms.marketplace`) → listing.posted. The amount is the listing price: the row labelled with the item the
 * subject names, so a boost upsell ("boost this listing for $5.00") is never the price. Merchant: the canonical
 * "Facebook Marketplace". Every other facebookmail.com message (comments, friend requests, messages) is not a
 * receipt.
 */
import { platformParser } from './parser';

export const marketplace = platformParser('marketplace');
