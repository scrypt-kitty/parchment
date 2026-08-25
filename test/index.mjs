/** Entry point: registers every suite, then runs them together so coverage and
 *  the pass/fail total cover the whole test set in one process. */
import "./render.test.mjs";
import "./update.test.mjs";

import { run } from "./runner.mjs";

run();
