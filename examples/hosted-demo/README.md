# A real Kane run on Kane Judge

On November 25 a visitor flow opened [the production demo](https://kane-judge.vercel.app/), pressed **Verify both evidence packs** and waited for the result. Kane’s [final screenshot](verified.jpg) shows the deployed shop failed, the repaired shop passed three assertions, and both checkout tests had the same SHA-256.

The [visitor flow](flows/01-verify-checkout-evidence_test.md) passed once on authoring and again in a gate with healing off. The gate completed at `2026-11-25T03:08:40.897Z`. Its own browser assertion passed and Kane’s claims policy passed all 6 checks. The three checkout assertions on screen belong to the earlier repaired-shop run.

From the repository root, re-evaluate the [scrubbed evidence pack](verifier.evidence) locally with Kane CLI:

```sh
kane-cli evidence validate examples/hosted-demo/verifier.evidence
kane-cli evidence verdict examples/hosted-demo/verifier.evidence --policy policies/claims.yaml
```

SHA-256 of the shared pack: `ed4d281025efa487f49152cd62376703d014b3bf791de6e04c06bb7a32e79e8d`.

To repeat the live check with a signed-in Kane account, copy the flow to a scratch directory and author it once before running the gate:

```sh
work=$(mktemp -d)
cp -R examples/hosted-demo/flows "$work/"
node dist/kane-judge.mjs run "$work" --parallel 1
node dist/kane-judge.mjs run "$work" --gate
```
