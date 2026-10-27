export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
type Table = { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] }
/** Type de transition : à régénérer depuis Supabase après application de la migration. */
export type Database = { public: { Tables: { [key: string]: Table }; Views: Record<string, never>; Functions: { [key: string]: { Args: Record<string, unknown>; Returns: unknown } }; Enums: Record<string, never>; CompositeTypes: Record<string, never> } }
