import { MOVEMENT_TYPES, type CashMovementType } from '../services/cashService'

// Readable French labels for the action codes written to the audit log.
const LABELS: Record<string, string> = {
  account_created: 'Compte comptable créé',
  account_updated: 'Compte comptable modifié',
  journal_entry_posted: 'Écriture validée',
  journal_entry_voided: 'Écriture annulée',
  partner_created: 'Associé ajouté',
  partner_updated: 'Associé modifié',
  cash_difference_validated: 'Écart de caisse validé',
  cash_movement_approved: 'Sortie de caisse autorisée',
  cash_movement_rejected: 'Sortie de caisse refusée',
  expense_cancelled: 'Dépense annulée',
  user_created: 'Compte utilisateur créé',
  user_updated: 'Compte utilisateur modifié',
  user_password_reset: 'Mot de passe réinitialisé',
  role_permissions_updated: 'Permissions d’un rôle modifiées',
  sale_refunded: 'Vente remboursée (retour)',
  sale_cancelled: 'Vente annulée',
  INSERT: 'Création',
  UPDATE: 'Modification',
  DELETE: 'Suppression',
}

export function auditLabel(action: string): string {
  if (LABELS[action]) return LABELS[action]
  const movement = action.match(/^cash_movement_(.+)$/)?.[1] as CashMovementType | undefined
  if (movement && MOVEMENT_TYPES[movement]) return `Mouvement de caisse : ${MOVEMENT_TYPES[movement].label}`
  return action.replace(/_/g, ' ')
}
