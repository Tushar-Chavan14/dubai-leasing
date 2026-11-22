/** The session token issuer for tests that call the app from outside the engine package (the web app's tests). */
export { issueToken } from "@platform/kernel";
/** The web app's tests build a fixed clock and calendar dates from here, so they import nothing outside the module by path. */
export { FixedClock } from "@platform/kernel/clock";
export { addDays } from "@platform/kernel/dates";
