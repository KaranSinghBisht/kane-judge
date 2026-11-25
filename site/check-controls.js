// Read only the selected claim from each published, scrubbed Kane pack.
import { unzipSync, strFromU8 } from "fflate";
import { parse } from "yaml";

async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function checkPack(control) {
  const response = await fetch(control.file);
  if (!response.ok) throw new Error(`Could not download the ${control.label} pack (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256(bytes) !== control.sha256) throw new Error(`The ${control.label} pack differs from the recorded share copy.`);

  const files = unzipSync(bytes, { filter: entry => /^tests\/04-apply-promo-[0-9a-f]{8}\/(?:test\.md|result\.yaml)$/.test(entry.name) });
  const names = Object.keys(files);
  const source = names.find(name => name.endsWith("/test.md"));
  const resultFile = source?.replace(/test\.md$/, "result.yaml");
  if (names.length !== 2 || !resultFile || !files[resultFile]) throw new Error("The pack does not contain one complete promo test.");
  const result = parse(strFromU8(files[resultFile]));
  const testHash = await sha256(files[source]);
  if (result.definition?.sha256 !== `sha256:${testHash}` || result.status !== control.status) {
    throw new Error(`The ${control.label} test definition or outcome disagrees with the recorded control.`);
  }
  const asserts = result.steps.filter(step => step.kind === "assert" && step.status === "passed").length;
  if (result.status === "passed" && !asserts) throw new Error("The repaired flow has no passing assertion.");
  return { status: result.status, testHash, asserts };
}

const button = document.querySelector("#check-packs");
const output = document.querySelector("#pack-result");
button.addEventListener("click", async () => {
  button.disabled = true;
  output.textContent = "Downloading and checking both evidence packs…";
  try {
    const controls = JSON.parse(document.querySelector("#controls").textContent);
    const [broken, fixed] = await Promise.all(controls.map(checkPack));
    if (broken.testHash !== fixed.testHash) throw new Error("The two packs contain different checkout tests.");
    output.textContent = `Verified both packs. Deployed shop: ${broken.status}. Repaired shop: ${fixed.status} with ${fixed.asserts} passing assertions. Identical test SHA-256: ${fixed.testHash}.`;
  } catch (error) {
    output.textContent = `Verification failed. ${error.message}`;
  } finally {
    button.disabled = false;
  }
});
