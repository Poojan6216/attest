# Security policy

**Who this is for:** anyone who found a security or privacy problem in Attest, the extension or its telemetry server.
**What you'll know after:** how to report it privately, and what happens next.

## Reporting a problem

Please do not open a public issue for a vulnerability. Write to poojanpatel119@gmail.com with what you found, the version (Attest's options page shows it, and the release page names each one), and the steps that show it. Never include anyone's real email, calendar or receipt data: a description of its kind and length is enough.

Every report is read and answered. A fix ships as a new version, and the changelog and the release page say what it fixed once it is out.

## What is in scope

- The extension: what it reads, stores and sends, and anything that would let a page or another extension read Attest's data (the privacy policy, [`PRIVACY.md`](PRIVACY.md), and [`docs/threat-model.md`](docs/threat-model.md) say what it promises).
- The telemetry server in `telemetry-api/` and its one public page, `/v1/stats`.

Ways to fool Attest's grading that need no vulnerability, such as an agent that hides what it did, are listed in [`docs/attacks-that-work.md`](docs/attacks-that-work.md); a new one is welcome as an issue.
