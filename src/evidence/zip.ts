import { readFile, stat } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { KaneJudgeError } from "../shared/errors.js";

/** Packs bigger than this are not opened (the report then just links the pack). */
const MAX_PACK_BYTES = 400 * 1024 * 1024;

/**
 * Read-only view of an evidence pack (a plain zip). Only the entries that are
 * asked for are decompressed.
 */
export class ZipReader {
  private constructor(
    private readonly data: Uint8Array,
    readonly names: string[],
  ) {}

  static async open(path: string): Promise<ZipReader> {
    const info = await stat(path);
    if (info.size > MAX_PACK_BYTES) {
      throw new KaneJudgeError(`evidence pack is too large to inspect (${Math.round(info.size / 1e6)} MB)`, "PACK_TOO_LARGE");
    }
    const data = new Uint8Array(await readFile(path));
    return ZipReader.fromBytes(data);
  }

  static fromBytes(data: Uint8Array): ZipReader {
    const names: string[] = [];
    // A filter that rejects everything lists the entries without decompressing any of them.
    unzipSync(data, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
    return new ZipReader(data, names);
  }

  has(name: string): boolean {
    return this.names.includes(name);
  }

  readBytes(names: string[]): Map<string, Uint8Array> {
    const wanted = new Set(names);
    if (wanted.size === 0) return new Map();
    const files = unzipSync(this.data, { filter: (file) => wanted.has(file.name) });
    return new Map(Object.entries(files));
  }

  readText(name: string): string | undefined {
    const bytes = this.readBytes([name]).get(name);
    return bytes ? strFromU8(bytes) : undefined;
  }
}
