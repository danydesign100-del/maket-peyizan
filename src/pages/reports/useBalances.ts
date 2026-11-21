import { useEffect, useState } from 'react'
import { ledgerService } from '../../services/ledgerService'
import type { AccountBalance } from '../../types/accounting'

/** account_balances(from, to), reloaded when the dates change. */
export function useBalances(from: string | null, to: string | null, enabled = true) {
  const [balances, setBalances] = useState<AccountBalance[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let current = true
    setBalances(null); setError(null)
    void ledgerService.balances(from, to).then(({ data, error: loadError }) => {
      if (!current) return
      if (loadError) setError(loadError.message)
      else setBalances(data ?? [])
    })
    return () => { current = false }
  }, [from, to, enabled])
  return { balances, error }
}
