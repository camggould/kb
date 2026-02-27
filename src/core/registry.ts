import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const REGISTRY_DIR = path.join(os.homedir(), ".config", "kb");
const REGISTRY_PATH = path.join(REGISTRY_DIR, "registry.json");

export interface Registry {
  [name: string]: string; // KB name → absolute folder path
}

function ensureRegistryDir(): void {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
}

export function loadRegistry(): Registry {
  ensureRegistryDir();
  if (!fs.existsSync(REGISTRY_PATH)) {
    return {};
  }
  const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
  return JSON.parse(raw);
}

function saveRegistry(registry: Registry): void {
  ensureRegistryDir();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
}

export function registerKb(name: string, absPath: string): void {
  const registry = loadRegistry();
  registry[name] = absPath;
  saveRegistry(registry);
}

export function unregisterKb(name: string): void {
  const registry = loadRegistry();
  delete registry[name];
  saveRegistry(registry);
}

export function resolveKb(name: string): string | null {
  const registry = loadRegistry();
  return registry[name] ?? null;
}

export function listKbs(): Registry {
  return loadRegistry();
}

export function initKb(targetPath: string): { name: string; absPath: string } {
  const absPath = path.resolve(targetPath);
  const name = path.basename(absPath);

  fs.mkdirSync(path.join(absPath, ".kb"), { recursive: true });
  fs.mkdirSync(path.join(absPath, "notes"), { recursive: true });

  // Write default config
  const configPath = path.join(absPath, ".kb", "config.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ version: 1 }, null, 2), "utf-8");
  }

  registerKb(name, absPath);
  return { name, absPath };
}
