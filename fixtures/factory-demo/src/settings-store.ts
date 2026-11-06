// A tiny settings store: one JSON file, read and written whole.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Settings {
  displayName: string;
  email: string;
  notifications: { productNews: boolean; weeklySummary: boolean; securityAlerts: true };
}

export const DEFAULTS: Settings = {
  displayName: "Demo user",
  email: "demo@example.com",
  notifications: { productNews: true, weeklySummary: false, securityAlerts: true },
};

export class SettingsStore {
  constructor(private readonly path: string) {}

  read(): Settings {
    if (!existsSync(this.path)) return structuredClone(DEFAULTS);
    return { ...structuredClone(DEFAULTS), ...JSON.parse(readFileSync(this.path, "utf8")) };
  }

  write(settings: Settings): void {
    writeFileSync(this.path, JSON.stringify(settings, null, 2) + "\n");
  }
}
