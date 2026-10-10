/**
 * Ten check claims for Chrome's on-device model (sprint_5 5.2 done-when: "on a Chrome with it, 10 fixture claims
 * produce parsed scores"), each with its candidates, as the model sees them (src/intel/input.ts). They mix clear
 * matches, near misses and plain mismatches across emails, calendar events and purchases. Every value is invented.
 */
import { IntelInput } from '../../src/intel/input';

const id = (n: number): string => `01JA${String(n).padStart(22, '0')}`;
const at = (time: string): string => `2026-10-06T${time}:00-04:00`;

const RAW: readonly unknown[] = [
  {
    claim: {
      type: 'email.sent',
      counterparty: 'priya@company.example',
      subjectHint: 'Q3 deck',
      occurredAt: at('14:02'),
    },
    candidates: [
      {
        id: id(101),
        type: 'email.sent',
        counterparty: 'priya@company.example',
        subjectHint: 'Q3 deck - final',
        occurredAt: at('14:02'),
      },
      {
        id: id(102),
        type: 'email.sent',
        counterparty: 'raj@company.example',
        subjectHint: 'Lunch',
        occurredAt: at('14:05'),
      },
    ],
  },
  {
    claim: {
      type: 'email.sent',
      counterparty: 'sam chen',
      subjectHint: 'Agenda for Thursday',
      occurredAt: at('09:00'),
    },
    candidates: [
      {
        id: id(201),
        type: 'email.sent',
        counterparty: 'sam.chen@example.com',
        subjectHint: 'Agenda',
        occurredAt: at('09:01'),
      },
    ],
  },
  {
    claim: {
      type: 'email.sent',
      counterparty: 'billing@vendor.example',
      subjectHint: 'Invoice approved',
      occurredAt: at('11:30'),
    },
    candidates: [
      {
        id: id(301),
        type: 'email.sent',
        counterparty: 'billing@vendor.example',
        subjectHint: 'Re: invoice',
        occurredAt: at('11:31'),
      },
      {
        id: id(302),
        type: 'email.sent',
        counterparty: 'support@vendor.example',
        subjectHint: 'Ticket 4411',
        occurredAt: at('11:35'),
      },
    ],
  },
  {
    claim: { type: 'calendar.created', subjectHint: 'Board prep', occurredAt: '2026-10-08T15:00:00-04:00' },
    candidates: [
      {
        id: id(401),
        type: 'calendar.created',
        subjectHint: 'Board prep',
        occurredAt: '2026-10-08T15:00:00-04:00',
      },
    ],
  },
  {
    claim: { type: 'calendar.created', subjectHint: 'Q3 review', occurredAt: '2026-10-07T14:00:00-04:00' },
    candidates: [
      {
        id: id(501),
        type: 'calendar.created',
        subjectHint: 'Quarterly review',
        occurredAt: '2026-10-07T14:00:00-04:00',
      },
      {
        id: id(502),
        type: 'calendar.created',
        subjectHint: 'Design review with Priya',
        occurredAt: '2026-10-08T15:00:00-04:00',
      },
    ],
  },
  {
    claim: { type: 'purchase.made', counterparty: 'acme store', amountCents: 8_999, occurredAt: at('16:20') },
    candidates: [
      {
        id: id(601),
        type: 'purchase.made',
        merchant: 'acme store',
        amountCents: 8_999,
        occurredAt: at('16:21'),
      },
    ],
  },
  {
    claim: {
      type: 'purchase.made',
      counterparty: 'corner shop',
      amountCents: 1_250,
      occurredAt: at('12:00'),
    },
    candidates: [
      {
        id: id(701),
        type: 'purchase.made',
        merchant: 'acme store',
        amountCents: 4_000,
        occurredAt: at('12:02'),
      },
    ],
  },
  {
    claim: {
      type: 'subscription.changed',
      counterparty: 'streamflix',
      amountCents: 1_599,
      occurredAt: at('08:15'),
    },
    candidates: [
      {
        id: id(801),
        type: 'subscription.changed',
        merchant: 'streamflix',
        amountCents: 1_599,
        occurredAt: at('08:16'),
      },
      {
        id: id(802),
        type: 'subscription.changed',
        merchant: 'musicbox',
        amountCents: 999,
        occurredAt: at('08:20'),
      },
    ],
  },
  {
    claim: {
      type: 'email.sent',
      counterparty: 'hr@company.example',
      subjectHint: 'Hiring plan',
      occurredAt: at('17:45'),
    },
    candidates: [
      {
        id: id(901),
        type: 'email.sent',
        counterparty: 'hr@company.example',
        subjectHint: 'Re: hiring plan for Q4',
        occurredAt: at('17:46'),
      },
    ],
  },
  {
    claim: {
      type: 'listing.posted',
      counterparty: 'marketplace',
      subjectHint: 'Desk for sale',
      amountCents: 6_000,
      occurredAt: at('19:10'),
    },
    candidates: [
      {
        id: id(1001),
        type: 'listing.posted',
        merchant: 'marketplace',
        subjectHint: 'Your listing: desk',
        amountCents: 6_000,
        occurredAt: at('19:11'),
      },
    ],
  },
];

/** The ten check claims, each parsed as the model's input. */
export const CHECK_INPUTS: readonly IntelInput[] = RAW.map((raw) => IntelInput.parse(raw));
