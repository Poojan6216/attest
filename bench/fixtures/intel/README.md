# Recorded model answers for the intel bench

`pnpm bench` measures the advisory model ([`bench/intel.ts`](../../intel.ts), Sprint 5.5) on the labelled matching corpus ([`extension/tests/fixtures/intel/corpus.json`](../../../extension/tests/fixtures/intel/corpus.json)): how many claims VERIFIED gets right and wrong, by the rules alone and with each model. A model is measured only from a recording of its real answers in this folder. A model with no recording is reported as not measured, never as a number (Hard Rule 12).

| File | Model | How it is recorded |
|---|---|---|
| `builtin.json` | Chrome's on-device model | On a Chrome that has it: open the development page `model-check.html` (in `pnpm build`, never in the store build), click **Record the bench's answers**, then **Save the recording**, and move `attest-intel-builtin.json` from Downloads here as `builtin.json`. |
| `byo-anthropic.json` | Anthropic, with a person's own key | From `extension/`: `pnpm exec tsx ../bench/intel-record.ts --vendor anthropic --key-file <file holding the key>`. |
| `byo-openai.json` | OpenAI, with a person's own key | The same with `--vendor openai`. |

Each recording answers the inputs in [`extension/entrypoints/model-check/bench-inputs.json`](../../../extension/entrypoints/model-check/bench-inputs.json): one per distinct claim and candidate the corpus would have the service worker send, generated from the corpus by [`extension/tests/tools/intel-inputs.ts`](../../../extension/tests/tools/intel-inputs.ts). A recording holds, for each input's hash, the model's scores in basis points, or `null` where it gave none within the extension's 2 seconds. It never holds a key, a hint or an input. Every input is invented, so a recording holds nothing of anyone's. A recording of older inputs still reads: an input it lacks counts as unanswered, and the bench says how many were answered.
