# CollectorOne · dati pubblici

- `main`: sito (https://collectorone.app/, il vecchio cartella-tcg/ porta lì) e job che aggiornano i dati.
- Job "Dati notturni" (`scripts/job-notte.sh`): prezzi per lingua, cataloghi, date dei set, correzioni
  Cardmarket ogni notte e immagini di riserva il lunedì; i file vanno su https://dati.collectorone.app (Cloudflare R2).
- `prezzi` e `immagini`: vecchi branch dei dati (l'app li usa solo come riserva).
- `apk`: CollectorOne.apk da installare.

Pubblicato dal progetto CollectorOne (privato): non modificare a mano.
