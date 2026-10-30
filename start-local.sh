#!/usr/bin/env bash
# Installe et lance Makèt Peyizan en mode local (SQLite), sans Supabase.
# Usage : ./start-local.sh            installe si besoin puis lance
#         ./start-local.sh --reset-db réinitialise la base de démonstration (efface les données)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$ROOT/server"
DB_FILE="$SERVER_DIR/maket-peyizan.db"
API_PORT="${PORT:-3001}"
RESET_DB=false
[[ "${1:-}" == "--reset-db" ]] && RESET_DB=true

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mErreur :\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Prérequis
command -v node >/dev/null || fail "Node.js est introuvable. Installez Node.js 20+ (https://nodejs.org)."
command -v npm >/dev/null || fail "npm est introuvable."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || fail "Node.js 20+ requis (version actuelle : $(node -v))."

if lsof -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Le port $API_PORT est déjà utilisé. Arrêtez l'autre processus ou lancez avec PORT=xxxx."
fi

# 2. Configuration du frontend
if [[ ! -f "$ROOT/.env.local" ]]; then
  log "Création de .env.local (mode local)"
  cat > "$ROOT/.env.local" <<EOF
VITE_USE_LOCAL_DB=true
VITE_API_URL=http://localhost:$API_PORT
EOF
elif ! grep -q '^VITE_USE_LOCAL_DB=true' "$ROOT/.env.local"; then
  log "Attention : .env.local existe sans VITE_USE_LOCAL_DB=true — le frontend utilisera Supabase."
fi

# 3. Dépendances
log "Installation des dépendances du serveur"
(cd "$SERVER_DIR" && npm install --no-fund --no-audit)
log "Installation des dépendances du frontend"
(cd "$ROOT" && npm install --no-fund --no-audit)

# 4. Base de données (jamais écrasée sans --reset-db)
if [[ ! -f "$DB_FILE" ]]; then
  log "Création de la base de démonstration"
  (cd "$SERVER_DIR" && npm run init-db)
elif $RESET_DB; then
  BACKUP="$DB_FILE.backup-$(date +%Y%m%d-%H%M%S)"
  log "Sauvegarde de la base actuelle vers $BACKUP puis réinitialisation"
  cp "$DB_FILE" "$BACKUP"
  (cd "$SERVER_DIR" && npm run init-db)
else
  log "Base existante conservée ($DB_FILE)"
fi

# 5. Lancement de l'API, arrêtée automatiquement à la sortie
log "Démarrage de l'API sur http://localhost:$API_PORT"
(cd "$SERVER_DIR" && PORT="$API_PORT" exec node server.js) &
API_PID=$!
trap 'log "Arrêt de l API"; kill "$API_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 30); do
  curl -sf "http://localhost:$API_PORT/health" >/dev/null 2>&1 && break
  kill -0 "$API_PID" 2>/dev/null || fail "L'API s'est arrêtée au démarrage (voir les messages ci-dessus)."
  sleep 1
done
curl -sf "http://localhost:$API_PORT/health" >/dev/null 2>&1 || fail "L'API ne répond pas sur /health."

# 6. Lancement du frontend
log "Démarrage du frontend — connexion : admin@maketpeyizan.com / admin123"
log "Ctrl+C pour tout arrêter"
cd "$ROOT"
npx vite --open
