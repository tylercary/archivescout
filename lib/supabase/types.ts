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
          alert_lease_until: string | null;
          alert_lease_owner: string | null;
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
          alert_lease_until?: string | null;
          alert_lease_owner?: string | null;
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
          alert_lease_until?: string | null;
          alert_lease_owner?: string | null;
        };
        Relationships: [];
      };
      saved_search_listing_snapshots: {
        Row: {
          id: string;
          saved_search_id: string;
          marketplace: string;
          external_listing_id: string;
          last_price: number | null;
          currency: string;
          first_seen_at: string;
          last_seen_at: string;
          last_notified_price: number | null;
          is_active: boolean;
          listing_snapshot: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          saved_search_id: string;
          marketplace: string;
          external_listing_id: string;
          last_price?: number | null;
          currency?: string;
          first_seen_at?: string;
          last_seen_at?: string;
          last_notified_price?: number | null;
          is_active?: boolean;
          listing_snapshot?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          saved_search_id?: string;
          marketplace?: string;
          external_listing_id?: string;
          last_price?: number | null;
          currency?: string;
          first_seen_at?: string;
          last_seen_at?: string;
          last_notified_price?: number | null;
          is_active?: boolean;
          listing_snapshot?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      saved_search_alert_events: {
        Row: {
          id: string;
          saved_search_id: string;
          user_id: string;
          event_type: string;
          marketplace: string;
          external_listing_id: string;
          previous_price: number | null;
          current_price: number | null;
          currency: string;
          listing_snapshot: Json;
          dedupe_key: string;
          delivery_status: string;
          created_at: string;
          delivered_at: string | null;
        };
        Insert: {
          id?: string;
          saved_search_id: string;
          user_id: string;
          event_type: string;
          marketplace: string;
          external_listing_id: string;
          previous_price?: number | null;
          current_price?: number | null;
          currency?: string;
          listing_snapshot?: Json;
          dedupe_key: string;
          delivery_status?: string;
          created_at?: string;
          delivered_at?: string | null;
        };
        Update: {
          id?: string;
          saved_search_id?: string;
          user_id?: string;
          event_type?: string;
          marketplace?: string;
          external_listing_id?: string;
          previous_price?: number | null;
          current_price?: number | null;
          currency?: string;
          listing_snapshot?: Json;
          dedupe_key?: string;
          delivery_status?: string;
          created_at?: string;
          delivered_at?: string | null;
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
