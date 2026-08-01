/**
 * Database types mirroring supabase/schema.sql. Generate the real types with:
 *   npx supabase gen types typescript --project-id <id> > lib/supabase/types.ts
 * This hand-written version keeps the app typed before that step.
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
          listing: Json; // normalized Listing snapshot
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
        Update: Partial<Database["public"]["Tables"]["favorites"]["Insert"]>;
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
        Update: Partial<
          Database["public"]["Tables"]["saved_searches"]["Insert"]
        >;
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
          marketplaces: string[];
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["recent_searches"]["Insert"]
        >;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
