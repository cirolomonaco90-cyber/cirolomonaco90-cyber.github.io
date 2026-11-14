// Da dove il job legge i file già pubblicati (quelli che l'app scarica): la variabile DATI_URL, che
// scripts/dati-supabase.sh esporta. Oggi lo spazio file "dati" di Supabase; con i file su Cloudflare R2
// (novembre 2026: il traffico del piano gratuito di Supabase era superato) diventa https://dati.collectorone.app.
// I percorsi sono gli stessi nei due posti: prezzi/v1/…, carte/v1/…, storico/v1/…, giochi/v1/…
export const SUPABASE_DATI = "https://lafgthxgasunkxrgwqng.supabase.co/storage/v1/object/public/dati";
export const DATI = (process.env.DATI_URL || SUPABASE_DATI).replace(/\/+$/, "");
