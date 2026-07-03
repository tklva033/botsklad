import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { Client } from "pg";
import { config } from "../config.js";

let instance = null;

export async function ensureEmbeddedPostgres() {
  if (instance) {
    return instance;
  }

  const connection = readLocalConnection();
  if (!config.embeddedPostgresEnabled || !connection) {
    return null;
  }

  await fs.mkdir(config.embeddedPostgresDir, { recursive: true });

  const clusterRoot = await resolveClusterRoot(config.embeddedPostgresDir);
  const databaseDir = path.join(clusterRoot, "cluster");
  await fs.mkdir(databaseDir, { recursive: true });
  await cleanupStalePid(databaseDir, connection.port);

  const binaries = await resolvePostgresBinaries();
  const versionFile = path.join(databaseDir, "PG_VERSION");

  try {
    await fs.access(versionFile);
  } catch {
    await initialiseCluster({
      binaries,
      databaseDir,
      username: connection.username,
      password: connection.password
    });
  }

  const processRef = await isPortOpen(connection.port)
    ? null
    : await startCluster({
        binaries,
        databaseDir,
        port: connection.port
      });

  await waitForDatabaseReady(connection);
  await ensureDatabaseExists(connection);

  instance = {
    connection,
    databaseDir,
    process: processRef
  };

  return instance;
}

export async function stopEmbeddedPostgres() {
  if (!instance?.process) {
    instance = null;
    return;
  }

  await stopProcess(instance.process);
  instance = null;
}

function readLocalConnection() {
  if (!config.databaseUrl) {
    return null;
  }

  const url = new URL(config.databaseUrl);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    return null;
  }

  return {
    username: decodeURIComponent(url.username || "postgres"),
    password: decodeURIComponent(url.password || "postgres"),
    port: Number(url.port || 5432),
    databaseName: url.pathname.replace(/^\//, "") || "postgres"
  };
}

async function resolveClusterRoot(targetDir) {
  if (process.platform !== "win32" || !targetDir.includes(" ")) {
    return targetDir;
  }

  const junctionPath = path.join(os.tmpdir(), "bot-sklad-postgres-link");
  try {
    const currentRealPath = await fs.realpath(junctionPath);
    const targetRealPath = await fs.realpath(targetDir);
    if (currentRealPath.toLowerCase() === targetRealPath.toLowerCase()) {
      return junctionPath;
    }
    await fs.rm(junctionPath, { recursive: true, force: true });
  } catch {
    // Recreate missing or stale junction below.
  }

  await fs.symlink(targetDir, junctionPath, "junction");
  return junctionPath;
}

async function resolvePostgresBinaries() {
  const embeddedEntry = fileURLToPath(await import.meta.resolve("embedded-postgres"));
  const embeddedDir = path.dirname(path.dirname(embeddedEntry));
  const binaryModuleUrl = pathToFileURL(path.join(embeddedDir, "dist", "binary.js")).href;
  const { default: getBinaries } = await import(binaryModuleUrl);
  return getBinaries();
}

async function initialiseCluster({ binaries, databaseDir, username, password }) {
  const passwordFile = path.join(os.tmpdir(), `bot-sklad-pg-password-${Date.now()}.txt`);
  await fs.writeFile(passwordFile, `${password}\n`, "utf8");

  try {
    await runProcess(binaries.initdb, [
      "-D",
      databaseDir,
      `--username=${username}`,
      `--pwfile=${passwordFile}`,
      "--auth=password",
      "--lc-messages=C"
    ]);
  } finally {
    await fs.rm(passwordFile, { force: true });
  }
}

async function startCluster({ binaries, databaseDir, port }) {
  const child = spawn(binaries.postgres, ["-D", databaseDir, "-p", String(port)], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  await waitForPort(port, 15000);
  return child;
}

async function ensureDatabaseExists(connection) {
  const databaseName = connection.databaseName.replace(/"/g, "\"\"");

  if (await databaseExists(connection, connection.databaseName)) {
    return;
  }

  const client = new Client({
    host: "127.0.0.1",
    port: connection.port,
    user: connection.username,
    password: connection.password,
    database: "template1"
  });

  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } catch (error) {
    if (error?.code !== "42P04") {
      throw error;
    }
  } finally {
    await client.end();
  }
}

async function databaseExists(connection, databaseName) {
  const client = new Client({
    host: "127.0.0.1",
    port: connection.port,
    user: connection.username,
    password: connection.password,
    database: "template1"
  });

  await client.connect();
  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    return result.rowCount > 0;
  } finally {
    await client.end();
  }
}

async function cleanupStalePid(databaseDir, port) {
  const pidFile = path.join(databaseDir, "postmaster.pid");
  try {
    await fs.access(pidFile);
  } catch {
    return;
  }

  if (await isPortOpen(port)) {
    return;
  }

  await fs.rm(pidFile, { force: true });
}

async function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };

    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

async function waitForPort(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`PostgreSQL did not start on port ${port} within ${timeoutMs}ms`);
}

async function waitForDatabaseReady(connection, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const client = new Client({
      host: "127.0.0.1",
      port: connection.port,
      user: connection.username,
      password: connection.password,
      database: "template1",
      connectionTimeoutMillis: 1000
    });

    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`PostgreSQL is not accepting connections within ${timeoutMs}ms`);
}

async function stopProcess(child) {
  await new Promise((resolve) => {
    child.once("exit", () => resolve());

    if (process.platform === "win32" && child.pid) {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
        stdio: "ignore"
      });
      killer.once("exit", () => undefined);
      return;
    }

    child.kill("SIGINT");
  });
}

async function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      if (process.env.NODE_ENV !== "test") {
        console.log(chunk.toString("utf8").trimEnd());
      }
    });
    child.stderr?.on("data", (chunk) => {
      const message = chunk.toString("utf8");
      stderr += message;
      if (process.env.NODE_ENV !== "test") {
        console.error(message.trimEnd());
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `Process failed with code ${code ?? "unknown"}`));
    });
  });
}
