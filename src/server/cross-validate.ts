/**
 * cross-validate.ts — Alanlar arası TUTARLILIK denetimi + güven ayarı.
 *
 * E-posta domaini ↔ şirket ↔ web sitesi uyumluysa güven ARTAR; çelişki varsa
 * işaretlenir. Web sitesi yoksa e-posta domaininden DÜŞÜK güvenle türetilir.
 */

import type { FieldHit } from "./schema";
import { THRESHOLDS } from "./config/thresholds";
import { domainMatchesCompany } from "./extractors/semantic";
import { makeHit } from "./extractors/util";

function host(website: string): string {
  return website.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}
function core(domain: string): string {
  return (domain.split(".")[0] || "").toLowerCase();
}
const FREE_MAIL = new Set(["gmail", "hotmail", "outlook", "yahoo", "icloud", "yandex", "live"]);

export interface CrossResult { hits: FieldHit[]; warnings: string[]; }

export function crossValidate(hits: FieldHit[]): CrossResult {
  const warnings: string[] = [];
  const out = [...hits];
  const byName = (n: string) => out.find((h) => h.field_name === n);

  const email = byName("email");
  const website = byName("website");
  const company = byName("company");

  const emailDomain = email?.value.includes("@") ? email.value.split("@")[1] : "";
  const emailCore = emailDomain ? core(emailDomain) : "";
  const emailIsFree = emailCore ? FREE_MAIL.has(emailCore) : true;

  // 1) Web sitesi yoksa, kurumsal e-posta domaininden türet (düşük güven).
  if (!website && emailDomain && !emailIsFree) {
    out.push(makeHit("website", emailDomain.toLowerCase(), 0.6,
      email!.bbox, "website:from-email", { signals: { derived: 1 } }));
  }

  const web = byName("website");
  const webCore = web ? core(host(web.value)) : "";

  const boost = (h: FieldHit | undefined, why: string) => {
    if (!h) return;
    h.confidence = Number(Math.min(1, h.confidence + THRESHOLDS.crossValidateBoost).toFixed(3));
    h.needsReview = h.confidence < THRESHOLDS.reviewBelow;
    h.signals = { ...(h.signals || {}), [why]: 1 };
  };

  // 2) E-posta domaini ↔ web sitesi tutarlı → ikisini de güçlendir.
  if (emailCore && webCore && (emailCore === webCore || emailCore.includes(webCore) || webCore.includes(emailCore))) {
    boost(email, "xv_email_web");
    boost(web, "xv_email_web");
  }

  // 3) Şirket ↔ e-posta domaini tutarlı → şirketi güçlendir.
  if (company && emailCore && !emailIsFree && domainMatchesCompany(company.value, emailCore)) {
    boost(company, "xv_company_domain");
  } else if (company && emailCore && !emailIsFree && web && !domainMatchesCompany(company.value, emailCore)) {
    // Çelişki: şirket adı ne e-posta ne web domainine uymuyor → işaretle (hata değil).
    company.needsReview = true;
    warnings.push(`Şirket adı e-posta/web domaini ile eşleşmiyor — doğrulanmalı: "${company.value}"`);
  }

  return { hits: out, warnings };
}
