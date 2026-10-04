/**
 * Uber trip receipts (sender domain `uber.com`; ./selectors.json `platforms.uber`): "Your <day> <time> trip with
 * Uber" → purchase.made with the `Total` line (the fare breakdown and the card line are not the total). Merchant:
 * the canonical "Uber".
 */
import { platformParser } from './parser';

export const uber = platformParser('uber');
