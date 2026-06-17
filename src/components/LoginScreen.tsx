import React, { useState } from "react";
import { ShieldCheck, Lock, User as UserIcon, Loader2 } from "lucide-react";
import { User } from "../types";

interface LoginScreenProps {
  onAuthenticated: (user: User) => void;
}

export default function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Kullanıcı adı ve parola gereklidir.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        onAuthenticated(data.user);
      } else {
        setError(data.error || "Giriş başarısız.");
      }
    } catch {
      setError("Sunucuya erişilemedi. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#080c14] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Başlık */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-[#0d1421] border border-[#1e293b] flex items-center justify-center mx-auto mb-3 shadow-lg">
            <ShieldCheck className="h-7 w-7 text-[#1e40af]" />
          </div>
          <h1 className="text-lg font-bold text-slate-100 tracking-wide font-display">B-CIP</h1>
          <p className="text-[11px] text-[#94a3b8] font-mono mt-1">
            Kartvizit İstihbarat & Temas Yönetim Platformu
          </p>
        </div>

        {/* Form */}
        <form
          onSubmit={submit}
          className="bg-[#0d1421] border border-[#1e293b] rounded-xl p-6 shadow-2xl space-y-4"
        >
          <h2 className="text-sm font-semibold text-slate-200 font-display tracking-wide">
            Güvenli Giriş
          </h2>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#94a3b8] uppercase font-mono">Kullanıcı Adı</label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full bg-[#080c14] border border-[#1e293b] rounded-md text-sm text-slate-100 pl-9 pr-3 py-2.5 outline-none focus:border-[#1e40af] transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-[#94a3b8] uppercase font-mono">Parola</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#080c14] border border-[#1e293b] rounded-md text-sm text-slate-100 pl-9 pr-3 py-2.5 outline-none focus:border-[#1e40af] transition-colors"
              />
            </div>
          </div>

          {error && (
            <div className="text-[11px] text-red-300 bg-red-950/40 border border-red-500/30 rounded-md px-3 py-2 font-mono">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#1e40af] hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs tracking-wider uppercase py-3 rounded-md transition-all flex items-center justify-center gap-2 font-display cursor-pointer"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {loading ? "Doğrulanıyor..." : "Giriş Yap"}
          </button>
        </form>

        <p className="text-center text-[10px] text-slate-600 font-mono mt-4">
          İmzalı httpOnly oturum · RBAC · Audit log
        </p>
      </div>
    </div>
  );
}
