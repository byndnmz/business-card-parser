import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";

let sidecarProcess: ChildProcess | null = null;

function rapidOcrUrl(): URL | null {
  try {
    return new URL(process.env.RAPIDOCR_SERVICE_URL || "http://127.0.0.1:8765");
  } catch {
    return null;
  }
}

function isLocalUrl(url: URL): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
}

async function healthOk(url: URL, timeoutMs = 1200): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.origin}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function pythonCandidates(): string[] {
  const serviceDir = path.join(process.cwd(), "ocr-service");
  return [
    process.env.OCR_SIDECAR_PYTHON || "",
    process.env.PYTHON_BIN || "",
    path.join(serviceDir, ".venv", "Scripts", "python.exe"),
    path.join(serviceDir, ".venv", "bin", "python"),
    "python",
    "python3",
  ].filter(Boolean);
}

function pickPython(): string | null {
  for (const candidate of pythonCandidates()) {
    if (candidate === "python" || candidate === "python3" || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function installShutdownHooks(child: ChildProcess) {
  const stop = () => {
    if (!child.killed) child.kill();
  };
  process.once("exit", stop);
  process.once("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    stop();
    process.exit(143);
  });
}

export async function ensureRapidOcrSidecar(): Promise<void> {
  const provider = (process.env.OCR_PROVIDER || "rapidocr").toLowerCase();
  if (provider !== "rapidocr") return;
  if (process.env.RAPIDOCR_AUTOSTART === "false") return;

  const url = rapidOcrUrl();
  if (!url || !isLocalUrl(url)) return;

  if (await healthOk(url)) {
    console.log(`[RAPIDOCR] Sidecar hazır: ${url.origin}`);
    return;
  }

  if (process.env.NODE_ENV === "production") {
    console.warn(`[RAPIDOCR] Sidecar'a ulaşılamadı: ${url.origin}. Üretimde start.sh veya ayrı servis başlatmalı.`);
    return;
  }

  const serviceDir = path.join(process.cwd(), "ocr-service");
  const appPath = path.join(serviceDir, "app.py");
  const python = pickPython();
  if (!python || !fs.existsSync(appPath)) {
    console.warn("[RAPIDOCR] Sidecar otomatik başlatılamadı: Python veya ocr-service/app.py bulunamadı.");
    return;
  }

  const out = fs.openSync(path.join(serviceDir, "sidecar.out.log"), "a");
  const err = fs.openSync(path.join(serviceDir, "sidecar.err.log"), "a");
  const port = url.port || "8765";

  sidecarProcess = spawn(python, [appPath], {
    cwd: serviceDir,
    env: { ...process.env, OCR_SIDECAR_PORT: port },
    stdio: ["ignore", out, err],
    windowsHide: true,
  });
  installShutdownHooks(sidecarProcess);

  console.log(`[RAPIDOCR] Sidecar başlatıldı (pid=${sidecarProcess.pid}, port=${port}).`);
  const timeoutMs = Number(process.env.RAPIDOCR_STARTUP_TIMEOUT_MS || 30_000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOk(url, 2000)) {
      console.log(`[RAPIDOCR] Sidecar hazır: ${url.origin}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.warn(`[RAPIDOCR] Sidecar ${timeoutMs}ms içinde hazır olmadı. Log: ocr-service/sidecar.err.log`);
}
