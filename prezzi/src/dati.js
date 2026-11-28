// Da dove il job legge i file già pubblicati (quelli che l'app scarica): la variabile DATI_URL, che
// scripts/dati-supabase.sh esporta. Dal 19 novembre 2026 Cloudflare R2 (https://dati.collectorone.app): il traffico del
// piano gratuito di Supabase era superato e le letture del job ne erano quasi tutto.
// I percorsi sono gli stessi nei due posti: prezzi/v1/…, carte/v1/…, storico/v1/…, giochi/v1/…
const R2_DATI = "https://dati.collectorone.app";
export const DATI = (process.env.DATI_URL || R2_DATI).replace(/\/+$/, "");
