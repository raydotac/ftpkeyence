import * as net from "net";
import { FtpItem, KeyenceConfig } from "./types";

const DEFAULT_CONFIG = {
  ftpPort: 21,
  ftpUser: "Admin",
  ftpPass: "",
  tcpPort: 8500,
};

export function normalizeConfig(config: KeyenceConfig): Required<KeyenceConfig> {
  return {
    ip: config.ip,
    ftpPort: config.ftpPort ?? DEFAULT_CONFIG.ftpPort,
    ftpUser: config.ftpUser ?? DEFAULT_CONFIG.ftpUser,
    ftpPass: config.ftpPass ?? DEFAULT_CONFIG.ftpPass,
    tcpPort: config.tcpPort ?? DEFAULT_CONFIG.tcpPort,
  };
}

/**
 * Raw MLSD implementation for Keyence VS camera (bypasses LIST -a issue)
 */
export function rawMlsd(
  remotePath: string,
  config: Required<KeyenceConfig>
): Promise<FtpItem[]> {
  return new Promise((resolve) => {
    const conn = new net.Socket();
    let buf = "";
    let dataBuffer = "";
    let step = 0;
    let dataConn: net.Socket | null = null;

    conn.setTimeout(10000);
    conn.connect(config.ftpPort, config.ip);

    const send = (cmd: string) => conn.write(cmd + "\r\n");

    conn.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\r\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        const code = parseInt(line);

        if (step === 0 && code === 220) {
          step = 1;
          send(`USER ${config.ftpUser}`);
        } else if (step === 1 && code === 331) {
          step = 2;
          send(`PASS ${config.ftpPass}`);
        } else if (step === 2 && code === 230) {
          step = 3;
          send(`CWD ${remotePath}`);
        } else if (step === 3 && (code === 200 || code === 250)) {
          step = 4;
          send("PASV");
        } else if (step === 4 && code === 227) {
          const m = line.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
          if (!m) {
            conn.destroy();
            return resolve([]);
          }
          dataConn = new net.Socket();
          const port = parseInt(m[5]) * 256 + parseInt(m[6]);
          dataConn.connect(port, config.ip, () => {
            step = 5;
            send("MLSD");
          });
          dataConn.on("data", (d) => {
            dataBuffer += d.toString();
          });
          dataConn.on("end", () => {
            /* wait for 226 */
          });
          dataConn.on("error", () => {
            conn.destroy();
            resolve([]);
          });
        } else if (step === 5 && code === 226) {
          step = 6;
          send("QUIT");
          conn.destroy();
          resolve(parseMlsd(dataBuffer));
        } else if (step === 3 && code === 550) {
          conn.destroy();
          resolve([]);
        }
      }
    });

    conn.on("timeout", () => {
      conn.destroy();
      resolve([]);
    });
    conn.on("error", () => resolve([]));
  });
}

function parseMlsd(raw: string): FtpItem[] {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const spaceIdx = line.indexOf(" ");
      const factsStr = spaceIdx >= 0 ? line.substring(0, spaceIdx) : line;
      const name = spaceIdx >= 0 ? line.substring(spaceIdx + 1).trim() : "";
      const attrs: Record<string, string> = {};

      factsStr.split(";").forEach((f) => {
        const [k, v] = f.split("=");
        if (k && v !== undefined) attrs[k.toLowerCase()] = v.trim();
      });

      const isDirectory = ["dir", "cdir", "pdir"].includes(attrs.type || "");
      const modify = attrs.modify || "";

      return {
        name,
        isDirectory,
        isFile: attrs.type === "file",
        size: parseInt(attrs.size || "0"),
        modifyRaw: modify,
        modifyDate: modify
          ? `${modify.substring(0, 4)}-${modify.substring(
              4,
              6
            )}-${modify.substring(6, 8)} ${modify.substring(
              8,
              10
            )}:${modify.substring(10, 12)}:${modify.substring(12, 14)}`
          : "",
      };
    })
    .filter((i) => i.name && i.name !== "." && i.name !== "..");
}
