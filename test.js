/**
 * test.js — ftpkeyence package test
 * ───────────────────────────────────
 * Run: node test.js
 *
 * Các test:
 *  1. list  — /EM/VS/Camera/Programs
 *  2. list  — /SD/VS/Camera/Programs
 *  3. get   — download file
 *  4. get   — download folder
 *  5. put   — upload file 
 *  6. put   — upload folder
 *  7. remove — remove uploaded file
 *  8. remove — remove uploaded dir
 *  9. list  — /EM/VS/Camera/Image
 */

"use strict";
const path = require("path");
const fs   = require("fs");
const { FtpKeyence } = require("@raydotac/ftpkeyence");

// ── Config ────────────────────────────────────────────────────────
const cam = new FtpKeyence({
  ip:      "192.168.1.86",
  ftpUser: "Admin",
  ftpPass: "",
});

const DOWNLOAD_DIR = "./test_downloads";

// ── Helpers ───────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function sizeStr(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024)        return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function header(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

function ok(msg)   { console.log(`  ✅  ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌  ${msg}`); failed++; }
function info(msg) { console.log(`  ℹ   ${msg}`); }

async function test(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (e) {
    fail(`${label} — ${e.message}`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║            ftpkeyence — Integration Tests               ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  // ── 1. LIST /EM/VS/Camera/Programs ────────────────────────────
  header("1. list /EM/VS/Camera/Programs");
  let emPrograms = [];
  await test("list() returns items", async () => {
    emPrograms = await cam.list("/EM/VS/Camera/Programs");
    if (emPrograms.length === 0) throw new Error("Empty result");
    info(`${emPrograms.length} items found`);
  });

  await test("items have required fields", async () => {
    const item = emPrograms[0];
    if (!item.name)    throw new Error("Missing name");
    if (typeof item.isDirectory !== "boolean") throw new Error("Missing isDirectory");
    if (typeof item.isFile      !== "boolean") throw new Error("Missing isFile");
    if (typeof item.size        !== "number")  throw new Error("Missing size");
    if (!item.modifyDate) throw new Error("Missing modifyDate");
    info(`First item: ${item.isDirectory ? "📁" : "📄"} ${item.name}  ${item.modifyDate}`);
  });

  const dirs  = emPrograms.filter(i => i.isDirectory);
  const files = emPrograms.filter(i => i.isFile);
  info(`Folders: ${dirs.length}  Files: ${files.length}`);
  files.slice(0, 3).forEach(f => info(`  📄 ${f.name}  ${sizeStr(f.size)}`));
  dirs.slice(0, 3).forEach(d => info(`  📁 ${d.name}`));

  // ── 2. LIST /SD/VS/Camera/Programs ────────────────────────────
  header("2. list /SD/VS/Camera/Programs");
  let sdPrograms = [];
  await test("list() SD storage", async () => {
    sdPrograms = await cam.list("/SD/VS/Camera/Programs");
    if (sdPrograms.length === 0) throw new Error("Empty result");
    info(`${sdPrograms.length} items found`);
    sdPrograms.slice(0, 3).forEach(i => info(`  ${i.isDirectory ? "📁" : "📄"} ${i.name}`));
  });

  // ── 3. LIST /EM/VS/Camera/Image ───────────────────────────────
  header("3. list /EM/VS/Camera/Image");
  let images = [];
  await test("list() Image folder exists", async () => {
    // rawMlsd returns [] for both empty dir AND non-existing
    // so we just check it doesn't throw
    images = await cam.list("/EM/VS/Camera/Image");
    info(`Images found: ${images.length}`);
    images.slice(0, 5).forEach(i => info(`  📄 ${i.name}  ${sizeStr(i.size)}  ${i.modifyDate}`));
    if (images.length === 0) info("(empty — camera may not be saving images to EM)");
  });

  // ── 4. GET — download file ────────────────────────────────────
  header("4. get — download file (StartupProgram.stp)");
  const remoteFile   = "/EM/VS/Camera/Programs/StartupProgram.stp";
  const localFile    = path.join(DOWNLOAD_DIR, "StartupProgram.stp");

  await test("connect()", async () => { await cam.connect(); });

  await test("downloadFile()", async () => {
    await cam.downloadFile(remoteFile, localFile);
    if (!fs.existsSync(localFile)) throw new Error("Local file not created");
    const size = fs.statSync(localFile).size;
    info(`Downloaded: ${localFile}  (${sizeStr(size)})`);
  });

  // ── 5. GET — download folder ──────────────────────────────────
  header("5. get — download folder (first program folder)");
  const firstDir     = dirs[0];
  const remoteFolderPath = `/EM/VS/Camera/Programs/${firstDir?.name}`;
  const localFolderPath  = path.join(DOWNLOAD_DIR, firstDir?.name || "test_folder");
  let downloadedCount = 0;

  await test("downloadFolder()", async () => {
    if (!firstDir) throw new Error("No folder found in Programs");
    await cam.downloadFolder(remoteFolderPath, localFolderPath, (remote) => {
      downloadedCount++;
      process.stdout.write(`\r    Downloading [${downloadedCount}] ${path.basename(remote).substring(0,40)}`);
    });
    process.stdout.write("\n");
    if (!fs.existsSync(localFolderPath)) throw new Error("Local folder not created");
    info(`Downloaded ${downloadedCount} file(s) to ${localFolderPath}`);
  });

  // ── 6. PUT — upload file ──────────────────────────────────────
  header("6. put — upload file");
  const uploadRemoteFile = "/EM/VS/Camera/Programs/_test_upload_file.txt";

  // Create a small test file to upload
  const uploadLocalFile = path.join(DOWNLOAD_DIR, "_test_upload.txt");
  fs.writeFileSync(uploadLocalFile, "ftpkeyence upload test\n");

  await test("uploadFile()", async () => {
    await cam.uploadFile(uploadLocalFile, uploadRemoteFile);
    // Verify it exists
    const items = await cam.list("/EM/VS/Camera/Programs");
    const found = items.find(i => i.name === "_test_upload_file.txt");
    if (!found) throw new Error("Uploaded file not found in listing");
    info(`Uploaded: ${uploadRemoteFile}`);
  });

  // ── 7. PUT — upload folder ────────────────────────────────────
  header("7. put — upload folder");
  const uploadRemoteFolder = "/EM/VS/Camera/Programs/_test_upload_folder";

  await test("uploadFolder()", async () => {
    let uploadCount = 0;
    await cam.uploadFolder(localFolderPath, uploadRemoteFolder, (local) => {
      uploadCount++;
      process.stdout.write(`\r    Uploading [${uploadCount}] ${path.basename(local).substring(0,40)}`);
    });
    process.stdout.write("\n");
    // Verify folder exists
    const items = await cam.list(uploadRemoteFolder);
    info(`Uploaded ${uploadCount} file(s), remote has ${items.length} items`);
  });

  // ── 8. REMOVE — delete file ───────────────────────────────────
  header("8. remove — delete file");

  await test("remove() file", async () => {
    let removedItems = [];
    await cam.remove(uploadRemoteFile, (p, t) => removedItems.push({ p, t }));
    // Verify gone
    const items = await cam.list("/EM/VS/Camera/Programs");
    const still = items.find(i => i.name === "_test_upload_file.txt");
    if (still) throw new Error("File still exists after remove");
    info(`Removed: ${uploadRemoteFile}  (${removedItems.length} item)`);
  });

  // ── 9. REMOVE — delete folder ─────────────────────────────────
  header("9. remove — delete folder (recursive)");

  await test("remove() folder", async () => {
    let removedItems = [];
    await cam.remove(uploadRemoteFolder, (p, t) => removedItems.push({ p, t }));
    // Verify gone
    const items = await cam.list(uploadRemoteFolder);
    if (items.length > 0) throw new Error("Folder still has contents after remove");
    const files = removedItems.filter(i => i.t === "file").length;
    const dirs2 = removedItems.filter(i => i.t === "dir").length;
    info(`Removed: ${uploadRemoteFolder}  (${files} files, ${dirs2} dirs)`);
  });

  cam.close();

  // ── Cleanup local downloads ───────────────────────────────────
  fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });

  // ── Summary ───────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Results: ✅ ${passed} passed  ❌ ${failed} failed`);
  console.log("═".repeat(60));

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\n❌ Fatal:", e.message);
  cam.close();
  process.exit(1);
});
