import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { demoCommand } from "../src/cli/commands/demo.js";
import { configureLogger } from "../src/shared/logger.js";

const EXAMPLE = join(import.meta.dirname, "..", "examples", "judged", "inkwell-shop");

beforeAll(() => {
  configureLogger({ stderr: false });
});

describe("kane-judge demo", () => {
  it("replays the committed run and sees every cheat refused, with no Kane account", async () => {
    // Exit 0 means: the committed example passes its own checks, its evidence pack matches the results,
    // and none of the doctored verdicts got through.
    expect(await demoCommand({ open: false, example: EXAMPLE, kane: false })).toBe(0);
  });

  it("says so when there is nothing to replay", async () => {
    expect(await demoCommand({ open: false, example: join(EXAMPLE, "no-such-folder"), kane: false })).toBe(2);
  });
});
