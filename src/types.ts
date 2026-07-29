/**
 * Configuration for Keyence VS Camera connection
 */
export interface KeyenceConfig {
  /** Camera IP address (e.g., "192.168.1.86") */
  ip: string;
  /** FTP port (default: 21) */
  ftpPort?: number;
  /** FTP username (default: "Admin") */
  ftpUser?: string;
  /** FTP password (default: "") */
  ftpPass?: string;
  /** TCP command port for non-procedural communication (default: 8500) */
  tcpPort?: number;
}

/**
 * File/directory item from FTP MLSD listing
 */
export interface FtpItem {
  /** Item name */
  name: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Whether this is a file */
  isFile: boolean;
  /** File size in bytes (0 for directories) */
  size: number;
  /** Raw modify timestamp (YYYYMMDDHHmmss format) */
  modifyRaw: string;
  /** Formatted modify date (YYYY-MM-DD HH:mm:ss) */
  modifyDate: string;
}

/**
 * Storage type
 */
export type StorageType = "EM" | "SD" | "both";

/**
 * Callback for file operations
 */
export type FileOperationCallback = (remotePath: string, localPath?: string) => void;

/**
 * Callback for remove operations
 */
export type RemoveCallback = (itemPath: string, itemType: "file" | "dir") => void;
