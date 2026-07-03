import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const runtimeDir = path.join(rootDir, "runlogs");
const pidFile = path.join(runtimeDir, "bot-sklad.pid");
const outLog = path.join(runtimeDir, "server.out.log");
const errLog = path.join(runtimeDir, "server.err.log");
const runnerJs = path.join(rootDir, "scripts", "server-runner.js");
const runnerPs1 = path.join(rootDir, "scripts", "server-runner.ps1");

const command = process.argv[2] || "status";

await fsPromises.mkdir(runtimeDir, { recursive: true });

switch (command) {
  case "start":
    await startService();
    break;
  case "stop":
    await stopService();
    break;
  case "restart":
    await restartService();
    break;
  case "status":
    await printStatus();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}

async function startService() {
  const running = getRunningProcessIds();
  if (running.length) {
    console.log(`Bot Sklad is already running (PID ${running.join(", ")}).`);
    return;
  }

  const stdout = fs.openSync(outLog, "a");
  const stderr = fs.openSync(errLog, "a");

  if (process.platform === "win32") {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        runnerPs1,
        process.execPath
      ],
      {
        cwd: rootDir,
        detached: true,
        stdio: ["ignore", stdout, stderr],
        windowsHide: true
      }
    );
    child.unref();
  } else {
    const child = spawn(process.execPath, [runnerJs], {
      cwd: rootDir,
      detached: true,
      stdio: ["ignore", stdout, stderr]
    });
    child.unref();
    await fsPromises.writeFile(pidFile, String(child.pid), "utf8");
  }

  const started = await waitForRunning(15000);
  if (!started.length) {
    throw new Error(`Bot Sklad did not stay running. Check logs: ${errLog}`);
  }

  console.log(`Bot Sklad started in background (PID ${started.join(", ")}).`);
  console.log(`Logs: ${outLog}`);
}

async function stopService() {
  const running = getRunningProcessIds();
  if (!running.length) {
    await removePidFile();
    console.log("Bot Sklad is not running.");
    return;
  }

  if (process.platform === "win32") {
    for (const pid of running) {
      execFileSync("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" });
    }
  } else {
    for (const pid of running) {
      try {
        process.kill(pid);
      } catch (error) {
        if (!isMissingProcessError(error)) {
          throw error;
        }
      }
    }
  }

  const stopped = await waitForStopped(10000);
  if (!stopped) {
    throw new Error("Failed to stop Bot Sklad within timeout.");
  }

  await removePidFile();
  console.log("Bot Sklad stopped.");
}

async function restartService() {
  await stopService();
  await startService();
}

async function printStatus() {
  const running = getRunningProcessIds();
  if (!running.length) {
    await removePidFile();
    console.log("Bot Sklad status: stopped");
    return;
  }

  console.log(`Bot Sklad status: running (PID ${running.join(", ")})`);
  console.log(`Logs: ${outLog}`);
}

function getRunningProcessIds() {
  return process.platform === "win32"
    ? getWindowsRunnerPids()
    : getPosixPidFromFile();
}

function getWindowsRunnerPids() {
  try {
    const script = `
      Get-CimInstance Win32_Process |
      Where-Object { $_.Name -match 'node' -and $_.CommandLine -and $_.CommandLine.Contains('server-runner.js') } |
      ForEach-Object { $_.ProcessId }
    `;
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true
    }).trim();

    return output
      .split(/\r?\n/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

function getPosixPidFromFile() {
  try {
    const value = fs.readFileSync(pidFile, "utf8");
    const pid = Number.parseInt(String(value).trim(), 10);
    return Number.isInteger(pid) && pid > 0 && isProcessRunning(pid) ? [pid] : [];
  } catch {
    return [];
  }
}

async function waitForRunning(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const running = getRunningProcessIds();
    if (running.length) {
      return running;
    }
    await sleep(300);
  }
  return [];
}

async function waitForStopped(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!getRunningProcessIds().length) {
      return true;
    }
    await sleep(300);
  }
  return false;
}

async function removePidFile() {
  await fsPromises.rm(pidFile, { force: true });
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

function isMissingProcessError(error) {
  return error && error.code === "ESRCH";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
