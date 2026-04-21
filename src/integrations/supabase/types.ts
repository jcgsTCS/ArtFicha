export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      art_drafts: {
        Row: {
          artist: string | null
          ai_trace: Json
          attribution_status: string
          artwork_name: string | null
          category: string | null
          condition: number | null
          condition_details: string | null
          created_at: string
          description: string | null
          estimated_minutes_saved: number
          final_description: string | null
          final_title: string | null
          generated_at: string
          generated_description: string | null
          generated_snapshot: Json | null
          generated_title: string | null
          id: string
          id_section: number | null
          image_url: string | null
          import_batch_id: string | null
          inherited_artist: string | null
          inherited_category: string | null
          inherited_measures: string | null
          inherited_price: number | null
          is_user_edited: boolean
          original_image_url: string | null
          manual_edit_count: number
          measures: string | null
          observations: string | null
          parsing_warnings: Json
          price: string | null
          processed_image_url: string | null
          publication_status: string
          publish_attempts: number
          published_image_url: string | null
          quality_score: number
          review_checklist: Json
          review_completed_at: string | null
          review_status: string
          scene_type: string | null
          source_path: string | null
          source_type: string
          status: string
          tc_external_id: number | null
          tc_last_error: string | null
          tc_last_response: Json | null
          tc_published_at: string | null
          title: string | null
          updated_at: string
          user_edited_fields: Json
          user_id: string | null
        }
        Insert: {
          artist?: string | null
          ai_trace?: Json
          attribution_status?: string
          artwork_name?: string | null
          category?: string | null
          condition?: number | null
          condition_details?: string | null
          created_at?: string
          description?: string | null
          estimated_minutes_saved?: number
          final_description?: string | null
          final_title?: string | null
          generated_at?: string
          generated_description?: string | null
          generated_snapshot?: Json | null
          generated_title?: string | null
          id?: string
          id_section?: number | null
          image_url?: string | null
          import_batch_id?: string | null
          inherited_artist?: string | null
          inherited_category?: string | null
          inherited_measures?: string | null
          inherited_price?: number | null
          is_user_edited?: boolean
          original_image_url?: string | null
          manual_edit_count?: number
          measures?: string | null
          observations?: string | null
          parsing_warnings?: Json
          price?: string | null
          processed_image_url?: string | null
          publication_status?: string
          publish_attempts?: number
          published_image_url?: string | null
          quality_score?: number
          review_checklist?: Json
          review_completed_at?: string | null
          review_status?: string
          scene_type?: string | null
          source_path?: string | null
          source_type?: string
          status?: string
          tc_external_id?: number | null
          tc_last_error?: string | null
          tc_last_response?: Json | null
          tc_published_at?: string | null
          title?: string | null
          updated_at?: string
          user_edited_fields?: Json
          user_id?: string | null
        }
        Update: {
          artist?: string | null
          ai_trace?: Json
          attribution_status?: string
          artwork_name?: string | null
          category?: string | null
          condition?: number | null
          condition_details?: string | null
          created_at?: string
          description?: string | null
          estimated_minutes_saved?: number
          final_description?: string | null
          final_title?: string | null
          generated_at?: string
          generated_description?: string | null
          generated_snapshot?: Json | null
          generated_title?: string | null
          id?: string
          id_section?: number | null
          image_url?: string | null
          import_batch_id?: string | null
          inherited_artist?: string | null
          inherited_category?: string | null
          inherited_measures?: string | null
          inherited_price?: number | null
          is_user_edited?: boolean
          original_image_url?: string | null
          manual_edit_count?: number
          measures?: string | null
          observations?: string | null
          parsing_warnings?: Json
          price?: string | null
          processed_image_url?: string | null
          publication_status?: string
          publish_attempts?: number
          published_image_url?: string | null
          quality_score?: number
          review_checklist?: Json
          review_completed_at?: string | null
          review_status?: string
          scene_type?: string | null
          source_path?: string | null
          source_type?: string
          status?: string
          tc_external_id?: number | null
          tc_last_error?: string | null
          tc_last_response?: Json | null
          tc_published_at?: string | null
          title?: string | null
          updated_at?: string
          user_edited_fields?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          failed_images: number
          id: string
          parsing_warnings: Json
          pending_images: number
          processed_images: number
          ready_for_review: number
          root_name: string | null
          source_type: string
          status: string
          total_images: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          failed_images?: number
          id?: string
          parsing_warnings?: Json
          pending_images?: number
          processed_images?: number
          ready_for_review?: number
          root_name?: string | null
          source_type?: string
          status?: string
          total_images?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          failed_images?: number
          id?: string
          parsing_warnings?: Json
          pending_images?: number
          processed_images?: number
          ready_for_review?: number
          root_name?: string | null
          source_type?: string
          status?: string
          total_images?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
