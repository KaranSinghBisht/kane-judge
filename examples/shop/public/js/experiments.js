// Client-side A/B experiments. The growth team manages them in data/experiments.json.
// Running experiments apply on page load and re-apply whenever their target re-renders.
const BUCKET_KEY = "inkwell.ab-bucket";

const ACTIONS = {
  "swap-text": (target, params) => {
    if (typeof params.text === "string" && target.textContent !== params.text) target.textContent = params.text;
  },
  "limit-rows": (target, params) => {
    const max = Number(params.maxRows);
    if (!Number.isInteger(max) || max < 1) return;
    [...target.children].forEach((row, index) => {
      row.hidden = index >= max;
    });
  },
};

function visitorBucket() {
  try {
    let bucket = Number(localStorage.getItem(BUCKET_KEY));
    if (!Number.isInteger(bucket) || bucket < 0 || bucket > 99) {
      bucket = Math.floor(Math.random() * 100);
      localStorage.setItem(BUCKET_KEY, String(bucket));
    }
    return bucket;
  } catch {
    return 0;
  }
}

function isLive(experiment, bucket) {
  const rollout = typeof experiment.rollout === "number" ? experiment.rollout : 100;
  return experiment.status === "running" && Boolean(ACTIONS[experiment.action]) && bucket < rollout;
}

function applyExperiment(experiment) {
  const target = document.querySelector(experiment.selector);
  if (target) ACTIONS[experiment.action](target, experiment.params ?? {});
}

async function main() {
  const res = await fetch("/api/experiments");
  if (!res.ok) return;
  const { experiments = [] } = await res.json();
  const bucket = visitorBucket();
  const live = experiments.filter((experiment) => isLive(experiment, bucket));
  if (live.length === 0) return;
  const applyAll = () => live.forEach(applyExperiment);
  applyAll();
  new MutationObserver(applyAll).observe(document.body, { childList: true, subtree: true });
}

main();
