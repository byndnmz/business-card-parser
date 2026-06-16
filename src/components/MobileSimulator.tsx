import React, { useState, useRef } from "react";
import { Smartphone, Camera, Image as ImageIcon, CheckCircle2, ShieldAlert, Sparkles, RefreshCw } from "lucide-react";

interface MobileSimulatorProps {
  onCardUploaded: (card: any) => void;
  onLogAudit: (action: string, detail: any) => void;
}

export default function MobileSimulator({ onCardUploaded, onLogAudit }: MobileSimulatorProps) {
  const [deviceOS, setDeviceOS] = useState<"ios" | "android">("ios");
  const [cameraActive, setCameraActive] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [qualityCheck, setQualityCheck] = useState<{ pass: boolean; score: number; feedback: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ready base64 templates for fast mock demonstration of defense sector
  const sampleCardImages = [
    {
      name: "ASELSAN_Kart.png",
      img: "https://images.unsplash.com/photo-1549465220-1a8b9238cd48?q=80&w=600&auto=format&fit=crop",
      isGov: true,
      feedback: "ASELSAN Tesis Giriş Kartviziti Tespit Edildi."
    },
    {
      name: "ROKETSAN_Mühendislik.jpg",
      img: "https://images.unsplash.com/photo-1516245834210-c4c142787335?q=80&w=600&auto=format&fit=crop",
      isGov: true,
      feedback: "ROKETSAN Elmadağ Sevk Sistemleri Kartı."
    },
    {
      name: "HAVELSAN_Direktör.jpg",
      img: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?q=80&w=600&auto=format&fit=crop",
      isGov: false,
      feedback: "Yüksek Görsel Kontrast ve Odak Saptandı."
    }
  ];

  const handleDeviceLoadImage = (imgUrl: string, name: string) => {
    onLogAudit("MOBILE_IMAGE_SELECTED", { name, os: deviceOS });
    setSelectedImage(imgUrl);
    setCameraActive(false);

    // Apply strict quality control check simulation (low lighting, blur metrics)
    const successRate = 0.82 + Math.random() * 0.16;
    const isQualityHigh = successRate > 0.85;
    setQualityCheck({
      pass: isQualityHigh,
      score: Math.round(successRate * 100),
      feedback: isQualityHigh 
        ? "Kalite Kontrol Başarılı: Yüksek çözünürlük, optik netlik ve yeterli kontrast saptandı." 
        : "Uyarı: Düşük kontrast veya hafif bulanıklık saptandı. Detaylı yapay zeka analizi önerilir."
    });
  };

  // Uzak örnek görsel URL'sini gerçek base64 verisine çevirir. Sunucu artık
  // dosya imzasını (magic-byte) doğruladığı için URL değil gerçek bayt göndeririz.
  const toBase64DataUrl = async (src: string): Promise<{ data: string; mime: string }> => {
    if (src.startsWith("data:")) {
      const mime = src.substring(5, src.indexOf(";")) || "image/jpeg";
      return { data: src.split(",")[1], mime };
    }
    const blob = await (await fetch(src)).blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return { data: dataUrl.split(",")[1], mime: blob.type || "image/jpeg" };
  };

  const executeUploadMock = async () => {
    if (!selectedImage) return;
    setUploading(true);
    onLogAudit("MOBILE_UPLOAD_REQUESTED", { os: deviceOS });

    try {
      // Görseli gerçek base64 baytlarına çevir (sunucu imzayı doğrular).
      const { data: imageData, mime } = await toBase64DataUrl(selectedImage);
      const response = await fetch("/api/cards/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: imageData,
          filename: `mobile_${deviceOS}_capture_${Date.now()}.jpg`,
          mimeType: mime,
          source: deviceOS
        })
      });

      const data = await response.json();
      if (response.ok) {
        onCardUploaded(data);
        onLogAudit("MOBILE_UPLOAD_SUCCESS", { cardId: data.card.id });
        setSelectedImage(null);
        setQualityCheck(null);
      } else {
        alert(data.error || "Mobil yükleme hatası.");
      }
    } catch (err) {
      console.error(err);
      alert("Sunucuya bağlanılamadı.");
    } finally {
      setUploading(false);
    }
  };

  const handleCustomFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        const base64 = event.target.result as string;
        handleDeviceLoadImage(base64, file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 shadow-2xl flex flex-col justify-between h-full">
      
      {/* OS selector */}
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#1e293b]">
        <div className="flex items-center gap-1.5">
          <Smartphone className="h-5 w-5 text-[#1e40af]" />
          <span className="text-sm font-semibold tracking-wide text-slate-300 font-display">Taktik Mobil Simülatör</span>
        </div>
        
        <div className="flex gap-1.5 bg-[#080c14] p-1 rounded border border-[#1e293b]">
          <button
            onClick={() => { setDeviceOS("ios"); onLogAudit("ROUTE_SWITCH_MOBILE", { to: "ios" }); }}
            className={`text-[10px] font-bold font-mono px-2.5 py-1 rounded transition-colors cursor-pointer ${
              deviceOS === "ios" ? "bg-[#0d1421] text-[#1e40af] border border-[#1e293b]" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            iOS APP
          </button>
          <button
            onClick={() => { setDeviceOS("android"); onLogAudit("ROUTE_SWITCH_MOBILE", { to: "android" }); }}
            className={`text-[10px] font-bold font-mono px-2.5 py-1 rounded transition-colors cursor-pointer ${
              deviceOS === "android" ? "bg-[#0d1421] text-teal-400 border border-[#1e293b]" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            ANDROID
          </button>
        </div>
      </div>

      {/* Simulator Device Frame */}
      <div className="relative mx-auto w-[290px] h-[520px] bg-[#080c14] rounded-[36px] border-[6px] border-[#1e293b] shadow-2xl flex flex-col overflow-hidden">
        
        {/* Notch / Speaker bar */}
        <div className="absolute top-0 inset-x-0 h-5 bg-[#1e293b] rounded-b-xl flex items-center justify-center z-30">
          <div className="w-16 h-1.5 bg-[#080c14] rounded-full"></div>
        </div>

        {/* Dynamic Screen Content */}
        <div className="flex-1 p-4 pt-7 flex flex-col justify-between h-full relative">
          
          {/* Virtual OS Status Header */}
          <div className="flex justify-between items-center text-[9px] font-mono font-bold text-slate-400 mb-2 select-none">
            <span>09:21 AM</span>
            <div className="flex items-center gap-1">
              <span className="text-[7px] text-emerald-400 bg-emerald-900/40 border border-emerald-500/20 px-1 py-0.2 rounded font-sans uppercase">SECURE VPN</span>
              <span>100%</span>
            </div>
          </div>

          {/* Core mobile view */}
          <div className="flex-1 flex flex-col justify-between border border-[#1e293b] bg-[#080c14] rounded-2xl p-3 overflow-hidden text-center justify-center">
            
            {cameraActive ? (
              // Active Virtual Camera Viewfinder
              <div className="relative flex-1 bg-[#0d1421] rounded-lg overflow-hidden flex flex-col justify-between p-2">
                
                {/* Visual crop bounds & grid */}
                <div className="absolute inset-4 border-2 border-dashed border-white/30 rounded flex items-center justify-center">
                  <span className="text-[8px] font-mono text-white/50 tracking-widest uppercase">KARTVİZİT KILAVUZU</span>
                  <div className="absolute h-full w-0.5 bg-white/5 left-1/3"></div>
                  <div className="absolute h-full w-0.5 bg-white/5 left-2/3"></div>
                  <div className="absolute w-full h-0.5 bg-white/5 top-1/3"></div>
                  <div className="absolute w-full h-0.5 bg-white/5 top-2/3"></div>
                </div>

                <div className="text-[8px] font-mono text-white bg-black/50 px-1.5 py-0.5 rounded self-start z-10 flex items-center gap-1">
                  <Sparkles className="h-2 w-2 text-yellow-400" />
                  <span>AUTOFOCUS: ACTIVE</span>
                </div>

                <div className="flex flex-col gap-1.5 z-10">
                  <span className="text-[7px] text-slate-400 font-mono">Simüle edilen vizörden şablon seçin</span>
                  <div className="grid grid-cols-3 gap-1">
                    {sampleCardImages.map((sci, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleDeviceLoadImage(sci.img, sci.name)}
                        className="bg-[#080c14] hover:bg-[#0d1421] border border-[#1e293b] text-[8px] py-1 px-0.5 rounded font-mono text-white leading-tight cursor-pointer"
                      >
                        Şablon {idx + 1}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setCameraActive(false)}
                  className="bg-red-950 hover:bg-red-900 text-[8px] py-1 rounded text-white font-bold tracking-wider uppercase font-mono z-10 cursor-pointer border border-red-850"
                >
                  Kapat
                </button>
              </div>
            ) : selectedImage ? (
              // Image selected, ready for quality checking & upload
              <div className="flex-1 flex flex-col justify-between">
                <div className="relative aspect-[1.75/1] w-full bg-black rounded-lg overflow-hidden border border-[#1e293b]">
                  <img src={selectedImage} alt="Capture visual" className="w-full h-full object-cover" />
                  <div className="absolute bottom-1 right-1 bg-black/60 text-[8px] text-white font-mono px-1 py-0.2 rounded">
                    Önizleme
                  </div>
                </div>

                {/* Quality check review panel */}
                {qualityCheck && (
                  <div className="bg-[#0d1421] p-2 rounded-lg border border-[#1e293b] my-2 text-left">
                    <div className="flex items-center gap-1 mb-1 justify-between">
                      <span className="text-[8px] font-bold font-mono text-slate-400 uppercase">Görsel Analiz (QC)</span>
                      <span className={`text-[8px] font-bold ${qualityCheck.pass ? "text-emerald-400" : "text-amber-400"}`}>
                        Skor: %{qualityCheck.score}
                      </span>
                    </div>
                    <p className="text-[8px] text-slate-300 leading-normal">{qualityCheck.feedback}</p>
                  </div>
                )}

                <div className="flex gap-1.5 mt-1">
                  <button
                    onClick={() => { setSelectedImage(null); setQualityCheck(null); }}
                    className="flex-1 bg-[#0d1421] hover:bg-[#080c14] border border-[#1e293b] text-slate-400 py-1.5 rounded text-[9px] font-bold tracking-wider font-mono cursor-pointer"
                  >
                    Yeniden Çek
                  </button>
                  <button
                    onClick={executeUploadMock}
                    disabled={uploading}
                    className="flex-1 bg-[#1e40af] hover:bg-blue-700 disabled:opacity-50 text-white py-1.5 rounded text-[9px] font-bold tracking-wider font-mono flex items-center justify-center gap-1 cursor-pointer"
                  >
                    {uploading ? (
                      <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-2.5 w-2.5" />
                    )}
                    <span>Yükle / Analiz</span>
                  </button>
                </div>
              </div>
            ) : (
              // Empty slate / Select capture mode
              <div className="flex-1 flex flex-col justify-center items-center py-6">
                <div className="w-12 h-12 rounded-full bg-[#0d1421] border border-[#1e293b] flex items-center justify-center mb-3">
                  <Smartphone className="h-6 w-6 text-slate-500" />
                </div>
                
                <h4 className="text-[11px] font-semibold text-slate-300 font-display transition-colors mb-1">
                  Business Card Intelligence Mobil Uygulaması
                </h4>
                <p className="text-[9px] text-[#94a3b8] max-w-[180px] leading-relaxed mb-4">
                  Saha operasyonları, fuar, heyet veya resmi ziyaretlerde kartvizitleri anında tarayın.
                </p>

                <div className="w-full space-y-2">
                  <button
                    onClick={() => { setCameraActive(true); onLogAudit("MOBILE_CAMERA_OPENED", { os: deviceOS }); }}
                    className="w-full bg-[#0d1421] hover:bg-[#080c14] text-slate-200 py-2 rounded text-[9px] font-bold tracking-widest uppercase font-mono border border-[#1e293b] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Camera className="h-3 w-3 text-[#1e40af]" />
                    Taktik Kamera ile Çek
                  </button>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-[#0d1421] hover:bg-[#080c14] text-slate-400 py-2 rounded text-[9px] font-bold tracking-widest uppercase font-mono border border-[#1e293b] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ImageIcon className="h-3 w-3 text-teal-400" />
                    Galeriden Fotoğraf Seç
                  </button>
                  
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleCustomFileInput}
                    accept="image/*"
                    className="hidden"
                  />
                </div>
              </div>
            )}

          </div>

          {/* Virtual Home Bar Indicator link */}
          <div className="w-24 h-1 bg-[#1e293b] rounded-full mx-auto mt-2"></div>
        </div>
      </div>

      <div className="mt-3 text-[10px] font-mono text-[#94a3b8] bg-[#080c14]/50 p-2.5 rounded border border-[#1e293b]">
        <span className="text-yellow-400 font-bold block mb-0.5">Savunma Sanayii Entegrasyonu:</span>
        Platform iOS, Android ve Web'den çekilen fotoğrafların bulanıklık / kalite testini yapar, ardından SSL + JWT katmanıyla ortak backend API'ye iletir.
      </div>
    </div>
  );
}
