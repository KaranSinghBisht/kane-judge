// Growth team's experiment runner. Experiments are configured on the server
// (/api/experiments) and applied to everyone in their rollout. Variants are
// re-applied after client-side re-renders so they survive UI updates.

const ACTIONS = {
  "swap-text": (el, { text }) => {
    if (el.textContent === text) return "";
    el.textContent = text;
    return `set text to "${text}"`;
  },
  "limit-rows": (el, { maxRows }) => {
    const rows = [...el.children];
    let hidden = 0;
    rows.forEach((row, index) => {
      row.hidden = index >= maxRows;
      if (row.hidden) hidden += 1;
    });
    return hidden ? `limit-rows hid ${hidden} of ${rows.length} rows` : "";
  },
};

function bucket() {
  let value = Number(localStorage.getItem("inkwell.bucket"));
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    value = Math.floor(Math.random() * 100);
    localStorage.setItem("inkwell.bucket", String(value));
  }
  return value;
}

function apply(experiment) {
  const el = document.querySelector(experiment.selector);
  const action = ACTIONS[experiment.action];
  if (!el || !action) return;
  const run = () => {
    const note = action(el, experiment.params ?? {});
    if (note) console.warn(`[experiments] ${experiment.id}: ${note} in ${experiment.selector}`);
  };
  run();
  new MutationObserver(run).observe(el, { childList: true });
}

async function start() {
  const res = await fetch("/api/experiments");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { experiments = [] } = await res.json();
  experiments
    .filter((e) => e.status === "running" && bucket() < (e.rollout ?? 100))
    .forEach(apply);
}

start().catch((err) => console.warn(`[experiments] disabled: ${err.message}`));
