# ftpkeyence

FTP client for **Keyence VS series** vision cameras. Written in TypeScript with full type definitions.

Supports listing, downloading, uploading, and removing files/folders on camera internal (EM) and SD card (SD) storage.

## Install

```bash
npm install @raydotac/ftpkeyence
```

## Camera Configuration

Before using, make sure the FTP server on the camera is accessible:

| Setting | Default | Where to find / set |
|---------|---------|---------------------|
| `ip` |  E| Camera IP address (required) |
| `ftpPort` | `21` | 環墁E��宁EↁEFTP設宁E|
| `ftpUser` | `"Admin"` | VS Creator title bar shows logged-in user |
| `ftpPass` | `""` | Empty by default  Eset in VS Creator if needed |

**Storage paths on the camera:**

| Path | Description |
|------|-------------|
| `/EM/VS/Camera/Programs` | Internal storage  Eprograms |
| `/SD/VS/Camera/Programs` | SD card  Eprograms |
| `/EM/VS/Camera/Image` | Internal storage  Ecaptured images |
| `/SD/VS/Camera/Image` | SD card  Ecaptured images |

> **Note:** The camera FTP server rejects `LIST -a`. This library uses `MLSD` internally to work around this.

---

## TypeScript / JavaScript Usage

### Basic setup

```ts
import { FtpKeyence } from '@raydotac/ftpkeyence';

const camera = new FtpKeyence({
  ip: '192.168.1.86',     // required
  ftpPort: 21,            // optional, default 21
  ftpUser: 'Admin',       // optional, default 'Admin'
  ftpPass: '',            // optional, default ''
});
```

### List a directory

```ts
await camera.connect();

const items = await camera.list('/EM/VS/Camera/Programs');

for (const item of items) {
  if (item.isDirectory) {
    console.log(`📁 ${item.name}  ${item.modifyDate}`);
  } else {
    console.log(`📄 ${item.name}  ${item.size} bytes  ${item.modifyDate}`);
  }
}

camera.close();
```

### Download a file

```ts
await camera.connect();

await camera.downloadFile(
  '/EM/VS/Camera/Programs/StartupProgram.stp',
  './downloads/StartupProgram.stp'
);

camera.close();
```

### Download a folder (recursive)

```ts
await camera.connect();

await camera.downloadFolder(
  '/EM/VS/Camera/Programs/0610_63331-731-53U00',
  './downloads/0610_63331-731-53U00',
  (remotePath, localPath) => {
    console.log(`Downloaded: ${remotePath}`);
  }
);

camera.close();
```

### Upload a file

```ts
await camera.connect();

await camera.uploadFile(
  './local/myprogram.vsm',
  '/SD/VS/Camera/Programs/myprogram.vsm'
);

camera.close();
```

### Upload a folder (recursive)

```ts
await camera.connect();

await camera.uploadFolder(
  './local/myprogram',
  '/SD/VS/Camera/Programs/myprogram',
  (localPath, remotePath) => {
    console.log(`Uploaded: ${localPath}`);
  }
);

camera.close();
```

### Remove a file or folder (auto-detected)

```ts
await camera.connect();

// Remove a file
await camera.remove('/EM/VS/Camera/Programs/StartupProgram.stp');

// Remove an entire folder recursively
await camera.remove(
  '/EM/VS/Camera/Programs/old_program',
  (itemPath, type) => {
    console.log(`Deleted [${type}]: ${itemPath}`);
  }
);

camera.close();
```

### Monitor for new images (auto-download)

```ts
import { FtpKeyence } from '@raydotac/ftpkeyence';
import * as fs from 'fs';
import * as path from 'path';

const camera = new FtpKeyence({ ip: '192.168.1.86' });
const known: Record<string, string> = {};
const OUT_DIR = './images';

async function poll() {
  const items = await camera.list('/EM/VS/Camera/Image');

  for (const item of items) {
    if (!item.isFile) continue;

    const key = item.name;
    if (!known[key] || known[key] !== item.modifyRaw) {
      known[key] = item.modifyRaw;

      // New or updated image  Edownload it
      const localPath = path.join(OUT_DIR, item.name);
      await camera.connect();
      await camera.downloadFile(`/EM/VS/Camera/Image/${item.name}`, localPath);
      camera.close();

      console.log(`Downloaded: ${item.name}`);
    }
  }
}

// Initial scan without downloading
const initial = await camera.list('/EM/VS/Camera/Image');  // standalone list
initial.forEach(i => { known[i.name] = i.modifyRaw; });

// Poll every 3 seconds
setInterval(poll, 3000);
```

### Electron / Vite integration

```ts
// In your Electron main process or Node.js backend:
import { FtpKeyence } from '@raydotac/ftpkeyence';

const camera = new FtpKeyence({ ip: '192.168.1.86' });

// Expose to renderer via IPC:
ipcMain.handle('camera:list', async (_, remotePath: string) => {
  await camera.connect();
  const items = await camera.list(remotePath);
  camera.close();
  return items;
});

ipcMain.handle('camera:download', async (_, remotePath: string, localPath: string) => {
  await camera.connect();
  await camera.downloadFile(remotePath, localPath);
  camera.close();
});
```

---

## API Reference

### `new FtpKeyence(config)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config.ip` | `string` | ✁E| Camera IP address |
| `config.ftpPort` | `number` |  E| FTP port (default: `21`) |
| `config.ftpUser` | `string` |  E| FTP username (default: `"Admin"`) |
| `config.ftpPass` | `string` |  E| FTP password (default: `""`) |

### Methods

| Method | Description |
|--------|-------------|
| `connect()` | Connect to FTP server |
| `close()` | Disconnect |
| `list(remotePath)` | List directory ↁE`FtpItem[]` |
| `downloadFile(remote, local)` | Download single file |
| `downloadFolder(remote, local, onFile?)` | Download folder recursively |
| `uploadFile(local, remote)` | Upload single file |
| `uploadFolder(local, remote, onFile?)` | Upload folder recursively |
| `remove(remote, onItem?)` | Remove file or folder (auto-detected) |
| `getClient()` | Access underlying `basic-ftp` client |

### `FtpItem`

```ts
interface FtpItem {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;       // bytes
  modifyRaw: string;  // "YYYYMMDDHHmmss"
  modifyDate: string; // "YYYY-MM-DD HH:mm:ss"
}
```

---

## CLI Usage

After installing globally (`npm install -g @raydotac/ftpkeyence`):

```bash
ftpkeyence list   /EM/VS/Camera/Programs
ftpkeyence get    /EM/VS/Camera/Programs/0610_63331-731-53U00
ftpkeyence get    /EM/VS/Camera/Programs/StartupProgram.stp  ./local/
ftpkeyence put    ./myprogram   /SD/VS/Camera/Programs/myprogram
ftpkeyence put    ./myfile.vsm  /SD/VS/Camera/Programs/myfile.vsm
ftpkeyence remove /EM/VS/Camera/Programs/old_program

# Custom camera address:
ftpkeyence list /EM/VS/Camera/Programs --ip 192.168.0.10 --user Admin --pass ""
```

---

## License

MIT
