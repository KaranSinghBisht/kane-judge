# Keep the gate

A pre-flight leaves one Kane flow per claim in `projects/<slug>/flows/`. Those are regression tests for the promises in your README. `kane-judge run --gate` replays them and sets the exit code:

- exit 0: every flow passed, each with at least one passed assert step, and Kane's verdict engine judged the sealed evidence pack a pass;
- exit 1: anything else, including a run Kane's verdict engine did not judge.

A replay takes about half a minute and a few Kane credits. Kane re-authors a flow only when you change its text.

## Before every push

[`pre-push`](pre-push) is a git hook. With your app running:

```bash
cp examples/gate/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push
export KANE_JUDGE_PROJECT=projects/my-app
git push        # runs the gate first; a failing claim stops the push
```

The hook is a thin wrapper around `kane-judge run --gate`, which we ran by hand on the sample shop: it exits 0 on the fixed build and 1 against the deployed one, which still has the bug. The hook itself has not been run from a real `git push` yet.

## On every deployment

[`kane-gate.yml`](kane-gate.yml) is a GitHub Actions workflow that replays the flows against a preview URL with `--start-url`. Kane CLI signs in with an access key there (`kane-cli login --username … --access-key …`). We have run the same command by hand against a deployed build; the workflow file itself has not run in CI yet, so treat it as a starting point.
