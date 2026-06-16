import React, { useState, useEffect } from "react";
import { BusinessCardField, Contact, Tag } from "../types";
import { CheckCircle, AlertTriangle, ShieldCheck, Tag as TagIcon, Plus } from "lucide-react";

interface VerifyFormProps {
  fields: BusinessCardField[];
  contact?: Contact;
  tags: Tag[];
  onVerify: (data: { fields: BusinessCardField[]; contactData: any; tagIds: string[] }) => void;
  selectedFieldId?: string | null;
  onFieldFocus?: (fieldId: string) => void;
}

export default function VerifyForm({
  fields,
  contact,
  tags,
  onVerify,
  selectedFieldId,
  onFieldFocus
}: VerifyFormProps) {
  // Local editable fields
  const [editableFields, setEditableFields] = useState<BusinessCardField[]>([]);
  const [formData, setFormData] = useState<any>({
    first_name: "",
    last_name: "",
    full_name: "",
    title: "",
    company: "",
    department: "",
    email: "",
    phone: "",
    mobile_phone: "",
    website: "",
    address: "",
    city: "",
    country: "",
    linkedin: "",
    notes: ""
  });
  
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [systemTags, setSystemTags] = useState<Tag[]>(tags);

  useEffect(() => {
    if (fields) {
      setEditableFields([...fields]);
    }
  }, [fields]);

  useEffect(() => {
    if (contact) {
      setFormData({
        first_name: contact.first_name || "",
        last_name: contact.last_name || "",
        full_name: contact.full_name || "",
        title: contact.title || "",
        company: contact.company || "",
        department: contact.department || "",
        email: contact.email || "",
        phone: contact.phone || "",
        mobile_phone: contact.mobile_phone || "",
        website: contact.website || "",
        address: contact.address || "",
        city: contact.city || "",
        country: contact.country || "",
        linkedin: contact.linkedin || "",
        notes: contact.notes || ""
      });
    }
  }, [contact]);

  useEffect(() => {
    setSystemTags(tags);
  }, [tags]);

  const handleFieldChange = (id: string, value: string) => {
    setEditableFields(prev => prev.map(f => {
      if (f.id === id) {
        // Sync with primary form data too
        setFormData(prevForm => ({
          ...prevForm,
          [f.field_name]: value,
          full_name: f.field_name === "full_name" ? value : prevForm.full_name,
          title: f.field_name === "title" ? value : prevForm.title,
          company: f.field_name === "company" ? value : prevForm.company,
          email: f.field_name === "email" ? value : prevForm.email,
          phone: f.field_name === "phone" ? value : prevForm.phone,
          address: f.field_name === "address" ? value : prevForm.address
        }));
        return { ...f, field_value: value };
      }
      return f;
    }));
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const updated = { ...prev, [name]: value };
      if (name === "full_name") {
        const parts = value.split(" ");
        updated.first_name = parts[0] || "";
        updated.last_name = parts.slice(1).join(" ") || "";
      }
      return updated;
    });

    // Sync with visual bounding box fields if applicable
    setEditableFields(prev => prev.map(f => {
      if (f.field_name === name) {
        return { ...f, field_value: value };
      }
      return f;
    }));
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds(prev => 
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  const handleAddNewTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    const colors = ["#EF4444", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const newTag: Tag = {
      id: `tag-custom-${Date.now()}`,
      name: newTagName,
      color: randomColor,
      created_by: "u-1",
      created_at: new Date().toISOString()
    };
    setSystemTags(prev => [...prev, newTag]);
    setSelectedTagIds(prev => [...prev, newTag.id]);
    setNewTagName("");
  };

  // Determine Confidence Gauge
  const getOverallConfidence = () => {
    if (editableFields.length === 0) return { score: 1.0, label: "Yüksek", color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" };
    const sum = editableFields.reduce((acc, f) => acc + f.confidence_score, 0);
    const avg = sum / editableFields.length;
    
    if (avg >= 0.85) {
      return { score: avg, label: "YÜKSEK GÜVENİLİRLİK (SECURE)", color: "text-emerald-400 bg-emerald-950/40 border-emerald-500/30", scoreColor: "bg-emerald-500" };
    } else if (avg >= 0.60) {
      return { score: avg, label: "ORTA GÜVENİLİRLİK (REVIEW REQUIRED)", color: "text-amber-400 bg-amber-950/40 border-amber-500/30", scoreColor: "bg-amber-500" };
    } else {
      return { score: avg, label: "KRİTİK DÜŞÜK GÜVENİLİRLİK (UNSAFE)", color: "text-red-400 bg-red-950/40 border-red-500/30", scoreColor: "bg-red-500" };
    }
  };

  const confidence = getOverallConfidence();

  return (
    <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 shadow-2xl h-full flex flex-col">
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#1e293b]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <h3 className="text-sm font-semibold tracking-wide text-slate-300 uppercase font-display">
            Manuel Doğrulama & Sınıflandırma
          </h3>
        </div>
        <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded border ${confidence.color}`}>
          {confidence.label} ({(confidence.score * 100).toFixed(0)}%)
        </span>
      </div>

      {/* Confidence Score Bar */}
      <div className="mb-5 bg-[#080c14] p-2.5 rounded-md border border-[#1e293b]">
        <div className="flex justify-between text-[11px] font-mono text-[#94a3b8] mb-1">
          <span>Yapay Zekâ Başarı Skoru (Cognitive Score)</span>
          <span>{(confidence.score * 100).toFixed(0)}%</span>
        </div>
        <div className="w-full h-1.5 bg-[#0d1421] rounded-full overflow-hidden">
          <div className={`h-full ${confidence.scoreColor} transition-all duration-300`} style={{ width: `${confidence.score * 100}%` }}></div>
        </div>
      </div>

      {/* Inputs fields Grid */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-4 max-h-[450px]">
        
        {/* Identified Fields list */}
        <div className="space-y-3">
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-bold text-[#94a3b8] uppercase font-display">OCR'lanan Kurumsal Girdiler</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {editableFields.length > 0 ? (
              editableFields.map((field) => {
                const isUnderFocused = selectedFieldId === field.id;
                const isLowScore = field.confidence_score < 0.7;
                
                return (
                  <div
                    key={field.id}
                    onClick={() => onFieldFocus && onFieldFocus(field.id)}
                    className={`p-2.5 rounded border transition-all ${
                      isUnderFocused
                        ? "bg-[#080c14] border-[#1e40af] ring-1 ring-[#1e40af]/20"
                        : "bg-[#080c14] border-[#1e293b] hover:border-slate-700"
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-mono font-semibold text-[#94a3b8] uppercase">
                        {field.field_name.replace("_", " ")}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isLowScore && (
                          <span className="flex items-center gap-0.5 text-[9px] text-amber-500 font-bold bg-amber-955/40 px-1 py-0.2 rounded border border-amber-500/30">
                            <AlertTriangle className="h-2.5 w-2.5" /> Düşük Güven
                          </span>
                        )}
                        <span className={`text-[9px] font-mono ${isLowScore ? "text-amber-400" : "text-slate-500"}`}>
                          {(field.confidence_score * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <input
                      type="text"
                      className="w-full bg-[#0d1421] text-xs text-slate-200 border border-[#1e293b] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#1e40af]"
                      value={field.field_value}
                      onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    />
                  </div>
                );
              })
            ) : (
              <div className="col-span-2 text-center py-6 text-xs text-slate-500 italic">No OCR fields mapped. Click / upload a card first.</div>
            )}
          </div>
        </div>

        {/* Detailed contact properties */}
        <div className="pt-3 border-t border-[#1e293b] space-y-3">
          <span className="text-[11px] font-bold text-[#94a3b8] uppercase font-display block">Sistem İstihbarat Detayları</span>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-[#94a3b8] uppercase">Departman</label>
              <input
                type="text"
                name="department"
                value={formData.department}
                onChange={handleFormChange}
                className="w-full bg-[#080c14] text-xs text-slate-200 border border-[#1e293b] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#1e40af]"
                placeholder="Örn. Siber Savunma Şubesi"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-[#94a3b8] uppercase">Cep Telefonu</label>
              <input
                type="text"
                name="mobile_phone"
                value={formData.mobile_phone}
                onChange={handleFormChange}
                className="w-full bg-[#080c14] text-xs text-slate-200 border border-[#1e293b] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#1e40af]"
                placeholder="Örn. +90 5XX XXX XX XX"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-[#94a3b8] uppercase">Şehir</label>
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={handleFormChange}
                className="w-full bg-[#080c14] text-xs text-slate-200 border border-[#1e293b] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#1e40af]"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-[#94a3b8] uppercase">Ülke</label>
              <input
                type="text"
                name="country"
                value={formData.country}
                onChange={handleFormChange}
                className="w-full bg-[#080c14] text-xs text-slate-200 border border-[#1e293b] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#1e40af]"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-mono text-[#94a3b8] uppercase">LinkedIn Profil URL</label>
              <input
                type="text"
                name="linkedin"
                value={formData.linkedin}
                onChange={handleFormChange}
                className="w-full bg-[#080c14] text-xs text-slate-200 border border-[#1e293b] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#1e40af]"
                placeholder="Örn. linkedin.com/in/adsoyad"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-mono text-[#94a3b8] uppercase">Operasyonel Notlar</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleFormChange}
                rows={2}
                className="w-full bg-[#080c14] text-xs text-slate-200 border border-[#1e293b] rounded px-2.5 py-1.5 focus:outline-none focus:border-[#1e40af] resize-none"
                placeholder="Temas bağlamı, heyet görüşmesi veya ek operasyonel detaylar girin..."
              />
            </div>
          </div>
        </div>

        {/* Corporate labels or security classification badges */}
        <div className="pt-3 border-t border-[#1e293b] space-y-3">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#94a3b8] uppercase font-display">
            <TagIcon className="h-3.5 w-3.5 text-[#1e40af]" /> Kurumsal Etiket Sınıflandırması
          </span>

          <div className="flex flex-wrap gap-2">
            {systemTags.map(tag => {
              const isSelected = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={`text-[10px] font-mono font-medium px-2.5 py-1 rounded transition-all border ${
                    isSelected
                      ? "text-white shadow-md scale-102"
                      : "text-slate-400 bg-blue-950/20 border-[#1e293b] hover:border-slate-700"
                  }`}
                  style={{
                    backgroundColor: isSelected ? tag.color : undefined,
                    borderColor: isSelected ? tag.color : undefined
                  }}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleAddNewTag} className="flex gap-2">
            <input
              type="text"
              className="bg-[#080c14] text-xs text-slate-300 border border-[#1e293b] rounded px-2.5 py-1 focus:outline-none focus:border-[#1e40af] flex-1"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Yeni etiket adı..."
            />
            <button
              type="submit"
              className="bg-[#0d1421] hover:bg-[#080c14] text-slate-200 p-1.5 rounded border border-[#1e293b] transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      </div>

      <button
        onClick={() => onVerify({ fields: editableFields, contactData: formData, tagIds: selectedTagIds })}
        disabled={editableFields.length === 0}
        className="mt-4 w-full cursor-pointer bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs tracking-wider uppercase py-3 px-4 rounded transition-all hover:shadow-lg hover:shadow-emerald-950/20 flex items-center justify-center gap-2 font-display"
      >
        <CheckCircle className="h-4 w-4" />
        Kayıt Doğrula ve Onayla (Commit Changes)
      </button>
    </div>
  );
}
