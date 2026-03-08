/**
 * Reactory Desktop — Simple persistent JSON store
 *
 * A lightweight alternative to electron-store that works with CJS output.
 * Reads/writes a JSON file in the Electron userData directory.
 */
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface StoreSchema {
  mongoUri: string | null;
  apiPort: number;
  clientPort: number;
  useEmbeddedMongo: boolean;
  windowBounds: { width: number; height: number; x?: number; y?: number } | null;
  /** Server configuration key — determines modules, enabled clients, env file */
  serverConfigId: string;
  /** Client configuration key — determines which PWA build and env to use */
  clientConfigId: string;
  /** Theme key — usually matches clientConfigId but can be overridden */
  themeId: string;
}

const DEFAULTS: StoreSchema = {
  mongoUri: null,
  apiPort: 4000,
  clientPort: 3000,
  useEmbeddedMongo: true,
  windowBounds: null,
  serverConfigId: 'reactory',
  clientConfigId: 'reactory',
  themeId: 'reactory',
};

export class JsonStore {
  private filePath: string;
  private data: StoreSchema;

  constructor(name = 'config') {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, `${name}.json`);
    this.data = this.load();
  }

  private load(): StoreSchema {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return { ...DEFAULTS, ...JSON.parse(raw) };
      }
    } catch {
      // Corrupted file — reset to defaults
    }
    return { ...DEFAULTS };
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save store:', err);
    }
  }

  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
    return this.data[key];
  }

  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
    this.data[key] = value;
    this.save();
  }
}
