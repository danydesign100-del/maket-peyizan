/** True in the test version (built with `--mode test`, its own Supabase project). */
export const isTestVersion = import.meta.env.MODE === 'test'

export const TEST_VERSION_NOTICE = 'Données fictives, séparées de la vraie boutique.'
