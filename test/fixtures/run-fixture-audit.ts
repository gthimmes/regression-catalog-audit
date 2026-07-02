/**
 * `npm run audit:fixture` — runs the full audit pipeline against bundled
 * fixtures (no git, no network) and prints the Markdown report, exiting 1 when
 * the fixture audit "fails" (as it is designed to). Handy for eyeballing report
 * output during development.
 */
import { buildFixture } from "./pipeline.js";

const { markdown, failed } = buildFixture();
process.stdout.write(markdown);
process.exitCode = failed ? 1 : 0;
