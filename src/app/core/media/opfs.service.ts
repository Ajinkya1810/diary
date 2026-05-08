import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class OpfsService {

  async writeBlob(path: string, blob: Blob): Promise<void> {
    const handle = await this.resolveFile(path, true);
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async readBlob(path: string): Promise<Blob> {
    const handle = await this.resolveFile(path, false);
    return handle.getFile();
  }

  async deleteBlob(path: string): Promise<void> {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    const dir = await this.resolveDir(parts.slice(0, -1), false);
    await dir.removeEntry(name);
  }

  async clearDir(dirPath: string): Promise<void> {
    const parts = dirPath.split('/').filter(Boolean);
    const root = await navigator.storage.getDirectory();
    let dir: FileSystemDirectoryHandle = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: false }).catch(() => null as any);
      if (!dir) return;
    }
    const toRemove: string[] = [];
    for await (const [name] of (dir as any).entries()) toRemove.push(name);
    await Promise.all(toRemove.map(name => dir.removeEntry(name, { recursive: true }).catch(() => {})));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.resolveFile(path, false);
      return true;
    } catch {
      return false;
    }
  }

  /** Recursive list of file paths under a directory. Returns OPFS-relative paths like "media/2026/05/abc.jpg". */
  async listFiles(dirPath: string): Promise<string[]> {
    const parts = dirPath.split('/').filter(Boolean);
    const root = await navigator.storage.getDirectory();
    let dir: FileSystemDirectoryHandle = root;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create: false });
      } catch { return []; }
    }
    const out: string[] = [];
    await this.walk(dir, parts.join('/'), out);
    return out;
  }

  private async walk(dir: FileSystemDirectoryHandle, prefix: string, out: string[]): Promise<void> {
    for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'file') out.push(path);
      else if (handle.kind === 'directory') await this.walk(handle as FileSystemDirectoryHandle, path, out);
    }
  }

  private async resolveFile(path: string, create: boolean): Promise<FileSystemFileHandle> {
    const parts = path.split('/');
    const dir = await this.resolveDir(parts.slice(0, -1), create);
    return dir.getFileHandle(parts[parts.length - 1], { create });
  }

  private async resolveDir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    let dir: FileSystemDirectoryHandle = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return dir;
  }
}
