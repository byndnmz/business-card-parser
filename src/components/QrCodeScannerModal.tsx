import React, { useRef, useEffect, useState } from "react";
import jsQR from "jsqr";
import { Camera, X, RefreshCw, AlertCircle, Sparkles, Shield } from "lucide-react";

interface QrCodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (decodedData: any) => void;
}

export default function QrCodeScannerModal({
  isOpen,
  onClose,
  onScanSuccess
}: QrCodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [activeDevice, setActiveDevice] = useState<string>("");
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (isOpen) {
      requestCameraAccess();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, activeDevice]);

  // Request camera and list available devices
  async function requestCameraAccess() {
    setErrorMessage("");
    try {
      // Get exact device constraints
      const constraints: MediaStreamConstraints = {
        video: activeDevice
          ? { deviceId: { exact: activeDevice } }
          : { facingMode: "environment" }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setHasPermission(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true"); // required for iOS safari iframe
        videoRef.current.play();
        setIsScanning(true);
        animationRef.current = requestAnimationFrame(scanLoop);
      }

      // Enumerate cameras for manual toggle (front/back camera selection)
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === "videoinput");
      setAvailableCameras(videoDevices);
    } catch (err: any) {
      console.error("Camera access failed:", err);
      setHasPermission(false);
      setErrorMessage(
        err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "Kamera izni kullanıcı tarafından reddedildi. Lütfen tarayıcı ayarlarından kameraya izin verin."
          : `Kamera başlatılamadı: ${err.message || "Bilinmeyen Hata"}`
      );
    }
  }

  // Stop camera stream completely
  function stopCamera() {
    setIsScanning(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  // Switch to another camera device
  function handleDeviceChange(deviceId: string) {
    stopCamera();
    setActiveDevice(deviceId);
  }

  // Parse various QR content formats (vCard, JSON, Key-Value, Plaintext)
  function parseQrContent(data: string) {
    let parsed: any = {};
    const cleaned = data.trim();

    // 1. JSON structure
    if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
      try {
        const obj = JSON.parse(cleaned);
        parsed = {
          full_name: obj.full_name || obj.name || "",
          title: obj.title || "",
          company: obj.company || obj.org || "",
          department: obj.department || obj.dept || "",
          email: obj.email || "",
          phone: obj.phone || obj.tel || "",
          mobile_phone: obj.mobile_phone || obj.mobile || "",
          website: obj.website || obj.url || "",
          address: obj.address || obj.adr || "",
          city: obj.city || "",
          country: obj.country || "",
          linkedin: obj.linkedin || "",
          notes: obj.notes || obj.note || "QR Kod ile otomatik yüklenen JSON veri."
        };

        if (parsed.full_name) {
          const parts = parsed.full_name.split(" ");
          parsed.first_name = parts[0] || "";
          parsed.last_name = parts.slice(1).join(" ") || "";
        } else if (obj.first_name && obj.last_name) {
          parsed.first_name = obj.first_name;
          parsed.last_name = obj.last_name;
          parsed.full_name = `${obj.first_name} ${obj.last_name}`;
        }
        return parsed;
      } catch (e) {
        console.warn("QR JSON parse fallback", e);
      }
    }

    // 2. vCard format
    if (cleaned.toUpperCase().includes("BEGIN:VCARD")) {
      const lines = cleaned.split(/\r?\n/);
      lines.forEach(line => {
        const [keyPart, ...valParts] = line.split(":");
        if (!keyPart) return;
        const val = valParts.join(":").trim();
        const key = keyPart.toUpperCase();

        if (key.startsWith("FN")) {
          parsed.full_name = val;
        } else if (key.startsWith("N") && !key.startsWith("NOTE") && !parsed.full_name) {
          const parts = val.split(";");
          const lastName = parts[0] || "";
          const firstName = parts[1] || "";
          parsed.first_name = firstName;
          parsed.last_name = lastName;
          parsed.full_name = `${firstName} ${lastName}`.trim();
        } else if (key.startsWith("ORG")) {
          const parts = val.split(";");
          parsed.company = parts[0] || "";
          if (parts[1]) parsed.department = parts[1];
        } else if (key.startsWith("TITLE")) {
          parsed.title = val;
        } else if (key.startsWith("EMAIL")) {
          parsed.email = val;
        } else if (key.startsWith("TEL")) {
          if (key.includes("CELL") || key.includes("MOB")) {
            parsed.mobile_phone = val;
          } else {
            parsed.phone = val;
          }
        } else if (key.startsWith("ADR")) {
          const parts = val.split(";");
          const street = parts[2] || "";
          const city = parts[3] || "";
          const country = parts[6] || "";
          parsed.address = [street, city, country].filter(Boolean).join(", ");
          parsed.city = city;
          parsed.country = country;
        } else if (key.startsWith("NOTE")) {
          parsed.notes = val;
        } else if (key.startsWith("URL")) {
          if (val.toLowerCase().includes("linkedin.com")) {
            parsed.linkedin = val;
          } else {
            parsed.website = val;
          }
        }
      });

      if (parsed.full_name && !parsed.first_name) {
        const parts = parsed.full_name.split(" ");
        parsed.first_name = parts[0] || "";
        parsed.last_name = parts.slice(1).join(" ") || "";
      }
      if (!parsed.notes) parsed.notes = "QR vCard formatı ile alındı.";
      return parsed;
    }

    // 3. Simple line-by-line key-value pairs
    const lines = cleaned.split(/\r?\n/);
    let parsedAny = false;
    lines.forEach(line => {
      if (line.includes(":")) {
        const [k, ...vParts] = line.split(":");
        if (!k) return;
        const key = k.trim().toLowerCase();
        const val = vParts.join(":").trim();

        if (["ad", "isim", "name", "fullname", "full_name"].includes(key)) {
          parsed.full_name = val;
          parsedAny = true;
        } else if (["soyad", "lastname", "last_name"].includes(key)) {
          parsed.last_name = val;
          parsedAny = true;
        } else if (["eposta", "email", "mail"].includes(key)) {
          parsed.email = val;
          parsedAny = true;
        } else if (["tel", "telefon", "phone", "gsm"].includes(key)) {
          parsed.phone = val;
          parsedAny = true;
        } else if (["mobil", "mobile_phone", "mobile"].includes(key)) {
          parsed.mobile_phone = val;
          parsedAny = true;
        } else if (["sirket", "company", "firm", "org"].includes(key)) {
          parsed.company = val;
          parsedAny = true;
        } else if (["unvan", "title", "position"].includes(key)) {
          parsed.title = val;
          parsedAny = true;
        } else if (["departman", "dept", "department"].includes(key)) {
          parsed.department = val;
          parsedAny = true;
        } else if (["sehir", "city"].includes(key)) {
          parsed.city = val;
          parsedAny = true;
        } else if (["ülke", "ulke", "country"].includes(key)) {
          parsed.country = val;
          parsedAny = true;
        } else if (["linkedin"].includes(key)) {
          parsed.linkedin = val;
          parsedAny = true;
        } else if (["not", "notes", "note"].includes(key)) {
          parsed.notes = val;
          parsedAny = true;
        }
      }
    });

    if (parsedAny) {
      if (parsed.full_name && !parsed.first_name) {
        const parts = parsed.full_name.split(" ");
        parsed.first_name = parts[0] || "";
        parsed.last_name = parts.slice(1).join(" ") || "";
      }
      return parsed;
    }

    // 4. Default raw plaintext fallback
    const parts = cleaned.split(" ");
    parsed.full_name = cleaned;
    parsed.first_name = parts[0] || "";
    parsed.last_name = parts.slice(1).join(" ") || "";
    parsed.notes = "Düz metin QR kod verisi.";
    return parsed;
  }

  // Tactical scan buzzer audio logic directly generated via Web Audio API 
  function playBeepSound() {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // High pitch notification freq (A5)
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.12); // Beep duration 120ms
    } catch (e) {
      console.warn("Beep buzzer failure:", e);
    }
  }

  // Core capture frame scan verification loop 
  function scanLoop() {
    if (!videoRef.current || !canvasRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
      animationRef.current = requestAnimationFrame(scanLoop);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    if (ctx) {
      // Stream size matching
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert"
      });

      if (code && code.data) {
        // Success match decoded data!
        playBeepSound();
        const parsedContact = parseQrContent(code.data);
        onScanSuccess(parsedContact);
        stopCamera();
        onClose();
        return;
      }
    }

    animationRef.current = requestAnimationFrame(scanLoop);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-[#080c14]/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1421] border border-[#1e293b] rounded-xl p-6 shadow-2xl max-w-md w-full relative overflow-hidden animate-fade">
        
        {/* Glow Decorator Top */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#1e40af] to-transparent"></div>

        {/* Header */}
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#1e293b]">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-[#1e40af]" />
            <h3 className="text-sm font-semibold tracking-wide text-slate-200 font-display uppercase">
              Taktik QR Kod Okuyucu Vizörü
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white bg-[#080c14] border border-[#1e293b] p-1.5 rounded cursor-pointer transition-all"
            id="qr-close-btn"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Video Canvas Vizör Stage */}
        <div className="relative aspect-video w-full rounded-lg bg-[#080c14] border border-[#1e293b] overflow-hidden flex items-center justify-center">
          {hasPermission === true && (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Laser Beam Visual Scan Effect */}
              {isScanning && (
                <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
                  {/* Outer boundaries border brackets */}
                  <div className="absolute inset-8 border-2 border-dashed border-[#1e40af]/30 rounded-md"></div>
                  
                  {/* Laser line moving loop */}
                  <div className="w-full h-[2px] bg-cyan-400 shadow-[0_0_10px_#22d3ee] opacity-80 animate-[bounce_2.5s_infinite] absolute left-0"></div>
                  
                  <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[9px] font-mono tracking-widest text-cyan-400 bg-[#0d1421]/90 px-2 py-0.5 rounded border border-cyan-500/20 uppercase font-bold animate-pulse">
                    Optik Vizör Aktif // Okunuyor...
                  </span>
                </div>
              )}
            </>
          )}

          {hasPermission === null && (
            <div className="text-center p-6 space-y-2">
              <RefreshCw className="h-8 w-8 text-[#1e40af] mx-auto animate-spin" />
              <p className="text-xs text-slate-400 font-mono">Kamera erişimi doğrulanıyor...</p>
            </div>
          )}

          {hasPermission === false && (
            <div className="text-center p-6 space-y-3 max-w-xs">
              <AlertCircle className="h-10 w-10 text-red-500 mx-auto" />
              <p className="text-xs text-slate-400 leading-normal font-mono">{errorMessage}</p>
              <button
                onClick={requestCameraAccess}
                className="text-[10px] font-mono font-bold bg-[#1e40af] hover:bg-blue-700 text-white px-3 py-1.5 rounded cursor-pointer transition-all"
              >
                Kamerayı Yeniden Dene
              </button>
            </div>
          )}
        </div>

        {/* Camera device toggle footer */}
        {hasPermission === true && availableCameras.length > 1 && (
          <div className="mt-3 flex items-center gap-1.5 bg-[#080c14] border border-[#1e293b] p-2 rounded">
            <span className="text-[9px] font-mono text-slate-500 uppercase font-bold">Kamera Değiştir:</span>
            <select
              className="bg-[#0d1421] text-[10px] text-slate-350 border border-transparent rounded px-1.5 py-0.5 focus:outline-none flex-1 cursor-pointer font-mono"
              onChange={(e) => handleDeviceChange(e.target.value)}
              value={activeDevice}
            >
              {availableCameras.map(cam => (
                <option key={cam.deviceId} value={cam.deviceId}>
                  {cam.label || `Kamera ${availableCameras.indexOf(cam) + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Security Declaration Clause */}
        <div className="mt-4 p-3 bg-[#080c14]/40 border border-[#1e293b]/60 rounded-lg flex gap-2">
          <Shield className="h-4 w-4 text-[#1e40af] mt-0.5 flex-shrink-0" />
          <span className="text-[10px] font-mono text-[#94a3b8] leading-relaxed">
            <strong>B-CIP Optik Sertifikası:</strong> Taratılan QR kod içerikleri yalnızca tarayıcı arayüzünüzde çözümlenerek VerifyForm'a aktarılır. Hiçbir harici API'ye veya yabancı sunucuya gönderilmez.
          </span>
        </div>
      </div>
    </div>
  );
}
