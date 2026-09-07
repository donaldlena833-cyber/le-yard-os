import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  advanceServiceRun,
  buildServiceScorecard,
  createServiceRun,
  exportServiceRunReport,
  fullServiceDayScenario,
  injectServiceEvent,
  pauseServiceRun,
  resetServiceRun,
  runServiceScenario,
  type ServiceRun,
} from "../src/lib/simulation/index.ts";

const outputDirectory = resolve(process.cwd(), "output", "service-simulation");

function assertIsolatedNonProduction(): void {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Simulation controls are disabled in production.");
  }
  if (process.env.SERVICE_SIMULATION_SCOPE !== "isolated-nonproduction") {
    throw new Error(
      "Set SERVICE_SIMULATION_SCOPE=isolated-nonproduction to use simulation controls.",
    );
  }
}

function validateRunId(runId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/.test(runId)) {
    throw new Error(
      "Run ID must be 3-64 characters and contain only letters, numbers, dashes, or underscores.",
    );
  }
  return runId;
}

function runPath(runId: string): string {
  return resolve(outputDirectory, `${validateRunId(runId)}.run.json`);
}

function reportPath(runId: string): string {
  return resolve(outputDirectory, `${validateRunId(runId)}.report.json`);
}

function ensureOutputDirectory(): void {
  mkdirSync(outputDirectory, { recursive: true });
}

function writeRun(run: ServiceRun): void {
  ensureOutputDirectory();
  writeFileSync(runPath(run.runId), `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

function readRun(runId: string): ServiceRun {
  const path = runPath(runId);
  if (!existsSync(path)) {
    throw new Error(`Synthetic run does not exist: ${runId}`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ServiceRun;
  if (!parsed.synthetic || parsed.runId !== runId) {
    throw new Error("The stored run is not the requested synthetic run.");
  }
  return parsed;
}

function normalizeClock(value: string): string {
  if (/^\d{2}:\d{2}$/.test(value)) {
    const nextDay = value === "24:00";
    const day = nextDay ? "2026-04-19" : fullServiceDayScenario.businessDate;
    const time = nextDay ? "00:00" : value;
    return `${day}T${time}:00-04:00`;
  }
  return value;
}

function printResult(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function seed(runId: string): ServiceRun {
  const run = createServiceRun(runId);
  writeRun(run);
  return run;
}

function run(runId: string): ServiceRun {
  const result = runServiceScenario(runId);
  writeRun(result);
  return result;
}

function exportReport(runId: string): ReturnType<typeof exportServiceRunReport> {
  const report = exportServiceRunReport(readRun(runId));
  ensureOutputDirectory();
  writeFileSync(reportPath(runId), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function replayMany(count: number): { count: number; passed: number; runIds: string[] } {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error("Replay count must be an integer from 1 through 100.");
  }
  const runIds: string[] = [];
  let passed = 0;
  for (let index = 1; index <= count; index += 1) {
    const runId = `clean-run-${String(index).padStart(2, "0")}`;
    const replay = run(runId);
    const scorecard = buildServiceScorecard(replay);
    runIds.push(runId);
    if (scorecard.localStatus === "passed") passed += 1;
  }
  return { count, passed, runIds };
}

assertIsolatedNonProduction();

const [, , command = "help", rawRunId = "clean-run-01", argument] = process.argv;
const runId =
  command === "replay" ? "clean-run-01" : validateRunId(rawRunId);

switch (command) {
  case "seed": {
    printResult(seed(runId));
    break;
  }
  case "run": {
    const result = run(runId);
    printResult({ run: result, scorecard: buildServiceScorecard(result) });
    break;
  }
  case "pause": {
    const result = pauseServiceRun(readRun(runId));
    writeRun(result);
    printResult(result);
    break;
  }
  case "advance": {
    if (!argument) throw new Error("Advance requires HH:MM or an ISO timestamp.");
    const result = advanceServiceRun(readRun(runId), normalizeClock(argument));
    writeRun(result);
    printResult(result);
    break;
  }
  case "inject": {
    if (!argument) throw new Error("Inject requires the next deterministic event ID.");
    const result = injectServiceEvent(readRun(runId), argument);
    writeRun(result);
    printResult(result);
    break;
  }
  case "reset": {
    const path = runPath(runId);
    const existing = readRun(runId);
    const result = resetServiceRun(existing, runId);
    if (existsSync(reportPath(runId))) unlinkSync(reportPath(runId));
    writeRun(result);
    printResult({ resetPath: path, run: result });
    break;
  }
  case "report": {
    printResult(exportReport(runId));
    break;
  }
  case "replay": {
    const count = Number(rawRunId);
    printResult(replayMany(count));
    break;
  }
  default: {
    printResult({
      scenarioId: fullServiceDayScenario.id,
      commands: [
        "seed [run-id]",
        "run [run-id]",
        "pause [run-id]",
        "advance [run-id] HH:MM",
        "inject [run-id] [next-event-id]",
        "reset [exact-run-id]",
        "report [run-id]",
        "replay [count]",
      ],
      boundary:
        "Synthetic output only. Connected and physical rehearsal gates remain blocked until separately evidenced.",
    });
  }
}
