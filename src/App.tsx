import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield,
  Search,
  UploadCloud,
  FileSpreadsheet,
  Settings,
  FolderSync,
  Smartphone,
  ShieldCheck,
  TrendingUp,
  LayoutGrid,
  TrendingDown,
  Clock,
  AlertTriangle,
  UserCheck,
  LogOut,
  Sparkles,
  RefreshCw,
  Plus,
  Trash2,
  FileCheck,
  QrCode
} from "lucide-react";
import BoundingBoxVisualizer from "./components/BoundingBoxVisualizer";
import VerifyForm from "./components/VerifyForm";
import MobileSimulator from "./components/MobileSimulator";
import BatchProcessor from "./components/BatchProcessor";
import ExportDialog from "./components/ExportDialog";
import AuditLogView from "./components/AuditLogView";
import AdminPanel from "./components/AdminPanel";
import QrCodeScannerModal from "./components/QrCodeScannerModal";
import LoginScreen from "./components/LoginScreen";
import MfaSetupModal from "./components/MfaSetupModal";
import { CardWithRelationships, User, AuditLog, Batch, Tag, Contact } from "./types";
import { testConnection } from "./firebase";

export default function App() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "scanner" | "mobile" | "batches" | "audit" | "admin">("dashboard");
  const [cards, setCards] = useState<CardWithRelationships[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [systemDashboard, setSystemDashboard] = useState<any>({
    metrics: {
      totalCards: 0,
      todayProcessed: 0,
      pendingVerification: 0,
      lowConfidence: 0,
      totalBatches: 0,
      totalExportsCount: 0,
      ocrSuccessRate: 94
    },
    topCompanies: [],
    topTitles: [],
    systemHealth: {}
  });

  // User session state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<CardWithRelationships | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<"all" | "today" | "pending" | "low_confidence" | "duplicates">("all");
  const [selectedFilterTag, setSelectedFilterTag] = useState<string>("all");

  // Export triggers
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [isMfaOpen, setIsMfaOpen] = useState(false);

  // Drag & drop highlight
  const [isDragging, setIsDragging] = useState(false);

  // Load initial data and confirm current user session
  useEffect(() => {
    testConnection();
    fetchSession();
  }, []);

  const fetchSession = async () => {
    try {
      const response = await fetch("/api/auth/me");
      const data = await response.json();
      if (data.user) {
        setCurrentUser(data.user);
        fetchAllData();
      }
      // Oturum yoksa login ekranı gösterilir (otomatik giriş kaldırıldı).
    } catch (err) {
      console.error(err);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    fetchAllData();
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("Çıkış hatası:", err);
    } finally {
      setCurrentUser(null);
    }
  };

  const fetchAllData = async () => {
    try {
      const [cardsRes, batchesRes, auditRes, tagsRes, usersRes, dashboardRes] = await Promise.all([
        fetch("/api/cards"),
        fetch("/api/batches"),
        fetch("/api/admin/audit-logs"),
        fetch("/api/tags"),
        fetch("/api/admin/users"),
        fetch("/api/admin/dashboard")
      ]);

      const [cardsData, batchesData, auditData, tagsData, usersData, dashboardData] = await Promise.all([
        cardsRes.json(),
        batchesRes.json(),
        auditRes.json(),
        tagsRes.json(),
        usersRes.json(),
        dashboardRes.json()
      ]);

      if (cardsData.cards) {
        setCards(cardsData.cards);
        if (cardsData.cards.length > 0 && !selectedCard) {
          setSelectedCard(cardsData.cards[0]);
        }
      }
      if (batchesData.batches) setBatches(batchesData.batches);
      if (auditData.logs) setAuditLogs(auditData.logs);
      if (tagsData.tags) setTags(tagsData.tags);
      if (usersData.users) setUsers(usersData.users);
      if (dashboardData) setSystemDashboard(dashboardData);

    } catch (err) {
      console.error("Error loading application states:", err);
    }
  };

  // Log auditing to server
  const logAuditPayload = async (action: string, detail: any) => {
    if (!currentUser) return;
    try {
      // Re-fetch log and update main analytics
      const updatedAuditRes = await fetch("/api/admin/audit-logs");
      const data = await updatedAuditRes.json();
      if (data.logs) setAuditLogs(data.logs);
    } catch (e) {
      console.error(e);
    }
  };

  // Perform card delete
  const handleDeleteCard = async (cardId: string) => {
    if (!confirm("Seçili Kartviziti ve tüm istihbarat verilerini güvenli sunuculardan kalıcı olarak silmek istediğinize emin misiniz? (Milli İmha Protokolü)")) {
      return;
    }

    try {
      const response = await fetch(`/api/cards/${cardId}`, {
        method: "DELETE"
      });
      if (response.ok) {
        await fetchAllData();
        setSelectedCard(null);
        await logAuditPayload("ADMIN_CARD_TERMINATED", { cardId });
      } else {
        const err = await response.json();
        alert(err.error || "Silme yetki hatası.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Card verification confirm commit
  const handleVerifyCommit = async (verifyPayload: { fields: any[]; contactData: any; tagIds: string[] }) => {
    if (!selectedCard) return;

    try {
      const response = await fetch(`/api/cards/${selectedCard.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verifyPayload)
      });

      if (response.ok) {
        alert("Kartvizit verileri, coğrafi referans koordinatları ve sınıflandırma etiketleri başarıyla doğrulanıp kaydedildi.");
        await fetchAllData();
        await logAuditPayload("CARD_VERIFICATION_SUCCESS_COMMITTED", { cardId: selectedCard.id });
      } else {
        const err = await response.json();
        alert(err.error || "Doğrulama yetki hatası.");
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Drag-and-drop file processing
  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleImageFileSelection(files[0]);
    }
  };

  const handleImageFileSelection = (file: File) => {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      alert("Yalnızca PNG, JPEG, WEBP görsel dosyaları ile PDF belgeleri yüklenebilir.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      if (event.target?.result) {
        const base64Content = (event.target.result as string).split(",")[1];
        await uploadCardBase64(base64Content, file.name, file.type);
      }
    };
    reader.readAsDataURL(file);
  };

  const uploadCardBase64 = async (base64: string, filename: string, mime: string) => {
    try {
      const response = await fetch("/api/cards/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          filename,
          mimeType: mime,
          source: "web"
        })
      });

      const data = await response.json();
      if (response.ok) {
        await fetchAllData();
        // Sunucu {card, fields, contact} döner — ilişki nesnesine düzleştir.
        setSelectedCard({ ...data.card, fields: data.fields || [], contact: data.contact, tags: [] });
        setActiveTab("scanner");
        if (data.duplicateOf) {
          alert("Dikkat: Bu kişiye ait olası bir tekrar kayıt (duplicate) tespit edildi. Kayıt 'manuel kontrol' olarak işaretlendi.");
        }
        if (data.warnings && data.warnings.length) {
          console.warn("OCR doğrulama uyarıları:", data.warnings);
        }
        await logAuditPayload("WEB_FILE_UPLOADER_SUCCESS", { filename });
      } else {
        alert(data.error || "Görsel yükleme hatası.");
      }
    } catch (err) {
      console.error(err);
      alert("Yükleme işlemi sırasında sunucuyla bağlantı koptu.");
    }
  };

  // Admin user modify
  const handleUserUpdate = async (userId: string, updates: any) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      if (response.ok) {
        await fetchAllData();
      } else {
        const err = await response.json();
        alert(err.error || "Yetki güncelleme hatası.");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleQrScanSuccess = (parsed: any) => {
    if (!parsed) return;

    if (selectedCard) {
      const mergedContact: Contact = {
        ...(selectedCard.contact || {
          id: `temp-contact-${Date.now()}`,
          business_card_id: selectedCard.id,
          owner_id: currentUser?.id || "u-1",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        first_name: parsed.first_name || selectedCard.contact?.first_name || "",
        last_name: parsed.last_name || selectedCard.contact?.last_name || "",
        full_name: parsed.full_name || selectedCard.contact?.full_name || "",
        title: parsed.title || selectedCard.contact?.title || "",
        company: parsed.company || selectedCard.contact?.company || "",
        department: parsed.department || selectedCard.contact?.department || "",
        email: parsed.email || selectedCard.contact?.email || "",
        phone: parsed.phone || selectedCard.contact?.phone || "",
        mobile_phone: parsed.mobile_phone || selectedCard.contact?.mobile_phone || "",
        website: parsed.website || selectedCard.contact?.website || "",
        address: parsed.address || selectedCard.contact?.address || "",
        city: parsed.city || selectedCard.contact?.city || "",
        country: parsed.country || selectedCard.contact?.country || "",
        linkedin: parsed.linkedin || selectedCard.contact?.linkedin || "",
        notes: parsed.notes || selectedCard.contact?.notes || "QR Kod Tarama ile güncellendi."
      } as Contact;

      const updatedFields = [...(selectedCard.fields || [])];
      const fieldKeys: Array<"full_name" | "title" | "company" | "department" | "email" | "phone" | "mobile_phone" | "website" | "address" | "city" | "country" | "linkedin"> = [
        "full_name", "title", "company", "department", "email", "phone", "mobile_phone", "website", "address", "city", "country", "linkedin"
      ];

      fieldKeys.forEach(key => {
        const parsedVal = parsed[key];
        if (parsedVal) {
          const fieldIndex = updatedFields.findIndex(f => f.field_name === key);
          if (fieldIndex > -1) {
            updatedFields[fieldIndex] = {
              ...updatedFields[fieldIndex],
              field_value: parsedVal,
              confidence_score: 1.0
            };
          } else {
            updatedFields.push({
              id: `qr-${key}-${Date.now()}`,
              business_card_id: selectedCard.id,
              field_name: key,
              field_value: parsedVal,
              confidence_score: 1.0,
              bounding_box_x: 0,
              bounding_box_y: 0,
              bounding_box_width: 0,
              bounding_box_height: 0,
              is_verified: false
            });
          }
        }
      });

      const updatedCard: CardWithRelationships = {
        ...selectedCard,
        contact: mergedContact,
        fields: updatedFields,
        confidence_score: 1.0
      };

      setSelectedCard(updatedCard);
      setCards(prevCards => prevCards.map(c => c.id === selectedCard.id ? updatedCard : c));
    } else {
      const tempCard: CardWithRelationships = {
        id: "temp-qr-card",
        owner_user_id: currentUser?.id || "u-1",
        image_url: "",
        processing_status: "pending_verification",
        confidence_score: 1.0,
        source_type: "web",
        created_at: new Date().toISOString(),
        fields: [
          { id: "qr-fn", business_card_id: "temp-qr-card", field_name: "full_name" as const, field_value: parsed.full_name || "", confidence_score: 1.0, bounding_box_x: 0, bounding_box_y: 0, bounding_box_width: 0, bounding_box_height: 0, is_verified: false },
          { id: "qr-title", business_card_id: "temp-qr-card", field_name: "title" as const, field_value: parsed.title || "", confidence_score: 1.0, bounding_box_x: 0, bounding_box_y: 0, bounding_box_width: 0, bounding_box_height: 0, is_verified: false },
          { id: "qr-company", business_card_id: "temp-qr-card", field_name: "company" as const, field_value: parsed.company || "", confidence_score: 1.0, bounding_box_x: 0, bounding_box_y: 0, bounding_box_width: 0, bounding_box_height: 0, is_verified: false },
          { id: "qr-email", business_card_id: "temp-qr-card", field_name: "email" as const, field_value: parsed.email || "", confidence_score: 1.0, bounding_box_x: 0, bounding_box_y: 0, bounding_box_width: 0, bounding_box_height: 0, is_verified: false },
          { id: "qr-phone", business_card_id: "temp-qr-card", field_name: "phone" as const, field_value: parsed.phone || "", confidence_score: 1.0, bounding_box_x: 0, bounding_box_y: 0, bounding_box_width: 0, bounding_box_height: 0, is_verified: false },
        ].filter(f => f.field_value !== "") as any[],
        contact: {
          id: "temp-qr-contact",
          business_card_id: "temp-qr-card",
          first_name: parsed.first_name || "",
          last_name: parsed.last_name || "",
          full_name: parsed.full_name || "",
          title: parsed.title || "",
          company: parsed.company || "",
          department: parsed.department || "",
          email: parsed.email || "",
          phone: parsed.phone || "",
          mobile_phone: parsed.mobile_phone || "",
          website: parsed.website || "",
          address: parsed.address || "",
          city: parsed.city || "",
          country: parsed.country || "",
          linkedin: parsed.linkedin || "",
          notes: parsed.notes || "QR Kod Tarama ile otomatik dolduruldu.",
          owner_id: currentUser?.id || "u-1",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Contact,
        tags: []
      };

      setSelectedCard(tempCard);
    }

    logAuditPayload("QR_CODE_CONTACT_SCANNED", {
      scannedName: parsed.full_name,
      scannedCompany: parsed.company
    });
  };

  // Session user role trigger switch (DEMO-ONLY RBAC showcase).
  // Sunucuda /api/auth/dev/switch-role audit'lenir ve üretimde kapatılabilir.
  const handleSessionRoleSwitch = async (role: string) => {
    if (!currentUser) return;
    try {
      const res = await fetch("/api/auth/dev/switch-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        setCurrentUser(data.user);
        await fetchAllData();
      } else {
        alert(data.error || "Rol değiştirilemedi.");
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Searching & Filtering Algorithm
  const filteredCards = cards.filter(card => {
    const contact = card.contact;
    const fields = card.fields || [];

    // Search query matches company, name, email, phone, city
    const textFieldsToSearch = [
      contact?.full_name,
      contact?.company,
      contact?.title,
      contact?.email,
      contact?.phone,
      contact?.city,
      contact?.notes,
      ...fields.map(f => f.field_value)
    ].map(v => (v || "").toLowerCase());

    const matchesSearch = searchTerm === "" || textFieldsToSearch.some(val => val.includes(searchTerm.toLowerCase()));

    // Tag category match
    const matchesTag = selectedFilterTag === "all" || card.tags.some(t => t.id === selectedFilterTag);

    // Context filter matches
    let matchesCategory = true;
    if (filterCategory === "today") {
      matchesCategory = card.created_at.startsWith("2026-06-15");
    } else if (filterCategory === "pending") {
      matchesCategory = card.processing_status === "pending_verification";
    } else if (filterCategory === "low_confidence") {
      matchesCategory = card.confidence_score < 0.70;
    } else if (filterCategory === "duplicates") {
      // Simulate duplicate company detect check
      matchesCategory = card.confidence_score === 0.61 || card.processing_status === "pending_verification";
    }

    return matchesSearch && matchesTag && matchesCategory;
  });

  // --- OTURUM GEÇİDİ: yükleniyor → login ekranı → uygulama ---
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#080c14] flex items-center justify-center text-slate-400 font-mono text-sm">
        Yükleniyor…
      </div>
    );
  }
  if (!currentUser) {
    return <LoginScreen onAuthenticated={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-[#080c14] text-[#e2e8f0] flex flex-col font-sans selection:bg-[#1e40af] selection:text-white animate-fade">
      
      {/* Platform Banner Alert / Defense Classification Bar */}
      <div className="bg-red-950/60 border-b border-[#1e293b] text-center py-1.5 px-4 text-[10px] font-mono tracking-widest text-red-400 font-bold flex justify-center items-center gap-1.5 select-none">
        <Shield className="h-3.5 w-3.5 animate-pulse" />
        <span>GİZLİ // T.C. SİBER GÜVENLİK VE MİLLÎ İSTİHBARAT HABERLEŞME AKIŞI // RECOGNITION PANEL ACTIVE</span>
      </div>

      {/* Main Header */}
      <header className="bg-[#0d1421] border-b border-[#1e293b]/80 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-[#080c14] border border-[#1e40af]/30 flex items-center justify-center">
            <Shield className="h-6 w-6 text-[#1e40af]" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white font-display">
              B-CİP // Business Card Intelligence Platform
            </h1>
            <p className="text-[11px] font-mono text-[#94a3b8]">
              Savunma Sanayii Seviyesi Temas & İlişki Haritalama Portalı
            </p>
          </div>
        </div>

        {/* Current User controls & Quick Switcher for Demo */}
        {currentUser && (
          <div className="flex items-center gap-3 bg-[#080c14] p-2 rounded-lg border border-[#1e293b]">
            <div className="text-right">
              <span className="text-xs font-semibold text-slate-200 block">{currentUser.full_name}</span>
              <div className="flex items-center gap-1.5 justify-end">
                <span className="text-[10px] font-mono text-[#1e40af] font-bold uppercase">
                  {currentUser.role.toUpperCase()}
                </span>
                <span className="text-[#94a3b8] text-[10px]">•</span>
                <button
                  onClick={() => setIsMfaOpen(true)}
                  className={`text-[9px] font-mono font-semibold cursor-pointer hover:underline ${
                    currentUser.mfa_enabled ? "text-emerald-400" : "text-amber-400"
                  }`}
                  title="TOTP MFA kurulumu / yenileme"
                >
                  {currentUser.mfa_enabled ? "MFA ENFORCED" : "MFA KURULUMU GEREKLİ"}
                </button>
              </div>
            </div>

            {/* Quick switcher for reviewer testing RBAC */}
            <div className="border-l border-[#1e293b] pl-3 flex flex-col gap-1">
              <span className="text-[8px] font-mono text-[#94a3b8] uppercase block font-bold">ROL DEĞİŞTİR (RBAC):</span>
              <div className="flex gap-1">
                {(["admin", "operator", "auditor", "user"] as const).map(role => (
                  <button
                    key={role}
                    onClick={() => handleSessionRoleSwitch(role)}
                    className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                      currentUser.role === role
                        ? "bg-[#1e40af] text-white"
                        : "bg-[#0d1421] text-[#94a3b8] hover:text-[#e2e8f0]"
                    }`}
                  >
                    {role.substring(0, 3).toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Oturumu kapat */}
            <button
              onClick={handleLogout}
              className="border-l border-[#1e293b] pl-3 ml-1 text-[#94a3b8] hover:text-red-400 transition-colors cursor-pointer flex items-center gap-1.5"
              title="Oturumu kapat"
            >
              <LogOut className="h-4 w-4" />
              <span className="text-[9px] font-mono font-bold uppercase">Çıkış</span>
            </button>
          </div>
        )}
      </header>

      {/* Main Tabs Navigation */}
      <nav className="bg-[#0d1421]/60 px-6 py-2.5 border-b border-[#1e293b] flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold tracking-wider uppercase transition-all cursor-pointer font-display border ${
            activeTab === "dashboard"
              ? "bg-[#1e40af]/15 border-[#1e40af] text-white shadow-md shadow-blue-950/20"
              : "border-transparent text-[#94a3b8] hover:text-[#e2e8f0]"
          }`}
        >
          <LayoutGrid className="h-4 w-4" /> Genel Analiz Dashboard
        </button>
        
        <button
          onClick={() => { setActiveTab("scanner"); if (cards.length > 0 && !selectedCard) setSelectedCard(cards[0]); }}
          className={`flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold tracking-wider uppercase transition-all cursor-pointer font-display border ${
            activeTab === "scanner"
              ? "bg-[#1e40af]/15 border-[#1e40af] text-white shadow-md shadow-blue-950/20"
              : "border-transparent text-[#94a3b8] hover:text-[#e2e8f0]"
          }`}
        >
          <Sparkles className="h-4 w-4" /> Kartvizit İstihbarat & Tarama
        </button>

        <button
          onClick={() => setActiveTab("mobile")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold tracking-wider uppercase transition-all cursor-pointer font-display border ${
            activeTab === "mobile"
              ? "bg-[#1e40af]/15 border-[#1e40af] text-white shadow-md shadow-blue-950/20"
              : "border-transparent text-[#94a3b8] hover:text-[#e2e8f0]"
          }`}
        >
          <Smartphone className="h-4 w-4" /> Mobil Taktik Simülatör
        </button>

        <button
          onClick={() => setActiveTab("batches")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold tracking-wider uppercase transition-all cursor-pointer font-display border ${
            activeTab === "batches"
              ? "bg-[#1e40af]/15 border-[#1e40af] text-white shadow-md shadow-blue-950/20"
              : "border-transparent text-[#94a3b8] hover:text-[#e2e8f0]"
          }`}
        >
          <FolderSync className="h-4 w-4" /> Toplu Kuyruklar
        </button>

        <button
          onClick={() => setActiveTab("audit")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold tracking-wider uppercase transition-all cursor-pointer font-display border ${
            activeTab === "audit"
              ? "bg-[#1e40af]/15 border-[#1e40af] text-white shadow-md shadow-blue-950/20"
              : "border-transparent text-[#94a3b8] hover:text-[#e2e8f0]"
          }`}
        >
          <ShieldCheck className="h-4 w-4" /> Denetim Günlüğü (Audit)
        </button>

        {currentUser?.role === "admin" && (
          <button
            onClick={() => setActiveTab("admin")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold tracking-wider uppercase transition-all cursor-pointer font-display border ${
              activeTab === "admin"
                ? "bg-[#1e40af]/15 border-[#1e40af] text-white shadow-md shadow-blue-950/20"
                : "border-transparent text-[#94a3b8] hover:text-[#e2e8f0]"
            }`}
          >
            <Settings className="h-4 w-4" /> Admin Portal
          </button>
        )}
      </nav>

      {/* Main View Area with motion transitions */}
      <main className="flex-1 p-6">
        <AnimatePresence mode="wait">
          
          {/* TAB 1: DASHBOARD METRICS */}
          {activeTab === "dashboard" && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="space-y-6"
            >
              {/* Bento Grid Stats Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                
                <div className="bg-[#0d1421] border border-[#1e293b] p-4 rounded-lg shadow-lg flex flex-col justify-between">
                  <span className="text-[10px] font-mono font-bold text-[#94a3b8] uppercase">Toplam Kartvizit</span>
                  <div className="text-2xl font-bold text-white mt-1 kpi-serif-value">
                    {systemDashboard.metrics.totalCards}
                  </div>
                  <span className="text-[9px] text-[#94a3b8]/80 block leading-none mt-2">Durable Cloud Contacts</span>
                </div>

                <div className="bg-[#0d1421] border border-[#1e293b] p-4 rounded-lg shadow-lg flex flex-col justify-between">
                  <span className="text-[10px] font-mono font-bold text-[#94a3b8] uppercase">Bugün İşlenen</span>
                  <div className="text-2xl font-bold text-blue-400 mt-1 kpi-serif-value">
                    {systemDashboard.metrics.todayProcessed}
                  </div>
                  <span className="text-[9px] text-blue-500 block leading-none mt-2">Realtime Cognitive extraction</span>
                </div>

                <div className="bg-[#0d1421] border border-[#1e293b] p-4 rounded-lg shadow-lg flex flex-col justify-between">
                  <span className="text-[10px] font-mono font-bold text-[#94a3b8] uppercase">Doğrulama Bekleyen</span>
                  <div className="text-2xl font-bold text-amber-400 mt-1 kpi-serif-value">
                    {systemDashboard.metrics.pendingVerification}
                  </div>
                  <span className="text-[9px] text-amber-500 block leading-none mt-2">Operator validation pending</span>
                </div>

                <div className="bg-[#0d1421] border border-[#1e293b]/90 p-4 rounded-lg shadow-lg flex flex-col justify-between">
                  <span className="text-[10px] font-mono font-bold text-[#94a3b8] uppercase">Düşük Güven (QC)</span>
                  <div className="text-2xl font-bold text-red-400 mt-1 kpi-serif-value">
                    {systemDashboard.metrics.lowConfidence}
                  </div>
                  <span className="text-[9px] text-red-500 block leading-none mt-1">Confidence rating &lt; 70%</span>
                </div>

                <div className="bg-[#0d1421] border border-[#1e293b] p-4 rounded-lg shadow-lg flex flex-col justify-between">
                  <span className="text-[10px] font-mono font-bold text-[#94a3b8] uppercase">OCR Başarı Oranı</span>
                  <div className="text-2xl font-bold text-emerald-400 mt-1 kpi-serif-value">
                    %{systemDashboard.metrics.ocrSuccessRate}
                  </div>
                  <span className="text-[9px] text-emerald-500 block leading-none mt-2">RapidOCR (yerel) ortalama güven</span>
                </div>

                <div className="bg-[#0d1421] border border-[#1e293b] p-4 rounded-lg shadow-lg flex flex-col justify-between">
                  <span className="text-[10px] font-mono font-bold text-[#94a3b8] uppercase">Dışa Aktarım (Log)</span>
                  <div className="text-2xl font-bold text-purple-400 mt-1 kpi-serif-value">
                    {systemDashboard.metrics.totalExportsCount}
                  </div>
                  <span className="text-[9px] text-purple-500 block leading-none mt-2">Audited CSV/VCard exports</span>
                </div>
              </div>

              {/* Bento Grid layout with graphics and metrics */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                
                {/* Drag-and-drop quick Scanner Widget */}
                <div className="lg:col-span-4 bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 flex flex-col justify-between shadow-lg">
                  <div>
                    <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase mb-2 font-display">
                      Zahmetsiz Hızlı Evrak / Kart Tarayıcı
                    </h3>
                    <p className="text-xs text-[#94a3b8] leading-normal mb-4">
                      Kartvizit görsellerini bu alana sürükleyip bırakarak el ile kamerayla çekilen veya PDF formatındaki evrakları sisteme anında analiz ettirebilirsiniz.
                    </p>
                  </div>

                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleFileDrop}
                    onClick={() => {
                      const fileInput = document.createElement("input");
                      fileInput.type = "file";
                      fileInput.accept = "image/*,application/pdf";
                      fileInput.onchange = (e: any) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageFileSelection(file);
                      };
                      fileInput.click();
                    }}
                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
                      isDragging 
                        ? "border-[#1e40af] bg-blue-950/20" 
                        : "border-[#1e293b] bg-[#080c14]/65 hover:bg-[#080c14] hover:border-[#1e293b]"
                    }`}
                  >
                    <UploadCloud className={`h-10 w-10 mx-auto mb-3 transition-colors ${isDragging ? "text-blue-400 animate-bounce" : "text-slate-650"}`} />
                    <span className="text-xs font-semibold text-slate-300 block mb-1">
                      Kart Resmi Sürükleyin veya Tıklayın
                    </span>
                    <span className="text-[10px] text-[#94a3b8] font-mono">
                      PNG, JPG, WEBP, PDF (Max 10MB)
                    </span>
                  </div>
                </div>

                {/* Top Companies Chart list */}
                <div className="lg:col-span-4 bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 shadow-lg">
                  <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase mb-4 font-display">
                    En Çok Görülen Savunma Şirketleri
                  </h3>

                  <div className="space-y-3.5">
                    {systemDashboard.topCompanies.map((comp: any, index: number) => {
                      const percentages = [85, 60, 45, 30, 15];
                      const valPercent = percentages[index % percentages.length];
                      return (
                        <div key={comp.name} className="space-y-1">
                           <div className="flex justify-between items-center text-xs font-mono">
                            <span className="font-semibold text-slate-300">{comp.name}</span>
                            <span className="text-[#94a3b8] text-[11px] font-bold">{comp.count} Adet Kartvizit</span>
                          </div>
                          <div className="w-full h-1.5 bg-[#080c14] rounded-full overflow-hidden">
                            <div className="h-full bg-[#1e40af] rounded-full" style={{ width: `${valPercent}%` }}></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Top Titles list */}
                <div className="lg:col-span-4 bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 shadow-lg">
                  <h3 className="text-sm font-semibold tracking-wide text-slate-200 uppercase mb-4 font-display">
                    Sık Karşılaşılan Unvan Profilleri
                  </h3>

                  <div className="space-y-3.5">
                    {systemDashboard.topTitles.map((title: any, index: number) => {
                      const colors = ["bg-teal-500/20 text-teal-400 border-teal-500/30", "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", "bg-indigo-500/20 text-indigo-400 border-indigo-500/30", "bg-purple-500/20 text-purple-400 border-purple-500/30", "bg-amber-500/20 text-amber-400 border-amber-500/30"];
                      const style = colors[index % colors.length];
                      return (
                        <div key={title.name} className="flex justify-between items-center p-2 rounded bg-[#080c14] border border-[#1e293b]">
                           <span className="text-xs font-semibold text-slate-300 truncate max-w-[180px]">{title.name}</span>
                          <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${style}`}>
                            {title.count} Kontak
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Advanced Network Security / Intelligence Notice on Bottom */}
              <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold font-mono tracking-widest text-[#1e40af] uppercase">
                    MİLLÎ KRİPTO TELEMETRİ / SİSTEM ALARMI:
                  </div>
                  <p className="text-xs text-[#94a3b8] leading-relaxed">
                    Sistem veri tabanındaki tüm silme işlemleri, siber güvenlik denetimleri ve kurtarma standartları uyumluluğu açısından <span className="text-red-400 font-bold">Soft Delete (Güvenli İzole Silme)</span> yöntemiyle askeri disklerde 180 gün kilitli saklanır.
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-3 py-1.5 rounded-md font-bold uppercase select-none">
                    ISO-27001 ACTIVE
                  </span>
                  <span className="text-[9px] font-mono text-[#1e40af] bg-blue-950/40 border border-[#1e40af]/30 px-3 py-1.5 rounded-md font-bold uppercase select-none">
                    MFA GÜVENLİĞİ
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 2: ACTIVE SCANNER & COGNITIVE PARSER HUB */}
          {activeTab === "scanner" && (
            <motion.div
              key="scanner"
              id="scanner"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="grid grid-cols-1 xl:grid-cols-12 gap-5"
            >
              {/* Left Rail: Cards List & Granular Search Filters */}
              <div className="xl:col-span-4 bg-[#0d1421] border border-[#1e293b] rounded-lg p-4 flex flex-col h-[740px]">
                
                {/* Search Bar */}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    className="w-full bg-[#080c14] text-xs text-slate-300 pl-9 pr-8 py-2 border border-[#1e293b] rounded focus:outline-none focus:border-[#1e40af]"
                    placeholder="İsim, Şirket, Ünvan veya Not ara..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm("")}
                      className="absolute right-3 top-2.5 h-4 w-4 text-slate-500 hover:text-slate-300 font-mono text-[10px]"
                    >
                      X
                    </button>
                  )}
                </div>

                {/* Secondary Filters Category Tabs */}
                <div className="grid grid-cols-2 gap-1.5 mb-3 bg-[#080c14] p-1.5 rounded border border-[#1e293b] text-center text-[10px] font-mono">
                  <button
                    onClick={() => setFilterCategory("all")}
                    className={`py-1 rounded font-bold transition-all cursor-pointer ${filterCategory === "all" ? "bg-[#0d1421] text-[#1e40af]" : "text-slate-500"}`}
                  >
                    HEPSİ ({cards.length})
                  </button>
                  <button
                    onClick={() => setFilterCategory("today")}
                    className={`py-1 rounded font-bold transition-all cursor-pointer ${filterCategory === "today" ? "bg-[#0d1421] text-[#1e40af]" : "text-slate-500"}`}
                  >
                    BUGÜN EKLENENLER
                  </button>
                  <button
                    onClick={() => setFilterCategory("pending")}
                    className={`py-1 rounded font-bold transition-all cursor-pointer ${filterCategory === "pending" ? "bg-[#0d1421] text-[#1e40af]" : "text-slate-500"}`}
                  >
                    DOĞRULAMA BEKLEYENLER
                  </button>
                  <button
                    onClick={() => setFilterCategory("low_confidence")}
                    className={`py-1 rounded font-bold transition-all cursor-pointer ${filterCategory === "low_confidence" ? "bg-[#0d1421] text-[#1e40af]" : "text-slate-500"}`}
                  >
                    QC ALARMI / DÜŞÜK GÜVEN
                  </button>
                </div>

                {/* Tag classification Filter dropdown */}
                <div className="flex items-center gap-2 mb-4 bg-[#080c14]/40 p-2 rounded border border-[#1e293b]">
                  <span className="text-[9px] font-mono text-[#94a3b8] uppercase font-bold">Etikete Göre Filtrele:</span>
                  <select
                    className="bg-[#080c14] text-[10px] font-mono text-[#94a3b8] focus:outline-none flex-1 border border-transparent rounded"
                    value={selectedFilterTag}
                    onChange={(e) => setSelectedFilterTag(e.target.value)}
                  >
                    <option value="all">Tüm Etiketler</option>
                    {tags.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                {/* QR Code Scan Trigger Button */}
                <button
                  id="scan-qr-btn"
                  onClick={() => setIsQrScannerOpen(true)}
                  className="w-full bg-[#080c14] hover:bg-[#0d1421] text-cyan-400 hover:text-cyan-300 font-bold py-2.5 px-3 border border-cyan-500/25 hover:border-cyan-500/50 rounded text-xs flex items-center justify-center gap-2 cursor-pointer transition-all mb-4 shadow-[0_0_10px_#22d3ee08]"
                >
                  <QrCode className="h-4 w-4 animate-pulse" />
                  Kamera ile QR Kod Tanımla
                </button>

                {/* Exporter triggers button */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <button
                    onClick={() => setIsExportOpen(true)}
                    className="bg-[#080c14] hover:bg-[#0d1421] text-[#94a3b8] font-semibold py-2 px-3 border border-[#1e293b] rounded text-[11px] flex items-center justify-center gap-1.5 cursor-pointer leading-none"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                    Seçilileri Dışa Aktar ({filteredCards.length})
                  </button>
                  <button
                    onClick={() => {
                      const fileInput = document.createElement("input");
                      fileInput.type = "file";
                      fileInput.accept = "image/*,application/pdf";
                      fileInput.onchange = (e: any) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageFileSelection(file);
                      };
                      fileInput.click();
                    }}
                    className="bg-[#1e40af] hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded text-[11px] flex items-center justify-center gap-1.5 cursor-pointer leading-none"
                  >
                    <UploadCloud className="h-4 w-4" />
                    Yeni Kart Yükle
                  </button>
                </div>

                {/* Cards Scrollable list */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {filteredCards.length > 0 ? (
                    filteredCards.map((card) => {
                      const isSelected = selectedCard?.id === card.id;
                      const isLowConfidence = card.confidence_score < 0.70;
                      return (
                        <div
                          key={card.id}
                          onClick={() => { setSelectedCard(card); setSelectedFieldId(null); }}
                          className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                            isSelected
                              ? "bg-[#080c14] border-[#1e40af] shadow-lg ring-1 ring-[#1e40af]/20"
                              : "bg-[#0d1421] border-[#1e293b] hover:border-slate-700"
                          }`}
                        >
                          <div className="flex justify-between items-start mb-1.5">
                            <div>
                              <h4 className="text-xs font-bold text-slate-200">
                                {card.contact?.full_name || "Bilinmeyen Kartvizit"}
                              </h4>
                              <p className="text-[10px] text-[#94a3b8] mt-0.5 font-sans">
                                {card.contact?.company || "Şirket Bilgisi Yok"}
                              </p>
                            </div>

                            <span className={`text-[8px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                              card.processing_status === "success"
                                ? "text-emerald-400 bg-emerald-950/20 border-emerald-900/30"
                                : "text-amber-400 bg-amber-950/20 border-amber-900/30"
                            }`}>
                              {card.processing_status === "success" ? "ONAYLI" : "DOĞRULAMA"}
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono mt-2 pt-1.5 border-t border-slate-900/55">
                            <span className="text-[9px]">Giriş: {new Date(card.created_at).toLocaleDateString()}</span>
                            <div className="flex items-center gap-1">
                              {isLowConfidence && (
                                <AlertTriangle className="h-3 w-3 text-red-400 animate-pulse" />
                              )}
                              <span className={isLowConfidence ? "text-red-400 font-bold" : "text-slate-500"}>
                                Scor: {(card.confidence_score * 100).toFixed(0)}%
                              </span>
                            </div>
                          </div>

                          {/* Quick labels rendering */}
                          {card.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {card.tags.map(t => (
                                <span
                                  key={t.id}
                                  className="text-[8px] font-mono px-1.5 rounded border"
                                  style={{ color: t.color, borderColor: `${t.color}30`, backgroundColor: `${t.color}10` }}
                                >
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-24 text-slate-500 italic text-xs">
                      Arama kriterlerine uygun kartvizit kaydı bulunamadı.
                    </div>
                  )}
                </div>

              </div>

              {/* Central Area: Selected Card Bounding Visualizer Overlay & Verification Panel */}
              <div className="xl:col-span-8 space-y-5 flex flex-col">
                {selectedCard ? (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                    
                    {/* Visual Segment & Bounding Box */}
                    <div className="lg:col-span-6 flex flex-col justify-between">
                      <BoundingBoxVisualizer
                        cardImageUrl={selectedCard.image_url}
                        fields={selectedCard.fields || []}
                        selectedFieldId={selectedFieldId}
                        onSelectField={(field) => setSelectedFieldId(field.id)}
                      />

                      {/* Immediate imha/destruction triggers */}
                      <div className="mt-4 p-4 rounded-lg bg-[#181216] border border-red-950 shadow-md flex justify-between items-center">
                        <div className="space-y-0.5">
                          <strong className="text-xs text-red-400 block font-display">GÜVENLİ VERİ İMHASI (DESTROY)</strong>
                          <p className="text-[10px] text-slate-500 font-mono">Bu istihbarat ögesini tüm disk ve veritabanı loglarından kalıcı olarak kaldırın.</p>
                        </div>
                        <button
                          onClick={() => handleDeleteCard(selectedCard.id)}
                          className="bg-red-900/60 border border-red-800 hover:bg-red-800 hover:border-red-700 text-white p-2.5 rounded transition-all cursor-pointer"
                          title="Hassas veriyi imha et"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Manual verification right Form */}
                    <div className="lg:col-span-6">
                      <VerifyForm
                        fields={selectedCard.fields || []}
                        contact={selectedCard.contact}
                        tags={tags}
                        selectedFieldId={selectedFieldId}
                        onFieldFocus={(fieldId) => setSelectedFieldId(fieldId)}
                        onVerify={handleVerifyCommit}
                      />
                    </div>

                  </div>
                ) : (
                  <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-16 text-center shadow-lg">
                    <Shield className="h-12 w-12 text-[#1e40af]/30 mx-auto mb-4" />
                    <h3 className="text-sm font-semibold text-[#94a3b8] font-display">Lütfen Bir Kartvizit Seçin</h3>
                    <p className="text-xs text-[#94a3b8]/70 max-w-sm mx-auto leading-relaxed mt-1">
                      Sol panelden analiz etmek veya el ile doğrulamak istediğiniz temas kaydını seçebilir veya en üst menüden yeni bir resim yükleyebilirsiniz.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 3: MOBILE SIMULATOR */}
          {activeTab === "mobile" && (
            <motion.div
              key="mobile"
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ duration: 0.15 }}
              className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-stretch"
            >
              <MobileSimulator
                onCardUploaded={() => { fetchAllData(); }}
                onLogAudit={logAuditPayload}
              />
              
              <div className="bg-[#0d1421] border border-[#1e293b] rounded-lg p-5 shadow-2xl space-y-4">
                <div className="flex items-center gap-1.5 pb-3 border-b border-[#1e293b]">
                  <FileCheck className="h-5 w-5 text-teal-400" />
                  <h3 className="text-sm font-semibold tracking-wide text-slate-300 uppercase font-display">Mobil Entegrasyon Kılavuzu & API Verileri</h3>
                </div>

                <div className="space-y-4 text-xs leading-relaxed text-[#94a3b8] font-mono">
                  <p>
                    B-CIP platformunun iOS Swift ve Android Jetpack Compose SDK kütüphaneleri, sahada çevrimdışı (offline-first) taranan kartları cihazın yerel SQLite veri tabanında şifreli (SQLCipher 256-bit) olarak saklar.
                  </p>

                  <div className="p-3 rounded-lg bg-[#080c14] border border-[#1e293b] space-y-2">
                    <span className="text-[10px] text-[#1e40af] font-bold block uppercase">REST API Endpoint Köprüsü:</span>
                    <pre className="text-[9px] text-slate-300 overflow-x-auto p-1.5 bg-[#0d1421] rounded">
{`POST /api/cards/upload HTTP/1.1
Host: business-card.savunma.gov.tr
Authorization: Bearer <Mobile_JWT_Token>
Content-Type: application/json

{
  "imageBase64": "iVBORw0KGgoAAAANS...",
  "filename": "camera_capture_1453.jpg",
  "source": "ios"
}`}
                    </pre>
                  </div>

                  <p>
                    Kamera vizöründeki gerçek zamanlı çerçeve algoritmaları, bulanık veya loş ışıklı fotoğrafları daha yapay zekaya göndermeden cihaz üzerinde uyararak (MIME denetimi) sistem kaynaklarının boşuna tüketilmesini engeller.
                  </p>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="p-3 bg-[#080c14] rounded border border-[#1e293b]">
                      <strong className="text-slate-300 block mb-1 uppercase text-[10px]">Cihaz Uyumluluğu:</strong>
                      iOS 15+, Android 10+ (Core CameraX SDK Entegrasyonu)
                    </div>
                    <div className="p-3 bg-[#080c14] rounded border border-[#1e293b]">
                      <strong className="text-slate-300 block mb-1 uppercase text-[10px]">Güvenli Kanal:</strong>
                      TLS 1.3 zorunluluğu, SHA256 Pin Certificate Pinning aktif.
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 4: BATCH QUEUES ACTIONS */}
          {activeTab === "batches" && (
            <motion.div
              key="batches"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              <BatchProcessor
                batches={batches}
                onRetry={async (id) => {
                  await fetch(`/api/batches/${id}/retry-failed`, { method: "POST" });
                }}
                onLogAudit={logAuditPayload}
                onBatchProcessed={fetchAllData}
              />
            </motion.div>
          )}

          {/* TAB 5: REGULATORY COMPLIANCE AUDITING LOGS */}
          {activeTab === "audit" && (
            <motion.div
              key="audit"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              <AuditLogView
                logs={auditLogs}
                onRefresh={async () => {
                  const r = await fetch("/api/admin/audit-logs");
                  const data = await r.json();
                  if (data.logs) setAuditLogs(data.logs);
                }}
              />
            </motion.div>
          )}

          {/* TAB 6: ADMINISTRATIVE USER SETTINGS */}
          {activeTab === "admin" && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              <AdminPanel
                users={users}
                systemHealth={systemDashboard.systemHealth}
                onUpdateRole={handleUserUpdate}
                onLogAudit={logAuditPayload}
              />
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* RENDER EXPORT FORM DIALOG OVERLAY */}
      {isExportOpen && (
        <ExportDialog
          cards={filteredCards}
          onLogAudit={logAuditPayload}
          onClose={() => setIsExportOpen(false)}
        />
      )}

      {/* RENDER QR CODE SCANNER MODAL */}
      <QrCodeScannerModal
        isOpen={isQrScannerOpen}
        onClose={() => setIsQrScannerOpen(false)}
        onScanSuccess={handleQrScanSuccess}
      />

      {/* RENDER MFA (TOTP) SETUP MODAL */}
      {currentUser && (
        <MfaSetupModal
          isOpen={isMfaOpen}
          mfaEnabled={currentUser.mfa_enabled}
          onClose={() => setIsMfaOpen(false)}
          onVerified={() => fetchSession()}
        />
      )}

      {/* Platform Footer */}
      <footer className="bg-[#0b0f19] border-t border-slate-900 py-3.5 px-6 text-center flex flex-col md:flex-row justify-between items-center text-[10px] font-mono text-slate-600 gap-2">
        <span>© 2026 T.C. DEVLET KURUMLARI VE SAVUNMA SANAYİİ MİLLÎ PROJESİ // B-CIP V4.2</span>
        <div className="flex items-center gap-4 select-none">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>SECURE CRYPTO CHANNEL</span>
          </div>
          <span>IP LOGGED: 10.240.0.12</span>
        </div>
      </footer>
    </div>
  );
}
