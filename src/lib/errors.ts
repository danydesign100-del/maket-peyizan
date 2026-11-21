// Readable French messages for errors coming from Supabase, the local server or
// the browser. Supabase answers with plain objects ({ message, code }), not Error
// instances: reading only `instanceof Error` loses the real reason.

const RULES: [RegExp, string | ((match: RegExpMatchArray) => string)][] = [
  [/Insufficient stock for (.+)/i, (match) => `Stock insuffisant pour ${match[1]}`],
  [/^Insufficient stock$/i, 'Stock insuffisant'],
  [/Open a cash session first/i, 'Aucune session de caisse ouverte : ouvrez la caisse avant de vendre'],
  [/A cash session is already open/i, 'Une session de caisse est déjà ouverte'],
  [/Payment total does not match sale total|Payment total mismatch/i, 'Le montant payé ne correspond pas au total de la vente'],
  [/Product unavailable/i, 'Produit indisponible ou désactivé'],
  [/Customer unavailable/i, 'Client indisponible ou désactivé'],
  [/Invalid discount/i, 'Remise supérieure au montant de la ligne'],
  [/Invalid payment/i, 'Mode ou montant de paiement invalide'],
  [/Invalid sale item/i, 'Quantité ou remise invalide dans le panier'],
  [/Cart is empty/i, 'Panier vide'],
  [/Payment required/i, 'Paiement manquant'],
  [/Opening amount must be zero or greater/i, 'Le montant d’ouverture doit être positif ou nul'],
  [/Permission denied|permission refusée|row-level security|42501/i, 'Action non autorisée pour votre rôle'],
  [/JWT expired|invalid jwt|not authenticated|non authentifi/i, 'Session expirée : reconnectez-vous'],
  [/failed to fetch|networkerror|network request failed|load failed/i, 'Connexion impossible avec le serveur'],
]

/** Message of any error value, translated when it is a known server message. */
export function errorText(cause: unknown, fallback = 'Opération refusée'): string {
  const raw = typeof cause === 'string' ? cause
    : cause instanceof Error ? cause.message
    : String((cause as { message?: unknown } | null)?.message ?? '')
  const message = raw.trim()
  if (!message) return fallback
  for (const [pattern, replacement] of RULES) {
    const match = message.match(pattern)
    if (match) return typeof replacement === 'string' ? replacement : replacement(match)
  }
  return message
}
