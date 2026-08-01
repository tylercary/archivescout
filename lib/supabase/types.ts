/**
 * Database types mirroring supabase/schema.sql + supabase/migrations/.
 *
 * Hand-written, but shaped exactly like `supabase gen types typescript`
 * output — including the `Views` / `Functions` / `Enums` / `CompositeTypes`
 * keys, which supabase-js's generics REQUIRE. Omitting them makes every
 * `.insert()` / `.update()` parameter resolve to `never`.
 *
 * Regenerate the real thing once the CLI is linked:
 *   npx supabase gen types typescript --project-id <ref> > lib/supabase/types.ts
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      favorites: {
        Row: {
          id: string;
          user_id: string;
          listing_id: string;
          marketplace: string;
          listing: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          listing_id: string;
          marketplace: string;
          listing: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          listing_id?: string;
          marketplace?: string;
          listing?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      saved_searches: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          query: string;
          marketplaces: string[];
          /** ArchiveScout's NORMALIZED filter model — never marketplace syntax. */
          filters: Json;
          sort: string;
          max_desired_price: number | null;
          price_alert: boolean;
          created_at: string;
          updated_at: string;
          last_checked_at: string | null;
          is_notification_enabled: boolean;
          notification_types: string[];
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string;
          query: string;
          marketplaces: string[];
          filters: Json;
          sort?: string;
          max_desired_price?: number | null;
          price_alert?: boolean;
          created_at?: string;
          updated_at?: string;
          last_checked_at?: string | null;
          is_notification_enabled?: boolean;
          notification_types?: string[];
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          query?: string;
          marketplaces?: string[];
          filters?: Json;
          sort?: string;
          max_desired_price?: number | null;
          price_alert?: boolean;
          created_at?: string;
          updated_at?: string;
          last_checked_at?: string | null;
          is_notification_enabled?: boolean;
          notification_types?: string[];
        };
        Relationships: [];
      };
      recent_searches: {
        Row: {
          id: string;
          user_id: string;
          query: string;
          marketplaces: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          query: string;
          marketplaces?: string[];
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          query?: string;
          marketplaces?: string[];
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
