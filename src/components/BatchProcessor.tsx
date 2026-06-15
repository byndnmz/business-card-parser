import React, { useState } from "react";
import { Batch } from "../types";
import { ListChecks, Play, RefreshCw, Layers, CheckCircle, AlertTriangle, Clock } from "lucide-react";

interface BatchProcessorProps {
  batches: Batch[];
  onRetry: (batchId: string) => void;
  onLogAudit: (action: string, detail: any) => void;
  onBatchProcessed: () => void;
}

export default function BatchProcessor({
  batches,
  onRetry,
  onLogAudit,
  onBatchProcessed
}: BatchProcessorProps) {
  const [selectedBatchFiles, setSelectedBatchFiles] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [loadingBatchId, setLoadingBatchId] = useState<string | null>(null);

  // Simulated queue mapping
  const mockFilesQueue = [
    { id: "bf-1", filename: "ROKETSAN_Mühendis_Gök.jpg", status: "success", info: "Mustafa Demir eklendi. Confidence: 96%", company: "ROKETSAN" },
    { id: "bf-2", filename: "HAVELSAN_Selin_Yılmaz.png", status: "success", info: "Selin Gök eklendi. Confidence: 91%", company: "HAVELSAN" },
    { id: "bf-3", filename: "TUSAŞ_Bora_Aksoy.jpg", status: "success", info: "Bora Aksoy eklendi. Confidence: 98%", company: "TUSAŞ" },
    { id: "bf-4", filename: "MİLGEM_Deniz_Projeleri.pdf", status: "manual_review", info: "Düşük güvenle OCR'landı, doğrulama bekliyor.", company: "STM Savunma" }
  ];

  const handleSimulateBatchProcess = (batchId: string) => {
    setLoadingBatchId(batchId);
    onLogAudit("BATCH_PROCESS_SIMULATION_START", { batchId });
    
    setTimeout(() => {
      onRetry(batchId);
      onBatchProcessed();
      setSelectedBatchFiles(mockFilesQueue);
      setLoadingBatchId(null);
      onLogAudit("BATCH_PROCESS_SIMULATION_SUCCESS", { batchId });
    }, 1500);
  };

  return (
    <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 shadow-2xl">
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#1e293b]">
        <div className="flex items-center gap-1.5">
          <ListChecks className="h-5 w-5 text-[#1e40af]" />
          <h3 className="text-sm font-semibold tracking-wide text-slate-300 uppercase font-display">
            Toplu Kartvizit İşleme & Kuyruk Yönetimi
          </h3>
        </div>
        <span className="text-[10px] font-mono text-slate-500">
          Aktif Toplu Görev: {batches.length} Adet
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Batches Table List */}
        <div className="lg:col-span-5 space-y-3">
          <span className="text-[11px] font-bold text-[#94a3b8] uppercase font-display block">Toplu İşlem Paketleri</span>
          
          <div className="space-y-3">
            {batches.map((batch) => {
              const isWorking = loadingBatchId === batch.id;
              return (
                <div key={batch.id} className="bg-[#080c14] p-4 rounded-md border border-[#1e293b] flex flex-col justify-between hover:border-slate-700 transition-all">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="text-xs font-mono font-bold text-slate-300">{batch.id}</span>
                      <span className="text-[10px] text-[#94a3b8] block">Tarih: {new Date(batch.created_at).toLocaleString()}</span>
                    </div>
                    <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${
                      batch.status === "completed" 
                        ? "text-emerald-400 bg-emerald-950/40 border-emerald-500/20" 
                        : "text-amber-400 bg-amber-950/40 border-amber-500/20"
                    }`}>
                      {batch.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 bg-slate-900/60 p-2 rounded text-center mb-3">
                    <div>
                      <span className="text-[8px] text-slate-500 font-mono block uppercase">TOPLAM</span>
                      <span className="text-xs font-bold text-slate-300">{batch.total_files}</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-slate-500 font-mono block uppercase">BAŞARILI</span>
                      <span className="text-xs font-bold text-emerald-400">{batch.processed_files}</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-slate-500 font-mono block uppercase">HATALI</span>
                      <span className="text-xs font-bold text-rose-400">{batch.failed_files}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedBatchFiles(mockFilesQueue)}
                      className="flex-1 bg-[#0d1421] hover:bg-[#080c14] text-slate-300 py-1.5 px-2.5 rounded text-[10px] font-semibold border border-[#1e293b] transition-colors cursor-pointer"
                    >
                      Kuyruğu Göster ({batch.total_files})
                    </button>
                    <button
                      onClick={() => handleSimulateBatchProcess(batch.id)}
                      disabled={isWorking}
                      className="bg-[#1e40af] hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-1.5 px-3 rounded text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      {isWorking ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      <span>İşlet</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Batch Files Detail progress */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-bold text-slate-400 uppercase font-display block">
              Paket Detayları & Dosya Ayrıştırma Durumları
            </span>
            <div className="flex bg-[#080c14] p-0.5 rounded border border-[#1e293b]">
              <button
                onClick={() => setActiveTab("all")}
                className={`text-[9px] font-mono px-2 py-0.5 rounded transition-all cursor-pointer ${activeTab === "all" ? "bg-[#0d1421] text-white font-semibold" : "text-slate-500"}`}
              >
                HEPSİ
              </button>
              <button
                onClick={() => setActiveTab("success")}
                className={`text-[9px] font-mono px-2 py-0.5 rounded transition-all cursor-pointer ${activeTab === "success" ? "bg-[#0d1421] text-white font-semibold" : "text-slate-500"}`}
              >
                BAŞARILI
              </button>
              <button
                onClick={() => setActiveTab("pending")}
                className={`text-[9px] font-mono px-2 py-0.5 rounded transition-all cursor-pointer ${activeTab === "pending" ? "bg-[#0d1421] text-white font-semibold" : "text-slate-500"}`}
              >
                MONİTÖR
              </button>
            </div>
          </div>

          <div className="bg-[#080c14] border border-[#1e293b] rounded-md p-3 max-h-[340px] overflow-y-auto space-y-2">
            {selectedBatchFiles.length > 0 ? (
              selectedBatchFiles
                .filter(f => activeTab === "all" || (activeTab === "success" && f.status === "success") || (activeTab === "pending" && f.status !== "success"))
                .map((file) => (
                  <div key={file.id} className="p-2.5 rounded bg-[#0d1421] border border-[#1e293b] flex justify-between items-center hover:border-slate-700 transition-all">
                    <div className="flex items-center gap-3">
                      {file.status === "success" ? (
                        <CheckCircle className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                      ) : file.status === "processing" ? (
                        <Clock className="h-4 w-4 text-amber-400 animate-spin flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                      )}
                      
                      <div>
                        <span className="text-xs font-semibold text-slate-300 block">{file.filename}</span>
                        <span className="text-[10px] text-[#94a3b8] font-mono block">{file.info}</span>
                      </div>
                    </div>

                    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                      file.status === "success" 
                        ? "text-emerald-400 border-emerald-900 bg-emerald-950/20" 
                        : "text-amber-400 border-amber-900 bg-amber-950/20"
                    }`}>
                      {file.company}
                    </span>
                  </div>
                ))
            ) : (
              <div className="text-center py-12 text-slate-500 text-xs italic">
                Sol kısımdan bir toplu paketin "Kuyruğu Göster" düğmesine basarak detayları inceleyebilirsiniz.
              </div>
            )}
          </div>
          
          <div className="bg-[#080c14] p-3 rounded border border-[#1e293b] text-[10px] font-mono text-[#94a3b8] leading-normal">
            <span className="text-yellow-400 font-bold block mb-0.5">Yapay Zekâ Duplicate Algılayıcı (Tekrarlı Kayıt Önleme):</span>
            Sistem toplu yükleme sırasında aynı isim ve e-posta adresine ait birden fazla kart saptadığında bunları otomatik birleştirir veya "Tekrarlı Kayıt" uyarısıyla el ile doğrulamaya düşürür.
          </div>
        </div>

      </div>
    </div>
  );
}
