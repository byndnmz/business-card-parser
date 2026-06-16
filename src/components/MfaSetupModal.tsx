import React, { useState } from "react";
import { ShieldCheck, X, KeyRound, Loader2, Copy, Check, AlertTriangle } from "lucide-react";

interface MfaSetupModalProps {
  isOpen: boolean;
  mfaEnabled: boolean;
  onClose: () => void;
  onVerified: () => void;
}

/**
 * Gerçek TOTP (RFC 6238) MFA kaydı. Sunucudan base32 sır + otpauth URI alır,
 * kullanıcı Authenticator uygulamasına ekler ve 6 haneli kodla doğrular.
 */
export default function MfaSetupModal({ isOpen, mfaEnabled, onClose, onVerified }: MfaSetupModalProps) {
  const [step, setStep] = useState<"intro" | "enroll" | "done">("intro");
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const startEnroll = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/enroll", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSecret(data.secret);
        setOtpauth(data.otpauth);
        setStep("enroll");
      } else {
        setError(data.error || "Kayıt başlatılamadı.");
      }
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError("6 haneli kodu girin.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStep("done");
        onVerified();
      } else {
        setError(data.error || "Kod doğrulanamadı.");
      }
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  };

  const copySecret = () => {
    navigator.clipboard?.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // base32 sırrı 4'lü gruplara ayırarak okunaklı göster
  const grouped = secret.replace(/(.{4})/g, "$1 ").trim();

  return (
    <div className="fixed inset-0 bg-[#080c14]/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-6 shadow-2xl max-w-md w-full">
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#1e293b]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase font-display">
              Çok Faktörlü Kimlik Doğrulama (TOTP)
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "intro" && (
          <div className="space-y-4">
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              {mfaEnabled
                ? "Hesabınızda TOTP MFA etkin. Yeni bir cihaza geçmek için kaydı yenileyebilirsiniz."
                : "Hesabınızı RFC 6238 zaman-tabanlı tek kullanımlık parola (Google Authenticator / Authy / Microsoft Authenticator) ile koruyun."}
            </p>
            <button
              onClick={startEnroll}
              disabled={busy}
              className="w-full bg-[#1e40af] hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs uppercase tracking-wider py-2.5 rounded flex items-center justify-center gap-2 cursor-pointer font-display"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {mfaEnabled ? "MFA Kaydını Yenile" : "MFA Kurulumunu Başlat"}
            </button>
            {error && <p className="text-[11px] text-red-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {error}</p>}
          </div>
        )}

        {step === "enroll" && (
          <div className="space-y-4">
            <ol className="text-[11px] text-[#94a3b8] leading-relaxed list-decimal pl-4 space-y-1">
              <li>Authenticator uygulamanızda "kurulum anahtarını elle gir" seçin.</li>
              <li>Aşağıdaki gizli anahtarı (Base32) girin, hesap: hesabınız, tür: zaman tabanlı.</li>
              <li>Uygulamadaki 6 haneli kodu girip doğrulayın.</li>
            </ol>

            <div className="bg-[#080c14] border border-[#1e293b] rounded p-3">
              <span className="text-[9px] text-slate-500 font-mono uppercase block mb-1">Gizli Anahtar (Base32)</span>
              <div className="flex items-center justify-between gap-2">
                <code className="text-xs text-emerald-300 font-mono tracking-wider break-all">{grouped}</code>
                <button onClick={copySecret} className="text-slate-400 hover:text-slate-200 shrink-0 cursor-pointer" title="Kopyala">
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <details className="text-[10px] text-slate-500 font-mono">
              <summary className="cursor-pointer hover:text-slate-300">otpauth:// URI (gelişmiş)</summary>
              <code className="block mt-1 break-all text-slate-400">{otpauth}</code>
            </details>

            <div>
              <span className="text-[10px] text-slate-500 font-mono uppercase block mb-1">Doğrulama Kodu</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full bg-[#080c14] text-center text-lg tracking-[0.5em] text-slate-100 border border-[#1e293b] rounded px-3 py-2 focus:outline-none focus:border-[#1e40af] font-mono"
              />
            </div>

            {error && <p className="text-[11px] text-red-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {error}</p>}

            <button
              onClick={verify}
              disabled={busy}
              className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-xs uppercase tracking-wider py-2.5 rounded flex items-center justify-center gap-2 cursor-pointer font-display"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Doğrula ve Etkinleştir
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center mx-auto">
              <Check className="h-6 w-6 text-emerald-400" />
            </div>
            <p className="text-xs text-slate-300 font-semibold">TOTP MFA başarıyla etkinleştirildi.</p>
            <p className="text-[11px] text-[#94a3b8]">Bundan sonra hassas işlemler için kimlik doğrulayıcınızdaki kodu kullanın.</p>
            <button
              onClick={onClose}
              className="w-full bg-[#1e40af] hover:bg-blue-700 text-white font-semibold text-xs uppercase tracking-wider py-2.5 rounded cursor-pointer font-display"
            >
              Kapat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
