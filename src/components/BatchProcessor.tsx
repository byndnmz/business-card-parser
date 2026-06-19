import React, { useRef, useState } from "react";
import { Batch } from "../types";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Layers,
  ListChecks,
  Play,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import { prepareImageForUpload, type PreparedUpload } from "../client/upload-prep";

interface BatchProcessorProps {
  batches: Batch[];
  onRetry: (batchId: string) => void | Promise<void>;
  onLogAudit: (action: string, detail: any) => void;
  onBatchProcessed: () => void | Promise<void>;
}

type BatchFileRow = {
  id: string;
  filename: string;
  status: "success" | "manual_review" | "failed" | "processing";
  info: string;
  company: string;
};

function rowFromProcessed(item: any): BatchFileRow {
  const card = item.card || {};
  const contact = item.contact || {};
  const needsReview = card.processing_status === "manual_review";
  const confidence = Math.round((card.confidence_score || 0) * 100);
  const duplicate = item.duplicateOf ? " Duplicate supheli." : "";
  return {
    id: card.id || `processed-${Math.random()}`,
    filename: card.original_filename || `${contact.full_name || "isimsiz-kart"}.jpg`,
    status: needsReview ? "manual_review" : "success",
    info: `${contact.full_name || "Isimsiz kayit"} eklendi. Confidence: ${confidence}%.${duplicate}`,
    company: contact.company || "KURUM YOK",
  };
}

function rowFromFailure(failure: any, index: number): BatchFileRow {
  return {
    id: `failure-${index}-${failure.filename || "file"}`,
    filename: failure.filename || "isimsiz-dosya",
    status: "failed",
    info: failure.error || "Dosya islenemedi.",
    company: "HATA",
  };
}

export default function BatchProcessor({
  batches,
  onRetry,
  onLogAudit,
  onBatchProcessed,
}: BatchProcessorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedBatchFiles, setSelectedBatchFiles] = useState<BatchFileRow[]>([]);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [loadingBatchId, setLoadingBatchId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const handleBatchUploadV2 = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > 50) {
      alert("Toplu islemde en fazla 50 dosya yuklenebilir.");
      return;
    }

    setLoadingBatchId("new");
    const rows: BatchFileRow[] = files.map((file, index) => ({
      id: `pending-${index}`,
      filename: file.name,
      status: "processing",
      info: "Dosya siraya alindi.",
      company: "OCR",
    }));
    setSelectedBatchFiles(rows);
    setStatusMessage(`${files.length} dosya OCR kuyruguna aliniyor...`);
    onLogAudit("BATCH_UPLOAD_STARTED", { count: files.length });

    try {
      const createResponse = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ total_files: files.length }),
      });
      const createData = await createResponse.json();
      if (!createResponse.ok || !createData.batch?.id) {
        throw new Error(createData.error || "Batch olusturulamadi.");
      }
      const batchId = createData.batch.id;
      let processed = 0;
      let failed = 0;

      const updateRow = (index: number, row: BatchFileRow) => {
        rows[index] = row;
        setSelectedBatchFiles([...rows]);
      };

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        updateRow(index, {
          id: `preparing-${index}`,
          filename: file.name,
          status: "processing",
          info: "Gorsel hazirlaniyor ve sikistiriliyor.",
          company: "OCR",
        });

        let prepared: PreparedUpload;
        try {
          prepared = await prepareImageForUpload(file);
        } catch (error: any) {
          try {
            await fetch(`/api/batches/${batchId}/items`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ file: { filename: file.name, imageBase64: "" } }),
            });
          } catch {
            // Batch sayaci bildirilemezse UI yine dosya bazli hatayi gosterir.
          }
          failed += 1;
          updateRow(index, {
            id: `failed-${index}`,
            filename: file.name,
            status: "failed",
            info: error?.message || "Gorsel hazirlanamadi.",
            company: "HATA",
          });
          setStatusMessage(`${processed}/${files.length} dosya islendi, ${failed} hata.`);
          continue;
        }

        updateRow(index, {
          id: `processing-${index}`,
          filename: prepared.filename,
          status: "processing",
          info: "RapidOCR ile isleniyor.",
          company: "OCR",
        });

        const response = await fetch(`/api/batches/${batchId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file: {
              filename: prepared.filename,
              mimeType: prepared.mimeType,
              imageHash: prepared.imageHash,
              originalBytes: prepared.originalBytes,
              processedBytes: prepared.processedBytes,
              imageBase64: prepared.base64,
            },
          }),
        });
        const data = await response.json();
        if (response.ok && data.processed) {
          processed += 1;
          updateRow(index, rowFromProcessed(data.processed));
        } else {
          failed += 1;
          updateRow(index, rowFromFailure(data.failure || { filename: prepared.filename, error: data.error }, index));
        }
        setStatusMessage(`${processed}/${files.length} dosya islendi, ${failed} hata.`);
      }

      onLogAudit("BATCH_UPLOAD_COMPLETED", { batchId, processed, failed });
      await onBatchProcessed();
    } catch (error: any) {
      console.error(error);
      setStatusMessage(error?.message || "Toplu islem tamamlanamadi.");
    } finally {
      setLoadingBatchId(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleBatchUpload = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > 50) {
      alert("Toplu islemde en fazla 50 dosya yuklenebilir.");
      return;
    }

    setLoadingBatchId("new");
    setStatusMessage(`${files.length} dosya OCR kuyruğuna alınıyor...`);
    setSelectedBatchFiles(files.map((file, index) => ({
      id: `pending-${index}`,
      filename: file.name,
      status: "processing",
      info: "Dosya okunuyor ve sunucuya hazirlaniyor.",
      company: "OCR",
    })));
    onLogAudit("BATCH_UPLOAD_STARTED", { count: files.length });

    try {
      const preparedFiles = await Promise.all(files.map((file) => prepareImageForUpload(file)));
      const payloadFiles = preparedFiles.map((prepared) => ({
        filename: prepared.filename,
        mimeType: prepared.mimeType,
        imageHash: prepared.imageHash,
        originalBytes: prepared.originalBytes,
        processedBytes: prepared.processedBytes,
        imageBase64: prepared.base64,
      }));

      setSelectedBatchFiles(files.map((file, index) => ({
        id: `processing-${index}`,
        filename: file.name,
        status: "processing",
        info: "RapidOCR ile isleniyor.",
        company: "OCR",
      })));

      const response = await fetch("/api/cards/batch-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payloadFiles }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Toplu islem API hatasi.");
      }

      const rows = [
        ...(data.processed || []).map(rowFromProcessed),
        ...(data.failures || []).map(rowFromFailure),
      ];
      setSelectedBatchFiles(rows);
      setStatusMessage(
        `${data.batch.processed_files}/${data.batch.total_files} dosya işlendi, ${data.batch.failed_files} hata.`
      );
      onLogAudit("BATCH_UPLOAD_COMPLETED", {
        batchId: data.batch.id,
        processed: data.batch.processed_files,
        failed: data.batch.failed_files,
      });
      await onBatchProcessed();
    } catch (error: any) {
      console.error(error);
      setStatusMessage(error?.message || "Toplu islem tamamlanamadi.");
      setSelectedBatchFiles(files.map((file, index) => ({
        id: `failed-${index}`,
        filename: file.name,
        status: "failed",
        info: error?.message || "Sunucuya ulasilamadi.",
        company: "HATA",
      })));
    } finally {
      setLoadingBatchId(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const loadBatchDetails = async (batchId: string) => {
    setLoadingBatchId(batchId);
    setStatusMessage("Batch detaylari yukleniyor...");
    try {
      const response = await fetch(`/api/batches/${batchId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Batch detayi alinamadi.");
      setSelectedBatchFiles(data.files || []);
      setStatusMessage(`${batchId} icin ${data.files?.length || 0} dosya detayi listelendi.`);
    } catch (error: any) {
      console.error(error);
      setStatusMessage(error?.message || "Batch detayi alinamadi.");
    } finally {
      setLoadingBatchId(null);
    }
  };

  const retryBatch = async (batchId: string) => {
    setLoadingBatchId(batchId);
    try {
      await onRetry(batchId);
      await onBatchProcessed();
      await loadBatchDetails(batchId);
      onLogAudit("BATCH_RETRY_COMPLETED", { batchId });
    } finally {
      setLoadingBatchId(null);
    }
  };

  const visibleRows = selectedBatchFiles.filter(file =>
    activeTab === "all" ||
    (activeTab === "success" && file.status === "success") ||
    (activeTab === "pending" && file.status !== "success")
  );

  return (
    <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 shadow-2xl">
      <div className="flex flex-col gap-4 mb-4 pb-3 border-b border-[#1e293b] md:flex-row md:items-center md:justify-between">
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

      <div className="mb-5 rounded-md border border-[#1e293b] bg-[#080c14] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-[#0d1421] border border-[#1e293b]">
              <Layers className="h-5 w-5 text-blue-300" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-200">Gerçek toplu OCR yükleme</div>
              <div className="text-[10px] font-mono text-[#94a3b8]">JPEG, PNG, WEBP, GIF veya PDF imzalı dosyalar. Maksimum 50 dosya.</div>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(event) => handleBatchUploadV2(event.target.files)}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={loadingBatchId !== null}
            className="bg-[#1e40af] hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            {loadingBatchId === "new" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Toplu Dosya Seç & İşle
          </button>
        </div>
        {statusMessage && (
          <div className="mt-3 text-[10px] font-mono text-[#94a3b8]">{statusMessage}</div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
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
                      onClick={() => loadBatchDetails(batch.id)}
                      disabled={isWorking}
                      className="flex-1 bg-[#0d1421] hover:bg-[#080c14] disabled:opacity-50 text-slate-300 py-1.5 px-2.5 rounded text-[10px] font-semibold border border-[#1e293b] transition-colors cursor-pointer"
                    >
                      Kuyruğu Göster ({batch.total_files})
                    </button>
                    <button
                      onClick={() => retryBatch(batch.id)}
                      disabled={isWorking}
                      className="bg-[#1e40af] hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-1.5 px-3 rounded text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      {isWorking ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      <span>Retry</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

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
            {visibleRows.length > 0 ? (
              visibleRows.map((file) => (
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
                      : file.status === "failed"
                      ? "text-rose-400 border-rose-900 bg-rose-950/20"
                      : "text-amber-400 border-amber-900 bg-amber-950/20"
                  }`}>
                    {file.company}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-center py-12 text-slate-500 text-xs italic">
                Toplu dosya seçerek gerçek OCR kuyruğu oluşturabilir veya soldan bir batch detayını açabilirsiniz.
              </div>
            )}
          </div>

          <div className="bg-[#080c14] p-3 rounded border border-[#1e293b] text-[10px] font-mono text-[#94a3b8] leading-normal">
            <span className="text-yellow-400 font-bold block mb-0.5">Duplicate Algılayıcı:</span>
            Toplu yüklemede aynı e-posta, telefon veya ad+şirket eşleşmesi yakalanırsa kayıt manuel kontrole düşer; başarısız dosyalar diğer dosyaların işlenmesini durdurmaz.
          </div>
        </div>
      </div>
    </div>
  );
}
