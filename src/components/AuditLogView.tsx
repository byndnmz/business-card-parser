import React, { useState } from "react";
import { AuditLog } from "../types";
import { ShieldCheck, Search, Filter, RefreshCw, Eye, FileLock2, Loader2 } from "lucide-react";

interface AuditLogViewProps {
  logs: AuditLog[];
  onRefresh: () => void;
}

export default function AuditLogView({ logs, onRefresh }: AuditLogViewProps) {
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("all");
  const [selectedDetailedLog, setSelectedDetailedLog] = useState<AuditLog | null>(null);
  const [chainStatus, setChainStatus] = useState<{ ok: boolean; total: number; brokenAt?: any } | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Kurcalama-kanıtı denetim zincirini sunucuda kriptografik olarak doğrula.
  const verifyChainIntegrity = async () => {
    setVerifying(true);
    setChainStatus(null);
    try {
      const res = await fetch("/api/admin/audit-logs/verify");
      const data = await res.json();
      setChainStatus(data);
    } catch (e) {
      console.error(e);
      setChainStatus({ ok: false, total: 0, brokenAt: { reason: "Sunucuya ulaşılamadı" } });
    } finally {
      setVerifying(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.user_id.toLowerCase().includes(search.toLowerCase()) ||
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      log.entity_type.toLowerCase().includes(search.toLowerCase()) ||
      log.ip_address.includes(search);
      
    const matchesAction = filterAction === "all" || log.action === filterAction;
    return matchesSearch && matchesAction;
  });

  const uniqueActions = ["all", ...Array.from(new Set(logs.map(l => l.action)))];

  return (
    <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 shadow-2xl space-y-5">
      <div className="flex justify-between items-center pb-3 border-b border-[#1e293b]">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-5 w-5 text-red-500" />
          <h3 className="text-sm font-semibold tracking-wide text-slate-300 uppercase font-display">
            Taktik Denetim Günlükleri & Güvenlik Defteri (Audit Logs)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {chainStatus && (
            <span
              className={`text-[9px] font-mono font-bold px-2 py-1 rounded border ${
                chainStatus.ok
                  ? "text-emerald-400 bg-emerald-950/40 border-emerald-500/30"
                  : "text-red-400 bg-red-950/40 border-red-500/30"
              }`}
              title={chainStatus.ok ? "" : `Kırılma: seq ${chainStatus.brokenAt?.seq} — ${chainStatus.brokenAt?.reason}`}
            >
              {chainStatus.ok
                ? `✓ ZİNCİR SAĞLAM (${chainStatus.total} KAYIT)`
                : `✗ KURCALAMA TESPİT EDİLDİ (seq ${chainStatus.brokenAt?.seq ?? "?"})`}
            </span>
          )}
          <button
            onClick={verifyChainIntegrity}
            disabled={verifying}
            className="flex items-center gap-1 text-[10px] bg-[#080c14] border border-[#1e40af]/40 text-[#1e40af] hover:text-blue-300 hover:border-[#1e40af] px-2.5 py-1.5 rounded transition-colors cursor-pointer disabled:opacity-50"
            title="Audit zincirini kriptografik olarak doğrula (SHA-256 hash-chain)"
          >
            {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileLock2 className="h-3 w-3" />}
            Zincir Bütünlüğü Doğrula
          </button>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1 text-[10px] bg-[#0d1421] border border-[#1e293b] text-slate-400 hover:text-slate-200 px-2.5 py-1.5 rounded transition-colors cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" /> Güncelle
          </button>
        </div>
      </div>

      {/* Query Bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-[#080c14] p-3 rounded-lg border border-[#1e293b]">
        <div className="md:col-span-8 relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            className="w-full bg-[#0d1421] text-xs text-slate-300 pl-9 pr-4 py-2 border border-[#1e293b] rounded focus:outline-none focus:border-[#1e40af]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kullanıcı ID, IP adresi, işlem tipi veya entite ara..."
          />
        </div>
        
        <div className="md:col-span-4 flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <select
            className="flex-1 bg-[#0d1421] text-xs text-slate-300 border border-[#1e293b] rounded p-2 focus:outline-none focus:border-[#1e40af] cursor-pointer"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          >
            {uniqueActions.map(action => (
              <option key={action} value={action}>
                {action === "all" ? "Tüm İşlemler" : action}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Log list Table */}
      <div className="overflow-x-auto rounded-lg border border-[#1e293b]">
        <table className="w-full text-left text-xs text-slate-300 font-mono">
          <thead className="bg-[#0d1421] text-[#94a3b8] border-b border-[#1e293b] text-[10px] tracking-wide uppercase">
            <tr>
              <th className="py-2.5 px-3">Tarih / Saat</th>
              <th className="py-2.5 px-3">Kullanıcı</th>
              <th className="py-2.5 px-3">Eylem Tipi</th>
              <th className="py-2.5 px-3">Entite</th>
              <th className="py-2.5 px-3">IP Adresi</th>
              <th className="py-2.5 px-3 text-right">Detaylar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e293b] bg-[#080c14]/40">
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-[#0d1421]/60 transition-colors">
                  <td className="py-3 px-3 text-[11px] text-slate-400">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 font-bold text-slate-350">{log.user_id}</td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded border text-[9px] font-bold ${
                      log.action.includes("FAILED") || log.action.includes("BLOCKED")
                        ? "text-red-400 bg-red-955/20 border-red-900/40"
                        : log.action.includes("EXPORT")
                        ? "text-amber-400 bg-amber-955/20 border-amber-900/40"
                        : "text-[#1e40af] bg-blue-955/20 border-blue-900/40"
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-slate-500">
                    {log.entity_type} ({log.entity_id})
                  </td>
                  <td className="py-3 px-3 text-slate-350">{log.ip_address}</td>
                  <td className="py-3 px-3 text-right">
                    <button
                      onClick={() => setSelectedDetailedLog(log)}
                      className="text-[#1040af] hover:text-[#1e40af] bg-[#080c14] border border-[#1e293b] p-1 rounded hover:bg-[#0d1421] transition-all font-sans text-[10px] cursor-pointer"
                    >
                      <Eye className="h-3 w-3 inline mr-1" /> İncele
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="text-center py-8 text-slate-500 italic font-sans text-xs">
                  Arama kriterlerinize uygun denetim kaydı bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* JSON comparison drawer modal */}
      {selectedDetailedLog && (
        <div className="fixed inset-0 bg-[#080c14]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 shadow-2xl max-w-2xl w-full">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#1e293b]">
              <span className="text-xs font-bold text-slate-300 font-mono">
                Log Defer No: {selectedDetailedLog.id}
              </span>
              <button
                onClick={() => setSelectedDetailedLog(null)}
                className="bg-[#080c14] border border-[#1e293b] text-slate-400 hover:text-slate-200 px-2 py-1 rounded text-xs font-mono cursor-pointer hover:bg-[#0d1421]"
              >
                Kapat
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-[10px] font-mono text-slate-400 bg-[#080c14] p-3 rounded border border-[#1e293b]">
                <div><strong>Kullanıcı:</strong> {selectedDetailedLog.user_id}</div>
                <div><strong>IP / Host:</strong> {selectedDetailedLog.ip_address}</div>
                <div><strong>Eylem:</strong> {selectedDetailedLog.action}</div>
                <div><strong>Tarih:</strong> {new Date(selectedDetailedLog.created_at).toLocaleString()}</div>
                <div className="col-span-2 overflow-x-auto"><strong>Cihaz (User Agent):</strong> {selectedDetailedLog.user_agent}</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                   <span className="text-[10px] text-slate-500 font-mono block mb-1">Önceki Değer (Old Value)</span>
                   <div className="bg-[#080c14] p-2 rounded border border-[#1e293b] h-[150px] overflow-auto text-[9px] font-mono text-rose-300 whitespace-pre">
                    {selectedDetailedLog.old_value ? JSON.stringify(JSON.parse(selectedDetailedLog.old_value), null, 2) : "BOŞ (NULL/INITIAL)"}
                  </div>
                </div>

                <div>
                   <span className="text-[10px] text-slate-500 font-mono block mb-1">Yeni Değer (New Value)</span>
                   <div className="bg-[#080c14] p-2 rounded border border-[#1e293b] h-[150px] overflow-auto text-[9px] font-mono text-emerald-350 whitespace-pre">
                    {selectedDetailedLog.new_value ? JSON.stringify(JSON.parse(selectedDetailedLog.new_value), null, 2) : "SİLİNDİ (SOFT-DELETED)"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
