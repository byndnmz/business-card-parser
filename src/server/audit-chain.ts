/**
 * audit-chain.ts — Kurcalama-kanıtı (tamper-evident) denetim günlüğü zinciri.
 *
 * Her audit kaydı, bir önceki kaydın hash'ini içerir (blockchain benzeri zincir):
 *   entry_hash = SHA256( prev_hash + canonical(entry) )
 * Tek bir kaydın bile sonradan değiştirilmesi (silme/düzenleme) zinciri kırar ve
 * doğrulama (verifyChain) tarafından tespit edilir. Bu, "denetlenebilirlik" ve
 * "değişmez audit log" gereksinimini kriptografik olarak destekler.
 */

import crypto from "crypto";

export const GENESIS_HASH = "0".repeat(64);

export interface ChainEntry {
  id: string;
  seq: number;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: string;
  new_value: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  prev_hash?: string;
  entry_hash?: string;
}

/** Hash'lenecek alanların deterministik (stabil) gösterimi. */
function canonical(e: ChainEntry): string {
  return JSON.stringify([
    e.seq,
    e.id,
    e.user_id,
    e.action,
    e.entity_type,
    e.entity_id,
    e.old_value,
    e.new_value,
    e.ip_address,
    e.user_agent,
    e.created_at,
  ]);
}

export function computeHash(prevHash: string, entry: ChainEntry): string {
  return crypto.createHash("sha256").update(prevHash + canonical(entry)).digest("hex");
}

/**
 * Bir koleksiyon audit kaydından tutarlı bir zincir kurar:
 * created_at + id'ye göre kronolojik sıralar, seq/prev_hash/entry_hash atar.
 * Firestore'dan sırasız yüklemeye karşı dayanıklıdır. Açılışta çağrılır.
 */
export function rebuildChain(entries: ChainEntry[]): {
  entries: ChainEntry[];
  head: { seq: number; entry_hash: string };
  nextSeq: number;
} {
  const sorted = [...entries].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  let prev = GENESIS_HASH;
  sorted.forEach((e, i) => {
    e.seq = i;
    e.prev_hash = prev;
    e.entry_hash = computeHash(prev, e);
    prev = e.entry_hash;
  });
  const head =
    sorted.length > 0
      ? { seq: sorted[sorted.length - 1].seq, entry_hash: sorted[sorted.length - 1].entry_hash! }
      : { seq: -1, entry_hash: GENESIS_HASH };
  return { entries: sorted, head, nextSeq: sorted.length };
}

/**
 * Zincir bütünlüğünü doğrular. seq'e göre sıralayıp her kaydı yeniden hash'leyerek
 * saklanan entry_hash ve prev_hash bağlantısını karşılaştırır.
 * @returns ok=true ise sağlam; değilse ilk kırılma noktası (brokenAt) raporlanır.
 */
export function verifyChain(entries: ChainEntry[]): {
  ok: boolean;
  total: number;
  brokenAt?: { seq: number; id: string; reason: string };
} {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS_HASH;
  for (const e of sorted) {
    if (e.prev_hash !== prev) {
      return { ok: false, total: sorted.length, brokenAt: { seq: e.seq, id: e.id, reason: "prev_hash uyuşmuyor (zincir kopması)" } };
    }
    const recomputed = computeHash(prev, e);
    if (recomputed !== e.entry_hash) {
      return { ok: false, total: sorted.length, brokenAt: { seq: e.seq, id: e.id, reason: "entry_hash uyuşmuyor (kayıt değiştirilmiş)" } };
    }
    prev = e.entry_hash!;
  }
  return { ok: true, total: sorted.length };
}
