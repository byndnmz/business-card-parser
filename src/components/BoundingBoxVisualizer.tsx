import React, { useState } from "react";
import { BusinessCardField } from "../types";
import { ToggleLeft, ToggleRight, Eye, Layers } from "lucide-react";

interface BoundingBoxVisualizerProps {
  cardImageUrl: string;
  fields: BusinessCardField[];
  onSelectField: (field: BusinessCardField) => void;
  selectedFieldId?: string | null;
}

const colorMap: Record<string, string> = {
  full_name: "border-blue-500 bg-blue-500/10 text-blue-300",
  title: "border-teal-500 bg-teal-500/10 text-teal-300",
  company: "border-amber-500 bg-amber-500/10 text-amber-300",
  email: "border-red-500 bg-red-500/10 text-red-300",
  phone: "border-emerald-500 bg-emerald-500/10 text-emerald-300",
  address: "border-purple-500 bg-purple-500/10 text-purple-300"
};

const labelMap: Record<string, string> = {
  full_name: "AD SOYAD",
  title: "ÜNVAN",
  company: "ŞİRKET",
  email: "E-POSTA",
  phone: "TELEFON",
  address: "ADRES"
};

export default function BoundingBoxVisualizer({
  cardImageUrl,
  fields,
  onSelectField,
  selectedFieldId
}: BoundingBoxVisualizerProps) {
  const [showOcrView, setShowOcrView] = useState(true);

  return (
    <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 shadow-2xl">
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#1e293b]">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-[#1e40af]" />
          <h3 className="text-sm font-semibold tracking-wide text-slate-300 uppercase font-display">
            Görsel Konumlandırma & OCR Katmanı
          </h3>
        </div>
        
        {/* Toggle Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOcrView(!showOcrView)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors bg-[#080c14] border border-[#1e293b] hover:bg-[#0d1421] cursor-pointer"
          >
            {showOcrView ? (
              <>
                <ToggleRight className="text-[#1e40af] h-4 w-4" />
                <span className="text-slate-300">OCR Görünümü Aktif</span>
              </>
            ) : (
              <>
                <ToggleLeft className="text-slate-500 h-4 w-4" />
                <span className="text-slate-400">Temiz Kartvizit Görünümü</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="relative w-full max-w-[550px] mx-auto aspect-[1.75/1] bg-[#080c14] rounded-lg overflow-hidden border-2 border-dashed border-[#1e293b] flex items-center justify-center">
        {/* Actual Image */}
        <img
          src={cardImageUrl}
          alt="Business Card Intelligence"
          className="w-full h-full object-cover select-none"
          referrerPolicy="no-referrer"
        />

        {/* OCR Overlay Nodes */}
        {showOcrView && fields.map((field) => {
          const colorClass = colorMap[field.field_name] || "border-slate-500 bg-slate-500/15 text-slate-300";
          const isSelected = selectedFieldId === field.id;
          
          return (
            <button
              key={field.id}
              onClick={() => onSelectField(field)}
              className={`absolute border transition-all duration-150 group cursor-pointer ${colorClass} ${
                isSelected ? "ring-2 ring-white scale-102 z-20 shadow-lg" : "hover:scale-101 hover:z-10"
              }`}
              style={{
                left: `${field.bounding_box_x}%`,
                top: `${field.bounding_box_y}%`,
                width: `${field.bounding_box_width}%`,
                height: `${field.bounding_box_height}%`,
              }}
              title={`${labelMap[field.field_name] || field.field_name}: ${field.field_value}`}
            >
              <div className="absolute top-0 left-0 -translate-y-full bg-[#0d1421] border border-current text-[8px] font-bold px-1 rounded shadow-md hidden group-hover:block z-30">
                {labelMap[field.field_name] || field.field_name} ({(field.confidence_score * 100).toFixed(0)}%)
              </div>
              <div className="absolute bottom-0 left-0 w-full bg-[#080c14]/75 border-t border-[#1e293b] text-[9px] font-mono whitespace-nowrap overflow-hidden text-ellipsis px-0.5 text-center leading-none">
                {field.field_value}
              </div>
            </button>
          );
        })}
      </div>
      
      {/* Help legend */}
      {showOcrView && (
        <div className="mt-4 pt-3 border-t border-[#1e293b] grid grid-cols-3 gap-2 text-[10px] font-mono text-[#94a3b8]">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-blue-500/20 border border-blue-500 rounded"></span>
            <span>Ad Soyad</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-teal-500/20 border border-teal-500 rounded"></span>
            <span>Ünvan / Rol</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-amber-500/20 border border-amber-500 rounded"></span>
            <span>Kurum / Şirket</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-red-500/20 border border-red-500 rounded"></span>
            <span>E-Posta Adresi</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-emerald-500/20 border border-emerald-500 rounded"></span>
            <span>Telefon No</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-purple-500/20 border border-purple-500 rounded"></span>
            <span>Fiziki Adres</span>
          </div>
        </div>
      )}
    </div>
  );
}
