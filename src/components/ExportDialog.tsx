import React, { useState, useMemo } from "react";
import { Download, FileJson, FileSpreadsheet, CreditCard, ShieldAlert, FileText, Check } from "lucide-react";
import { CardWithRelationships } from "../types";

interface ExportDialogProps {
  cards: CardWithRelationships[];
  onLogAudit: (action: string, detail: any) => void;
  onClose: () => void;
}

const exportFields = [
  { id: "full_name", label: "Ad Soyad" },
  { id: "title", label: "Ünvan / Rol" },
  { id: "company", label: "Şirket / Kurum" },
  { id: "department", label: "Departman" },
  { id: "email", label: "E-Posta" },
  { id: "phone", label: "Telefon" },
  { id: "mobile_phone", label: "Cep Telefonu" },
  { id: "website", label: "Web Sitesi" },
  { id: "address", label: "Fiziki Adres" },
  { id: "city", label: "Şehir" },
  { id: "country", label: "Ülke" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "notes", label: "Notlar" }
];

export default function ExportDialog({ cards, onLogAudit, onClose }: ExportDialogProps) {
  const [selectedFields, setSelectedFields] = useState<string[]>(exportFields.map(f => f.id));
  const [exportFormat, setExportFormat] = useState<"csv" | "json" | "vcf" | "pdf">("csv");
  const [isExporting, setIsExporting] = useState(false);

  // Kapsam: tümü / belirli şirket / belirli kategori (etiket). Filtreleme istemcide.
  const [scope, setScope] = useState<"all" | "company" | "category">("all");
  const [companyFilter, setCompanyFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  // Kartlardan benzersiz şirket ve kategori listelerini türet.
  const companies = useMemo(
    () => Array.from(new Set(cards.map(c => c.contact?.company).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, "tr")),
    [cards]
  );
  const categories = useMemo(() => {
    const map = new Map<string, string>();
    cards.forEach(c => (c.tags || []).forEach(t => { if (t?.id) map.set(t.id, t.name); }));
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  }, [cards]);

  // Seçilen kapsama göre dışa aktarılacak kartlar.
  const targetCards = useMemo(() => {
    if (scope === "company") return companyFilter ? cards.filter(c => c.contact?.company === companyFilter) : [];
    if (scope === "category") return categoryFilter ? cards.filter(c => (c.tags || []).some(t => t.id === categoryFilter)) : [];
    return cards;
  }, [cards, scope, companyFilter, categoryFilter]);
  const [exportedFile, setExportedFile] = useState<{
    filename: string;
    content?: string;
    base64Content?: string;
    mimeType: string;
    isBase64?: boolean;
    downloadUrl?: string;
  } | null>(null);

  const toggleField = (fieldId: string) => {
    setSelectedFields(prev => 
      prev.includes(fieldId) ? prev.filter(f => f !== fieldId) : [...prev, fieldId]
    );
  };

  const handleSelectAll = () => {
    setSelectedFields(exportFields.map(f => f.id));
  };

  const handleSelectNone = () => {
    setSelectedFields([]);
  };

  const executeServerExport = async () => {
    setIsExporting(true);
    onLogAudit("EXPORT_PREPARATION_STARTED", {
      format: exportFormat, itemsCount: targetCards.length,
      scope, company: scope === "company" ? companyFilter : undefined,
      category: scope === "category" ? categoryFilter : undefined,
    });

    try {
      // Clean target IDs list (seçilen kapsama göre süzülmüş)
      const recordIds = targetCards.map(c => c.contact?.id).filter(Boolean);

      const response = await fetch(`/api/exports/${exportFormat}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedFields,
          recordIds
        })
      });

      const data = await response.json();
      if (response.ok) {
        setExportedFile({
          filename: data.filename,
          content: data.content,
          base64Content: data.base64Content,
          mimeType: data.mimeType,
          isBase64: data.isBase64,
          downloadUrl: data.downloadUrl
        });
        onLogAudit("EXPORT_PREPARATION_COMPLETED_SUCCESS", { exportId: data.exportId });
      } else {
        alert(data.error || "Dışa aktarım API katmanı hatası.");
      }
    } catch (err) {
      console.error(err);
      alert("Sunucuya erişilemedi.");
    } finally {
      setIsExporting(false);
    }
  };

  const triggerBrowserDownload = () => {
    if (!exportedFile) return;

    const blobParts = exportedFile.isBase64 && exportedFile.base64Content
      ? [Uint8Array.from(atob(exportedFile.base64Content), c => c.charCodeAt(0))]
      : [exportedFile.content || ""];
    const blob = new Blob(blobParts, { type: exportedFile.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportedFile.filename;
    link.click();
    
    URL.revokeObjectURL(url);
    onLogAudit("EXPORT_DOWNLOADED_TO_LOCAL", { filename: exportedFile.filename });
  };

  return (
    <div className="fixed inset-0 bg-[#080c14]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-6 shadow-2xl max-w-lg w-full relative">
        
        {/* Header */}
        <div className="flex justify-between items-start mb-4 pb-3 border-b border-[#1e293b]">
          <div>
            <h3 className="text-base font-semibold tracking-wide text-slate-200 font-display">
              GÜVENLİ DATA DIŞA AKTARIM (EXPORT)
            </h3>
            <span className="text-[10px] font-mono text-[#94a3b8] uppercase">
              Dışa Aktarılacak Kayıt: {targetCards.length} Adet
              {scope === "company" && companyFilter ? ` · ${companyFilter}` : ""}
              {scope === "category" && categoryFilter ? ` · ${categories.find(c => c.id === categoryFilter)?.name || ""}` : ""}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-250 text-xs font-mono bg-[#080c14] border border-[#1e293b] px-2 py-1 rounded cursor-pointer hover:bg-[#0d1421]"
          >
            Kapat
          </button>
        </div>

        {exportedFile ? (
          // Success download prompt Screen
          <div className="py-5 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-950 border border-emerald-500/30 flex items-center justify-center mx-auto mb-2">
              <Check className="h-6 w-6 text-emerald-400" />
            </div>
            
            <h4 className="text-sm font-semibold text-slate-200">
              Veri Paketi Hazırlandı & Loglandı
            </h4>
            
            <p className="text-xs text-[#94a3b8] max-w-sm mx-auto leading-relaxed">
              İlgili işlem millî güvenlik protokolleri uyarınca denetim defterine (audit logs) <span className="text-[#1e40af] font-mono">EXPORT_DATA</span> etiketiyle kaydedildi.
            </p>

            <div className="bg-[#080c14] p-3 rounded border border-[#1e293b] text-left font-mono text-[10px] space-y-1 text-slate-350">
              <div><strong className="text-slate-500">Dosya Adı:</strong> {exportedFile.filename}</div>
              <div><strong className="text-slate-500">MIME Türü:</strong> {exportedFile.mimeType}</div>
              <div><strong className="text-slate-500">Durum:</strong> GÜVENLİ / MD5 LOGGED</div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setExportedFile(null); }}
                className="flex-1 bg-[#080c14] hover:bg-[#0d1421] border border-[#1e293b] text-slate-300 font-semibold py-2.5 rounded text-xs transition-colors cursor-pointer"
              >
                Yeni Export Yap
              </button>
              <button
                onClick={triggerBrowserDownload}
                className="flex-1 bg-[#1e40af] hover:bg-blue-700 text-white font-semibold py-2.5 rounded text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="h-4 w-4" />
                Dosyayı İndir
              </button>
            </div>
          </div>
        ) : (
          // Configure dialog Screen
          <div className="space-y-4">
            
            {/* Formats Selection */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-[#94a3b8] uppercase font-display block">Dışa Aktarım Formatı</label>
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => setExportFormat("csv")}
                  className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${
                    exportFormat === "csv"
                      ? "bg-[#1e40af]/30 border-[#1e40af] text-blue-300"
                      : "bg-[#080c14] border-[#1e293b] text-slate-400 hover:border-slate-700"
                  }`}
                >
                  <FileSpreadsheet className="h-5 w-5 mx-auto mb-1" />
                  <span className="text-[10px] font-bold font-mono">CSV</span>
                </button>

                <button
                  onClick={() => setExportFormat("json")}
                  className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${
                    exportFormat === "json"
                      ? "bg-[#1e40af]/30 border-[#1e40af] text-blue-300"
                      : "bg-[#080c14] border-[#1e293b] text-slate-400 hover:border-slate-700"
                  }`}
                >
                  <FileJson className="h-5 w-5 mx-auto mb-1" />
                  <span className="text-[10px] font-bold font-mono">JSON</span>
                </button>

                <button
                  onClick={() => setExportFormat("vcf")}
                  className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${
                    exportFormat === "vcf"
                      ? "bg-[#1e40af]/30 border-[#1e40af] text-blue-300"
                      : "bg-[#080c14] border-[#1e293b] text-slate-400 hover:border-slate-700"
                  }`}
                >
                  <CreditCard className="h-5 w-5 mx-auto mb-1" />
                  <span className="text-[10px] font-bold font-mono">vCard / VCF</span>
                </button>

                <button
                  onClick={() => setExportFormat("pdf")}
                  className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${
                    exportFormat === "pdf"
                      ? "bg-[#1e40af]/30 border-[#1e40af] text-blue-300"
                      : "bg-[#080c14] border-[#1e293b] text-slate-400 hover:border-slate-700"
                  }`}
                >
                  <FileText className="h-5 w-5 mx-auto mb-1" />
                  <span className="text-[10px] font-bold font-mono">PDF REPORT</span>
                </button>
              </div>
            </div>

            {/* Kapsam Seçimi: tümü / şirket / kategori */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-[#94a3b8] uppercase font-display block">Kapsam — Kimleri Aktar?</label>
              <div className="grid grid-cols-3 gap-2">
                {([["all", "Tümü"], ["company", "Şirkete Göre"], ["category", "Kategoriye Göre"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setScope(val)}
                    className={`p-2 rounded-lg border text-center text-[10px] font-bold font-mono transition-all cursor-pointer ${
                      scope === val ? "bg-[#1e40af]/30 border-[#1e40af] text-blue-300" : "bg-[#080c14] border-[#1e293b] text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {scope === "company" && (
                <select
                  value={companyFilter}
                  onChange={e => setCompanyFilter(e.target.value)}
                  className="w-full bg-[#080c14] border border-[#1e293b] rounded text-xs text-slate-200 px-2 py-2 font-mono cursor-pointer"
                >
                  <option value="">— Şirket seçin ({companies.length} şirket) —</option>
                  {companies.map(co => <option key={co} value={co}>{co}</option>)}
                </select>
              )}
              {scope === "category" && (
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="w-full bg-[#080c14] border border-[#1e293b] rounded text-xs text-slate-200 px-2 py-2 font-mono cursor-pointer"
                >
                  <option value="">— Kategori seçin ({categories.length} kategori) —</option>
                  {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
              )}
            </div>

            {/* Fields Selection */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-bold text-[#94a3b8] uppercase font-display">Alanları Sınırla / Seç</label>
                <div className="flex gap-2">
                  <button onClick={handleSelectAll} className="text-[9px] font-mono text-blue-400 hover:underline cursor-pointer">Hepsini Seç</button>
                  <span className="text-slate-600 text-[9px] font-mono">|</span>
                  <button onClick={handleSelectNone} className="text-[9px] font-mono text-slate-500 hover:underline cursor-pointer">Temizle</button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 bg-[#080c14] p-3 rounded-lg border border-[#1e293b] max-h-[160px] overflow-y-auto w-full">
                {exportFields.map(field => {
                  const isChecked = selectedFields.includes(field.id);
                  return (
                    <button
                      key={field.id}
                      onClick={() => toggleField(field.id)}
                      className={`flex items-center gap-2 p-1.5 rounded text-left transition-colors text-[10px] font-mono cursor-pointer ${
                        isChecked ? "text-slate-200 bg-[#0d1421] border border-[#1e293b]" : "text-slate-500 hover:text-slate-450 border border-transparent"
                      }`}
                    >
                      <div className={`w-3 h-3 rounded flex items-center justify-center border text-[8px] ${
                        isChecked ? "border-[#1e40af] bg-[#1e40af] text-white" : "border-[#1e293b] bg-transparent"
                      }`}>
                        {isChecked && "✓"}
                      </div>
                      <span>{field.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-amber-955/20 p-3 rounded border border-amber-500/20 text-[10px] font-mono text-[#94a3b8] flex gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500 flex-shrink-0" />
              <span>
                <strong>Güvenlik Sorumluluğu & Denetim Beyanı:</strong> Bu dosya hassas askeri/kamu irtibat verileri içeriyor olabilir. Yapacağınız export işlemi kayıt altına alınacak ve isminizle sistem günlüğüne loglanacaktır.
              </span>
            </div>

            <button
              onClick={executeServerExport}
              disabled={selectedFields.length === 0 || isExporting || targetCards.length === 0}
              className="w-full bg-[#1e40af] hover:bg-blue-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs tracking-wider uppercase py-3 rounded transition-all flex items-center justify-center gap-2 font-display"
            >
              {isExporting
                ? "Dosya Paketleniyor..."
                : targetCards.length === 0
                ? (scope === "company" ? "Önce şirket seçin" : scope === "category" ? "Önce kategori seçin" : "Aktarılacak kayıt yok")
                : `Export Başlat (${targetCards.length} kayıt) & Log Kaydet`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
