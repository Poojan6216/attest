import { BYO_VENDORS } from '../../../src/config';

/**
 * What the person's own key sends, to whom, and what stays here (agents/intel_engineer.md rule 6), exactly: the one
 * match the claim took, with Attest's id for it and a purchase's merchant (Sprint 5 close, security review SEC-8).
 */
export function ByoStatement() {
  return (
    <>
      <p class="text-sm">
        Off unless you turn it on with a key you saved. While it is on, for each claim still being checked
        with a partial match it sends, with your key, to Anthropic ({BYO_VENDORS.anthropic.host}) or OpenAI (
        {BYO_VENDORS.openai.host}), whichever your key is for: what kind of action the claim was, who it was
        to (an email address or a name), its short subject, its amount and its time, and the same for the one
        sent email or event it partly matched, with Attest’s id for it and, for a purchase, the merchant.
        Nothing else: never a page, never what you asked an agent.
      </p>
      <p class="text-sm">
        Your key stays in this browser, where only Attest can read it, and goes only to that company. They
        keep what they receive under their own terms, and each check is billed to your key. If Chrome’s
        on-device model is on and ready, Attest uses it instead and sends nothing. Like it, your key’s model
        never decides a grade.
      </p>
    </>
  );
}
