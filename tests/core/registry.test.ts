import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initKb, listKbs, resolveKb, unregisterKb, loadRegistry } from "../../src/core/registry.js";

const TEST_DIR = path.join(os.tmpdir(), "kb-test-registry-" + Date.now());
const REGISTRY_PATH = path.join(os.homedir(), ".config", "kb", "registry.json");

let originalRegistry: string | null = null;

beforeEach(() => {
  // Back up existing registry
  if (fs.existsSync(REGISTRY_PATH)) {
    originalRegistry = fs.readFileSync(REGISTRY_PATH, "utf-8");
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  // Restore registry
  if (originalRegistry !== null) {
    fs.writeFileSync(REGISTRY_PATH, originalRegistry, "utf-8");
  }
  // Clean up test dir
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("registry", () => {
  it("should create a KB and register it", () => {
    const kbPath = path.join(TEST_DIR, "my-test-kb");
    const { name, absPath } = initKb(kbPath);

    expect(name).toBe("my-test-kb");
    expect(absPath).toBe(kbPath);
    expect(fs.existsSync(path.join(kbPath, ".kb"))).toBe(true);
    expect(fs.existsSync(path.join(kbPath, "notes"))).toBe(true);
    expect(resolveKb("my-test-kb")).toBe(kbPath);
  });

  it("should list registered KBs", () => {
    const kbPath = path.join(TEST_DIR, "list-test-kb");
    initKb(kbPath);
    const kbs = listKbs();
    expect(kbs["list-test-kb"]).toBe(kbPath);
  });

  it("should unregister a KB", () => {
    const kbPath = path.join(TEST_DIR, "unreg-test-kb");
    initKb(kbPath);
    expect(resolveKb("unreg-test-kb")).toBe(kbPath);
    unregisterKb("unreg-test-kb");
    expect(resolveKb("unreg-test-kb")).toBeNull();
  });

  it("should return null for unknown KB", () => {
    expect(resolveKb("nonexistent-kb-" + Date.now())).toBeNull();
  });
});
