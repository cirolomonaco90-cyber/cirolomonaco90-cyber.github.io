# CollectorOne · dati pubblici

- `main`: sito (https://cirolomonaco90-cyber.github.io/cartella-tcg/) e job che aggiornano i dati.
- Job "Dati notturni" (`scripts/job-notte.sh`): prezzi per lingua, cataloghi, date dei set, correzioni
  Cardmarket ogni notte e immagini di riserva il lunedì; i file vanno nello spazio pubblico "dati" di Supabase.
- `prezzi` e `immagini`: vecchi branch dei dati (l'app li usa solo come riserva).
- `apk`: CollectorOne.apk da installare.

Pubblicato dal progetto CollectorOne (privato): non modificare a mano.
