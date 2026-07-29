#!/usr/bin/env node
/**
 * ftpkeyence CLI
 * ──────────────
 * Usage:
 *   ftpkeyence list   <remotePath>              [--ip <ip>] [--user <u>] [--pass <p>]
 *   ftpkeyence get    <remotePath> [localDest]  [--ip <ip>]
 *   ftpkeyence put    <localSrc>   <remotePath> [--ip <ip>]
 *   ftpkeyence remove <remotePath>              [--ip <ip>]
 */

import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import { FtpKeyence } from "./FtpKeyence";
import { rawMlsd } from "./utils";
import { normalizeConfig } from "./utils";
import { FtpItem, KeyenceConfig } from "./types";

// ── Parse CLI args ────────────────────────────────────────────────
function parseArgs(argv: string[]): {
  cmd: string;
  args: string[];
  opts: Record<string, string>;
} {
  const args: string[] = [];
  const opts: Record<string, string> = {};
  let i = 2; // skip node + script
  while (i < argv.length) {
    if (argv[i].startsWith("--")) {
      opts[argv[i].slice(2)] = argv[i + 1] || "";
      i += 2;
    } else {
      args.push(argv[i]);
      i++;
    }
  }
  return { cmd: args[0] || "", args: args.slice(1), opts };
}

function buildConfig(opts: Record<string, string>): KeyenceConfig {
  const cfg: KeyenceConfig = { ip: opts.ip || "192.168.1.86" };
  if (opts.port) cfg.ftpPort = parseInt(opts.port);
  if (opts.user) cfg.ftpUser = opts.user;
  if (opts.pass !== undefined) cfg.ftpPass = opts.pass;
  return cfg;
}

// ── Helpers ───────────────────────────────────────────────────────
function sizeStr(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function bar(current: number, total: number, width = 30): string {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${Math.round(pct * 100)}%`;
}

function confirm(question: string): Promise<string> {
  return new Promise((res) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (ans) => {
      rl.close();
      res(ans.toLowerCase().trim());
    });
  });
}

async function detectRemoteType(
  remotePath: string,
  config: Required<KeyenceConfig>
): Promise<"file" | "dir" | "unknown"> {
  const items = await rawMlsd(remotePath, config);
  if (items.length > 0) return "dir";

  const parent = remotePath.substring(0, remotePath.lastIndexOf("/"));
  const name = path.basename(remotePath);
  const siblings = await rawMlsd(parent, config);
  const match = siblings.find((i: FtpItem) => i.name === name);
  if (match) return match.isDirectory ? "dir" : "file";

  return "unknown";
}

// ── Commands ──────────────────────────────────────────────────────
async function cmdList(
  remotePath: string,
  config: Required<KeyenceConfig>
): Promise<void> {
  console.log(`\n📂 Listing: ${remotePath}\n`);
  const items = await rawMlsd(remotePath, config);

  if (items.length === 0) {
    console.log("  (empty or path not found)");
    return;
  }

  const dirs = items.filter((i) => i.isDirectory);
  const files = items.filter((i) => i.isFile);

  dirs.forEach((i) =>
    console.log(`  📁  ${i.name.padEnd(55)} ${i.modifyDate}`)
  );
  files.forEach((i) =>
    console.log(
      `  📄  ${i.name.padEnd(55)} ${sizeStr(i.size).padStart(10)}  ${i.modifyDate}`
    )
  );

  console.log(`\n  Total: ${dirs.length} folder(s), ${files.length} file(s)`);
}

async function cmdGet(
  remotePath: string,
  localDest: string | undefined,
  config: Required<KeyenceConfig>
): Promise<void> {
  const type = await detectRemoteType(remotePath, config);

  if (type === "unknown") {
    console.error(`  ❌ Path not found on camera: ${remotePath}`);
    process.exit(1);
  }

  const client = new FtpKeyence(config);
  try {
    await client.connect();

    if (type === "file") {
      const localPath =
        localDest || path.join("./downloads", path.basename(remotePath));
      console.log(`\n⬇  Download file`);
      console.log(`   From : ${remotePath}`);
      console.log(`   To   : ${path.resolve(localPath)}\n`);

      const rawClient = client.getClient()!;
      rawClient.trackProgress((info) => {
        process.stdout.write(
          `\r   ${bar(info.bytes, (info as any).fileSize || 0)}  ${sizeStr(info.bytes)}`
        );
      });
      await client.downloadFile(remotePath, localPath);
      rawClient.trackProgress();
      console.log(`\n\n  ✅ Done: ${path.resolve(localPath)}`);
    } else {
      const localDir =
        localDest || path.join("./downloads", path.basename(remotePath));
      console.log(`\n⬇  Download folder`);
      console.log(`   From : ${remotePath}`);
      console.log(`   To   : ${path.resolve(localDir)}\n`);

      let count = 0;
      await client.downloadFolder(remotePath, localDir, (remote) => {
        process.stdout.write(
          `\r   [${++count}] ${path.basename(remote).substring(0, 52).padEnd(54)}`
        );
      });
      process.stdout.write("\n");
      console.log(`\n  ✅ Done: ${count} file(s) saved to ${path.resolve(localDir)}`);
    }
  } finally {
    client.close();
  }
}

async function cmdPut(
  localSrc: string,
  remotePath: string,
  config: Required<KeyenceConfig>
): Promise<void> {
  if (!fs.existsSync(localSrc)) {
    console.error(`  ❌ Local path not found: ${localSrc}`);
    process.exit(1);
  }

  const isDir = fs.statSync(localSrc).isDirectory();
  const client = new FtpKeyence(config);
  try {
    await client.connect();

    if (!isDir) {
      console.log(`\n⬆  Upload file`);
      console.log(`   From : ${path.resolve(localSrc)}`);
      console.log(`   To   : ${remotePath}\n`);

      const rawClient = client.getClient()!;
      rawClient.trackProgress((info) => {
        process.stdout.write(
          `\r   ${bar(info.bytes, (info as any).fileSize || 0)}  ${sizeStr(info.bytes)}`
        );
      });
      await client.uploadFile(localSrc, remotePath);
      rawClient.trackProgress();
      console.log(`\n\n  ✅ Upload complete: ${remotePath}`);
    } else {
      console.log(`\n⬆  Upload folder`);
      console.log(`   From : ${path.resolve(localSrc)}`);
      console.log(`   To   : ${remotePath}\n`);

      let count = 0;
      await client.uploadFolder(localSrc, remotePath, (local) => {
        process.stdout.write(
          `\r   [${++count}] ${path.basename(local).substring(0, 52).padEnd(54)}`
        );
      });
      process.stdout.write("\n");
      console.log(`\n  ✅ Done: ${count} file(s) uploaded to ${remotePath}`);
    }
  } finally {
    client.close();
  }
}

async function cmdRemove(
  remotePath: string,
  config: Required<KeyenceConfig>
): Promise<void> {
  console.log(`\n🗑  Remove: ${remotePath}\n`);

  const type = await detectRemoteType(remotePath, config);

  if (type === "unknown") {
    console.error(`  ❌ Path not found on camera: ${remotePath}`);
    process.exit(1);
  }

  if (type === "dir") {
    const countAll = async (
      rPath: string
    ): Promise<{ files: number; dirs: number }> => {
      const children = await rawMlsd(rPath, config);
      let files = 0,
        dirs = 1;
      for (const c of children) {
        if (c.isDirectory) {
          const r = await countAll(`${rPath}/${c.name}`);
          files += r.files;
          dirs += r.dirs;
        } else {
          files++;
        }
      }
      return { files, dirs };
    };
    const { files, dirs } = await countAll(remotePath);
    console.log(`  Type   : Directory`);
    console.log(`  Content: ${dirs} folder(s), ${files} file(s)`);
  } else {
    console.log(`  Type   : File`);
  }

  console.log(`\n  ⚠️  This will permanently delete: ${remotePath}`);
  const answer = await confirm("  Continue? [y/N] ");

  if (answer !== "y") {
    console.log("\n  Cancelled.");
    return;
  }

  const client = new FtpKeyence(config);
  try {
    await client.connect();
    let count = 0;
    await client.remove(remotePath, (itemPath, itemType) => {
      count++;
      process.stdout.write(
        `\r   [${count}] ${itemType === "dir" ? "📁" : "📄"} ${itemPath.substring(0, 60).padEnd(62)}`
      );
    });
    process.stdout.write("\n");
    console.log(`\n  ✅ Removed: ${remotePath}  (${count} item(s) deleted)`);
  } finally {
    client.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────
const HELP = `
ftpkeyence - FTP client for Keyence VS series cameras
──────────────────────────────────────────────────────
Commands:
  list   <remotePath>              List directory contents
  get    <remotePath> [localDest]  Download file or folder
  put    <localSrc>   <remotePath> Upload file or folder
  remove <remotePath>              Delete file or folder

Options:
  --ip   <address>   Camera IP (default: 192.168.1.86)
  --port <number>    FTP port   (default: 21)
  --user <name>      FTP user   (default: Admin)
  --pass <password>  FTP pass   (default: empty)

Examples:
  ftpkeyence list /EM/VS/Camera/Programs
  ftpkeyence get  /EM/VS/Camera/Programs/0610_63331-731-53U00
  ftpkeyence put  ./myprogram /SD/VS/Camera/Programs/myprogram
  ftpkeyence remove /EM/VS/Camera/Image/img001.bmp
  ftpkeyence list /EM/VS/Camera/Programs --ip 192.168.0.10 --user admin
`;

async function main(): Promise<void> {
  const { cmd, args, opts } = parseArgs(process.argv);
  const config = normalizeConfig(buildConfig(opts));

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return;
  }

  try {
    switch (cmd) {
      case "list":
        if (!args[0]) {
          console.error("Usage: ftpkeyence list <remotePath>");
          process.exit(1);
        }
        await cmdList(args[0], config);
        break;

      case "get":
        if (!args[0]) {
          console.error("Usage: ftpkeyence get <remotePath> [localDest]");
          process.exit(1);
        }
        await cmdGet(args[0], args[1], config);
        break;

      case "put":
        if (!args[0] || !args[1]) {
          console.error("Usage: ftpkeyence put <localSrc> <remotePath>");
          process.exit(1);
        }
        await cmdPut(args[0], args[1], config);
        break;

      case "remove":
        if (!args[0]) {
          console.error("Usage: ftpkeyence remove <remotePath>");
          process.exit(1);
        }
        await cmdRemove(args[0], config);
        break;

      default:
        console.log(`Unknown command: ${cmd}\n${HELP}`);
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Error: ${message}`);
    process.exit(1);
  }
}

main();
