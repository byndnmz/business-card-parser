/**
 * dictionaries.ts — Sözlükler ve kalıplar (kod mantığı değil, AYARLANABİLİR VERİ).
 *
 * Türkçe + İngilizce kartvizit alanlarını skorlamak için kullanılan sözcük
 * listeleri, yasal ekler, şehir/il listesi, isim sinyalleri ve OCR karışıklık
 * haritaları. Yeni terim eklemek = bu listeye eklemek (kod değişmez).
 */

// --- UNVAN (title) ----------------------------------------------------------
// Türkçe kökler EK-TOLERANSLI eşleşir ("Müdür" → "Müdürü", "Lider" → "Lideri").
// İngilizce sözcükler tam sınırlıdır.
export const TITLE_KEYWORDS_TR = [
  "genel müdür", "müdür", "yönetici", "direktör", "uzman", "mühendis", "lider",
  "şef", "başkan", "koordinatör", "sorumlu", "danışman", "geliştirici",
  "başmühendis", "amir", "teknisyen", "analist", "mimar", "satış temsilcisi",
  "temsilci", "avukat", "doktor", "müsteşar", "genel sekreter", "başkan yardımcısı",
  "ar-ge", "proje yöneticisi", "ürün müdürü", "operasyon", "pazarlama",
];
export const TITLE_KEYWORDS_EN = [
  "engineer", "manager", "director", "specialist", "officer", "chief", "head",
  "lead", "developer", "consultant", "architect", "ceo", "cto", "cfo", "coo",
  "cio", "president", "vp", "vice president", "founder", "co-founder", "partner",
  "analyst", "designer", "coordinator", "supervisor", "executive", "representative",
];
/** Unvan ön-ekleri (isim satırında da görülebilir; isim tespitinde hariç tutulur). */
export const TITLE_PREFIXES = ["dr", "prof", "doç", "yrd", "av", "müh", "uzm", "öğr"];

// --- ŞİRKET (company) -------------------------------------------------------
/** Yasal ekler — ÇOK GÜÇLÜ şirket sinyali. */
export const COMPANY_LEGAL_SUFFIXES = [
  "a.ş.", "a.ş", "aş", "ltd. şti.", "ltd şti", "ltd.şti.", "ltd", "şti",
  "san. tic.", "san. ve tic.", "san ve tic", "sanayi ve ticaret",
  "inc", "inc.", "llc", "gmbh", "corp", "corp.", "co.", "ltd.", "plc",
  "holding", "group", "grup", "s.a.", "sa", "ag", "bv", "n.v.",
];
/** Sektör sözcükleri — orta güçte şirket sinyali. */
export const COMPANY_SECTOR_WORDS = [
  "teknoloji", "teknolojileri", "savunma", "sanayi", "sanayii", "ticaret",
  "sistem", "sistemleri", "elektronik", "yazılım", "bilişim", "mühendislik",
  "danışmanlık", "havacılık", "uzay", "enerji", "inşaat", "lojistik",
  "otomotiv", "makine", "endüstri", "technology", "technologies", "systems",
  "electronics", "software", "defense", "defence", "aerospace", "solutions",
  "engineering", "industries", "consulting", "logistics", "energy",
];

// --- DEPARTMAN (department) -------------------------------------------------
export const DEPARTMENT_KEYWORDS = [
  "daire", "müdürlüğü", "müdürlük", "departman", "departmanı", "birim", "birimi",
  "şube", "şubesi", "bölüm", "bölümü", "başkanlığı", "başkanlık", "direktörlüğü",
  "division", "department", "unit", "office",
];

// --- ADRES (address) --------------------------------------------------------
export const ADDRESS_KEYWORDS = [
  "mah.", "mahalle", "mahallesi", "cad.", "cadde", "caddesi", "sok.", "sokak",
  "sokağı", "bulvar", "bulvarı", "blok", "no:", "no.", "kat:", "kat ", "daire:",
  "d:", "osb", "organize sanayi", "yerleşke", "plaza", "sanayi sitesi", "sitesi",
  "apt", "apartmanı", "iş merkezi", "kule", "cd.", "blv.",
];

// --- TÜRKİYE 81 İL (şehir/ülke tahmini) ------------------------------------
export const TR_PROVINCES = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ankara",
  "Antalya", "Ardahan", "Artvin", "Aydın", "Balıkesir", "Bartın", "Batman",
  "Bayburt", "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa",
  "Çanakkale", "Çankırı", "Çorum", "Denizli", "Diyarbakır", "Düzce", "Edirne",
  "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep", "Giresun",
  "Gümüşhane", "Hakkari", "Hatay", "Iğdır", "Isparta", "İstanbul", "İzmir",
  "Kahramanmaraş", "Karabük", "Karaman", "Kars", "Kastamonu", "Kayseri",
  "Kırıkkale", "Kırklareli", "Kırşehir", "Kilis", "Kocaeli", "Konya", "Kütahya",
  "Malatya", "Manisa", "Mardin", "Mersin", "Muğla", "Muş", "Nevşehir", "Niğde",
  "Ordu", "Osmaniye", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas",
  "Şanlıurfa", "Şırnak", "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Uşak",
  "Van", "Yalova", "Yozgat", "Zonguldak",
];
/** Sık geçen ilçe/semtler (şehir bağlamı güçlendirme). */
export const TR_DISTRICTS = [
  "Çankaya", "Keçiören", "Yenimahalle", "Etimesgut", "Elmadağ", "Gölbaşı",
  "Kadıköy", "Beşiktaş", "Şişli", "Üsküdar", "Maltepe", "Pendik", "Tuzla",
  "Gebze", "Çorlu", "Bornova", "Konak", "Nilüfer", "Osmangazi", "Selçuklu",
];
export const COUNTRY_TOKENS = [
  { match: /\bt[üu]rkiye\b|\bturkey\b|\bt[üu]rkey\b/i, value: "Türkiye" },
];

// --- İSİM (name) sinyali ----------------------------------------------------
/** Yaygın Türkçe adlar — isim skorunu güçlendiren YUMUŞAK sinyal (kapsayıcı değil). */
export const TR_COMMON_NAMES = [
  "ahmet", "mehmet", "mustafa", "ali", "hasan", "hüseyin", "ibrahim", "ismail",
  "osman", "yusuf", "murat", "ömer", "kemal", "emre", "burak", "can", "cem",
  "deniz", "engin", "fatih", "gökhan", "halil", "kaan", "levent", "onur",
  "selim", "serkan", "tolga", "ufuk", "volkan", "yiğit", "ayşe", "fatma",
  "emine", "hatice", "zeynep", "elif", "meryem", "şerife", "sultan", "selin",
  "aylin", "büşra", "ceren", "dilara", "esra", "gül", "merve", "nur", "özlem",
  "pınar", "sema", "seda", "tuğçe", "yasemin", "zehra", "sadık", "şahin",
];
export const TR_COMMON_SURNAMES = [
  "yılmaz", "kaya", "demir", "şahin", "çelik", "yıldız", "yıldırım", "öztürk",
  "aydın", "özdemir", "arslan", "doğan", "kılıç", "aslan", "çetin", "kara",
  "koç", "kurt", "özkan", "şimşek", "polat", "korkmaz", "çakır", "erdoğan",
  "kaplan", "şahiner", "demirci", "aksoy", "bulut",
];

// --- VKN / VERGİ NO ---------------------------------------------------------
/** Vergi Kimlik Numarası 10 hane; bağlam sözcükleri. */
export const VKN_CONTEXT = ["vkn", "vergi no", "vergi kimlik", "tax id", "tax no", "v.d.", "vergi dairesi"];

// --- SOSYAL MEDYA -----------------------------------------------------------
export const SOCIAL_DOMAINS = [
  { key: "linkedin", host: "linkedin.com", path: /linkedin\.com\/(?:in|company)\/[A-Za-z0-9\-_%.]+/i },
  { key: "twitter", host: "twitter.com", path: /(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+/i },
  { key: "instagram", host: "instagram.com", path: /instagram\.com\/[A-Za-z0-9_.]+/i },
  { key: "facebook", host: "facebook.com", path: /facebook\.com\/[A-Za-z0-9.]+/i },
];

// --- OCR KARIŞIKLIK HARİTALARI (ölçülü düzeltme) ---------------------------
// SADECE düşük güven + sözlük doğrulamasıyla uygulanır. Kör düzeltme yapılmaz.
export const OCR_CONFUSIONS: Record<string, string[]> = {
  // Türkçe karakter ve rakam/harf karışıklıkları
  "İ": ["I", "l", "1", "|"],
  "I": ["İ", "l", "1", "|"],
  "ı": ["i", "1", "l"],
  "O": ["0"],
  "0": ["O", "o"],
  "Ş": ["S", "5"],
  "ş": ["s"],
  "Ğ": ["G"],
  "ğ": ["g"],
  "Ü": ["U"],
  "Ö": ["O", "0"],
  "Ç": ["C"],
  "ç": ["c"],
  "B": ["8"],
  "S": ["5", "Ş"],
};

// --- TLD'LER (web/e-posta domain ayrımı) ------------------------------------
export const KNOWN_TLDS = [
  "com", "net", "org", "gov", "edu", "mil", "io", "co", "biz", "info", "app",
  "dev", "tech", "tr", "com.tr", "gov.tr", "org.tr", "edu.tr", "mil.tr",
  "k12.tr", "bel.tr", "mss", "de", "uk", "us", "fr", "nl",
];
