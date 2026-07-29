import * as ftp from "basic-ftp";
import * as fs from "fs";
import * as path from "path";
import {
  KeyenceConfig,
  FtpItem,
  FileOperationCallback,
  RemoveCallback,
} from "./types";
import { normalizeConfig, rawMlsd } from "./utils";

/**
 * FTP client for Keyence VS series vision cameras
 */
export class FtpKeyence {
  private client: ftp.Client | null = null;
  private config: Required<KeyenceConfig>;

  constructor(config: KeyenceConfig) {
    this.config = normalizeConfig(config);
  }

  /**
   * Connect to the camera FTP server
   */
  async connect(): Promise<void> {
    this.client = new ftp.Client(30000);
    this.client.ftp.verbose = false;
    await this.client.access({
      host: this.config.ip,
      port: this.config.ftpPort,
      user: this.config.ftpUser,
      password: this.config.ftpPass,
      secure: false,
    });
  }

  /**
   * Disconnect from the FTP server
   */
  close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  /**
   * List items in a remote directory
   * @param remotePath - Remote path (e.g., "/EM/VS/Camera/Programs")
   * @returns Array of FtpItem
   */
  async list(remotePath: string): Promise<FtpItem[]> {
    return rawMlsd(remotePath, this.config);
  }

  /**
   * Download a file from the camera
   * @param remotePath - Remote file path
   * @param localPath - Local destination path
   */
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    await this.client.downloadTo(localPath, remotePath);
  }

  /**
   * Download a folder recursively from the camera
   * @param remotePath - Remote folder path
   * @param localDir - Local destination directory
   * @param onFile - Optional callback per file downloaded
   */
  async downloadFolder(
    remotePath: string,
    localDir: string,
    onFile?: FileOperationCallback
  ): Promise<void> {
    fs.mkdirSync(localDir, { recursive: true });
    const items = await rawMlsd(remotePath, this.config);

    for (const item of items) {
      const remoteChild = `${remotePath}/${item.name}`;
      const localChild = path.join(localDir, item.name);

      if (item.isDirectory) {
        await this.downloadFolder(remoteChild, localChild, onFile);
      } else if (item.isFile) {
        if (onFile) onFile(remoteChild, localChild);
        await this.downloadFile(remoteChild, localChild);
      }
    }
  }

  /**
   * Upload a file to the camera
   * @param localPath - Local file path
   * @param remotePath - Remote destination path
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    const remoteDir = remotePath.substring(0, remotePath.lastIndexOf("/"));
    try {
      await this.client.send(`MKD ${remoteDir}`);
    } catch {
      // Directory may already exist
    }
    await this.client.cd(remoteDir);
    await this.client.uploadFrom(localPath, path.basename(remotePath));
  }

  /**
   * Upload a folder recursively to the camera
   * @param localDir - Local folder path
   * @param remotePath - Remote destination path
   * @param onFile - Optional callback per file uploaded
   */
  async uploadFolder(
    localDir: string,
    remotePath: string,
    onFile?: FileOperationCallback
  ): Promise<void> {
    if (!this.client) throw new Error("Not connected");

    // Create remote directory
    try {
      await this.client.send(`MKD ${remotePath}`);
    } catch {
      // Directory may already exist
    }

    const entries = fs.readdirSync(localDir, { withFileTypes: true });

    for (const entry of entries) {
      const localChild = path.join(localDir, entry.name);
      const remoteChild = `${remotePath}/${entry.name}`;

      if (entry.isDirectory()) {
        await this.uploadFolder(localChild, remoteChild, onFile);
      } else {
        if (onFile) onFile(localChild, remoteChild);
        await this.client.cd(remotePath);
        await this.client.uploadFrom(localChild, entry.name);
      }
    }
  }

  /**
   * Remove a file or directory from the camera (auto-detected)
   * @param remotePath - Remote path to remove
   * @param onItem - Optional callback per deleted item
   */
  async remove(remotePath: string, onItem?: RemoveCallback): Promise<void> {
    if (!this.client) throw new Error("Not connected");

    const items = await rawMlsd(remotePath, this.config);

    if (items.length > 0 || (await this._isDir(remotePath))) {
      await this._removeDir(remotePath, onItem);
    } else {
      if (onItem) onItem(remotePath, "file");
      await this.client.remove(remotePath);
    }
  }

  /**
   * Check if a remote path is a directory
   */
  private async _isDir(remotePath: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.cd(remotePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Recursively remove a directory
   */
  private async _removeDir(
    remotePath: string,
    onItem?: RemoveCallback
  ): Promise<void> {
    if (!this.client) throw new Error("Not connected");

    const items = await rawMlsd(remotePath, this.config);

    for (const item of items) {
      const childPath = `${remotePath}/${item.name}`;
      if (item.isDirectory) {
        await this._removeDir(childPath, onItem);
      } else {
        if (onItem) onItem(childPath, "file");
        await this.client.remove(childPath);
      }
    }

    if (onItem) onItem(remotePath, "dir");
    await this.client.removeDir(remotePath);
  }

  /**
   * Get the client's basic-ftp instance (for advanced usage)
   */
  getClient(): ftp.Client | null {
    return this.client;
  }
}
