/**
 * OpenTable charges (sender domain `opentable.com`; ./selectors.json `platforms.opentable`): "Your prepaid
 * reservation at <restaurant> is confirmed" and "Your receipt from <restaurant>" → purchase.made with the
 * `Total charged` line. The merchant is the restaurant the subject names. A plain (unpaid) reservation is not a
 * receipt. occurredAt is when the message was sent, never the reservation time in the body.
 */
import { platformParser } from './parser';

export const opentable = platformParser('opentable');
