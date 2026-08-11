// Generated from the ordered SQL migrations by scripts/generate-database-types.mjs.
// Do not hand-edit. Regenerate after every schema migration.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      "ai_action_proposals": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "ai_run_id": string
          "action_type": string
          "target_table": string
          "target_record_id": string | null
          "proposed_change": Json
          "confidence": number | null
          "status": Database["public"]["Enums"]["request_status"]
          "decided_by": string | null
          "decided_at": string | null
          "decision_note": string | null
          "applied_by": string | null
          "applied_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "ai_run_id": string
          "action_type": string
          "target_table": string
          "target_record_id"?: string | null
          "proposed_change": Json
          "confidence"?: number | null
          "status"?: Database["public"]["Enums"]["request_status"]
          "decided_by"?: string | null
          "decided_at"?: string | null
          "decision_note"?: string | null
          "applied_by"?: string | null
          "applied_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "ai_run_id"?: string
          "action_type"?: string
          "target_table"?: string
          "target_record_id"?: string | null
          "proposed_change"?: Json
          "confidence"?: number | null
          "status"?: Database["public"]["Enums"]["request_status"]
          "decided_by"?: string | null
          "decided_at"?: string | null
          "decision_note"?: string | null
          "applied_by"?: string | null
          "applied_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_action_proposals_organization_id_ai_run_id_fkey"
            columns: ["organization_id","ai_run_id"]
            referencedRelation: "ai_runs"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "ai_action_proposals_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "ai_citations": {
        Row: {
          "id": string
          "organization_id": string
          "ai_run_id": string
          "source_table": string
          "source_record_id": string
          "source_field": string | null
          "excerpt": string | null
          "relevance": number | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "ai_run_id": string
          "source_table": string
          "source_record_id": string
          "source_field"?: string | null
          "excerpt"?: string | null
          "relevance"?: number | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "ai_run_id"?: string
          "source_table"?: string
          "source_record_id"?: string
          "source_field"?: string | null
          "excerpt"?: string | null
          "relevance"?: number | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_citations_organization_id_ai_run_id_fkey"
            columns: ["organization_id","ai_run_id"]
            referencedRelation: "ai_runs"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "ai_runs": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "kind": Database["public"]["Enums"]["ai_run_kind"]
          "status": Database["public"]["Enums"]["job_status"]
          "prompt": string | null
          "model": string | null
          "input_parameters": Json
          "output": Json | null
          "confidence": number | null
          "requested_by": string
          "started_at": string | null
          "completed_at": string | null
          "error_message": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "kind": Database["public"]["Enums"]["ai_run_kind"]
          "status"?: Database["public"]["Enums"]["job_status"]
          "prompt"?: string | null
          "model"?: string | null
          "input_parameters"?: Json
          "output"?: Json | null
          "confidence"?: number | null
          "requested_by": string
          "started_at"?: string | null
          "completed_at"?: string | null
          "error_message"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "kind"?: Database["public"]["Enums"]["ai_run_kind"]
          "status"?: Database["public"]["Enums"]["job_status"]
          "prompt"?: string | null
          "model"?: string | null
          "input_parameters"?: Json
          "output"?: Json | null
          "confidence"?: number | null
          "requested_by"?: string
          "started_at"?: string | null
          "completed_at"?: string | null
          "error_message"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "announcement_acknowledgements": {
        Row: {
          "id": string
          "organization_id": string
          "message_id": string
          "user_id": string
          "acknowledged_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "message_id": string
          "user_id": string
          "acknowledged_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "message_id"?: string
          "user_id"?: string
          "acknowledged_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_acknowledgements_organization_id_message_id_fkey"
            columns: ["organization_id","message_id"]
            referencedRelation: "chat_messages"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "application_errors": {
        Row: {
          "id": string
          "organization_id": string | null
          "location_id": string | null
          "user_id": string | null
          "environment": string
          "fingerprint": string | null
          "severity": string
          "message": string
          "stack_trace": string | null
          "context": Json
          "resolved_at": string | null
          "resolved_by": string | null
          "occurred_at": string
        }
        Insert: {
          "id"?: string
          "organization_id"?: string | null
          "location_id"?: string | null
          "user_id"?: string | null
          "environment": string
          "fingerprint"?: string | null
          "severity"?: string
          "message": string
          "stack_trace"?: string | null
          "context"?: Json
          "resolved_at"?: string | null
          "resolved_by"?: string | null
          "occurred_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string | null
          "location_id"?: string | null
          "user_id"?: string | null
          "environment"?: string
          "fingerprint"?: string | null
          "severity"?: string
          "message"?: string
          "stack_trace"?: string | null
          "context"?: Json
          "resolved_at"?: string | null
          "resolved_by"?: string | null
          "occurred_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_errors_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_errors_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "audit_events": {
        Row: {
          "id": number
          "occurred_at": string
          "organization_id": string | null
          "location_id": string | null
          "actor_id": string | null
          "actor_role": Database["public"]["Enums"]["app_role"] | null
          "action": string
          "table_name": string
          "record_id": string | null
          "old_record": Json | null
          "new_record": Json | null
          "request_id": string | null
          "ip_address": string | null
          "user_agent": string | null
          "metadata": Json
        }
        Insert: {
          "id"?: number
          "occurred_at"?: string
          "organization_id"?: string | null
          "location_id"?: string | null
          "actor_id"?: string | null
          "actor_role"?: Database["public"]["Enums"]["app_role"] | null
          "action": string
          "table_name": string
          "record_id"?: string | null
          "old_record"?: Json | null
          "new_record"?: Json | null
          "request_id"?: string | null
          "ip_address"?: string | null
          "user_agent"?: string | null
          "metadata"?: Json
        }
        Update: {
          "id"?: number
          "occurred_at"?: string
          "organization_id"?: string | null
          "location_id"?: string | null
          "actor_id"?: string | null
          "actor_role"?: Database["public"]["Enums"]["app_role"] | null
          "action"?: string
          "table_name"?: string
          "record_id"?: string | null
          "old_record"?: Json | null
          "new_record"?: Json | null
          "request_id"?: string | null
          "ip_address"?: string | null
          "user_agent"?: string | null
          "metadata"?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "availability_rules": {
        Row: {
          "id": string
          "organization_id": string
          "employee_id": string
          "location_id": string | null
          "weekday": number
          "available_from": string | null
          "available_until": string | null
          "is_available": boolean
          "effective_from": string
          "effective_to": string | null
          "notes": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "employee_id": string
          "location_id"?: string | null
          "weekday": number
          "available_from"?: string | null
          "available_until"?: string | null
          "is_available"?: boolean
          "effective_from": string
          "effective_to"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "employee_id"?: string
          "location_id"?: string | null
          "weekday"?: number
          "available_from"?: string | null
          "available_until"?: string | null
          "is_available"?: boolean
          "effective_from"?: string
          "effective_to"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "availability_rules_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "backup_runs": {
        Row: {
          "id": string
          "organization_id": string | null
          "environment": string
          "provider": string
          "backup_type": string
          "status": Database["public"]["Enums"]["job_status"]
          "started_at": string
          "completed_at": string | null
          "restore_tested_at": string | null
          "encrypted_reference": string | null
          "metadata": Json
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id"?: string | null
          "environment": string
          "provider": string
          "backup_type": string
          "status": Database["public"]["Enums"]["job_status"]
          "started_at": string
          "completed_at"?: string | null
          "restore_tested_at"?: string | null
          "encrypted_reference"?: string | null
          "metadata"?: Json
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string | null
          "environment"?: string
          "provider"?: string
          "backup_type"?: string
          "status"?: Database["public"]["Enums"]["job_status"]
          "started_at"?: string
          "completed_at"?: string | null
          "restore_tested_at"?: string | null
          "encrypted_reference"?: string | null
          "metadata"?: Json
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "backup_runs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "booking_api_clients": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "name": string
          "key_hash": string
          "key_hint": string
          "scopes": string[]
          "allowed_origins": string[]
          "is_active": boolean
          "last_used_at": string | null
          "expires_at": string | null
          "created_by": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "name": string
          "key_hash": string
          "key_hint": string
          "scopes"?: string[]
          "allowed_origins"?: string[]
          "is_active"?: boolean
          "last_used_at"?: string | null
          "expires_at"?: string | null
          "created_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "name"?: string
          "key_hash"?: string
          "key_hint"?: string
          "scopes"?: string[]
          "allowed_origins"?: string[]
          "is_active"?: boolean
          "last_used_at"?: string | null
          "expires_at"?: string | null
          "created_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_api_clients_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_api_clients_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "capability_definitions": {
        Row: {
          "capability_key": string
          "domain": string
          "label": string
          "description": string
          "is_active": boolean
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "capability_key": string
          "domain": string
          "label": string
          "description": string
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "capability_key"?: string
          "domain"?: string
          "label"?: string
          "description"?: string
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: []
      };
      "chat_attachments": {
        Row: {
          "id": string
          "organization_id": string
          "message_id": string
          "storage_path": string
          "file_name": string
          "mime_type": string | null
          "size_bytes": number | null
          "uploaded_by": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "message_id": string
          "storage_path": string
          "file_name": string
          "mime_type"?: string | null
          "size_bytes"?: number | null
          "uploaded_by": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "message_id"?: string
          "storage_path"?: string
          "file_name"?: string
          "mime_type"?: string | null
          "size_bytes"?: number | null
          "uploaded_by"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_attachments_organization_id_message_id_fkey"
            columns: ["organization_id","message_id"]
            referencedRelation: "chat_messages"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "chat_channel_members": {
        Row: {
          "id": string
          "organization_id": string
          "channel_id": string
          "user_id": string
          "joined_at": string
          "muted_until": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "channel_id": string
          "user_id": string
          "joined_at"?: string
          "muted_until"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "channel_id"?: string
          "user_id"?: string
          "joined_at"?: string
          "muted_until"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_organization_id_channel_id_fkey"
            columns: ["organization_id","channel_id"]
            referencedRelation: "chat_channels"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "chat_channel_members_organization_id_user_id_fkey"
            columns: ["organization_id","user_id"]
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id","user_id"]
          },
        ]
      };
      "chat_channels": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "kind": Database["public"]["Enums"]["channel_kind"]
          "name": string
          "description": string | null
          "is_archived": boolean
          "created_by": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "kind": Database["public"]["Enums"]["channel_kind"]
          "name": string
          "description"?: string | null
          "is_archived"?: boolean
          "created_by": string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "kind"?: Database["public"]["Enums"]["channel_kind"]
          "name"?: string
          "description"?: string | null
          "is_archived"?: boolean
          "created_by"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channels_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channels_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "chat_messages": {
        Row: {
          "id": string
          "organization_id": string
          "channel_id": string
          "author_id": string
          "reply_to_id": string | null
          "body": string
          "is_announcement": boolean
          "edited_at": string | null
          "deleted_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "channel_id": string
          "author_id": string
          "reply_to_id"?: string | null
          "body": string
          "is_announcement"?: boolean
          "edited_at"?: string | null
          "deleted_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "channel_id"?: string
          "author_id"?: string
          "reply_to_id"?: string | null
          "body"?: string
          "is_announcement"?: boolean
          "edited_at"?: string | null
          "deleted_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_organization_id_channel_id_fkey"
            columns: ["organization_id","channel_id"]
            referencedRelation: "chat_channels"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      };
      "chat_reactions": {
        Row: {
          "id": string
          "organization_id": string
          "message_id": string
          "user_id": string
          "emoji": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "message_id": string
          "user_id": string
          "emoji": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "message_id"?: string
          "user_id"?: string
          "emoji"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_reactions_organization_id_message_id_fkey"
            columns: ["organization_id","message_id"]
            referencedRelation: "chat_messages"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "chat_read_receipts": {
        Row: {
          "id": string
          "organization_id": string
          "channel_id": string
          "user_id": string
          "last_read_message_id": string | null
          "last_read_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "channel_id": string
          "user_id": string
          "last_read_message_id"?: string | null
          "last_read_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "channel_id"?: string
          "user_id"?: string
          "last_read_message_id"?: string | null
          "last_read_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_read_receipts_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_read_receipts_organization_id_channel_id_fkey"
            columns: ["organization_id","channel_id"]
            referencedRelation: "chat_channels"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "checklist_responses": {
        Row: {
          "id": string
          "organization_id": string
          "checklist_run_id": string
          "template_item_id": string
          "response": Json
          "storage_path": string | null
          "responded_by": string
          "responded_at": string
          "notes": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "checklist_run_id": string
          "template_item_id": string
          "response": Json
          "storage_path"?: string | null
          "responded_by": string
          "responded_at"?: string
          "notes"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "checklist_run_id"?: string
          "template_item_id"?: string
          "response"?: Json
          "storage_path"?: string | null
          "responded_by"?: string
          "responded_at"?: string
          "notes"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_responses_organization_id_checklist_run_id_fkey"
            columns: ["organization_id","checklist_run_id"]
            referencedRelation: "checklist_runs"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "checklist_responses_organization_id_template_item_id_fkey"
            columns: ["organization_id","template_item_id"]
            referencedRelation: "checklist_template_items"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "checklist_runs": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "template_id": string
          "business_date": string
          "status": Database["public"]["Enums"]["task_status"]
          "assigned_employee_id": string | null
          "started_at": string | null
          "completed_at": string | null
          "approved_by": string | null
          "approved_at": string | null
          "created_by": string
          "created_at": string
          "updated_at": string
          "completed_by": string | null
          "completion_note": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "template_id": string
          "business_date": string
          "status"?: Database["public"]["Enums"]["task_status"]
          "assigned_employee_id"?: string | null
          "started_at"?: string | null
          "completed_at"?: string | null
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_by": string
          "created_at"?: string
          "updated_at"?: string
          "completed_by"?: string | null
          "completion_note"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "template_id"?: string
          "business_date"?: string
          "status"?: Database["public"]["Enums"]["task_status"]
          "assigned_employee_id"?: string | null
          "started_at"?: string | null
          "completed_at"?: string | null
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_by"?: string
          "created_at"?: string
          "updated_at"?: string
          "completed_by"?: string | null
          "completion_note"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_runs_organization_id_assigned_employee_id_fkey"
            columns: ["organization_id","assigned_employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "checklist_runs_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "checklist_runs_organization_id_template_id_fkey"
            columns: ["organization_id","template_id"]
            referencedRelation: "checklist_templates"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "checklist_template_items": {
        Row: {
          "id": string
          "organization_id": string
          "template_id": string
          "position": number
          "label": string
          "instructions": string | null
          "response_type": string
          "required": boolean
          "validation": Json
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "template_id": string
          "position": number
          "label": string
          "instructions"?: string | null
          "response_type"?: string
          "required"?: boolean
          "validation"?: Json
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "template_id"?: string
          "position"?: number
          "label"?: string
          "instructions"?: string | null
          "response_type"?: string
          "required"?: boolean
          "validation"?: Json
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_template_items_organization_id_template_id_fkey"
            columns: ["organization_id","template_id"]
            referencedRelation: "checklist_templates"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "checklist_templates": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "name": string
          "checklist_type": string
          "version": number
          "is_active": boolean
          "created_by": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "name": string
          "checklist_type": string
          "version"?: number
          "is_active"?: boolean
          "created_by": string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "name"?: string
          "checklist_type"?: string
          "version"?: number
          "is_active"?: boolean
          "created_by"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "closeout_attachments": {
        Row: {
          "id": string
          "organization_id": string
          "closeout_id": string
          "storage_path": string
          "file_name": string
          "mime_type": string | null
          "uploaded_by": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "closeout_id": string
          "storage_path": string
          "file_name": string
          "mime_type"?: string | null
          "uploaded_by": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "closeout_id"?: string
          "storage_path"?: string
          "file_name"?: string
          "mime_type"?: string | null
          "uploaded_by"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "closeout_attachments_organization_id_closeout_id_fkey"
            columns: ["organization_id","closeout_id"]
            referencedRelation: "shift_closeouts"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "cogs_periods": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "period_start": string
          "period_end": string
          "opening_inventory_cents": number
          "purchases_cents": number
          "transfers_in_cents": number
          "transfers_out_cents": number
          "closing_inventory_cents": number
          "cogs_cents": number | null
          "status": Database["public"]["Enums"]["review_status"]
          "calculated_at": string | null
          "approved_by": string | null
          "approved_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "period_start": string
          "period_end": string
          "opening_inventory_cents"?: number
          "purchases_cents"?: number
          "transfers_in_cents"?: number
          "transfers_out_cents"?: number
          "closing_inventory_cents"?: number
          "cogs_cents"?: number | null
          "status"?: Database["public"]["Enums"]["review_status"]
          "calculated_at"?: string | null
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "period_start"?: string
          "period_end"?: string
          "opening_inventory_cents"?: number
          "purchases_cents"?: number
          "transfers_in_cents"?: number
          "transfers_out_cents"?: number
          "closing_inventory_cents"?: number
          "cogs_cents"?: number | null
          "status"?: Database["public"]["Enums"]["review_status"]
          "calculated_at"?: string | null
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "cogs_periods_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "data_export_requests": {
        Row: {
          "id": string
          "organization_id": string
          "subject_type": string
          "subject_id": string | null
          "status": Database["public"]["Enums"]["job_status"]
          "storage_path": string | null
          "requested_by": string
          "approved_by": string | null
          "approved_at": string | null
          "completed_at": string | null
          "expires_at": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "subject_type": string
          "subject_id"?: string | null
          "status"?: Database["public"]["Enums"]["job_status"]
          "storage_path"?: string | null
          "requested_by": string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "completed_at"?: string | null
          "expires_at"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "subject_type"?: string
          "subject_id"?: string | null
          "status"?: Database["public"]["Enums"]["job_status"]
          "storage_path"?: string | null
          "requested_by"?: string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "completed_at"?: string | null
          "expires_at"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_export_requests_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "deliveries": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "vendor_id": string
          "purchase_order_id": string | null
          "receipt_id": string | null
          "delivered_at": string
          "invoice_number": string | null
          "received_by": string
          "notes": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "vendor_id": string
          "purchase_order_id"?: string | null
          "receipt_id"?: string | null
          "delivered_at": string
          "invoice_number"?: string | null
          "received_by": string
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "vendor_id"?: string
          "purchase_order_id"?: string | null
          "receipt_id"?: string | null
          "delivered_at"?: string
          "invoice_number"?: string | null
          "received_by"?: string
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "deliveries_organization_id_purchase_order_id_fkey"
            columns: ["organization_id","purchase_order_id"]
            referencedRelation: "purchase_orders"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "deliveries_organization_id_receipt_id_fkey"
            columns: ["organization_id","receipt_id"]
            referencedRelation: "receipts"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "deliveries_organization_id_vendor_id_fkey"
            columns: ["organization_id","vendor_id"]
            referencedRelation: "vendors"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "delivery_lines": {
        Row: {
          "id": string
          "organization_id": string
          "delivery_id": string
          "inventory_item_id": string
          "unit_id": string
          "quantity": number
          "accepted_quantity": number
          "unit_price_cents": number
          "lot_code": string | null
          "expires_on": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "delivery_id": string
          "inventory_item_id": string
          "unit_id": string
          "quantity": number
          "accepted_quantity": number
          "unit_price_cents": number
          "lot_code"?: string | null
          "expires_on"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "delivery_id"?: string
          "inventory_item_id"?: string
          "unit_id"?: string
          "quantity"?: number
          "accepted_quantity"?: number
          "unit_price_cents"?: number
          "lot_code"?: string | null
          "expires_on"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_lines_organization_id_delivery_id_fkey"
            columns: ["organization_id","delivery_id"]
            referencedRelation: "deliveries"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "delivery_lines_organization_id_inventory_item_id_fkey"
            columns: ["organization_id","inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "delivery_lines_organization_id_unit_id_fkey"
            columns: ["organization_id","unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "dining_areas": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "name": string
          "sort_order": number
          "is_active": boolean
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "name": string
          "sort_order"?: number
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "name"?: string
          "sort_order"?: number
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "dining_areas_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "employee_certifications": {
        Row: {
          "id": string
          "organization_id": string
          "employee_id": string
          "certification_type": string
          "issuer": string | null
          "credential_number": string | null
          "issued_on": string | null
          "expires_on": string | null
          "document_path": string | null
          "verified_by": string | null
          "verified_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "employee_id": string
          "certification_type": string
          "issuer"?: string | null
          "credential_number"?: string | null
          "issued_on"?: string | null
          "expires_on"?: string | null
          "document_path"?: string | null
          "verified_by"?: string | null
          "verified_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "employee_id"?: string
          "certification_type"?: string
          "issuer"?: string | null
          "credential_number"?: string | null
          "issued_on"?: string | null
          "expires_on"?: string | null
          "document_path"?: string | null
          "verified_by"?: string | null
          "verified_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_certifications_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "employee_documents": {
        Row: {
          "id": string
          "organization_id": string
          "employee_id": string
          "document_type": string
          "title": string
          "storage_path": string
          "mime_type": string | null
          "size_bytes": number | null
          "is_employee_visible": boolean
          "uploaded_by": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "employee_id": string
          "document_type": string
          "title": string
          "storage_path": string
          "mime_type"?: string | null
          "size_bytes"?: number | null
          "is_employee_visible"?: boolean
          "uploaded_by": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "employee_id"?: string
          "document_type"?: string
          "title"?: string
          "storage_path"?: string
          "mime_type"?: string | null
          "size_bytes"?: number | null
          "is_employee_visible"?: boolean
          "uploaded_by"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "employee_emergency_contacts": {
        Row: {
          "id": string
          "organization_id": string
          "employee_id": string
          "name": string
          "relationship": string | null
          "phone": string
          "email": string | null
          "is_primary": boolean
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "employee_id": string
          "name": string
          "relationship"?: string | null
          "phone": string
          "email"?: string | null
          "is_primary"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "employee_id"?: string
          "name"?: string
          "relationship"?: string | null
          "phone"?: string
          "email"?: string | null
          "is_primary"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_emergency_contacts_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "employee_job_roles": {
        Row: {
          "id": string
          "organization_id": string
          "employee_id": string
          "job_role_id": string
          "location_id": string
          "hourly_rate_cents": number | null
          "effective_from": string
          "effective_to": string | null
          "is_primary": boolean
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "employee_id": string
          "job_role_id": string
          "location_id": string
          "hourly_rate_cents"?: number | null
          "effective_from"?: string
          "effective_to"?: string | null
          "is_primary"?: boolean
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "employee_id"?: string
          "job_role_id"?: string
          "location_id"?: string
          "hourly_rate_cents"?: number | null
          "effective_from"?: string
          "effective_to"?: string | null
          "is_primary"?: boolean
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_job_roles_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "employee_job_roles_organization_id_job_role_id_fkey"
            columns: ["organization_id","job_role_id"]
            referencedRelation: "job_roles"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "employee_job_roles_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "employees": {
        Row: {
          "id": string
          "organization_id": string
          "user_id": string | null
          "home_location_id": string | null
          "employee_number": string | null
          "legal_name": string | null
          "display_name": string
          "email": string | null
          "phone": string | null
          "hire_date": string | null
          "termination_date": string | null
          "employment_status": string
          "employment_type": string | null
          "payroll_reference": string | null
          "notes": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "user_id"?: string | null
          "home_location_id"?: string | null
          "employee_number"?: string | null
          "legal_name"?: string | null
          "display_name": string
          "email"?: string | null
          "phone"?: string | null
          "hire_date"?: string | null
          "termination_date"?: string | null
          "employment_status"?: string
          "employment_type"?: string | null
          "payroll_reference"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "user_id"?: string | null
          "home_location_id"?: string | null
          "employee_number"?: string | null
          "legal_name"?: string | null
          "display_name"?: string
          "email"?: string | null
          "phone"?: string | null
          "hire_date"?: string | null
          "termination_date"?: string | null
          "employment_status"?: string
          "employment_type"?: string | null
          "payroll_reference"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_organization_id_home_location_id_fkey"
            columns: ["organization_id","home_location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "expense_categories": {
        Row: {
          "id": string
          "organization_id": string
          "name": string
          "accounting_code": string | null
          "is_active": boolean
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "name": string
          "accounting_code"?: string | null
          "is_active"?: boolean
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "name"?: string
          "accounting_code"?: string | null
          "is_active"?: boolean
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "expenses": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "receipt_id": string | null
          "vendor_id": string | null
          "expense_category_id": string | null
          "expense_date": string
          "subtotal_cents": number
          "tax_cents": number
          "total_cents": number | null
          "description": string | null
          "created_by": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "receipt_id"?: string | null
          "vendor_id"?: string | null
          "expense_category_id"?: string | null
          "expense_date": string
          "subtotal_cents": number
          "tax_cents"?: number
          "total_cents"?: number | null
          "description"?: string | null
          "created_by": string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "receipt_id"?: string | null
          "vendor_id"?: string | null
          "expense_category_id"?: string | null
          "expense_date"?: string
          "subtotal_cents"?: number
          "tax_cents"?: number
          "total_cents"?: number | null
          "description"?: string | null
          "created_by"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_organization_id_expense_category_id_fkey"
            columns: ["organization_id","expense_category_id"]
            referencedRelation: "expense_categories"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "expenses_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "expenses_organization_id_receipt_id_fkey"
            columns: ["organization_id","receipt_id"]
            referencedRelation: "receipts"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "expenses_organization_id_vendor_id_fkey"
            columns: ["organization_id","vendor_id"]
            referencedRelation: "vendors"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "export_jobs": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "report_run_id": string | null
          "export_type": string
          "status": Database["public"]["Enums"]["job_status"]
          "storage_path": string | null
          "expires_at": string | null
          "requested_by": string
          "completed_at": string | null
          "error_message": string | null
          "created_at": string
          "started_at": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "report_run_id"?: string | null
          "export_type": string
          "status"?: Database["public"]["Enums"]["job_status"]
          "storage_path"?: string | null
          "expires_at"?: string | null
          "requested_by": string
          "completed_at"?: string | null
          "error_message"?: string | null
          "created_at"?: string
          "started_at"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "report_run_id"?: string | null
          "export_type"?: string
          "status"?: Database["public"]["Enums"]["job_status"]
          "storage_path"?: string | null
          "expires_at"?: string | null
          "requested_by"?: string
          "completed_at"?: string | null
          "error_message"?: string | null
          "created_at"?: string
          "started_at"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_jobs_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "export_jobs_organization_id_report_run_id_fkey"
            columns: ["organization_id","report_run_id"]
            referencedRelation: "report_runs"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "guest_consents": {
        Row: {
          "id": string
          "organization_id": string
          "guest_id": string
          "channel": string
          "status": Database["public"]["Enums"]["consent_status"]
          "captured_at": string
          "revoked_at": string | null
          "source": string
          "evidence": Json
          "recorded_by": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "guest_id": string
          "channel": string
          "status": Database["public"]["Enums"]["consent_status"]
          "captured_at": string
          "revoked_at"?: string | null
          "source": string
          "evidence"?: Json
          "recorded_by"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "guest_id"?: string
          "channel"?: string
          "status"?: Database["public"]["Enums"]["consent_status"]
          "captured_at"?: string
          "revoked_at"?: string | null
          "source"?: string
          "evidence"?: Json
          "recorded_by"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_consents_organization_id_guest_id_fkey"
            columns: ["organization_id","guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "guest_contacts": {
        Row: {
          "id": string
          "organization_id": string
          "guest_id": string
          "contact_type": string
          "label": string | null
          "value": string
          "normalized_value": string | null
          "is_primary": boolean
          "verified_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "guest_id": string
          "contact_type": string
          "label"?: string | null
          "value": string
          "normalized_value"?: string | null
          "is_primary"?: boolean
          "verified_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "guest_id"?: string
          "contact_type"?: string
          "label"?: string | null
          "value"?: string
          "normalized_value"?: string | null
          "is_primary"?: boolean
          "verified_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_contacts_organization_id_guest_id_fkey"
            columns: ["organization_id","guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "guest_locations": {
        Row: {
          "id": string
          "organization_id": string
          "guest_id": string
          "location_id": string
          "is_home_location": boolean
          "first_visit_at": string | null
          "last_visit_at": string | null
          "visit_count": number
          "spend_cents": number
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "guest_id": string
          "location_id": string
          "is_home_location"?: boolean
          "first_visit_at"?: string | null
          "last_visit_at"?: string | null
          "visit_count"?: number
          "spend_cents"?: number
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "guest_id"?: string
          "location_id"?: string
          "is_home_location"?: boolean
          "first_visit_at"?: string | null
          "last_visit_at"?: string | null
          "visit_count"?: number
          "spend_cents"?: number
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_locations_organization_id_guest_id_fkey"
            columns: ["organization_id","guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "guest_locations_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "guest_merge_events": {
        Row: {
          "id": string
          "organization_id": string
          "source_guest_id": string
          "target_guest_id": string
          "match_score": number | null
          "reasons": Json
          "merged_by": string
          "merged_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "source_guest_id": string
          "target_guest_id": string
          "match_score"?: number | null
          "reasons"?: Json
          "merged_by": string
          "merged_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "source_guest_id"?: string
          "target_guest_id"?: string
          "match_score"?: number | null
          "reasons"?: Json
          "merged_by"?: string
          "merged_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_merge_events_organization_id_source_guest_id_fkey"
            columns: ["organization_id","source_guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "guest_merge_events_organization_id_target_guest_id_fkey"
            columns: ["organization_id","target_guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "guest_notes": {
        Row: {
          "id": string
          "organization_id": string
          "guest_id": string
          "location_id": string | null
          "note": string
          "is_sensitive": boolean
          "author_id": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "guest_id": string
          "location_id"?: string | null
          "note": string
          "is_sensitive"?: boolean
          "author_id": string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "guest_id"?: string
          "location_id"?: string | null
          "note"?: string
          "is_sensitive"?: boolean
          "author_id"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_notes_organization_id_guest_id_fkey"
            columns: ["organization_id","guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "guest_notes_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "guest_tag_assignments": {
        Row: {
          "id": string
          "organization_id": string
          "guest_id": string
          "tag_id": string
          "assigned_by": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "guest_id": string
          "tag_id": string
          "assigned_by": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "guest_id"?: string
          "tag_id"?: string
          "assigned_by"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_tag_assignments_organization_id_guest_id_fkey"
            columns: ["organization_id","guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "guest_tag_assignments_organization_id_tag_id_fkey"
            columns: ["organization_id","tag_id"]
            referencedRelation: "guest_tags"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "guest_tags": {
        Row: {
          "id": string
          "organization_id": string
          "name": string
          "color": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "name": string
          "color"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "name"?: string
          "color"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_tags_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "guest_visits": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "guest_id": string
          "visited_at": string
          "party_size": number | null
          "covers": number | null
          "spend_cents": number | null
          "reservation_id_external": string | null
          "check_reference": string | null
          "server_employee_id": string | null
          "source": string
          "notes": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "guest_id": string
          "visited_at": string
          "party_size"?: number | null
          "covers"?: number | null
          "spend_cents"?: number | null
          "reservation_id_external"?: string | null
          "check_reference"?: string | null
          "server_employee_id"?: string | null
          "source"?: string
          "notes"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "guest_id"?: string
          "visited_at"?: string
          "party_size"?: number | null
          "covers"?: number | null
          "spend_cents"?: number | null
          "reservation_id_external"?: string | null
          "check_reference"?: string | null
          "server_employee_id"?: string | null
          "source"?: string
          "notes"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_visits_organization_id_guest_id_fkey"
            columns: ["organization_id","guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "guest_visits_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "guest_visits_organization_id_server_employee_id_fkey"
            columns: ["organization_id","server_employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "guests": {
        Row: {
          "id": string
          "organization_id": string
          "first_name": string | null
          "last_name": string | null
          "display_name": string
          "email": string | null
          "phone": string | null
          "birthday": string | null
          "vip": boolean
          "preferences": string | null
          "allergies": string | null
          "notes": string | null
          "first_visit_at": string | null
          "last_visit_at": string | null
          "visit_count": number
          "lifetime_spend_cents": number
          "source": string
          "external_references": Json
          "merged_into_id": string | null
          "search_vector": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "first_name"?: string | null
          "last_name"?: string | null
          "display_name": string
          "email"?: string | null
          "phone"?: string | null
          "birthday"?: string | null
          "vip"?: boolean
          "preferences"?: string | null
          "allergies"?: string | null
          "notes"?: string | null
          "first_visit_at"?: string | null
          "last_visit_at"?: string | null
          "visit_count"?: number
          "lifetime_spend_cents"?: number
          "source"?: string
          "external_references"?: Json
          "merged_into_id"?: string | null
          "search_vector"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "first_name"?: string | null
          "last_name"?: string | null
          "display_name"?: string
          "email"?: string | null
          "phone"?: string | null
          "birthday"?: string | null
          "vip"?: boolean
          "preferences"?: string | null
          "allergies"?: string | null
          "notes"?: string | null
          "first_visit_at"?: string | null
          "last_visit_at"?: string | null
          "visit_count"?: number
          "lifetime_spend_cents"?: number
          "source"?: string
          "external_references"?: Json
          "merged_into_id"?: string | null
          "search_vector"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "guests_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_organization_id_merged_into_id_fkey"
            columns: ["organization_id","merged_into_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "import_jobs": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "import_type": string
          "file_name": string
          "storage_path": string
          "status": Database["public"]["Enums"]["job_status"]
          "mapping": Json
          "total_rows": number | null
          "successful_rows": number
          "failed_rows": number
          "requested_by": string
          "completed_at": string | null
          "created_at": string
          "content_sha256": string | null
          "declared_total_rows": number | null
          "declared_headers": string[] | null
          "validation_version": string | null
          "started_at": string | null
          "error_message": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "import_type": string
          "file_name": string
          "storage_path": string
          "status"?: Database["public"]["Enums"]["job_status"]
          "mapping"?: Json
          "total_rows"?: number | null
          "successful_rows"?: number
          "failed_rows"?: number
          "requested_by": string
          "completed_at"?: string | null
          "created_at"?: string
          "content_sha256"?: string | null
          "declared_total_rows"?: number | null
          "declared_headers"?: string[] | null
          "validation_version"?: string | null
          "started_at"?: string | null
          "error_message"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "import_type"?: string
          "file_name"?: string
          "storage_path"?: string
          "status"?: Database["public"]["Enums"]["job_status"]
          "mapping"?: Json
          "total_rows"?: number | null
          "successful_rows"?: number
          "failed_rows"?: number
          "requested_by"?: string
          "completed_at"?: string | null
          "created_at"?: string
          "content_sha256"?: string | null
          "declared_total_rows"?: number | null
          "declared_headers"?: string[] | null
          "validation_version"?: string | null
          "started_at"?: string | null
          "error_message"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "import_rows": {
        Row: {
          "id": string
          "organization_id": string
          "import_job_id": string
          "row_number": number
          "raw_data": Json
          "normalized_data": Json | null
          "status": string
          "error_message": string | null
          "local_table": string | null
          "local_id": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "import_job_id": string
          "row_number": number
          "raw_data": Json
          "normalized_data"?: Json | null
          "status"?: string
          "error_message"?: string | null
          "local_table"?: string | null
          "local_id"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "import_job_id"?: string
          "row_number"?: number
          "raw_data"?: Json
          "normalized_data"?: Json | null
          "status"?: string
          "error_message"?: string | null
          "local_table"?: string | null
          "local_id"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_organization_id_import_job_id_fkey"
            columns: ["organization_id","import_job_id"]
            referencedRelation: "import_jobs"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "incident_attachments": {
        Row: {
          "id": string
          "organization_id": string
          "incident_id": string
          "storage_path": string
          "file_name": string
          "mime_type": string | null
          "uploaded_by": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "incident_id": string
          "storage_path": string
          "file_name": string
          "mime_type"?: string | null
          "uploaded_by": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "incident_id"?: string
          "storage_path"?: string
          "file_name"?: string
          "mime_type"?: string | null
          "uploaded_by"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_attachments_organization_id_incident_id_fkey"
            columns: ["organization_id","incident_id"]
            referencedRelation: "incidents"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "incidents": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "incident_type": string
          "occurred_at": string
          "description": string
          "severity": string
          "status": string
          "reported_by": string
          "involved_employee_ids": string[]
          "guest_id": string | null
          "follow_up": string | null
          "resolved_by": string | null
          "resolved_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "incident_type": string
          "occurred_at": string
          "description": string
          "severity"?: string
          "status"?: string
          "reported_by": string
          "involved_employee_ids"?: string[]
          "guest_id"?: string | null
          "follow_up"?: string | null
          "resolved_by"?: string | null
          "resolved_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "incident_type"?: string
          "occurred_at"?: string
          "description"?: string
          "severity"?: string
          "status"?: string
          "reported_by"?: string
          "involved_employee_ids"?: string[]
          "guest_id"?: string | null
          "follow_up"?: string | null
          "resolved_by"?: string | null
          "resolved_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_organization_id_guest_id_fkey"
            columns: ["organization_id","guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "incidents_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "income_sales_checks": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "source": string
          "external_id": string
          "business_date": string
          "status": string
          "opened_at": string
          "closed_at": string | null
          "gross_sales_cents": number
          "net_sales_cents": number
          "discount_cents": number
          "comp_cents": number
          "void_cents": number
          "tax_cents": number
          "tip_cents": number
          "service_charge_cents": number
          "covers": number
          "order_channel": string | null
          "source_observed_at": string
          "payload_hash": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "source": string
          "external_id": string
          "business_date": string
          "status": string
          "opened_at": string
          "closed_at"?: string | null
          "gross_sales_cents"?: number
          "net_sales_cents"?: number
          "discount_cents"?: number
          "comp_cents"?: number
          "void_cents"?: number
          "tax_cents"?: number
          "tip_cents"?: number
          "service_charge_cents"?: number
          "covers"?: number
          "order_channel"?: string | null
          "source_observed_at": string
          "payload_hash": string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "source"?: string
          "external_id"?: string
          "business_date"?: string
          "status"?: string
          "opened_at"?: string
          "closed_at"?: string | null
          "gross_sales_cents"?: number
          "net_sales_cents"?: number
          "discount_cents"?: number
          "comp_cents"?: number
          "void_cents"?: number
          "tax_cents"?: number
          "tip_cents"?: number
          "service_charge_cents"?: number
          "covers"?: number
          "order_channel"?: string | null
          "source_observed_at"?: string
          "payload_hash"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "income_sales_checks_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "integration_connections": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "provider": Database["public"]["Enums"]["integration_provider"]
          "display_name": string
          "adapter_version": string
          "status": string
          "capabilities": Json
          "configuration": Json
          "last_synced_at": string | null
          "created_by": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "provider": Database["public"]["Enums"]["integration_provider"]
          "display_name": string
          "adapter_version"?: string
          "status"?: string
          "capabilities"?: Json
          "configuration"?: Json
          "last_synced_at"?: string | null
          "created_by": string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "provider"?: Database["public"]["Enums"]["integration_provider"]
          "display_name"?: string
          "adapter_version"?: string
          "status"?: string
          "capabilities"?: Json
          "configuration"?: Json
          "last_synced_at"?: string | null
          "created_by"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "integration_events": {
        Row: {
          "id": number
          "organization_id": string
          "connection_id": string | null
          "event_type": string
          "severity": string
          "message": string
          "metadata": Json
          "occurred_at": string
        }
        Insert: {
          "id"?: number
          "organization_id": string
          "connection_id"?: string | null
          "event_type": string
          "severity"?: string
          "message": string
          "metadata"?: Json
          "occurred_at"?: string
        }
        Update: {
          "id"?: number
          "organization_id"?: string
          "connection_id"?: string | null
          "event_type"?: string
          "severity"?: string
          "message"?: string
          "metadata"?: Json
          "occurred_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_events_organization_id_connection_id_fkey"
            columns: ["organization_id","connection_id"]
            referencedRelation: "integration_connections"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "integration_events_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "integration_sync_jobs": {
        Row: {
          "id": string
          "organization_id": string
          "connection_id": string
          "direction": string
          "resource_type": string
          "status": Database["public"]["Enums"]["job_status"]
          "cursor": string | null
          "attempts": number
          "max_attempts": number
          "next_attempt_at": string | null
          "records_processed": number
          "error_message": string | null
          "started_at": string | null
          "completed_at": string | null
          "created_at": string
          "updated_at": string
          "retry_of_id": string | null
          "requested_by": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "connection_id": string
          "direction": string
          "resource_type": string
          "status"?: Database["public"]["Enums"]["job_status"]
          "cursor"?: string | null
          "attempts"?: number
          "max_attempts"?: number
          "next_attempt_at"?: string | null
          "records_processed"?: number
          "error_message"?: string | null
          "started_at"?: string | null
          "completed_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "retry_of_id"?: string | null
          "requested_by"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "connection_id"?: string
          "direction"?: string
          "resource_type"?: string
          "status"?: Database["public"]["Enums"]["job_status"]
          "cursor"?: string | null
          "attempts"?: number
          "max_attempts"?: number
          "next_attempt_at"?: string | null
          "records_processed"?: number
          "error_message"?: string | null
          "started_at"?: string | null
          "completed_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "retry_of_id"?: string | null
          "requested_by"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_jobs_organization_id_connection_id_fkey"
            columns: ["organization_id","connection_id"]
            referencedRelation: "integration_connections"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "integration_sync_jobs_retry_of_id_fkey"
            columns: ["retry_of_id"]
            referencedRelation: "integration_sync_jobs"
            referencedColumns: ["id"]
          },
        ]
      };
      "integration_sync_records": {
        Row: {
          "id": string
          "organization_id": string
          "sync_job_id": string
          "resource_type": string
          "external_id": string
          "local_table": string | null
          "local_id": string | null
          "status": string
          "payload_hash": string | null
          "error_message": string | null
          "processed_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "sync_job_id": string
          "resource_type": string
          "external_id": string
          "local_table"?: string | null
          "local_id"?: string | null
          "status": string
          "payload_hash"?: string | null
          "error_message"?: string | null
          "processed_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "sync_job_id"?: string
          "resource_type"?: string
          "external_id"?: string
          "local_table"?: string | null
          "local_id"?: string | null
          "status"?: string
          "payload_hash"?: string | null
          "error_message"?: string | null
          "processed_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_records_organization_id_sync_job_id_fkey"
            columns: ["organization_id","sync_job_id"]
            referencedRelation: "integration_sync_jobs"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "inventory_categories": {
        Row: {
          "id": string
          "organization_id": string
          "name": string
          "parent_id": string | null
          "created_at": string
          "is_active": boolean
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "name": string
          "parent_id"?: string | null
          "created_at"?: string
          "is_active"?: boolean
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "name"?: string
          "parent_id"?: string | null
          "created_at"?: string
          "is_active"?: boolean
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_categories_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_categories_parent_org_fk"
            columns: ["organization_id","parent_id"]
            referencedRelation: "inventory_categories"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "inventory_count_lines": {
        Row: {
          "id": string
          "organization_id": string
          "inventory_count_id": string
          "inventory_item_id": string
          "unit_id": string
          "expected_quantity": number | null
          "counted_quantity": number
          "unit_cost_cents": number | null
          "notes": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "inventory_count_id": string
          "inventory_item_id": string
          "unit_id": string
          "expected_quantity"?: number | null
          "counted_quantity": number
          "unit_cost_cents"?: number | null
          "notes"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "inventory_count_id"?: string
          "inventory_item_id"?: string
          "unit_id"?: string
          "expected_quantity"?: number | null
          "counted_quantity"?: number
          "unit_cost_cents"?: number | null
          "notes"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_lines_organization_id_inventory_count_id_fkey"
            columns: ["organization_id","inventory_count_id"]
            referencedRelation: "inventory_counts"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "inventory_count_lines_organization_id_inventory_item_id_fkey"
            columns: ["organization_id","inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "inventory_count_lines_organization_id_unit_id_fkey"
            columns: ["organization_id","unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "inventory_counts": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "counted_at": string
          "status": Database["public"]["Enums"]["review_status"]
          "count_type": string
          "counted_by": string
          "approved_by": string | null
          "approved_at": string | null
          "notes": string | null
          "created_at": string
          "updated_at": string
          "review_note": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "counted_at"?: string
          "status"?: Database["public"]["Enums"]["review_status"]
          "count_type"?: string
          "counted_by": string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "review_note"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "counted_at"?: string
          "status"?: Database["public"]["Enums"]["review_status"]
          "count_type"?: string
          "counted_by"?: string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "review_note"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "inventory_items": {
        Row: {
          "id": string
          "organization_id": string
          "category_id": string | null
          "base_unit_id": string
          "name": string
          "sku": string | null
          "description": string | null
          "track_inventory": boolean
          "is_active": boolean
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "category_id"?: string | null
          "base_unit_id": string
          "name": string
          "sku"?: string | null
          "description"?: string | null
          "track_inventory"?: boolean
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "category_id"?: string | null
          "base_unit_id"?: string
          "name"?: string
          "sku"?: string | null
          "description"?: string | null
          "track_inventory"?: boolean
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_organization_id_base_unit_id_fkey"
            columns: ["organization_id","base_unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "inventory_items_organization_id_category_id_fkey"
            columns: ["organization_id","category_id"]
            referencedRelation: "inventory_categories"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "inventory_items_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "inventory_par_levels": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "inventory_item_id": string
          "par_quantity": number
          "reorder_quantity": number | null
          "effective_from": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "inventory_item_id": string
          "par_quantity": number
          "reorder_quantity"?: number | null
          "effective_from"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "inventory_item_id"?: string
          "par_quantity"?: number
          "reorder_quantity"?: number | null
          "effective_from"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_par_levels_organization_id_inventory_item_id_fkey"
            columns: ["organization_id","inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "inventory_par_levels_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "inventory_recipe_versions": {
        Row: {
          "id": string
          "organization_id": string
          "recipe_id": string
          "version_number": number
          "snapshot": Json
          "changed_by": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "recipe_id": string
          "version_number": number
          "snapshot": Json
          "changed_by": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "recipe_id"?: string
          "version_number"?: number
          "snapshot"?: Json
          "changed_by"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_recipe_versions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_recipe_versions_organization_id_recipe_id_fkey"
            columns: ["organization_id","recipe_id"]
            referencedRelation: "recipes"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "inventory_transactions": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "inventory_item_id": string
          "unit_id": string
          "transaction_kind": Database["public"]["Enums"]["inventory_transaction_kind"]
          "quantity_delta": number
          "unit_cost_cents": number | null
          "occurred_at": string
          "reference_type": string | null
          "reference_id": string | null
          "reason": string | null
          "created_by": string
          "approved_by": string | null
          "approved_at": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "inventory_item_id": string
          "unit_id": string
          "transaction_kind": Database["public"]["Enums"]["inventory_transaction_kind"]
          "quantity_delta": number
          "unit_cost_cents"?: number | null
          "occurred_at"?: string
          "reference_type"?: string | null
          "reference_id"?: string | null
          "reason"?: string | null
          "created_by": string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "inventory_item_id"?: string
          "unit_id"?: string
          "transaction_kind"?: Database["public"]["Enums"]["inventory_transaction_kind"]
          "quantity_delta"?: number
          "unit_cost_cents"?: number | null
          "occurred_at"?: string
          "reference_type"?: string | null
          "reference_id"?: string | null
          "reason"?: string | null
          "created_by"?: string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_organization_id_inventory_item_id_fkey"
            columns: ["organization_id","inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "inventory_transactions_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "inventory_transactions_organization_id_unit_id_fkey"
            columns: ["organization_id","unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "inventory_transfer_lines": {
        Row: {
          "id": string
          "organization_id": string
          "transfer_id": string
          "inventory_item_id": string
          "unit_id": string
          "sent_quantity": number
          "received_quantity": number | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "transfer_id": string
          "inventory_item_id": string
          "unit_id": string
          "sent_quantity": number
          "received_quantity"?: number | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "transfer_id"?: string
          "inventory_item_id"?: string
          "unit_id"?: string
          "sent_quantity"?: number
          "received_quantity"?: number | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transfer_lines_organization_id_inventory_item_id_fkey"
            columns: ["organization_id","inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "inventory_transfer_lines_organization_id_transfer_id_fkey"
            columns: ["organization_id","transfer_id"]
            referencedRelation: "inventory_transfers"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "inventory_transfer_lines_organization_id_unit_id_fkey"
            columns: ["organization_id","unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "inventory_transfers": {
        Row: {
          "id": string
          "organization_id": string
          "from_location_id": string
          "to_location_id": string
          "status": string
          "sent_at": string | null
          "received_at": string | null
          "created_by": string
          "received_by": string | null
          "notes": string | null
          "created_at": string
          "updated_at": string
          "reviewed_by": string | null
          "reviewed_at": string | null
          "review_note": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "from_location_id": string
          "to_location_id": string
          "status"?: string
          "sent_at"?: string | null
          "received_at"?: string | null
          "created_by": string
          "received_by"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "reviewed_by"?: string | null
          "reviewed_at"?: string | null
          "review_note"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "from_location_id"?: string
          "to_location_id"?: string
          "status"?: string
          "sent_at"?: string | null
          "received_at"?: string | null
          "created_by"?: string
          "received_by"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "reviewed_by"?: string | null
          "reviewed_at"?: string | null
          "review_note"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transfers_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfers_organization_id_from_location_id_fkey"
            columns: ["organization_id","from_location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "inventory_transfers_organization_id_to_location_id_fkey"
            columns: ["organization_id","to_location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "item_price_history": {
        Row: {
          "id": string
          "organization_id": string
          "inventory_item_id": string
          "vendor_id": string | null
          "unit_id": string
          "unit_price_cents": number
          "effective_at": string
          "source_type": string | null
          "source_id": string | null
          "created_at": string
          "price_quantity": number
          "notes": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "inventory_item_id": string
          "vendor_id"?: string | null
          "unit_id": string
          "unit_price_cents": number
          "effective_at": string
          "source_type"?: string | null
          "source_id"?: string | null
          "created_at"?: string
          "price_quantity"?: number
          "notes"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "inventory_item_id"?: string
          "vendor_id"?: string | null
          "unit_id"?: string
          "unit_price_cents"?: number
          "effective_at"?: string
          "source_type"?: string | null
          "source_id"?: string | null
          "created_at"?: string
          "price_quantity"?: number
          "notes"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_price_history_organization_id_inventory_item_id_fkey"
            columns: ["organization_id","inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "item_price_history_organization_id_unit_id_fkey"
            columns: ["organization_id","unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "item_price_history_organization_id_vendor_id_fkey"
            columns: ["organization_id","vendor_id"]
            referencedRelation: "vendors"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "job_role_capabilities": {
        Row: {
          "id": string
          "organization_id": string
          "job_role_id": string
          "capability_key": string
          "location_id": string | null
          "effective_from": string
          "effective_to": string | null
          "is_active": boolean
          "created_by": string
          "updated_by": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "job_role_id": string
          "capability_key": string
          "location_id"?: string | null
          "effective_from"?: string
          "effective_to"?: string | null
          "is_active"?: boolean
          "created_by": string
          "updated_by": string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "job_role_id"?: string
          "capability_key"?: string
          "location_id"?: string | null
          "effective_from"?: string
          "effective_to"?: string | null
          "is_active"?: boolean
          "created_by"?: string
          "updated_by"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_role_capabilities_capability_key_fkey"
            columns: ["capability_key"]
            referencedRelation: "capability_definitions"
            referencedColumns: ["capability_key"]
          },
          {
            foreignKeyName: "job_role_capabilities_organization_id_job_role_id_fkey"
            columns: ["organization_id","job_role_id"]
            referencedRelation: "job_roles"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "job_role_capabilities_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "job_roles": {
        Row: {
          "id": string
          "organization_id": string
          "name": string
          "code": string
          "department": string | null
          "color": string | null
          "default_tip_points": number
          "is_tipped": boolean
          "is_active": boolean
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "name": string
          "code": string
          "department"?: string | null
          "color"?: string | null
          "default_tip_points"?: number
          "is_tipped"?: boolean
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "name"?: string
          "code"?: string
          "department"?: string | null
          "color"?: string | null
          "default_tip_points"?: number
          "is_tipped"?: boolean
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_roles_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "location_memberships": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "user_id": string
          "is_primary": boolean
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "user_id": string
          "is_primary"?: boolean
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "user_id"?: string
          "is_primary"?: boolean
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_memberships_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "location_memberships_organization_id_user_id_fkey"
            columns: ["organization_id","user_id"]
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id","user_id"]
          },
        ]
      };
      "locations": {
        Row: {
          "id": string
          "organization_id": string
          "name": string
          "code": string
          "timezone": string
          "address": Json
          "phone": string | null
          "is_active": boolean
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "name": string
          "code": string
          "timezone": string
          "address"?: Json
          "phone"?: string | null
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "name"?: string
          "code"?: string
          "timezone"?: string
          "address"?: Json
          "phone"?: string | null
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "maintenance_requests": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "title": string
          "description": string
          "category": string | null
          "priority": string
          "status": Database["public"]["Enums"]["task_status"]
          "reported_by": string
          "assigned_to": string | null
          "vendor_id": string | null
          "estimated_cost_cents": number | null
          "actual_cost_cents": number | null
          "due_at": string | null
          "resolved_at": string | null
          "created_at": string
          "updated_at": string
          "resolved_by": string | null
          "status_note": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "title": string
          "description": string
          "category"?: string | null
          "priority"?: string
          "status"?: Database["public"]["Enums"]["task_status"]
          "reported_by": string
          "assigned_to"?: string | null
          "vendor_id"?: string | null
          "estimated_cost_cents"?: number | null
          "actual_cost_cents"?: number | null
          "due_at"?: string | null
          "resolved_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "resolved_by"?: string | null
          "status_note"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "title"?: string
          "description"?: string
          "category"?: string | null
          "priority"?: string
          "status"?: Database["public"]["Enums"]["task_status"]
          "reported_by"?: string
          "assigned_to"?: string | null
          "vendor_id"?: string | null
          "estimated_cost_cents"?: number | null
          "actual_cost_cents"?: number | null
          "due_at"?: string | null
          "resolved_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "resolved_by"?: string | null
          "status_note"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_requests_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "maintenance_requests_organization_id_vendor_id_fkey"
            columns: ["organization_id","vendor_id"]
            referencedRelation: "vendors"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "manager_log_entries": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "business_date": string
          "service_period": string
          "category": string
          "severity": string
          "title": string
          "narrative": string
          "author_id": string
          "related_employee_id": string | null
          "related_guest_id": string | null
          "related_reservation_id": string | null
          "related_inventory_item_id": string | null
          "follow_up_owner_id": string | null
          "due_date": string | null
          "status": string
          "resolution": string | null
          "attachment_path": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id": string
          "organization_id": string
          "location_id": string
          "business_date": string
          "service_period": string
          "category": string
          "severity": string
          "title": string
          "narrative": string
          "author_id": string
          "related_employee_id"?: string | null
          "related_guest_id"?: string | null
          "related_reservation_id"?: string | null
          "related_inventory_item_id"?: string | null
          "follow_up_owner_id"?: string | null
          "due_date"?: string | null
          "status": string
          "resolution"?: string | null
          "attachment_path"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "business_date"?: string
          "service_period"?: string
          "category"?: string
          "severity"?: string
          "title"?: string
          "narrative"?: string
          "author_id"?: string
          "related_employee_id"?: string | null
          "related_guest_id"?: string | null
          "related_reservation_id"?: string | null
          "related_inventory_item_id"?: string | null
          "follow_up_owner_id"?: string | null
          "due_date"?: string | null
          "status"?: string
          "resolution"?: string | null
          "attachment_path"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_log_entries_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "manager_log_entries_organization_id_related_employee_id_fkey"
            columns: ["organization_id","related_employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "manager_log_entries_organization_id_related_guest_id_fkey"
            columns: ["organization_id","related_guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "manager_log_entries_organization_id_related_inventory_item_fkey"
            columns: ["organization_id","related_inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "manager_log_entries_organization_id_related_reservation_id_fkey"
            columns: ["organization_id","related_reservation_id"]
            referencedRelation: "reservations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "manager_log_versions": {
        Row: {
          "id": string
          "organization_id": string
          "manager_log_entry_id": string
          "version_number": number
          "snapshot": Json
          "changed_by": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "manager_log_entry_id": string
          "version_number": number
          "snapshot": Json
          "changed_by": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "manager_log_entry_id"?: string
          "version_number"?: number
          "snapshot"?: Json
          "changed_by"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_log_versions_organization_id_manager_log_entry_id_fkey"
            columns: ["organization_id","manager_log_entry_id"]
            referencedRelation: "manager_log_entries"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "measurement_units": {
        Row: {
          "id": string
          "organization_id": string
          "name": string
          "symbol": string
          "dimension": string
          "is_base": boolean
          "created_at": string
          "is_active": boolean
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "name": string
          "symbol": string
          "dimension": string
          "is_base"?: boolean
          "created_at"?: string
          "is_active"?: boolean
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "name"?: string
          "symbol"?: string
          "dimension"?: string
          "is_base"?: boolean
          "created_at"?: string
          "is_active"?: boolean
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurement_units_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "notification_preferences": {
        Row: {
          "id": string
          "organization_id": string
          "user_id": string
          "notification_type": string
          "in_app": boolean
          "email": boolean
          "push": boolean
          "quiet_hours": Json
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "user_id": string
          "notification_type": string
          "in_app"?: boolean
          "email"?: boolean
          "push"?: boolean
          "quiet_hours"?: Json
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "user_id"?: string
          "notification_type"?: string
          "in_app"?: boolean
          "email"?: boolean
          "push"?: boolean
          "quiet_hours"?: Json
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_member_fk"
            columns: ["organization_id","user_id"]
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id","user_id"]
          },
          {
            foreignKeyName: "notification_preferences_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "notifications": {
        Row: {
          "id": string
          "organization_id": string
          "user_id": string
          "notification_type": string
          "title": string
          "body": string | null
          "action_url": string | null
          "entity_type": string | null
          "entity_id": string | null
          "read_at": string | null
          "created_at": string
          "evidence_key": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "user_id": string
          "notification_type": string
          "title": string
          "body"?: string | null
          "action_url"?: string | null
          "entity_type"?: string | null
          "entity_id"?: string | null
          "read_at"?: string | null
          "created_at"?: string
          "evidence_key"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "user_id"?: string
          "notification_type"?: string
          "title"?: string
          "body"?: string | null
          "action_url"?: string | null
          "entity_type"?: string | null
          "entity_id"?: string | null
          "read_at"?: string | null
          "created_at"?: string
          "evidence_key"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_active_member_fk"
            columns: ["organization_id","user_id"]
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id","user_id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "organization_memberships": {
        Row: {
          "id": string
          "organization_id": string
          "user_id": string
          "role": Database["public"]["Enums"]["app_role"]
          "status": Database["public"]["Enums"]["membership_status"]
          "invited_by": string | null
          "invited_at": string
          "joined_at": string | null
          "suspended_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "user_id": string
          "role": Database["public"]["Enums"]["app_role"]
          "status"?: Database["public"]["Enums"]["membership_status"]
          "invited_by"?: string | null
          "invited_at"?: string
          "joined_at"?: string | null
          "suspended_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "user_id"?: string
          "role"?: Database["public"]["Enums"]["app_role"]
          "status"?: Database["public"]["Enums"]["membership_status"]
          "invited_by"?: string | null
          "invited_at"?: string
          "joined_at"?: string | null
          "suspended_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "organization_settings": {
        Row: {
          "organization_id": string
          "week_starts_on": number
          "default_location_id": string | null
          "branding": Json
          "feature_flags": Json
          "configured_at": string | null
          "updated_at": string
        }
        Insert: {
          "organization_id": string
          "week_starts_on"?: number
          "default_location_id"?: string | null
          "branding"?: Json
          "feature_flags"?: Json
          "configured_at"?: string | null
          "updated_at"?: string
        }
        Update: {
          "organization_id"?: string
          "week_starts_on"?: number
          "default_location_id"?: string | null
          "branding"?: Json
          "feature_flags"?: Json
          "configured_at"?: string | null
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_default_location_id_fkey"
            columns: ["organization_id","default_location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "organizations": {
        Row: {
          "id": string
          "name": string
          "slug": string
          "timezone": string
          "currency_code": string
          "status": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "name": string
          "slug": string
          "timezone"?: string
          "currency_code"?: string
          "status"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "name"?: string
          "slug"?: string
          "timezone"?: string
          "currency_code"?: string
          "status"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: []
      };
      "payroll_exports": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "period_start": string
          "period_end": string
          "status": Database["public"]["Enums"]["job_status"]
          "format": string
          "storage_path": string | null
          "totals": Json
          "generated_by": string
          "generated_at": string | null
          "created_at": string
          "tip_run_id": string | null
          "allocation_snapshot": Json
          "allocation_snapshot_hash": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "period_start": string
          "period_end": string
          "status"?: Database["public"]["Enums"]["job_status"]
          "format"?: string
          "storage_path"?: string | null
          "totals"?: Json
          "generated_by": string
          "generated_at"?: string | null
          "created_at"?: string
          "tip_run_id"?: string | null
          "allocation_snapshot"?: Json
          "allocation_snapshot_hash"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "period_start"?: string
          "period_end"?: string
          "status"?: Database["public"]["Enums"]["job_status"]
          "format"?: string
          "storage_path"?: string | null
          "totals"?: Json
          "generated_by"?: string
          "generated_at"?: string | null
          "created_at"?: string
          "tip_run_id"?: string | null
          "allocation_snapshot"?: Json
          "allocation_snapshot_hash"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_exports_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_exports_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "payroll_exports_tip_run_fk"
            columns: ["organization_id","tip_run_id"]
            referencedRelation: "tip_runs"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "preshift_acknowledgements": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "preshift_id": string
          "employee_id": string
          "acknowledged_by": string
          "acknowledged_at": string
          "comment": string | null
        }
        Insert: {
          "id": string
          "organization_id": string
          "location_id": string
          "preshift_id": string
          "employee_id": string
          "acknowledged_by": string
          "acknowledged_at"?: string
          "comment"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "preshift_id"?: string
          "employee_id"?: string
          "acknowledged_by"?: string
          "acknowledged_at"?: string
          "comment"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "preshift_acknowledgements_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "preshift_acknowledgements_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "preshift_acknowledgements_organization_id_preshift_id_fkey"
            columns: ["organization_id","preshift_id"]
            referencedRelation: "preshifts"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "preshifts": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "business_date": string
          "service_period": string
          "version_number": number
          "status": string
          "booked_covers": number | null
          "projected_covers": number | null
          "vip_notes": string | null
          "allergy_notes": string | null
          "large_party_notes": string | null
          "specials": string | null
          "staffing_notes": string | null
          "station_assignments": Json
          "previous_handoff": string | null
          "service_goal": string | null
          "training_point": string | null
          "manager_notes": string | null
          "created_by": string
          "published_by": string | null
          "published_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id": string
          "organization_id": string
          "location_id": string
          "business_date": string
          "service_period": string
          "version_number"?: number
          "status": string
          "booked_covers"?: number | null
          "projected_covers"?: number | null
          "vip_notes"?: string | null
          "allergy_notes"?: string | null
          "large_party_notes"?: string | null
          "specials"?: string | null
          "staffing_notes"?: string | null
          "station_assignments"?: Json
          "previous_handoff"?: string | null
          "service_goal"?: string | null
          "training_point"?: string | null
          "manager_notes"?: string | null
          "created_by": string
          "published_by"?: string | null
          "published_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "business_date"?: string
          "service_period"?: string
          "version_number"?: number
          "status"?: string
          "booked_covers"?: number | null
          "projected_covers"?: number | null
          "vip_notes"?: string | null
          "allergy_notes"?: string | null
          "large_party_notes"?: string | null
          "specials"?: string | null
          "staffing_notes"?: string | null
          "station_assignments"?: Json
          "previous_handoff"?: string | null
          "service_goal"?: string | null
          "training_point"?: string | null
          "manager_notes"?: string | null
          "created_by"?: string
          "published_by"?: string | null
          "published_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "preshifts_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "profiles": {
        Row: {
          "id": string
          "display_name": string
          "preferred_name": string | null
          "avatar_path": string | null
          "phone": string | null
          "locale": string
          "timezone": string
          "last_seen_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id": string
          "display_name": string
          "preferred_name"?: string | null
          "avatar_path"?: string | null
          "phone"?: string | null
          "locale"?: string
          "timezone"?: string
          "last_seen_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "display_name"?: string
          "preferred_name"?: string | null
          "avatar_path"?: string | null
          "phone"?: string | null
          "locale"?: string
          "timezone"?: string
          "last_seen_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: []
      };
      "purchase_order_lines": {
        Row: {
          "id": string
          "organization_id": string
          "purchase_order_id": string
          "inventory_item_id": string
          "unit_id": string
          "quantity": number
          "unit_price_cents": number
          "line_total_cents": number | null
          "notes": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "purchase_order_id": string
          "inventory_item_id": string
          "unit_id": string
          "quantity": number
          "unit_price_cents": number
          "line_total_cents"?: number | null
          "notes"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "purchase_order_id"?: string
          "inventory_item_id"?: string
          "unit_id"?: string
          "quantity"?: number
          "unit_price_cents"?: number
          "line_total_cents"?: number | null
          "notes"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_organization_id_inventory_item_id_fkey"
            columns: ["organization_id","inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "purchase_order_lines_organization_id_purchase_order_id_fkey"
            columns: ["organization_id","purchase_order_id"]
            referencedRelation: "purchase_orders"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "purchase_order_lines_organization_id_unit_id_fkey"
            columns: ["organization_id","unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "purchase_orders": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "vendor_id": string
          "po_number": string
          "status": string
          "ordered_on": string | null
          "expected_on": string | null
          "subtotal_cents": number
          "tax_cents": number
          "shipping_cents": number
          "notes": string | null
          "created_by": string
          "approved_by": string | null
          "approved_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "vendor_id": string
          "po_number": string
          "status"?: string
          "ordered_on"?: string | null
          "expected_on"?: string | null
          "subtotal_cents"?: number
          "tax_cents"?: number
          "shipping_cents"?: number
          "notes"?: string | null
          "created_by": string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "vendor_id"?: string
          "po_number"?: string
          "status"?: string
          "ordered_on"?: string | null
          "expected_on"?: string | null
          "subtotal_cents"?: number
          "tax_cents"?: number
          "shipping_cents"?: number
          "notes"?: string | null
          "created_by"?: string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "purchase_orders_organization_id_vendor_id_fkey"
            columns: ["organization_id","vendor_id"]
            referencedRelation: "vendors"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "push_subscriptions": {
        Row: {
          "id": string
          "organization_id": string
          "user_id": string
          "endpoint_hash": string
          "encrypted_subscription": string
          "device_label": string | null
          "last_used_at": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "user_id": string
          "endpoint_hash": string
          "encrypted_subscription": string
          "device_label"?: string | null
          "last_used_at"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "user_id"?: string
          "endpoint_hash"?: string
          "encrypted_subscription"?: string
          "device_label"?: string | null
          "last_used_at"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_member_fk"
            columns: ["organization_id","user_id"]
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id","user_id"]
          },
          {
            foreignKeyName: "push_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "receipt_duplicate_matches": {
        Row: {
          "id": string
          "organization_id": string
          "receipt_id": string
          "possible_duplicate_id": string
          "score": number
          "reasons": Json
          "resolution": string | null
          "resolved_by": string | null
          "resolved_at": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "receipt_id": string
          "possible_duplicate_id": string
          "score": number
          "reasons"?: Json
          "resolution"?: string | null
          "resolved_by"?: string | null
          "resolved_at"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "receipt_id"?: string
          "possible_duplicate_id"?: string
          "score"?: number
          "reasons"?: Json
          "resolution"?: string | null
          "resolved_by"?: string | null
          "resolved_at"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_duplicate_matches_organization_id_possible_duplica_fkey"
            columns: ["organization_id","possible_duplicate_id"]
            referencedRelation: "receipts"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "receipt_duplicate_matches_organization_id_receipt_id_fkey"
            columns: ["organization_id","receipt_id"]
            referencedRelation: "receipts"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "receipt_extractions": {
        Row: {
          "id": string
          "organization_id": string
          "receipt_id": string
          "ocr_run_id": string | null
          "field_name": string
          "extracted_value": Json
          "normalized_value": Json | null
          "confidence": number | null
          "bounding_box": Json | null
          "review_status": Database["public"]["Enums"]["review_status"]
          "reviewed_by": string | null
          "reviewed_at": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "receipt_id": string
          "ocr_run_id"?: string | null
          "field_name": string
          "extracted_value": Json
          "normalized_value"?: Json | null
          "confidence"?: number | null
          "bounding_box"?: Json | null
          "review_status"?: Database["public"]["Enums"]["review_status"]
          "reviewed_by"?: string | null
          "reviewed_at"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "receipt_id"?: string
          "ocr_run_id"?: string | null
          "field_name"?: string
          "extracted_value"?: Json
          "normalized_value"?: Json | null
          "confidence"?: number | null
          "bounding_box"?: Json | null
          "review_status"?: Database["public"]["Enums"]["review_status"]
          "reviewed_by"?: string | null
          "reviewed_at"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_extractions_organization_id_ocr_run_id_fkey"
            columns: ["organization_id","ocr_run_id"]
            referencedRelation: "receipt_ocr_runs"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "receipt_extractions_organization_id_receipt_id_fkey"
            columns: ["organization_id","receipt_id"]
            referencedRelation: "receipts"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "receipt_files": {
        Row: {
          "id": string
          "organization_id": string
          "receipt_id": string
          "storage_path": string
          "file_name": string
          "mime_type": string
          "size_bytes": number | null
          "page_count": number | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "receipt_id": string
          "storage_path": string
          "file_name": string
          "mime_type": string
          "size_bytes"?: number | null
          "page_count"?: number | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "receipt_id"?: string
          "storage_path"?: string
          "file_name"?: string
          "mime_type"?: string
          "size_bytes"?: number | null
          "page_count"?: number | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_files_organization_id_receipt_id_fkey"
            columns: ["organization_id","receipt_id"]
            referencedRelation: "receipts"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "receipt_ocr_runs": {
        Row: {
          "id": string
          "organization_id": string
          "receipt_id": string
          "provider": string
          "model": string | null
          "status": Database["public"]["Enums"]["job_status"]
          "raw_response": Json | null
          "error_message": string | null
          "started_at": string | null
          "completed_at": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "receipt_id": string
          "provider": string
          "model"?: string | null
          "status"?: Database["public"]["Enums"]["job_status"]
          "raw_response"?: Json | null
          "error_message"?: string | null
          "started_at"?: string | null
          "completed_at"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "receipt_id"?: string
          "provider"?: string
          "model"?: string | null
          "status"?: Database["public"]["Enums"]["job_status"]
          "raw_response"?: Json | null
          "error_message"?: string | null
          "started_at"?: string | null
          "completed_at"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_ocr_runs_organization_id_receipt_id_fkey"
            columns: ["organization_id","receipt_id"]
            referencedRelation: "receipts"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "receipts": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "vendor_id": string | null
          "expense_category_id": string | null
          "document_kind": string
          "document_number": string | null
          "document_date": string | null
          "total_cents": number | null
          "tax_cents": number | null
          "currency_code": string
          "payment_method": string | null
          "review_status": Database["public"]["Enums"]["review_status"]
          "ocr_text": string | null
          "content_hash": string | null
          "source": string
          "uploaded_by": string
          "reviewed_by": string | null
          "reviewed_at": string | null
          "notes": string | null
          "search_vector": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "vendor_id"?: string | null
          "expense_category_id"?: string | null
          "document_kind"?: string
          "document_number"?: string | null
          "document_date"?: string | null
          "total_cents"?: number | null
          "tax_cents"?: number | null
          "currency_code"?: string
          "payment_method"?: string | null
          "review_status"?: Database["public"]["Enums"]["review_status"]
          "ocr_text"?: string | null
          "content_hash"?: string | null
          "source"?: string
          "uploaded_by": string
          "reviewed_by"?: string | null
          "reviewed_at"?: string | null
          "notes"?: string | null
          "search_vector"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "vendor_id"?: string | null
          "expense_category_id"?: string | null
          "document_kind"?: string
          "document_number"?: string | null
          "document_date"?: string | null
          "total_cents"?: number | null
          "tax_cents"?: number | null
          "currency_code"?: string
          "payment_method"?: string | null
          "review_status"?: Database["public"]["Enums"]["review_status"]
          "ocr_text"?: string | null
          "content_hash"?: string | null
          "source"?: string
          "uploaded_by"?: string
          "reviewed_by"?: string | null
          "reviewed_at"?: string | null
          "notes"?: string | null
          "search_vector"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_organization_id_expense_category_id_fkey"
            columns: ["organization_id","expense_category_id"]
            referencedRelation: "expense_categories"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "receipts_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "receipts_organization_id_vendor_id_fkey"
            columns: ["organization_id","vendor_id"]
            referencedRelation: "vendors"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "recipe_ingredients": {
        Row: {
          "id": string
          "organization_id": string
          "recipe_id": string
          "inventory_item_id": string
          "unit_id": string
          "quantity": number
          "waste_factor": number
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "recipe_id": string
          "inventory_item_id": string
          "unit_id": string
          "quantity": number
          "waste_factor"?: number
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "recipe_id"?: string
          "inventory_item_id"?: string
          "unit_id"?: string
          "quantity"?: number
          "waste_factor"?: number
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_organization_id_inventory_item_id_fkey"
            columns: ["organization_id","inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "recipe_ingredients_organization_id_recipe_id_fkey"
            columns: ["organization_id","recipe_id"]
            referencedRelation: "recipes"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "recipe_ingredients_organization_id_unit_id_fkey"
            columns: ["organization_id","unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "recipes": {
        Row: {
          "id": string
          "organization_id": string
          "name": string
          "yield_quantity": number
          "yield_unit_id": string
          "menu_price_cents": number | null
          "is_active": boolean
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "name": string
          "yield_quantity"?: number
          "yield_unit_id": string
          "menu_price_cents"?: number | null
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "name"?: string
          "yield_quantity"?: number
          "yield_unit_id"?: string
          "menu_price_cents"?: number | null
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_organization_id_yield_unit_id_fkey"
            columns: ["organization_id","yield_unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "report_runs": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "saved_report_id": string | null
          "report_type": string
          "period_start": string | null
          "period_end": string | null
          "filters": Json
          "status": Database["public"]["Enums"]["job_status"]
          "result_summary": Json | null
          "row_count": number | null
          "error_message": string | null
          "requested_by": string
          "started_at": string | null
          "completed_at": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "saved_report_id"?: string | null
          "report_type": string
          "period_start"?: string | null
          "period_end"?: string | null
          "filters"?: Json
          "status"?: Database["public"]["Enums"]["job_status"]
          "result_summary"?: Json | null
          "row_count"?: number | null
          "error_message"?: string | null
          "requested_by": string
          "started_at"?: string | null
          "completed_at"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "saved_report_id"?: string | null
          "report_type"?: string
          "period_start"?: string | null
          "period_end"?: string | null
          "filters"?: Json
          "status"?: Database["public"]["Enums"]["job_status"]
          "result_summary"?: Json | null
          "row_count"?: number | null
          "error_message"?: string | null
          "requested_by"?: string
          "started_at"?: string | null
          "completed_at"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_runs_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "report_runs_organization_id_saved_report_id_fkey"
            columns: ["organization_id","saved_report_id"]
            referencedRelation: "saved_reports"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "reservation_events": {
        Row: {
          "id": number
          "organization_id": string
          "location_id": string
          "reservation_id": string
          "event_type": string
          "from_status": string | null
          "to_status": string | null
          "note": string | null
          "actor_id": string | null
          "actor_kind": string
          "metadata": Json
          "occurred_at": string
        }
        Insert: {
          "id"?: number
          "organization_id": string
          "location_id": string
          "reservation_id": string
          "event_type": string
          "from_status"?: string | null
          "to_status"?: string | null
          "note"?: string | null
          "actor_id"?: string | null
          "actor_kind"?: string
          "metadata"?: Json
          "occurred_at"?: string
        }
        Update: {
          "id"?: number
          "organization_id"?: string
          "location_id"?: string
          "reservation_id"?: string
          "event_type"?: string
          "from_status"?: string | null
          "to_status"?: string | null
          "note"?: string | null
          "actor_id"?: string | null
          "actor_kind"?: string
          "metadata"?: Json
          "occurred_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_events_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "reservation_events_organization_id_reservation_id_fkey"
            columns: ["organization_id","reservation_id"]
            referencedRelation: "reservations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "reservation_message_outbox": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "reservation_id": string | null
          "booking_hold_id": string | null
          "waitlist_entry_id": string | null
          "guest_id": string | null
          "channel": string
          "template_key": string
          "template_data": Json
          "status": string
          "dedupe_key": string
          "provider_message_id": string | null
          "attempts": number
          "next_attempt_at": string
          "claim_token": string | null
          "claimed_by": string | null
          "claimed_at": string | null
          "lease_expires_at": string | null
          "sent_at": string | null
          "delivered_at": string | null
          "last_error_code": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "reservation_id"?: string | null
          "booking_hold_id"?: string | null
          "waitlist_entry_id"?: string | null
          "guest_id"?: string | null
          "channel": string
          "template_key": string
          "template_data"?: Json
          "status"?: string
          "dedupe_key": string
          "provider_message_id"?: string | null
          "attempts"?: number
          "next_attempt_at"?: string
          "claim_token"?: string | null
          "claimed_by"?: string | null
          "claimed_at"?: string | null
          "lease_expires_at"?: string | null
          "sent_at"?: string | null
          "delivered_at"?: string | null
          "last_error_code"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "reservation_id"?: string | null
          "booking_hold_id"?: string | null
          "waitlist_entry_id"?: string | null
          "guest_id"?: string | null
          "channel"?: string
          "template_key"?: string
          "template_data"?: Json
          "status"?: string
          "dedupe_key"?: string
          "provider_message_id"?: string | null
          "attempts"?: number
          "next_attempt_at"?: string
          "claim_token"?: string | null
          "claimed_by"?: string | null
          "claimed_at"?: string | null
          "lease_expires_at"?: string | null
          "sent_at"?: string | null
          "delivered_at"?: string | null
          "last_error_code"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_message_outbox_organization_id_guest_id_fkey"
            columns: ["organization_id","guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "reservation_message_outbox_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "reservation_message_outbox_organization_id_reservation_id_fkey"
            columns: ["organization_id","reservation_id"]
            referencedRelation: "reservations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "reservation_message_outbox_organization_id_waitlist_entry__fkey"
            columns: ["organization_id","waitlist_entry_id"]
            referencedRelation: "waitlist_entries"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "reservation_push_deliveries": {
        Row: {
          "id": string
          "organization_id": string
          "notification_id": string
          "subscription_id": string
          "status": string
          "attempts": number
          "last_error_code": string | null
          "sent_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "notification_id": string
          "subscription_id": string
          "status"?: string
          "attempts"?: number
          "last_error_code"?: string | null
          "sent_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "notification_id"?: string
          "subscription_id"?: string
          "status"?: string
          "attempts"?: number
          "last_error_code"?: string | null
          "sent_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_push_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_push_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_push_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      };
      "reservation_revisions": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "reservation_id": string
          "request_id": string
          "actor_id": string
          "version": number
          "mutation_kind": string
          "reason": string
          "payload_hash": string
          "before_state": Json
          "after_state": Json
          "service_shift_id": string | null
          "service_shift_evidence": Json
          "policy_hash": string | null
          "policy_evidence": Json
          "allocation_evidence": Json
          "result_evidence": Json
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "reservation_id": string
          "request_id": string
          "actor_id": string
          "version": number
          "mutation_kind": string
          "reason": string
          "payload_hash": string
          "before_state": Json
          "after_state": Json
          "service_shift_id"?: string | null
          "service_shift_evidence"?: Json
          "policy_hash"?: string | null
          "policy_evidence"?: Json
          "allocation_evidence"?: Json
          "result_evidence": Json
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "reservation_id"?: string
          "request_id"?: string
          "actor_id"?: string
          "version"?: number
          "mutation_kind"?: string
          "reason"?: string
          "payload_hash"?: string
          "before_state"?: Json
          "after_state"?: Json
          "service_shift_id"?: string | null
          "service_shift_evidence"?: Json
          "policy_hash"?: string | null
          "policy_evidence"?: Json
          "allocation_evidence"?: Json
          "result_evidence"?: Json
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_revisions_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "reservation_revisions_organization_id_location_id_reservat_fkey"
            columns: ["organization_id","location_id","reservation_id"]
            referencedRelation: "reservations"
            referencedColumns: ["organization_id","location_id","id"]
          },
          {
            foreignKeyName: "reservation_revisions_organization_id_location_id_service__fkey"
            columns: ["organization_id","location_id","service_shift_id"]
            referencedRelation: "service_shifts"
            referencedColumns: ["organization_id","location_id","id"]
          },
        ]
      };
      "reservation_service_periods": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "name": string
          "days_of_week": number[]
          "starts_local": string
          "ends_local": string
          "default_duration_minutes": number
          "pacing_interval_minutes": number
          "pacing_cover_limit": number
          "min_party_size": number
          "max_party_size": number
          "effective_from": string
          "effective_to": string | null
          "online_enabled": boolean
          "is_active": boolean
          "approved_at": string | null
          "approved_by": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "name": string
          "days_of_week": number[]
          "starts_local": string
          "ends_local": string
          "default_duration_minutes": number
          "pacing_interval_minutes": number
          "pacing_cover_limit": number
          "min_party_size"?: number
          "max_party_size": number
          "effective_from": string
          "effective_to"?: string | null
          "online_enabled"?: boolean
          "is_active"?: boolean
          "approved_at"?: string | null
          "approved_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "name"?: string
          "days_of_week"?: number[]
          "starts_local"?: string
          "ends_local"?: string
          "default_duration_minutes"?: number
          "pacing_interval_minutes"?: number
          "pacing_cover_limit"?: number
          "min_party_size"?: number
          "max_party_size"?: number
          "effective_from"?: string
          "effective_to"?: string | null
          "online_enabled"?: boolean
          "is_active"?: boolean
          "approved_at"?: string | null
          "approved_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_service_periods_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "reservation_settings": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "online_booking_enabled": boolean
          "guest_messaging_enabled": boolean
          "verification_channels": string[]
          "staff_push_enabled": boolean
          "verification_hold_minutes": number
          "booking_horizon_days": number | null
          "minimum_lead_minutes": number | null
          "slot_interval_minutes": number | null
          "max_online_party_size": number | null
          "modification_cutoff_minutes": number | null
          "cancellation_cutoff_minutes": number | null
          "reminder_schedule_minutes": number[]
          "approved_at": string | null
          "approved_by": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "online_booking_enabled"?: boolean
          "guest_messaging_enabled"?: boolean
          "verification_channels"?: string[]
          "staff_push_enabled"?: boolean
          "verification_hold_minutes"?: number
          "booking_horizon_days"?: number | null
          "minimum_lead_minutes"?: number | null
          "slot_interval_minutes"?: number | null
          "max_online_party_size"?: number | null
          "modification_cutoff_minutes"?: number | null
          "cancellation_cutoff_minutes"?: number | null
          "reminder_schedule_minutes"?: number[]
          "approved_at"?: string | null
          "approved_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "online_booking_enabled"?: boolean
          "guest_messaging_enabled"?: boolean
          "verification_channels"?: string[]
          "staff_push_enabled"?: boolean
          "verification_hold_minutes"?: number
          "booking_horizon_days"?: number | null
          "minimum_lead_minutes"?: number | null
          "slot_interval_minutes"?: number | null
          "max_online_party_size"?: number | null
          "modification_cutoff_minutes"?: number | null
          "cancellation_cutoff_minutes"?: number | null
          "reminder_schedule_minutes"?: number[]
          "approved_at"?: string | null
          "approved_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_settings_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "reservation_table_allocations": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "reservation_id": string | null
          "booking_hold_id": string | null
          "table_id": string
          "allocation_kind": string
          "starts_at": string
          "ends_at": string
          "allocation_range": string | null
          "expires_at": string | null
          "is_active": boolean
          "released_at": string | null
          "released_by": string | null
          "created_by": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "reservation_id"?: string | null
          "booking_hold_id"?: string | null
          "table_id": string
          "allocation_kind": string
          "starts_at": string
          "ends_at": string
          "allocation_range"?: string | null
          "expires_at"?: string | null
          "is_active"?: boolean
          "released_at"?: string | null
          "released_by"?: string | null
          "created_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "reservation_id"?: string | null
          "booking_hold_id"?: string | null
          "table_id"?: string
          "allocation_kind"?: string
          "starts_at"?: string
          "ends_at"?: string
          "allocation_range"?: string | null
          "expires_at"?: string | null
          "is_active"?: boolean
          "released_at"?: string | null
          "released_by"?: string | null
          "created_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_table_allocations_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "reservation_table_allocations_organization_id_reservation__fkey"
            columns: ["organization_id","reservation_id"]
            referencedRelation: "reservations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "reservation_table_allocations_organization_id_table_id_fkey"
            columns: ["organization_id","table_id"]
            referencedRelation: "reservation_tables"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "reservation_table_combination_members": {
        Row: {
          "id": string
          "organization_id": string
          "combination_id": string
          "table_id": string
          "sort_order": number
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "combination_id": string
          "table_id": string
          "sort_order"?: number
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "combination_id"?: string
          "table_id"?: string
          "sort_order"?: number
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_table_combination_mem_organization_id_table_id_fkey"
            columns: ["organization_id","table_id"]
            referencedRelation: "reservation_tables"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "reservation_table_combination_organization_id_combination__fkey"
            columns: ["organization_id","combination_id"]
            referencedRelation: "reservation_table_combinations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "reservation_table_combinations": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "label": string
          "min_capacity": number
          "max_capacity": number
          "is_active": boolean
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "label": string
          "min_capacity": number
          "max_capacity": number
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "label"?: string
          "min_capacity"?: number
          "max_capacity"?: number
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_table_combinations_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "reservation_tables": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "dining_area_id": string | null
          "label": string
          "min_capacity": number
          "max_capacity": number
          "position_x": number
          "position_y": number
          "width": number
          "height": number
          "rotation_degrees": number
          "shape": string
          "is_bookable": boolean
          "is_active": boolean
          "approved_at": string | null
          "approved_by": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "dining_area_id"?: string | null
          "label": string
          "min_capacity"?: number
          "max_capacity": number
          "position_x": number
          "position_y": number
          "width": number
          "height": number
          "rotation_degrees"?: number
          "shape"?: string
          "is_bookable"?: boolean
          "is_active"?: boolean
          "approved_at"?: string | null
          "approved_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "dining_area_id"?: string | null
          "label"?: string
          "min_capacity"?: number
          "max_capacity"?: number
          "position_x"?: number
          "position_y"?: number
          "width"?: number
          "height"?: number
          "rotation_degrees"?: number
          "shape"?: string
          "is_bookable"?: boolean
          "is_active"?: boolean
          "approved_at"?: string | null
          "approved_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_tables_organization_id_dining_area_id_fkey"
            columns: ["organization_id","dining_area_id"]
            referencedRelation: "dining_areas"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "reservation_tables_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "reservation_turn_rules": {
        Row: {
          "id": string
          "organization_id": string
          "service_period_id": string
          "min_party_size": number
          "max_party_size": number
          "duration_minutes": number
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "service_period_id": string
          "min_party_size": number
          "max_party_size": number
          "duration_minutes": number
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "service_period_id"?: string
          "min_party_size"?: number
          "max_party_size"?: number
          "duration_minutes"?: number
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_turn_rules_organization_id_service_period_id_fkey"
            columns: ["organization_id","service_period_id"]
            referencedRelation: "reservation_service_periods"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "reservations": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "guest_id": string | null
          "reserved_at": string
          "party_size": number
          "status": string
          "table_label": string | null
          "special_requests": string | null
          "source": string
          "external_id": string | null
          "raw_payload": Json | null
          "created_at": string
          "updated_at": string
          "duration_minutes": number | null
          "public_code": string | null
          "booking_channel": string
          "version": number
          "confirmed_at": string | null
          "arrived_at": string | null
          "seated_at": string | null
          "completed_at": string | null
          "cancelled_at": string | null
          "cancellation_reason": string | null
          "created_by": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "guest_id"?: string | null
          "reserved_at": string
          "party_size": number
          "status": string
          "table_label"?: string | null
          "special_requests"?: string | null
          "source"?: string
          "external_id"?: string | null
          "raw_payload"?: Json | null
          "created_at"?: string
          "updated_at"?: string
          "duration_minutes"?: number | null
          "public_code"?: string | null
          "booking_channel"?: string
          "version"?: number
          "confirmed_at"?: string | null
          "arrived_at"?: string | null
          "seated_at"?: string | null
          "completed_at"?: string | null
          "cancelled_at"?: string | null
          "cancellation_reason"?: string | null
          "created_by"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "guest_id"?: string | null
          "reserved_at"?: string
          "party_size"?: number
          "status"?: string
          "table_label"?: string | null
          "special_requests"?: string | null
          "source"?: string
          "external_id"?: string | null
          "raw_payload"?: Json | null
          "created_at"?: string
          "updated_at"?: string
          "duration_minutes"?: number | null
          "public_code"?: string | null
          "booking_channel"?: string
          "version"?: number
          "confirmed_at"?: string | null
          "arrived_at"?: string | null
          "seated_at"?: string | null
          "completed_at"?: string | null
          "cancelled_at"?: string | null
          "cancellation_reason"?: string | null
          "created_by"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_organization_id_guest_id_fkey"
            columns: ["organization_id","guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "reservations_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "retention_policies": {
        Row: {
          "id": string
          "organization_id": string
          "data_class": string
          "retention_days": number | null
          "legal_hold": boolean
          "configured_by": string | null
          "configured_at": string | null
          "notes": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "data_class": string
          "retention_days"?: number | null
          "legal_hold"?: boolean
          "configured_by"?: string | null
          "configured_at"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "data_class"?: string
          "retention_days"?: number | null
          "legal_hold"?: boolean
          "configured_by"?: string | null
          "configured_at"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "saved_reports": {
        Row: {
          "id": string
          "organization_id": string
          "name": string
          "report_type": string
          "filters": Json
          "created_by": string
          "is_shared": boolean
          "created_at": string
          "updated_at": string
          "location_id": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "name": string
          "report_type": string
          "filters"?: Json
          "created_by": string
          "is_shared"?: boolean
          "created_at"?: string
          "updated_at"?: string
          "location_id"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "name"?: string
          "report_type"?: string
          "filters"?: Json
          "created_by"?: string
          "is_shared"?: boolean
          "created_at"?: string
          "updated_at"?: string
          "location_id"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_reports_location_scope_fk"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "saved_reports_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "schedule_template_shifts": {
        Row: {
          "id": string
          "organization_id": string
          "template_id": string
          "weekday": number
          "starts_at": string
          "ends_at": string
          "job_role_id": string
          "employee_id": string | null
          "break_minutes": number
          "notes": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "template_id": string
          "weekday": number
          "starts_at": string
          "ends_at": string
          "job_role_id": string
          "employee_id"?: string | null
          "break_minutes"?: number
          "notes"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "template_id"?: string
          "weekday"?: number
          "starts_at"?: string
          "ends_at"?: string
          "job_role_id"?: string
          "employee_id"?: string | null
          "break_minutes"?: number
          "notes"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_template_shifts_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "schedule_template_shifts_organization_id_job_role_id_fkey"
            columns: ["organization_id","job_role_id"]
            referencedRelation: "job_roles"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "schedule_template_shifts_organization_id_template_id_fkey"
            columns: ["organization_id","template_id"]
            referencedRelation: "schedule_templates"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "schedule_templates": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "name": string
          "description": string | null
          "created_by": string
          "is_active": boolean
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "name": string
          "description"?: string | null
          "created_by": string
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "name"?: string
          "description"?: string | null
          "created_by"?: string
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_templates_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "schedules": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "week_start": string
          "status": Database["public"]["Enums"]["schedule_status"]
          "version": number
          "template_id": string | null
          "created_by": string
          "published_by": string | null
          "published_at": string | null
          "publish_note": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "week_start": string
          "status"?: Database["public"]["Enums"]["schedule_status"]
          "version"?: number
          "template_id"?: string | null
          "created_by": string
          "published_by"?: string | null
          "published_at"?: string | null
          "publish_note"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "week_start"?: string
          "status"?: Database["public"]["Enums"]["schedule_status"]
          "version"?: number
          "template_id"?: string | null
          "created_by"?: string
          "published_by"?: string | null
          "published_at"?: string | null
          "publish_note"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "schedules_organization_id_template_id_fkey"
            columns: ["organization_id","template_id"]
            referencedRelation: "schedule_templates"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "service_availability_events": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "subject_type": string
          "subject_label": string
          "status": string
          "estimated_portions": number | null
          "reason": string | null
          "effective_at": string
          "expected_restoration_at": string | null
          "actor_id": string
          "notes": string | null
          "created_at": string
        }
        Insert: {
          "id": string
          "organization_id": string
          "location_id": string
          "subject_type": string
          "subject_label": string
          "status": string
          "estimated_portions"?: number | null
          "reason"?: string | null
          "effective_at": string
          "expected_restoration_at"?: string | null
          "actor_id": string
          "notes"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "subject_type"?: string
          "subject_label"?: string
          "status"?: string
          "estimated_portions"?: number | null
          "reason"?: string | null
          "effective_at"?: string
          "expected_restoration_at"?: string | null
          "actor_id"?: string
          "notes"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_availability_events_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "service_shift_exceptions": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "service_shift_id": string
          "exception_kind": string
          "status": string
          "effective_starts_at": string
          "effective_ends_at": string
          "effective_range": string | null
          "pacing_interval_minutes": number | null
          "pacing_cover_limit": number | null
          "opening_buffer_minutes": number | null
          "closing_buffer_minutes": number | null
          "reason": string
          "created_by": string
          "created_at": string
          "revoked_by": string | null
          "revoked_at": string | null
          "updated_at": string
        }
        Insert: {
          "id": string
          "organization_id": string
          "location_id": string
          "service_shift_id": string
          "exception_kind": string
          "status"?: string
          "effective_starts_at": string
          "effective_ends_at": string
          "effective_range"?: string | null
          "pacing_interval_minutes"?: number | null
          "pacing_cover_limit"?: number | null
          "opening_buffer_minutes"?: number | null
          "closing_buffer_minutes"?: number | null
          "reason": string
          "created_by": string
          "created_at"?: string
          "revoked_by"?: string | null
          "revoked_at"?: string | null
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "service_shift_id"?: string
          "exception_kind"?: string
          "status"?: string
          "effective_starts_at"?: string
          "effective_ends_at"?: string
          "effective_range"?: string | null
          "pacing_interval_minutes"?: number | null
          "pacing_cover_limit"?: number | null
          "opening_buffer_minutes"?: number | null
          "closing_buffer_minutes"?: number | null
          "reason"?: string
          "created_by"?: string
          "created_at"?: string
          "revoked_by"?: string | null
          "revoked_at"?: string | null
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_shift_exceptions_organization_id_location_id_servi_fkey"
            columns: ["organization_id","location_id","service_shift_id"]
            referencedRelation: "service_shifts"
            referencedColumns: ["organization_id","location_id","id"]
          },
        ]
      };
      "service_shifts": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "business_date": string
          "service_period_id": string
          "name": string
          "starts_at": string
          "ends_at": string
          "default_duration_minutes": number
          "pacing_interval_minutes": number
          "pacing_cover_limit": number
          "min_party_size": number
          "max_party_size": number
          "online_enabled": boolean
          "status": string
          "configuration_state": string
          "source_updated_at": string
          "materialized_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "business_date": string
          "service_period_id": string
          "name": string
          "starts_at": string
          "ends_at": string
          "default_duration_minutes": number
          "pacing_interval_minutes": number
          "pacing_cover_limit": number
          "min_party_size": number
          "max_party_size": number
          "online_enabled"?: boolean
          "status"?: string
          "configuration_state": string
          "source_updated_at": string
          "materialized_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "business_date"?: string
          "service_period_id"?: string
          "name"?: string
          "starts_at"?: string
          "ends_at"?: string
          "default_duration_minutes"?: number
          "pacing_interval_minutes"?: number
          "pacing_cover_limit"?: number
          "min_party_size"?: number
          "max_party_size"?: number
          "online_enabled"?: boolean
          "status"?: string
          "configuration_state"?: string
          "source_updated_at"?: string
          "materialized_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_shifts_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "service_shifts_organization_id_service_period_id_fkey"
            columns: ["organization_id","service_period_id"]
            referencedRelation: "reservation_service_periods"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "shift_acknowledgements": {
        Row: {
          "id": string
          "organization_id": string
          "shift_id": string
          "employee_id": string
          "acknowledged_at": string
          "note": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "shift_id": string
          "employee_id": string
          "acknowledged_at"?: string
          "note"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "shift_id"?: string
          "employee_id"?: string
          "acknowledged_at"?: string
          "note"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_acknowledgements_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "shift_acknowledgements_organization_id_shift_id_fkey"
            columns: ["organization_id","shift_id"]
            referencedRelation: "shifts"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "shift_closeouts": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "business_date": string
          "shift_label": string
          "status": Database["public"]["Enums"]["review_status"]
          "gross_sales_cents": number
          "net_sales_cents": number
          "cash_sales_cents": number
          "card_sales_cents": number
          "expected_cash_cents": number
          "actual_cash_cents": number | null
          "covers": number
          "comps_cents": number
          "voids_cents": number
          "service_charges_cents": number
          "card_tips_cents": number
          "cash_tips_cents": number
          "notes": string | null
          "submitted_by": string
          "submitted_at": string
          "approved_by": string | null
          "approved_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "business_date": string
          "shift_label": string
          "status"?: Database["public"]["Enums"]["review_status"]
          "gross_sales_cents"?: number
          "net_sales_cents"?: number
          "cash_sales_cents"?: number
          "card_sales_cents"?: number
          "expected_cash_cents"?: number
          "actual_cash_cents"?: number | null
          "covers"?: number
          "comps_cents"?: number
          "voids_cents"?: number
          "service_charges_cents"?: number
          "card_tips_cents"?: number
          "cash_tips_cents"?: number
          "notes"?: string | null
          "submitted_by": string
          "submitted_at"?: string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "business_date"?: string
          "shift_label"?: string
          "status"?: Database["public"]["Enums"]["review_status"]
          "gross_sales_cents"?: number
          "net_sales_cents"?: number
          "cash_sales_cents"?: number
          "card_sales_cents"?: number
          "expected_cash_cents"?: number
          "actual_cash_cents"?: number | null
          "covers"?: number
          "comps_cents"?: number
          "voids_cents"?: number
          "service_charges_cents"?: number
          "card_tips_cents"?: number
          "cash_tips_cents"?: number
          "notes"?: string | null
          "submitted_by"?: string
          "submitted_at"?: string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_closeouts_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "shift_swap_offers": {
        Row: {
          "id": string
          "organization_id": string
          "swap_request_id": string
          "offered_by_employee_id": string
          "offered_shift_id": string | null
          "message": string | null
          "status": Database["public"]["Enums"]["request_status"]
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "swap_request_id": string
          "offered_by_employee_id": string
          "offered_shift_id"?: string | null
          "message"?: string | null
          "status"?: Database["public"]["Enums"]["request_status"]
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "swap_request_id"?: string
          "offered_by_employee_id"?: string
          "offered_shift_id"?: string | null
          "message"?: string | null
          "status"?: Database["public"]["Enums"]["request_status"]
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_swap_offers_organization_id_offered_by_employee_id_fkey"
            columns: ["organization_id","offered_by_employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "shift_swap_offers_organization_id_offered_shift_id_fkey"
            columns: ["organization_id","offered_shift_id"]
            referencedRelation: "shifts"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "shift_swap_offers_organization_id_swap_request_id_fkey"
            columns: ["organization_id","swap_request_id"]
            referencedRelation: "shift_swap_requests"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "shift_swap_requests": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "shift_id": string
          "requested_by_employee_id": string
          "preferred_employee_id": string | null
          "reason": string | null
          "status": Database["public"]["Enums"]["request_status"]
          "decided_by": string | null
          "decided_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "shift_id": string
          "requested_by_employee_id": string
          "preferred_employee_id"?: string | null
          "reason"?: string | null
          "status"?: Database["public"]["Enums"]["request_status"]
          "decided_by"?: string | null
          "decided_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "shift_id"?: string
          "requested_by_employee_id"?: string
          "preferred_employee_id"?: string | null
          "reason"?: string | null
          "status"?: Database["public"]["Enums"]["request_status"]
          "decided_by"?: string | null
          "decided_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_swap_requests_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "shift_swap_requests_organization_id_preferred_employee_id_fkey"
            columns: ["organization_id","preferred_employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "shift_swap_requests_organization_id_requested_by_employee__fkey"
            columns: ["organization_id","requested_by_employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "shift_swap_requests_organization_id_shift_id_fkey"
            columns: ["organization_id","shift_id"]
            referencedRelation: "shifts"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "shifts": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "schedule_id": string
          "employee_id": string | null
          "job_role_id": string
          "starts_at": string
          "ends_at": string
          "break_minutes": number
          "status": Database["public"]["Enums"]["shift_status"]
          "is_open": boolean
          "notes": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "schedule_id": string
          "employee_id"?: string | null
          "job_role_id": string
          "starts_at": string
          "ends_at": string
          "break_minutes"?: number
          "status"?: Database["public"]["Enums"]["shift_status"]
          "is_open"?: boolean
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "schedule_id"?: string
          "employee_id"?: string | null
          "job_role_id"?: string
          "starts_at"?: string
          "ends_at"?: string
          "break_minutes"?: number
          "status"?: Database["public"]["Enums"]["shift_status"]
          "is_open"?: boolean
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "shifts_organization_id_job_role_id_fkey"
            columns: ["organization_id","job_role_id"]
            referencedRelation: "job_roles"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "shifts_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "shifts_organization_id_schedule_id_fkey"
            columns: ["organization_id","schedule_id"]
            referencedRelation: "schedules"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "sop_acknowledgements": {
        Row: {
          "id": string
          "organization_id": string
          "sop_version_id": string
          "employee_id": string
          "acknowledged_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "sop_version_id": string
          "employee_id": string
          "acknowledged_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "sop_version_id"?: string
          "employee_id"?: string
          "acknowledged_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_acknowledgements_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "sop_acknowledgements_organization_id_sop_version_id_fkey"
            columns: ["organization_id","sop_version_id"]
            referencedRelation: "sop_versions"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "sop_documents": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "title": string
          "category": string | null
          "current_version": number
          "is_published": boolean
          "requires_acknowledgement": boolean
          "created_by": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "title": string
          "category"?: string | null
          "current_version"?: number
          "is_published"?: boolean
          "requires_acknowledgement"?: boolean
          "created_by": string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "title"?: string
          "category"?: string | null
          "current_version"?: number
          "is_published"?: boolean
          "requires_acknowledgement"?: boolean
          "created_by"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_documents_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_documents_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "sop_versions": {
        Row: {
          "id": string
          "organization_id": string
          "sop_document_id": string
          "version": number
          "body": string | null
          "storage_path": string | null
          "change_summary": string | null
          "published_by": string | null
          "published_at": string | null
          "created_by": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "sop_document_id": string
          "version": number
          "body"?: string | null
          "storage_path"?: string | null
          "change_summary"?: string | null
          "published_by"?: string | null
          "published_at"?: string | null
          "created_by": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "sop_document_id"?: string
          "version"?: number
          "body"?: string | null
          "storage_path"?: string | null
          "change_summary"?: string | null
          "published_by"?: string | null
          "published_at"?: string | null
          "created_by"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_versions_organization_id_sop_document_id_fkey"
            columns: ["organization_id","sop_document_id"]
            referencedRelation: "sop_documents"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "table_status_events": {
        Row: {
          "id": number
          "organization_id": string
          "location_id": string
          "table_id": string
          "reservation_id": string | null
          "status": string
          "note": string | null
          "actor_id": string | null
          "occurred_at": string
        }
        Insert: {
          "id"?: number
          "organization_id": string
          "location_id": string
          "table_id": string
          "reservation_id"?: string | null
          "status": string
          "note"?: string | null
          "actor_id"?: string | null
          "occurred_at"?: string
        }
        Update: {
          "id"?: number
          "organization_id"?: string
          "location_id"?: string
          "table_id"?: string
          "reservation_id"?: string | null
          "status"?: string
          "note"?: string | null
          "actor_id"?: string | null
          "occurred_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_status_events_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "table_status_events_organization_id_reservation_id_fkey"
            columns: ["organization_id","reservation_id"]
            referencedRelation: "reservations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "table_status_events_organization_id_table_id_fkey"
            columns: ["organization_id","table_id"]
            referencedRelation: "reservation_tables"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "tasks": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "title": string
          "description": string | null
          "status": Database["public"]["Enums"]["task_status"]
          "priority": string
          "assigned_employee_id": string | null
          "created_by": string
          "due_at": string | null
          "completed_at": string | null
          "completed_by": string | null
          "source_type": string | null
          "source_id": string | null
          "created_at": string
          "updated_at": string
          "last_transition_note": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "title": string
          "description"?: string | null
          "status"?: Database["public"]["Enums"]["task_status"]
          "priority"?: string
          "assigned_employee_id"?: string | null
          "created_by": string
          "due_at"?: string | null
          "completed_at"?: string | null
          "completed_by"?: string | null
          "source_type"?: string | null
          "source_id"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "last_transition_note"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "title"?: string
          "description"?: string | null
          "status"?: Database["public"]["Enums"]["task_status"]
          "priority"?: string
          "assigned_employee_id"?: string | null
          "created_by"?: string
          "due_at"?: string | null
          "completed_at"?: string | null
          "completed_by"?: string | null
          "source_type"?: string | null
          "source_id"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "last_transition_note"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_organization_id_assigned_employee_id_fkey"
            columns: ["organization_id","assigned_employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "tasks_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "time_breaks": {
        Row: {
          "id": string
          "organization_id": string
          "time_entry_id": string
          "started_at": string
          "ended_at": string | null
          "is_paid": boolean
          "source": string
          "notes": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "time_entry_id": string
          "started_at": string
          "ended_at"?: string | null
          "is_paid": boolean
          "source"?: string
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "time_entry_id"?: string
          "started_at"?: string
          "ended_at"?: string | null
          "is_paid"?: boolean
          "source"?: string
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_breaks_organization_id_time_entry_id_fkey"
            columns: ["organization_id","time_entry_id"]
            referencedRelation: "time_entries"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "time_entries": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "employee_id": string
          "job_role_id": string
          "scheduled_shift_id": string | null
          "clocked_in_at": string
          "clocked_out_at": string | null
          "status": Database["public"]["Enums"]["time_entry_status"]
          "source": string
          "clock_in_metadata": Json
          "clock_out_metadata": Json
          "submitted_at": string | null
          "approved_by": string | null
          "approved_at": string | null
          "notes": string | null
          "created_at": string
          "updated_at": string
          "review_note": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "employee_id": string
          "job_role_id": string
          "scheduled_shift_id"?: string | null
          "clocked_in_at": string
          "clocked_out_at"?: string | null
          "status"?: Database["public"]["Enums"]["time_entry_status"]
          "source"?: string
          "clock_in_metadata"?: Json
          "clock_out_metadata"?: Json
          "submitted_at"?: string | null
          "approved_by"?: string | null
          "approved_at"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "review_note"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "employee_id"?: string
          "job_role_id"?: string
          "scheduled_shift_id"?: string | null
          "clocked_in_at"?: string
          "clocked_out_at"?: string | null
          "status"?: Database["public"]["Enums"]["time_entry_status"]
          "source"?: string
          "clock_in_metadata"?: Json
          "clock_out_metadata"?: Json
          "submitted_at"?: string | null
          "approved_by"?: string | null
          "approved_at"?: string | null
          "notes"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "review_note"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_job_role_id_fkey"
            columns: ["organization_id","job_role_id"]
            referencedRelation: "job_roles"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_scheduled_shift_id_fkey"
            columns: ["organization_id","scheduled_shift_id"]
            referencedRelation: "shifts"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "time_entry_corrections": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "time_entry_id": string
          "requested_by": string
          "proposed_clocked_in_at": string | null
          "proposed_clocked_out_at": string | null
          "proposed_job_role_id": string | null
          "proposed_breaks": Json | null
          "reason": string
          "status": Database["public"]["Enums"]["request_status"]
          "decided_by": string | null
          "decided_at": string | null
          "decision_note": string | null
          "applied_at": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "time_entry_id": string
          "requested_by": string
          "proposed_clocked_in_at"?: string | null
          "proposed_clocked_out_at"?: string | null
          "proposed_job_role_id"?: string | null
          "proposed_breaks"?: Json | null
          "reason": string
          "status"?: Database["public"]["Enums"]["request_status"]
          "decided_by"?: string | null
          "decided_at"?: string | null
          "decision_note"?: string | null
          "applied_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "time_entry_id"?: string
          "requested_by"?: string
          "proposed_clocked_in_at"?: string | null
          "proposed_clocked_out_at"?: string | null
          "proposed_job_role_id"?: string | null
          "proposed_breaks"?: Json | null
          "reason"?: string
          "status"?: Database["public"]["Enums"]["request_status"]
          "decided_by"?: string | null
          "decided_at"?: string | null
          "decision_note"?: string | null
          "applied_at"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entry_corrections_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "time_entry_corrections_organization_id_proposed_job_role_i_fkey"
            columns: ["organization_id","proposed_job_role_id"]
            referencedRelation: "job_roles"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "time_entry_corrections_organization_id_time_entry_id_fkey"
            columns: ["organization_id","time_entry_id"]
            referencedRelation: "time_entries"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "time_off_requests": {
        Row: {
          "id": string
          "organization_id": string
          "employee_id": string
          "location_id": string | null
          "starts_at": string
          "ends_at": string
          "reason": string | null
          "status": Database["public"]["Enums"]["request_status"]
          "decided_by": string | null
          "decided_at": string | null
          "decision_note": string | null
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "employee_id": string
          "location_id"?: string | null
          "starts_at": string
          "ends_at": string
          "reason"?: string | null
          "status"?: Database["public"]["Enums"]["request_status"]
          "decided_by"?: string | null
          "decided_at"?: string | null
          "decision_note"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "employee_id"?: string
          "location_id"?: string | null
          "starts_at"?: string
          "ends_at"?: string
          "reason"?: string | null
          "status"?: Database["public"]["Enums"]["request_status"]
          "decided_by"?: string | null
          "decided_at"?: string | null
          "decision_note"?: string | null
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_off_requests_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "time_off_requests_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "tip_adjustments": {
        Row: {
          "id": string
          "organization_id": string
          "tip_run_id": string
          "employee_id": string
          "amount_cents": number
          "reason": string
          "created_by": string
          "approved_by": string | null
          "approved_at": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "tip_run_id": string
          "employee_id": string
          "amount_cents": number
          "reason": string
          "created_by": string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "tip_run_id"?: string
          "employee_id"?: string
          "amount_cents"?: number
          "reason"?: string
          "created_by"?: string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_adjustments_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "tip_adjustments_organization_id_tip_run_id_fkey"
            columns: ["organization_id","tip_run_id"]
            referencedRelation: "tip_runs"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "tip_allocations": {
        Row: {
          "id": string
          "organization_id": string
          "tip_run_id": string
          "employee_id": string
          "base_amount_cents": number
          "adjustment_cents": number
          "final_amount_cents": number
          "weight": number
          "exact_share": number
          "remainder_rank": number | null
          "explanation": Json
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "tip_run_id": string
          "employee_id": string
          "base_amount_cents": number
          "adjustment_cents"?: number
          "final_amount_cents": number
          "weight": number
          "exact_share": number
          "remainder_rank"?: number | null
          "explanation": Json
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "tip_run_id"?: string
          "employee_id"?: string
          "base_amount_cents"?: number
          "adjustment_cents"?: number
          "final_amount_cents"?: number
          "weight"?: number
          "exact_share"?: number
          "remainder_rank"?: number | null
          "explanation"?: Json
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_allocations_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "tip_allocations_organization_id_tip_run_id_fkey"
            columns: ["organization_id","tip_run_id"]
            referencedRelation: "tip_runs"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "tip_pool_eligibility_rules": {
        Row: {
          "id": string
          "organization_id": string
          "policy_version_id": string
          "job_role_id": string
          "eligible": boolean
          "points": number
          "minimum_minutes": number
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "policy_version_id": string
          "job_role_id": string
          "eligible"?: boolean
          "points"?: number
          "minimum_minutes"?: number
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "policy_version_id"?: string
          "job_role_id"?: string
          "eligible"?: boolean
          "points"?: number
          "minimum_minutes"?: number
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_pool_eligibility_rules_organization_id_job_role_id_fkey"
            columns: ["organization_id","job_role_id"]
            referencedRelation: "job_roles"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "tip_pool_eligibility_rules_organization_id_policy_version__fkey"
            columns: ["organization_id","policy_version_id"]
            referencedRelation: "tip_pool_policy_versions"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "tip_pool_policies": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string | null
          "name": string
          "description": string | null
          "is_active": boolean
          "created_by": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id"?: string | null
          "name": string
          "description"?: string | null
          "is_active"?: boolean
          "created_by": string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string | null
          "name"?: string
          "description"?: string | null
          "is_active"?: boolean
          "created_by"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_pool_policies_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_pool_policies_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "tip_pool_policy_versions": {
        Row: {
          "id": string
          "organization_id": string
          "policy_id": string
          "version": number
          "distribution_method": Database["public"]["Enums"]["tip_distribution_method"]
          "effective_from": string
          "effective_to": string | null
          "source_rules": Json
          "rounding_rule": string
          "approved_by": string | null
          "approved_at": string | null
          "created_by": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "policy_id": string
          "version": number
          "distribution_method": Database["public"]["Enums"]["tip_distribution_method"]
          "effective_from": string
          "effective_to"?: string | null
          "source_rules"?: Json
          "rounding_rule"?: string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_by": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "policy_id"?: string
          "version"?: number
          "distribution_method"?: Database["public"]["Enums"]["tip_distribution_method"]
          "effective_from"?: string
          "effective_to"?: string | null
          "source_rules"?: Json
          "rounding_rule"?: string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_by"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_pool_policy_versions_organization_id_policy_id_fkey"
            columns: ["organization_id","policy_id"]
            referencedRelation: "tip_pool_policies"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "tip_run_participants": {
        Row: {
          "id": string
          "organization_id": string
          "tip_run_id": string
          "employee_id": string
          "job_role_id": string
          "worked_minutes": number
          "points": number
          "eligible": boolean
          "exclusion_reason": string | null
          "source_time_entry_ids": string[]
          "created_at": string
          "updated_at": string
          "derivation": Json
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "tip_run_id": string
          "employee_id": string
          "job_role_id": string
          "worked_minutes"?: number
          "points"?: number
          "eligible"?: boolean
          "exclusion_reason"?: string | null
          "source_time_entry_ids"?: string[]
          "created_at"?: string
          "updated_at"?: string
          "derivation"?: Json
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "tip_run_id"?: string
          "employee_id"?: string
          "job_role_id"?: string
          "worked_minutes"?: number
          "points"?: number
          "eligible"?: boolean
          "exclusion_reason"?: string | null
          "source_time_entry_ids"?: string[]
          "created_at"?: string
          "updated_at"?: string
          "derivation"?: Json
        }
        Relationships: [
          {
            foreignKeyName: "tip_run_participants_organization_id_employee_id_fkey"
            columns: ["organization_id","employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "tip_run_participants_organization_id_job_role_id_fkey"
            columns: ["organization_id","job_role_id"]
            referencedRelation: "job_roles"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "tip_run_participants_organization_id_tip_run_id_fkey"
            columns: ["organization_id","tip_run_id"]
            referencedRelation: "tip_runs"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "tip_runs": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "policy_version_id": string
          "closeout_id": string | null
          "business_date": string
          "shift_label": string
          "status": Database["public"]["Enums"]["run_status"]
          "distributable_cents": number
          "allocated_cents": number
          "calculation_version": string
          "calculated_at": string | null
          "approved_by": string | null
          "approved_at": string | null
          "locked_at": string | null
          "created_by": string
          "created_at": string
          "updated_at": string
          "prepared_at": string | null
          "prepared_by": string | null
          "preparation_version": string | null
          "derivation_hash": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "policy_version_id": string
          "closeout_id"?: string | null
          "business_date": string
          "shift_label": string
          "status"?: Database["public"]["Enums"]["run_status"]
          "distributable_cents"?: number
          "allocated_cents"?: number
          "calculation_version"?: string
          "calculated_at"?: string | null
          "approved_by"?: string | null
          "approved_at"?: string | null
          "locked_at"?: string | null
          "created_by": string
          "created_at"?: string
          "updated_at"?: string
          "prepared_at"?: string | null
          "prepared_by"?: string | null
          "preparation_version"?: string | null
          "derivation_hash"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "policy_version_id"?: string
          "closeout_id"?: string | null
          "business_date"?: string
          "shift_label"?: string
          "status"?: Database["public"]["Enums"]["run_status"]
          "distributable_cents"?: number
          "allocated_cents"?: number
          "calculation_version"?: string
          "calculated_at"?: string | null
          "approved_by"?: string | null
          "approved_at"?: string | null
          "locked_at"?: string | null
          "created_by"?: string
          "created_at"?: string
          "updated_at"?: string
          "prepared_at"?: string | null
          "prepared_by"?: string | null
          "preparation_version"?: string | null
          "derivation_hash"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tip_runs_organization_id_closeout_id_fkey"
            columns: ["organization_id","closeout_id"]
            referencedRelation: "shift_closeouts"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "tip_runs_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "tip_runs_organization_id_policy_version_id_fkey"
            columns: ["organization_id","policy_version_id"]
            referencedRelation: "tip_pool_policy_versions"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "tip_sources": {
        Row: {
          "id": string
          "organization_id": string
          "tip_run_id": string
          "source_type": string
          "label": string
          "amount_cents": number
          "is_distributable": boolean
          "reference_type": string | null
          "reference_id": string | null
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "tip_run_id": string
          "source_type": string
          "label": string
          "amount_cents": number
          "is_distributable"?: boolean
          "reference_type"?: string | null
          "reference_id"?: string | null
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "tip_run_id"?: string
          "source_type"?: string
          "label"?: string
          "amount_cents"?: number
          "is_distributable"?: boolean
          "reference_type"?: string | null
          "reference_id"?: string | null
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_sources_organization_id_tip_run_id_fkey"
            columns: ["organization_id","tip_run_id"]
            referencedRelation: "tip_runs"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "unit_conversions": {
        Row: {
          "id": string
          "organization_id": string
          "from_unit_id": string
          "to_unit_id": string
          "multiplier": number
          "item_id": string | null
          "created_at": string
          "is_active": boolean
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "from_unit_id": string
          "to_unit_id": string
          "multiplier": number
          "item_id"?: string | null
          "created_at"?: string
          "is_active"?: boolean
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "from_unit_id"?: string
          "to_unit_id"?: string
          "multiplier"?: number
          "item_id"?: string | null
          "created_at"?: string
          "is_active"?: boolean
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_conversions_item_fk"
            columns: ["organization_id","item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "unit_conversions_organization_id_from_unit_id_fkey"
            columns: ["organization_id","from_unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "unit_conversions_organization_id_to_unit_id_fkey"
            columns: ["organization_id","to_unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "user_capability_overrides": {
        Row: {
          "id": string
          "organization_id": string
          "user_id": string
          "capability_key": string
          "location_id": string | null
          "effect": string
          "reason": string
          "effective_from": string
          "effective_to": string | null
          "is_active": boolean
          "created_by": string
          "updated_by": string
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "user_id": string
          "capability_key": string
          "location_id"?: string | null
          "effect": string
          "reason": string
          "effective_from"?: string
          "effective_to"?: string | null
          "is_active"?: boolean
          "created_by": string
          "updated_by": string
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "user_id"?: string
          "capability_key"?: string
          "location_id"?: string | null
          "effect"?: string
          "reason"?: string
          "effective_from"?: string
          "effective_to"?: string | null
          "is_active"?: boolean
          "created_by"?: string
          "updated_by"?: string
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_capability_overrides_capability_key_fkey"
            columns: ["capability_key"]
            referencedRelation: "capability_definitions"
            referencedColumns: ["capability_key"]
          },
          {
            foreignKeyName: "user_capability_overrides_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "user_capability_overrides_organization_id_user_id_fkey"
            columns: ["organization_id","user_id"]
            referencedRelation: "organization_memberships"
            referencedColumns: ["organization_id","user_id"]
          },
        ]
      };
      "user_invitations": {
        Row: {
          "id": string
          "organization_id": string
          "email": string
          "role": Database["public"]["Enums"]["app_role"]
          "location_ids": string[]
          "token_hash": string
          "temporary_credential_expires_at": string | null
          "expires_at": string
          "accepted_at": string | null
          "revoked_at": string | null
          "invited_by": string
          "created_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "email": string
          "role": Database["public"]["Enums"]["app_role"]
          "location_ids"?: string[]
          "token_hash": string
          "temporary_credential_expires_at"?: string | null
          "expires_at": string
          "accepted_at"?: string | null
          "revoked_at"?: string | null
          "invited_by": string
          "created_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "email"?: string
          "role"?: Database["public"]["Enums"]["app_role"]
          "location_ids"?: string[]
          "token_hash"?: string
          "temporary_credential_expires_at"?: string | null
          "expires_at"?: string
          "accepted_at"?: string | null
          "revoked_at"?: string | null
          "invited_by"?: string
          "created_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_invitations_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "vendor_items": {
        Row: {
          "id": string
          "organization_id": string
          "vendor_id": string
          "inventory_item_id": string
          "purchase_unit_id": string
          "vendor_sku": string | null
          "pack_quantity": number
          "last_price_cents": number | null
          "is_preferred": boolean
          "created_at": string
          "updated_at": string
          "is_active": boolean
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "vendor_id": string
          "inventory_item_id": string
          "purchase_unit_id": string
          "vendor_sku"?: string | null
          "pack_quantity"?: number
          "last_price_cents"?: number | null
          "is_preferred"?: boolean
          "created_at"?: string
          "updated_at"?: string
          "is_active"?: boolean
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "vendor_id"?: string
          "inventory_item_id"?: string
          "purchase_unit_id"?: string
          "vendor_sku"?: string | null
          "pack_quantity"?: number
          "last_price_cents"?: number | null
          "is_preferred"?: boolean
          "created_at"?: string
          "updated_at"?: string
          "is_active"?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "vendor_items_organization_id_inventory_item_id_fkey"
            columns: ["organization_id","inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "vendor_items_organization_id_purchase_unit_id_fkey"
            columns: ["organization_id","purchase_unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "vendor_items_organization_id_vendor_id_fkey"
            columns: ["organization_id","vendor_id"]
            referencedRelation: "vendors"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "vendors": {
        Row: {
          "id": string
          "organization_id": string
          "name": string
          "account_number": string | null
          "contact_name": string | null
          "email": string | null
          "phone": string | null
          "address": Json
          "payment_terms": string | null
          "is_active": boolean
          "created_at": string
          "updated_at": string
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "name": string
          "account_number"?: string | null
          "contact_name"?: string | null
          "email"?: string | null
          "phone"?: string | null
          "address"?: Json
          "payment_terms"?: string | null
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "name"?: string
          "account_number"?: string | null
          "contact_name"?: string | null
          "email"?: string | null
          "phone"?: string | null
          "address"?: Json
          "payment_terms"?: string | null
          "is_active"?: boolean
          "created_at"?: string
          "updated_at"?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      };
      "waitlist_entries": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "guest_id": string | null
          "resulting_reservation_id": string | null
          "display_name": string
          "party_size": number
          "desired_from": string | null
          "desired_to": string | null
          "quoted_wait_minutes": number | null
          "status": string
          "notes": string | null
          "notified_at": string | null
          "offer_expires_at": string | null
          "seated_at": string | null
          "created_by": string | null
          "created_at": string
          "updated_at": string
          "email": string | null
          "phone": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "guest_id"?: string | null
          "resulting_reservation_id"?: string | null
          "display_name": string
          "party_size": number
          "desired_from"?: string | null
          "desired_to"?: string | null
          "quoted_wait_minutes"?: number | null
          "status"?: string
          "notes"?: string | null
          "notified_at"?: string | null
          "offer_expires_at"?: string | null
          "seated_at"?: string | null
          "created_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "email"?: string | null
          "phone"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "guest_id"?: string | null
          "resulting_reservation_id"?: string | null
          "display_name"?: string
          "party_size"?: number
          "desired_from"?: string | null
          "desired_to"?: string | null
          "quoted_wait_minutes"?: number | null
          "status"?: string
          "notes"?: string | null
          "notified_at"?: string | null
          "offer_expires_at"?: string | null
          "seated_at"?: string | null
          "created_by"?: string | null
          "created_at"?: string
          "updated_at"?: string
          "email"?: string | null
          "phone"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_organization_id_guest_id_fkey"
            columns: ["organization_id","guest_id"]
            referencedRelation: "guests"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "waitlist_entries_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "waitlist_entries_organization_id_resulting_reservation_id_fkey"
            columns: ["organization_id","resulting_reservation_id"]
            referencedRelation: "reservations"
            referencedColumns: ["organization_id","id"]
          },
        ]
      };
      "waste_records": {
        Row: {
          "id": string
          "organization_id": string
          "location_id": string
          "inventory_item_id": string
          "unit_id": string
          "quantity": number
          "reason_code": string
          "estimated_cost_cents": number | null
          "occurred_at": string
          "notes": string | null
          "recorded_by": string
          "approved_by": string | null
          "approved_at": string | null
          "created_at": string
          "status": Database["public"]["Enums"]["review_status"]
          "review_note": string | null
        }
        Insert: {
          "id"?: string
          "organization_id": string
          "location_id": string
          "inventory_item_id": string
          "unit_id": string
          "quantity": number
          "reason_code": string
          "estimated_cost_cents"?: number | null
          "occurred_at"?: string
          "notes"?: string | null
          "recorded_by": string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
          "status"?: Database["public"]["Enums"]["review_status"]
          "review_note"?: string | null
        }
        Update: {
          "id"?: string
          "organization_id"?: string
          "location_id"?: string
          "inventory_item_id"?: string
          "unit_id"?: string
          "quantity"?: number
          "reason_code"?: string
          "estimated_cost_cents"?: number | null
          "occurred_at"?: string
          "notes"?: string | null
          "recorded_by"?: string
          "approved_by"?: string | null
          "approved_at"?: string | null
          "created_at"?: string
          "status"?: Database["public"]["Enums"]["review_status"]
          "review_note"?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waste_records_organization_id_inventory_item_id_fkey"
            columns: ["organization_id","inventory_item_id"]
            referencedRelation: "inventory_items"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "waste_records_organization_id_location_id_fkey"
            columns: ["organization_id","location_id"]
            referencedRelation: "locations"
            referencedColumns: ["organization_id","id"]
          },
          {
            foreignKeyName: "waste_records_organization_id_unit_id_fkey"
            columns: ["organization_id","unit_id"]
            referencedRelation: "measurement_units"
            referencedColumns: ["organization_id","id"]
          },
        ]
      }
    }
    Views: {
      "approved_labor_daily": {
        Row: {
          "organization_id": string | null
          "location_id": string | null
          "employee_id": string | null
          "business_date": string | null
          "paid_minutes": number | null
        }
        Relationships: []
      };
      "inventory_on_hand": {
        Row: {
          "organization_id": string | null
          "location_id": string | null
          "inventory_item_id": string | null
          "quantity_on_hand": number | null
          "last_movement_at": string | null
        }
        Relationships: []
      };
      "tip_run_totals": {
        Row: {
          "organization_id": string | null
          "location_id": string | null
          "tip_run_id": string | null
          "business_date": string | null
          "status": Database["public"]["Enums"]["run_status"] | null
          "distributable_cents": number | null
          "allocated_cents": number | null
          "allocation_count": number | null
          "allocation_check_cents": number | null
        }
        Relationships: []
      }
    }
    Functions: {
      "accept_my_invitation": {
        Args: {
          "p_organization_id": string | null
        }
        Returns: boolean
      };
      "acknowledge_preshift": {
        Args: {
          "p_request_id": string | null
          "p_preshift_id": string | null
          "p_comment": string | null
        }
        Returns: Database["public"]["Tables"]["preshift_acknowledgements"]["Row"]
      };
      "acknowledge_sop": {
        Args: {
          "p_request_id": string | null
          "p_sop_version_id": string | null
        }
        Returns: Database["public"]["Tables"]["sop_acknowledgements"]["Row"]
      };
      "add_guest_note": {
        Args: {
          "p_request_id": string | null
          "p_guest_id": string | null
          "p_location_id": string | null
          "p_note": string | null
          "p_is_sensitive"?: boolean | null
        }
        Returns: Database["public"]["Tables"]["guest_notes"]["Row"]
      };
      "administer_organization_member": {
        Args: {
          "p_request_id": string | null
          "p_membership_id": string | null
          "p_role": Database["public"]["Enums"]["app_role"] | null
          "p_status": Database["public"]["Enums"]["membership_status"] | null
          "p_location_ids": string[] | null
        }
        Returns: Database["public"]["Tables"]["organization_memberships"]["Row"]
      };
      "apply_time_entry_correction": {
        Args: {
          "p_correction_id": string | null
          "p_approve": boolean | null
          "p_decision_note"?: string | null
        }
        Returns: Database["public"]["Tables"]["time_entry_corrections"]["Row"]
      };
      "approve_closeout": {
        Args: {
          "p_closeout_id": string | null
          "p_approved": boolean | null
          "p_note"?: string | null
        }
        Returns: Database["public"]["Tables"]["shift_closeouts"]["Row"]
      };
      "approve_inventory_count": {
        Args: {
          "p_request_id": string | null
          "p_count_id": string | null
          "p_approve": boolean | null
          "p_note"?: string | null
        }
        Returns: Database["public"]["Tables"]["inventory_counts"]["Row"]
      };
      "approve_le_yard_reservation_draft": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_enable_online": boolean | null
          "p_enable_messaging": boolean | null
          "p_enable_staff_push": boolean | null
          "p_verification_note": string | null
        }
        Returns: Json
      };
      "approve_tip_adjustment": {
        Args: {
          "p_request_id": string | null
          "p_adjustment_id": string | null
        }
        Returns: Database["public"]["Tables"]["tip_adjustments"]["Row"]
      };
      "approve_tip_policy_version": {
        Args: {
          "p_request_id": string | null
          "p_policy_version_id": string | null
        }
        Returns: Database["public"]["Tables"]["tip_pool_policy_versions"]["Row"]
      };
      "approve_tip_run": {
        Args: {
          "p_tip_run_id": string | null
        }
        Returns: Database["public"]["Tables"]["tip_runs"]["Row"]
      };
      "assign_guest_tag": {
        Args: {
          "p_request_id": string | null
          "p_guest_id": string | null
          "p_tag_id": string | null
        }
        Returns: Database["public"]["Tables"]["guest_tag_assignments"]["Row"]
      };
      "assign_reservation_tables": {
        Args: {
          "p_request_id": string | null
          "p_reservation_id": string | null
          "p_table_ids": string[] | null
          "p_override_note": string | null
        }
        Returns: Json
      };
      "bind_verified_checklist_photo_response": {
        Args: {
          "p_request_id": string | null
          "p_actor_id": string | null
          "p_actor_aal": string | null
          "p_run_id": string | null
          "p_template_item_id": string | null
          "p_response": Json | null
          "p_storage_path": string | null
          "p_notes": string | null
          "p_mime_type": string | null
          "p_size_bytes": number | null
        }
        Returns: Database["public"]["Tables"]["checklist_responses"]["Row"]
      };
      "bind_verified_checklist_photo_response_aal2_legacy": {
        Args: {
          "p_request_id": string | null
          "p_actor_id": string | null
          "p_actor_aal": string | null
          "p_run_id": string | null
          "p_template_item_id": string | null
          "p_response": Json | null
          "p_storage_path": string | null
          "p_notes": string | null
          "p_mime_type": string | null
          "p_size_bytes": number | null
        }
        Returns: Database["public"]["Tables"]["checklist_responses"]["Row"]
      };
      "bootstrap_initial_tenant": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_organization_name": string | null
          "p_organization_slug": string | null
          "p_timezone": string | null
          "p_currency_code": string | null
          "p_locations": Json | null
          "p_donald_user_id": string | null
          "p_donald_email": string | null
          "p_donald_display_name": string | null
          "p_donald_employee_id": string | null
          "p_donald_token_hash": string | null
          "p_maris_user_id": string | null
          "p_maris_email": string | null
          "p_maris_display_name": string | null
          "p_maris_employee_id": string | null
          "p_maris_token_hash": string | null
          "p_expires_at": string | null
        }
        Returns: string
      };
      "broadcast_reservation_change": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "calculate_tip_run": {
        Args: {
          "p_tip_run_id": string | null
        }
        Returns: Database["public"]["Tables"]["tip_runs"]["Row"]
      };
      "calculate_tip_run_unchecked": {
        Args: {
          "p_tip_run_id": string | null
        }
        Returns: Database["public"]["Tables"]["tip_runs"]["Row"]
      };
      "can_access_channel": {
        Args: {
          "p_channel_id": string | null
        }
        Returns: boolean
      };
      "can_access_location": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
        }
        Returns: boolean
      };
      "can_access_org": {
        Args: {
          "p_organization_id": string | null
        }
        Returns: boolean
      };
      "can_access_storage_scope": {
        Args: {
          "p_name": string | null
        }
        Returns: boolean
      };
      "can_administer_membership_target": {
        Args: {
          "p_organization_id": string | null
          "p_target_user_id": string | null
          "p_prospective_role"?: Database["public"]["Enums"]["app_role"] | null
        }
        Returns: boolean
      };
      "can_manage_guest_profile_scope": {
        Args: {
          "p_organization_id": string | null
          "p_guest_id": string | null
        }
        Returns: boolean
      };
      "can_manage_location": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
        }
        Returns: boolean
      };
      "can_manage_org": {
        Args: {
          "p_organization_id": string | null
        }
        Returns: boolean
      };
      "can_manage_report_scope": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
        }
        Returns: boolean
      };
      "can_manage_storage_scope": {
        Args: {
          "p_name": string | null
        }
        Returns: boolean
      };
      "can_operate_employee": {
        Args: {
          "p_employee_id": string | null
        }
        Returns: boolean
      };
      "can_operate_org": {
        Args: {
          "p_organization_id": string | null
        }
        Returns: boolean
      };
      "can_read_employee_management": {
        Args: {
          "p_employee_id": string | null
        }
        Returns: boolean
      };
      "can_read_guest_note_scope": {
        Args: {
          "p_organization_id": string | null
          "p_guest_id": string | null
          "p_note_location_id": string | null
        }
        Returns: boolean
      };
      "can_read_guest_profile_scope": {
        Args: {
          "p_organization_id": string | null
          "p_guest_id": string | null
        }
        Returns: boolean
      };
      "can_read_management_location": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
        }
        Returns: boolean
      };
      "can_read_management_org": {
        Args: {
          "p_organization_id": string | null
        }
        Returns: boolean
      };
      "can_read_management_storage_scope": {
        Args: {
          "p_name": string | null
        }
        Returns: boolean
      };
      "can_read_report_scope": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
        }
        Returns: boolean
      };
      "cancel_reservation": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_reservation_id": string | null
          "p_expected_version": number | null
          "p_reason": string | null
        }
        Returns: Json
      };
      "cancel_time_off_request": {
        Args: {
          "p_request_id": string | null
          "p_time_off_id": string | null
        }
        Returns: Database["public"]["Tables"]["time_off_requests"]["Row"]
      };
      "capture_audit_event": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "claim_open_shift": {
        Args: {
          "p_request_id": string | null
          "p_shift_id": string | null
        }
        Returns: Database["public"]["Tables"]["shifts"]["Row"]
      };
      "complete_checklist_run": {
        Args: {
          "p_request_id": string | null
          "p_run_id": string | null
          "p_note"?: string | null
        }
        Returns: Database["public"]["Tables"]["checklist_runs"]["Row"]
      };
      "complete_report_export": {
        Args: {
          "p_export_id": string | null
          "p_status": Database["public"]["Enums"]["job_status"] | null
          "p_row_count": number | null
          "p_result_summary": Json | null
          "p_error_message"?: string | null
        }
        Returns: Database["public"]["Tables"]["export_jobs"]["Row"]
      };
      "configure_inventory_catalog": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_command": string | null
          "p_payload": Json | null
        }
        Returns: Json
      };
      "configure_job_role_capability": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_assignment_id": string | null
          "p_job_role_id": string | null
          "p_capability_key": string | null
          "p_location_id": string | null
          "p_effective_from": string | null
          "p_effective_to": string | null
          "p_is_active": boolean | null
        }
        Returns: Json
      };
      "configure_kitchen_foundation": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_command": string | null
          "p_payload": Json | null
        }
        Returns: Json
      };
      "configure_operational_inventory_catalog": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_command": string | null
          "p_payload": Json | null
        }
        Returns: Json
      };
      "configure_reservation_location": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_command": string | null
          "p_payload": Json | null
        }
        Returns: Json
      };
      "configure_retention_policy": {
        Args: {
          "p_request_id": string | null
          "p_policy_id": string | null
          "p_organization_id": string | null
          "p_data_class": string | null
          "p_retention_days": number | null
          "p_legal_hold": boolean | null
          "p_notes"?: string | null
        }
        Returns: Database["public"]["Tables"]["retention_policies"]["Row"]
      };
      "configure_service_shift_exception": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_service_shift_id": string | null
          "p_exception_kind": string | null
          "p_effective_starts_at": string | null
          "p_effective_ends_at": string | null
          "p_pacing_interval_minutes": number | null
          "p_pacing_cover_limit": number | null
          "p_opening_buffer_minutes": number | null
          "p_closing_buffer_minutes": number | null
          "p_reason": string | null
          "p_active"?: boolean | null
        }
        Returns: Json
      };
      "configure_tip_pool_policy": {
        Args: {
          "p_request_id": string | null
          "p_policy_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_name": string | null
          "p_description"?: string | null
          "p_is_active"?: boolean | null
        }
        Returns: Database["public"]["Tables"]["tip_pool_policies"]["Row"]
      };
      "configure_user_capability_override": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_override_id": string | null
          "p_user_id": string | null
          "p_capability_key": string | null
          "p_location_id": string | null
          "p_effect": string | null
          "p_reason": string | null
          "p_effective_from": string | null
          "p_effective_to": string | null
          "p_is_active": boolean | null
        }
        Returns: Json
      };
      "create_chat_channel": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_kind": Database["public"]["Enums"]["channel_kind"] | null
          "p_location_id": string | null
          "p_name": string | null
          "p_description"?: string | null
          "p_member_ids"?: string[] | null
        }
        Returns: Database["public"]["Tables"]["chat_channels"]["Row"]
      };
      "create_checklist_template_version": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_name": string | null
          "p_checklist_type": string | null
          "p_items": Json | null
        }
        Returns: Database["public"]["Tables"]["checklist_templates"]["Row"]
      };
      "create_employee_job_assignment": {
        Args: {
          "p_request_id": string | null
          "p_employee_id": string | null
          "p_job_role_id": string | null
          "p_location_id": string | null
          "p_hourly_rate_cents": number | null
          "p_effective_from": string | null
          "p_effective_to": string | null
          "p_is_primary": boolean | null
        }
        Returns: Database["public"]["Tables"]["employee_job_roles"]["Row"]
      };
      "create_incident": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_incident_type": string | null
          "p_severity": string | null
          "p_description": string | null
          "p_occurred_at": string | null
          "p_involved_employee_ids"?: string[] | null
          "p_guest_id"?: string | null
        }
        Returns: Database["public"]["Tables"]["incidents"]["Row"]
      };
      "create_inventory_transfer": {
        Args: {
          "p_request_id": string | null
          "p_from_location_id": string | null
          "p_to_location_id": string | null
          "p_notes": string | null
          "p_lines": Json | null
        }
        Returns: Database["public"]["Tables"]["inventory_transfers"]["Row"]
      };
      "create_job_role_definition": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_name": string | null
          "p_code": string | null
          "p_department": string | null
          "p_color": string | null
          "p_default_tip_points": number | null
          "p_is_tipped": boolean | null
        }
        Returns: Database["public"]["Tables"]["job_roles"]["Row"]
      };
      "create_maintenance_request": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_title": string | null
          "p_description": string | null
          "p_category": string | null
          "p_priority": string | null
          "p_assigned_to"?: string | null
          "p_vendor_id"?: string | null
          "p_due_at"?: string | null
        }
        Returns: Database["public"]["Tables"]["maintenance_requests"]["Row"]
      };
      "create_manual_csv_import": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_import_type": string | null
          "p_file_name": string | null
          "p_storage_path": string | null
          "p_content_sha256": string | null
          "p_total_rows": number | null
          "p_headers": string[] | null
          "p_mapping": Json | null
        }
        Returns: Database["public"]["Tables"]["import_jobs"]["Row"]
      };
      "create_purchase_order": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_vendor_id": string | null
          "p_po_number": string | null
          "p_ordered_on": string | null
          "p_expected_on": string | null
          "p_tax_cents": number | null
          "p_shipping_cents": number | null
          "p_notes": string | null
          "p_lines": Json | null
        }
        Returns: Database["public"]["Tables"]["purchase_orders"]["Row"]
      };
      "create_schedule_draft": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_week_start": string | null
          "p_template_id"?: string | null
        }
        Returns: Json
      };
      "create_sop_draft": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_title": string | null
          "p_category": string | null
          "p_requires_acknowledgement": boolean | null
          "p_body": string | null
          "p_change_summary"?: string | null
        }
        Returns: Database["public"]["Tables"]["sop_versions"]["Row"]
      };
      "create_sop_version": {
        Args: {
          "p_request_id": string | null
          "p_sop_document_id": string | null
          "p_body": string | null
          "p_change_summary"?: string | null
        }
        Returns: Database["public"]["Tables"]["sop_versions"]["Row"]
      };
      "create_task": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_title": string | null
          "p_description": string | null
          "p_priority": string | null
          "p_assigned_employee_id"?: string | null
          "p_due_at"?: string | null
        }
        Returns: Database["public"]["Tables"]["tasks"]["Row"]
      };
      "current_user_id": {
        Args: Record<PropertyKey, never>
        Returns: string
      };
      "deactivate_job_role_definition": {
        Args: {
          "p_request_id": string | null
          "p_job_role_id": string | null
        }
        Returns: Database["public"]["Tables"]["job_roles"]["Row"]
      };
      "decide_shift_swap": {
        Args: {
          "p_request_id": string | null
          "p_swap_request_id": string | null
          "p_offer_id": string | null
          "p_approve": boolean | null
        }
        Returns: Database["public"]["Tables"]["shift_swap_requests"]["Row"]
      };
      "decide_time_off_request": {
        Args: {
          "p_request_id": string | null
          "p_time_off_id": string | null
          "p_approve": boolean | null
          "p_decision_note"?: string | null
        }
        Returns: Database["public"]["Tables"]["time_off_requests"]["Row"]
      };
      "delete_availability_rule": {
        Args: {
          "p_request_id": string | null
          "p_rule_id": string | null
        }
        Returns: string
      };
      "effective_capabilities": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_effective_on"?: string | null
        }
        Returns: { "capability_key": string | null }[]
      };
      "employee_is_effectively_assigned": {
        Args: {
          "p_employee_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_business_date": string | null
        }
        Returns: boolean
      };
      "end_employee_job_assignment": {
        Args: {
          "p_request_id": string | null
          "p_assignment_id": string | null
          "p_effective_to": string | null
        }
        Returns: Database["public"]["Tables"]["employee_job_roles"]["Row"]
      };
      "end_time_break": {
        Args: {
          "p_break_id": string | null
        }
        Returns: Database["public"]["Tables"]["time_breaks"]["Row"]
      };
      "enforce_owner_role_assignment": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "finalize_employee_document": {
        Args: {
          "p_request_id": string | null
          "p_employee_id": string | null
          "p_location_id": string | null
          "p_storage_path": string | null
          "p_document_type": string | null
          "p_title": string | null
          "p_mime_type": string | null
          "p_size_bytes": number | null
          "p_is_employee_visible"?: boolean | null
        }
        Returns: Database["public"]["Tables"]["employee_documents"]["Row"]
      };
      "guard_active_owner_count": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_chat_message_scope": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_chat_read_position": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_closeout_attachment_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_closeout_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_employee_auth_identity": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_employee_hr_fields": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_guest_append_only_evidence": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_guest_profile_owned_fields": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_integration_job_evidence": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_inventory_count_line_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_inventory_count_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_inventory_transaction_evidence": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_inventory_transfer_line_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_inventory_transfer_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_notification_evidence": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_owner_invitation_target": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_owner_location_membership_target": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_owner_membership_target": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_published_shift_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_published_sop_evidence": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_receipt_child_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_receipt_duplicate_resolution": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_receipt_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_receipt_reference_link": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_receipt_terminal_duplicate_resolution": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_report_job_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_reservation_append_only": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_saved_report_scope": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_schedule_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_shift_acknowledgement": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_shift_swap_offer_scope": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_shift_swap_scope": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_terminal_operation_evidence": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_time_correction_decision_actor": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_time_correction_scope": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_tip_adjustment_approval_evidence": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_tip_eligibility_rule_version": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_tip_policy_operational_contract": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_tip_policy_version_approval_evidence": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_tip_run_financial_evidence": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "guard_waste_review_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "handle_new_auth_user": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "has_any_capability": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_capability_keys": string[] | null
          "p_effective_on"?: string | null
        }
        Returns: boolean
      };
      "has_any_location_capability": {
        Args: {
          "p_organization_id": string | null
          "p_capability_keys": string[] | null
          "p_effective_on"?: string | null
        }
        Returns: boolean
      };
      "has_capability": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_capability_key": string | null
          "p_effective_on"?: string | null
        }
        Returns: boolean
      };
      "has_current_location_capability": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_capability_key": string | null
        }
        Returns: boolean
      };
      "has_org_role": {
        Args: {
          "p_organization_id": string | null
          "p_roles": Database["public"]["Enums"]["app_role"][] | null
        }
        Returns: boolean
      };
      "income_operating_snapshot": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_observed_at"?: string | null
          "p_history_days"?: number | null
        }
        Returns: Json
      };
      "ingest_income_sales_check": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_source": string | null
          "p_external_id": string | null
          "p_status": string | null
          "p_opened_at": string | null
          "p_closed_at": string | null
          "p_gross_sales_cents": number | null
          "p_net_sales_cents": number | null
          "p_discount_cents": number | null
          "p_comp_cents": number | null
          "p_void_cents": number | null
          "p_tax_cents": number | null
          "p_tip_cents": number | null
          "p_service_charge_cents": number | null
          "p_covers": number | null
          "p_order_channel": string | null
          "p_source_observed_at": string | null
          "p_payload_hash": string | null
        }
        Returns: Json
      };
      "install_le_yard_reservation_draft": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
        }
        Returns: Json
      };
      "is_owner_pending_mfa": {
        Args: {
          "p_organization_id": string | null
        }
        Returns: boolean
      };
      "is_self_employee": {
        Args: {
          "p_employee_id": string | null
        }
        Returns: boolean
      };
      "jwt_aal": {
        Args: Record<PropertyKey, never>
        Returns: string
      };
      "manual_import_headers_are_valid": {
        Args: {
          "p_headers": string[] | null
        }
        Returns: boolean
      };
      "mark_channel_read": {
        Args: {
          "p_channel_id": string | null
          "p_last_read_message_id"?: string | null
        }
        Returns: Database["public"]["Tables"]["chat_read_receipts"]["Row"]
      };
      "merge_guests": {
        Args: {
          "p_request_id": string | null
          "p_source_guest_id": string | null
          "p_target_guest_id": string | null
          "p_match_score"?: number | null
          "p_reasons"?: Json | null
        }
        Returns: Database["public"]["Tables"]["guest_merge_events"]["Row"]
      };
      "modify_reservation": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_reservation_id": string | null
          "p_expected_version": number | null
          "p_reserved_at": string | null
          "p_duration_minutes": number | null
          "p_party_size": number | null
          "p_special_requests": string | null
          "p_table_ids": string[] | null
          "p_reason": string | null
        }
        Returns: Json
      };
      "notification_type_is_supported": {
        Args: {
          "p_notification_type": string | null
        }
        Returns: boolean
      };
      "offer_shift_swap": {
        Args: {
          "p_request_id": string | null
          "p_swap_request_id": string | null
          "p_message"?: string | null
        }
        Returns: Database["public"]["Tables"]["shift_swap_offers"]["Row"]
      };
      "org_role": {
        Args: {
          "p_organization_id": string | null
        }
        Returns: Database["public"]["Enums"]["app_role"]
      };
      "prepare_tip_run_from_closeout": {
        Args: {
          "p_request_id": string | null
          "p_closeout_id": string | null
          "p_policy_version_id": string | null
        }
        Returns: Database["public"]["Tables"]["tip_runs"]["Row"]
      };
      "prevent_approved_record_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "prevent_audit_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "prevent_ledger_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "prevent_locked_tip_mutation": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "provision_user_invitation": {
        Args: {
          "p_auth_user_id": string | null
          "p_organization_id": string | null
          "p_email": string | null
          "p_display_name": string | null
          "p_role": Database["public"]["Enums"]["app_role"] | null
          "p_location_ids": string[] | null
          "p_token_hash": string | null
          "p_expires_at": string | null
          "p_employee_id": string | null
        }
        Returns: string
      };
      "provision_user_invitation_aal2_legacy": {
        Args: {
          "p_auth_user_id": string | null
          "p_organization_id": string | null
          "p_email": string | null
          "p_display_name": string | null
          "p_role": Database["public"]["Enums"]["app_role"] | null
          "p_location_ids": string[] | null
          "p_token_hash": string | null
          "p_expires_at": string | null
          "p_employee_id": string | null
        }
        Returns: string
      };
      "publish_checklist_template": {
        Args: {
          "p_request_id": string | null
          "p_template_id": string | null
        }
        Returns: Database["public"]["Tables"]["checklist_templates"]["Row"]
      };
      "publish_schedule": {
        Args: {
          "p_schedule_id": string | null
          "p_note"?: string | null
        }
        Returns: Database["public"]["Tables"]["schedules"]["Row"]
      };
      "publish_sop_version": {
        Args: {
          "p_request_id": string | null
          "p_sop_version_id": string | null
        }
        Returns: Database["public"]["Tables"]["sop_versions"]["Row"]
      };
      "receive_inventory_delivery": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_vendor_id": string | null
          "p_purchase_order_id": string | null
          "p_delivered_at": string | null
          "p_invoice_number": string | null
          "p_notes": string | null
          "p_lines": Json | null
        }
        Returns: Database["public"]["Tables"]["deliveries"]["Row"]
      };
      "record_checklist_response": {
        Args: {
          "p_request_id": string | null
          "p_run_id": string | null
          "p_template_item_id": string | null
          "p_response": Json | null
          "p_storage_path"?: string | null
          "p_notes"?: string | null
        }
        Returns: Database["public"]["Tables"]["checklist_responses"]["Row"]
      };
      "record_clock_in": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_job_role_id": string | null
          "p_scheduled_shift_id"?: string | null
        }
        Returns: Database["public"]["Tables"]["time_entries"]["Row"]
      };
      "record_clock_out": {
        Args: {
          "p_time_entry_id": string | null
        }
        Returns: Database["public"]["Tables"]["time_entries"]["Row"]
      };
      "record_guest_consent": {
        Args: {
          "p_request_id": string | null
          "p_guest_id": string | null
          "p_channel": string | null
          "p_status": Database["public"]["Enums"]["consent_status"] | null
          "p_evidence_note"?: string | null
        }
        Returns: Database["public"]["Tables"]["guest_consents"]["Row"]
      };
      "record_inventory_item_cost": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_inventory_item_id": string | null
          "p_unit_id": string | null
          "p_price_quantity": number | null
          "p_unit_price_cents": number | null
          "p_effective_at": string | null
          "p_notes"?: string | null
        }
        Returns: Json
      };
      "record_missed_time_entry": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_employee_id": string | null
          "p_job_role_id": string | null
          "p_scheduled_shift_id": string | null
          "p_clocked_in_at": string | null
          "p_clocked_out_at": string | null
          "p_reason": string | null
        }
        Returns: Database["public"]["Tables"]["time_entries"]["Row"]
      };
      "record_receipt_fingerprint": {
        Args: {
          "p_request_id": string | null
          "p_receipt_id": string | null
          "p_content_hash": string | null
        }
        Returns: Json
      };
      "record_service_availability_event": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_subject_type": string | null
          "p_subject_label": string | null
          "p_status": string | null
          "p_estimated_portions": number | null
          "p_reason": string | null
          "p_effective_at": string | null
          "p_expected_restoration_at": string | null
          "p_notes": string | null
        }
        Returns: Database["public"]["Tables"]["service_availability_events"]["Row"]
      };
      "record_tip_payroll_export": {
        Args: {
          "p_request_id": string | null
          "p_tip_run_id": string | null
          "p_format"?: string | null
          "p_storage_path"?: string | null
        }
        Returns: Database["public"]["Tables"]["payroll_exports"]["Row"]
      };
      "redact_audit_record": {
        Args: {
          "p_table": string | null
          "p_record": Json | null
        }
        Returns: Json
      };
      "remove_push_subscription": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_endpoint_hash": string | null
        }
        Returns: boolean
      };
      "reopen_shift": {
        Args: {
          "p_request_id": string | null
          "p_shift_id": string | null
        }
        Returns: Database["public"]["Tables"]["shifts"]["Row"]
      };
      "report_filters_are_scope_safe": {
        Args: {
          "p_filters": Json | null
        }
        Returns: boolean
      };
      "report_filters_without_scope": {
        Args: {
          "p_filters": Json | null
        }
        Returns: Json
      };
      "request_report_export": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_saved_report_id": string | null
          "p_report_type": string | null
          "p_period_start": string | null
          "p_period_end": string | null
          "p_filters": Json | null
          "p_export_type": string | null
        }
        Returns: Database["public"]["Tables"]["export_jobs"]["Row"]
      };
      "request_shift_swap": {
        Args: {
          "p_request_id": string | null
          "p_shift_id": string | null
          "p_preferred_employee_id"?: string | null
          "p_reason"?: string | null
        }
        Returns: Database["public"]["Tables"]["shift_swap_requests"]["Row"]
      };
      "request_time_entry_correction": {
        Args: {
          "p_request_id": string | null
          "p_time_entry_id": string | null
          "p_proposed_clocked_in_at": string | null
          "p_proposed_clocked_out_at": string | null
          "p_proposed_job_role_id": string | null
          "p_reason": string | null
        }
        Returns: Database["public"]["Tables"]["time_entry_corrections"]["Row"]
      };
      "reservation_capacity_snapshot": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_from": string | null
          "p_to": string | null
        }
        Returns: { "startsAt": string | null; "partySize": number | null; "kind": string | null }[]
      };
      "resolve_receipt_duplicate": {
        Args: {
          "p_request_id": string | null
          "p_match_id": string | null
          "p_resolution": string | null
        }
        Returns: Database["public"]["Tables"]["receipt_duplicate_matches"]["Row"]
      };
      "retry_integration_sync_job": {
        Args: {
          "p_request_id": string | null
          "p_sync_job_id": string | null
        }
        Returns: Database["public"]["Tables"]["integration_sync_jobs"]["Row"]
      };
      "review_inventory_transfer": {
        Args: {
          "p_request_id": string | null
          "p_transfer_id": string | null
          "p_approve": boolean | null
          "p_note": string | null
          "p_lines": Json | null
        }
        Returns: Database["public"]["Tables"]["inventory_transfers"]["Row"]
      };
      "review_receipt": {
        Args: {
          "p_receipt_id": string | null
          "p_review_status": Database["public"]["Enums"]["review_status"] | null
          "p_patch"?: Json | null
        }
        Returns: Database["public"]["Tables"]["receipts"]["Row"]
      };
      "review_time_entry": {
        Args: {
          "p_request_id": string | null
          "p_time_entry_id": string | null
          "p_approve": boolean | null
          "p_review_note"?: string | null
        }
        Returns: Database["public"]["Tables"]["time_entries"]["Row"]
      };
      "review_waste_record": {
        Args: {
          "p_request_id": string | null
          "p_waste_record_id": string | null
          "p_approve": boolean | null
          "p_note": string | null
        }
        Returns: Database["public"]["Tables"]["waste_records"]["Row"]
      };
      "revoke_service_shift_exception": {
        Args: {
          "p_request_id": string | null
          "p_exception_id": string | null
          "p_reason": string | null
        }
        Returns: Json
      };
      "revoke_user_invitation": {
        Args: {
          "p_request_id": string | null
          "p_invitation_id": string | null
        }
        Returns: Database["public"]["Tables"]["user_invitations"]["Row"]
      };
      "save_availability_rule": {
        Args: {
          "p_request_id": string | null
          "p_employee_id": string | null
          "p_rule_id": string | null
          "p_location_id": string | null
          "p_weekday": number | null
          "p_available_from": string | null
          "p_available_until": string | null
          "p_is_available": boolean | null
          "p_effective_from": string | null
          "p_effective_to": string | null
          "p_notes"?: string | null
        }
        Returns: Database["public"]["Tables"]["availability_rules"]["Row"]
      };
      "save_employee_certification": {
        Args: {
          "p_request_id": string | null
          "p_employee_id": string | null
          "p_certification_id": string | null
          "p_certification_type": string | null
          "p_issuer": string | null
          "p_credential_number": string | null
          "p_issued_on": string | null
          "p_expires_on": string | null
          "p_verified"?: boolean | null
        }
        Returns: Database["public"]["Tables"]["employee_certifications"]["Row"]
      };
      "save_employee_emergency_contact": {
        Args: {
          "p_request_id": string | null
          "p_employee_id": string | null
          "p_contact_id": string | null
          "p_name": string | null
          "p_relationship": string | null
          "p_phone": string | null
          "p_email": string | null
          "p_is_primary"?: boolean | null
        }
        Returns: Database["public"]["Tables"]["employee_emergency_contacts"]["Row"]
      };
      "save_expense_category": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_category_id": string | null
          "p_name": string | null
          "p_accounting_code"?: string | null
        }
        Returns: Database["public"]["Tables"]["expense_categories"]["Row"]
      };
      "save_guest": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_guest_id": string | null
          "p_first_name": string | null
          "p_last_name": string | null
          "p_display_name": string | null
          "p_email": string | null
          "p_phone": string | null
          "p_birthday": string | null
          "p_vip": boolean | null
          "p_preferences": string | null
          "p_allergies": string | null
          "p_notes": string | null
        }
        Returns: Database["public"]["Tables"]["guests"]["Row"]
      };
      "save_guest_contact": {
        Args: {
          "p_request_id": string | null
          "p_guest_id": string | null
          "p_contact_id": string | null
          "p_contact_type": string | null
          "p_label": string | null
          "p_value": string | null
          "p_is_primary"?: boolean | null
        }
        Returns: Database["public"]["Tables"]["guest_contacts"]["Row"]
      };
      "save_manager_log_entry": {
        Args: {
          "p_request_id": string | null
          "p_entry_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_business_date": string | null
          "p_service_period": string | null
          "p_category": string | null
          "p_severity": string | null
          "p_title": string | null
          "p_narrative": string | null
          "p_related_employee_id": string | null
          "p_related_guest_id": string | null
          "p_related_reservation_id": string | null
          "p_related_inventory_item_id": string | null
          "p_follow_up_owner_id": string | null
          "p_due_date": string | null
          "p_status": string | null
          "p_resolution": string | null
          "p_attachment_path": string | null
        }
        Returns: Database["public"]["Tables"]["manager_log_entries"]["Row"]
      };
      "save_manager_recipe": {
        Args: {
          "p_request_id": string | null
          "p_workspace_location_id": string | null
          "p_recipe_id": string | null
          "p_name": string | null
          "p_yield_quantity": number | null
          "p_yield_unit_id": string | null
          "p_menu_price_cents": number | null
          "p_is_active": boolean | null
          "p_ingredients": Json | null
        }
        Returns: Json
      };
      "save_preshift": {
        Args: {
          "p_request_id": string | null
          "p_preshift_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_business_date": string | null
          "p_service_period": string | null
          "p_status": string | null
          "p_booked_covers": number | null
          "p_projected_covers": number | null
          "p_vip_notes": string | null
          "p_allergy_notes": string | null
          "p_large_party_notes": string | null
          "p_specials": string | null
          "p_staffing_notes": string | null
          "p_station_assignments": Json | null
          "p_previous_handoff": string | null
          "p_service_goal": string | null
          "p_training_point": string | null
          "p_manager_notes": string | null
        }
        Returns: Database["public"]["Tables"]["preshifts"]["Row"]
      };
      "save_push_subscription": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_endpoint_hash": string | null
          "p_encrypted_subscription": string | null
          "p_device_label"?: string | null
        }
        Returns: Database["public"]["Tables"]["push_subscriptions"]["Row"]
      };
      "save_reservation": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_reservation_id": string | null
          "p_guest_id": string | null
          "p_reserved_at": string | null
          "p_duration_minutes": number | null
          "p_party_size": number | null
          "p_special_requests": string | null
          "p_source": string | null
          "p_table_ids": string[] | null
        }
        Returns: Json
      };
      "save_reservation_with_guest": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_display_name": string | null
          "p_email": string | null
          "p_phone": string | null
          "p_reserved_at": string | null
          "p_duration_minutes": number | null
          "p_party_size": number | null
          "p_special_requests": string | null
          "p_source": string | null
          "p_table_ids": string[] | null
        }
        Returns: Json
      };
      "save_schedule_template": {
        Args: {
          "p_request_id": string | null
          "p_schedule_id": string | null
          "p_name": string | null
        }
        Returns: Json
      };
      "save_time_off_request": {
        Args: {
          "p_request_id": string | null
          "p_employee_id": string | null
          "p_time_off_id": string | null
          "p_location_id": string | null
          "p_starts_at": string | null
          "p_ends_at": string | null
          "p_reason"?: string | null
        }
        Returns: Database["public"]["Tables"]["time_off_requests"]["Row"]
      };
      "save_tip_pool_policy_draft": {
        Args: {
          "p_request_id": string | null
          "p_policy_id": string | null
          "p_policy_version_id": string | null
          "p_distribution_method": Database["public"]["Enums"]["tip_distribution_method"] | null
          "p_effective_from": string | null
          "p_effective_to": string | null
          "p_closeout_sources": string[] | null
          "p_eligibility_rules": Json | null
        }
        Returns: Database["public"]["Tables"]["tip_pool_policy_versions"]["Row"]
      };
      "save_waitlist_entry": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_guest_id": string | null
          "p_display_name": string | null
          "p_party_size": number | null
          "p_desired_from": string | null
          "p_desired_to": string | null
          "p_quoted_wait_minutes": number | null
          "p_notes": string | null
        }
        Returns: Json
      };
      "save_waitlist_entry_v2": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_guest_id": string | null
          "p_display_name": string | null
          "p_email": string | null
          "p_phone": string | null
          "p_party_size": number | null
          "p_desired_from": string | null
          "p_desired_to": string | null
          "p_quoted_wait_minutes": number | null
          "p_notes": string | null
        }
        Returns: Json
      };
      "search_guests": {
        Args: {
          "p_organization_id": string | null
          "p_query": string | null
          "p_limit"?: number | null
        }
        Returns: Database["public"]["Tables"]["guests"]["Row"][]
      };
      "search_receipts": {
        Args: {
          "p_organization_id": string | null
          "p_query": string | null
          "p_location_id"?: string | null
          "p_limit"?: number | null
        }
        Returns: Database["public"]["Tables"]["receipts"]["Row"][]
      };
      "seat_waitlist_entry": {
        Args: {
          "p_request_id": string | null
          "p_waitlist_entry_id": string | null
          "p_table_ids": string[] | null
          "p_duration_minutes": number | null
        }
        Returns: Json
      };
      "serialize_tip_labor_evidence": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "service_add_guest_note": {
        Args: {
          "p_request_id": string | null
          "p_guest_id": string | null
          "p_location_id": string | null
          "p_note": string | null
          "p_is_sensitive"?: boolean | null
        }
        Returns: { "id": string | null; "created_at": string | null }[]
      };
      "service_cancel_public_reservation": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_manage_token_hash": string | null
          "p_reason": string | null
        }
        Returns: Json
      };
      "service_claim_booking_rate_limit": {
        Args: {
          "p_bucket_hash": string | null
          "p_limit": number | null
          "p_window_seconds": number | null
        }
        Returns: Json
      };
      "service_claim_reservation_message_outbox": {
        Args: {
          "p_worker_id": string | null
          "p_limit": number | null
          "p_lease_seconds": number | null
          "p_now": string | null
        }
        Returns: { "id": string | null; "claimToken": string | null; "organizationId": string | null; "locationId": string | null; "reservationId": string | null; "bookingHoldId": string | null; "waitlistEntryId": string | null; "guestId": string | null; "channel": string | null; "templateKey": string | null; "templateData": Json | null; "attempts": number | null; "createdAt": string | null; "guestName": string | null; "recipientEmail": string | null; "recipientPhone": string | null; "publicCode": string | null; "reservedAt": string | null; "offerExpiresAt": string | null; "holdExpiresAt": string | null }[]
      };
      "service_complete_reservation_message_outbox": {
        Args: {
          "p_id": string | null
          "p_claim_token": string | null
          "p_status": string | null
          "p_error_code"?: string | null
          "p_next_attempt_at"?: string | null
          "p_provider_message_id"?: string | null
        }
        Returns: Json
      };
      "service_confirm_public_reservation": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_booking_hold_id": string | null
          "p_confirmation_fingerprint": string | null
          "p_verified_channel": string | null
          "p_available_channels": string[] | null
        }
        Returns: Json
      };
      "service_create_public_reservation": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_reserved_at": string | null
          "p_duration_minutes": number | null
          "p_party_size": number | null
          "p_first_name": string | null
          "p_last_name": string | null
          "p_email": string | null
          "p_phone": string | null
          "p_special_requests": string | null
          "p_table_ids": string[] | null
          "p_available_channels": string[] | null
        }
        Returns: Json
      };
      "service_day_business_date": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_observed_at"?: string | null
        }
        Returns: { "businessDate": string | null; "calendarDate": string | null; "timeZone": string | null; "source": string | null; "servicePeriodId": string | null; "serviceName": string | null; "startsAt": string | null; "endsAt": string | null; "pacingIntervalMinutes": number | null; "pacingCoverLimit": number | null; "configurationState": string | null }[]
      };
      "service_day_provider_health": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
        }
        Returns: { "provider": Database["public"]["Enums"]["integration_provider"] | null; "display_name": string | null; "status": string | null; "last_synced_at": string | null; "updated_at": string | null }[]
      };
      "service_enqueue_reservation_reminders": {
        Args: {
          "p_now": string | null
        }
        Returns: number
      };
      "service_exchange_reservation_management": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_reservation_id": string | null
          "p_exchange_fingerprint": string | null
          "p_manage_token_hash": string | null
          "p_browser_binding_hash": string | null
        }
        Returns: Json
      };
      "service_expire_reservation_deadlines": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_now": string | null
          "p_limit"?: number | null
        }
        Returns: Json
      };
      "service_finalize_employee_document": {
        Args: {
          "p_request_id": string | null
          "p_actor_id": string | null
          "p_actor_aal": string | null
          "p_employee_id": string | null
          "p_location_id": string | null
          "p_storage_path": string | null
          "p_document_type": string | null
          "p_title": string | null
          "p_mime_type": string | null
          "p_size_bytes": number | null
          "p_is_employee_visible"?: boolean | null
        }
        Returns: Database["public"]["Tables"]["employee_documents"]["Row"]
      };
      "service_get_managed_reservation": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_manage_token_hash": string | null
        }
        Returns: Json
      };
      "service_guest_profiles": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_query"?: string | null
          "p_limit"?: number | null
          "p_guest_ids"?: string[] | null
        }
        Returns: { "id": string | null; "first_name": string | null; "last_name": string | null; "display_name": string | null; "email": string | null; "phone": string | null; "birthday": string | null; "vip": boolean | null; "first_visit_at": string | null; "last_visit_at": string | null; "visit_count": number | null; "source": string | null }[]
      };
      "service_guest_sensitive_metrics": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
        }
        Returns: { "profiles_with_allergies": number | null }[]
      };
      "service_guest_sensitive_notes": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_guest_ids": string[] | null
        }
        Returns: { "id": string | null; "guest_id": string | null; "location_id": string | null; "note": string | null; "is_sensitive": boolean | null; "author_id": string | null; "created_at": string | null }[]
      };
      "service_guest_sensitive_profiles": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_guest_ids": string[] | null
        }
        Returns: { "id": string | null; "preferences": string | null; "allergies": string | null; "notes": string | null; "lifetime_spend_cents": number | null }[]
      };
      "service_merge_guests": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_source_guest_id": string | null
          "p_target_guest_id": string | null
          "p_match_score": number | null
          "p_reasons": Json | null
        }
        Returns: { "id": string | null; "source_guest_id": string | null; "target_guest_id": string | null; "merged_at": string | null }[]
      };
      "service_modify_public_reservation": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_manage_token_hash": string | null
          "p_reserved_at": string | null
          "p_duration_minutes": number | null
          "p_party_size": number | null
          "p_special_requests": string | null
          "p_table_ids": string[] | null
        }
        Returns: Json
      };
      "service_record_guest_consent": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_guest_id": string | null
          "p_channel": string | null
          "p_status": Database["public"]["Enums"]["consent_status"] | null
          "p_evidence_note": string | null
        }
        Returns: { "id": string | null; "captured_at": string | null }[]
      };
      "service_reservation_guest_summaries": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_guest_ids": string[] | null
        }
        Returns: { "id": string | null; "display_name": string | null; "vip": boolean | null; "visit_count": number | null }[]
      };
      "service_reservation_host_snapshot": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_from": string | null
          "p_to": string | null
        }
        Returns: { "id": string | null; "guest_id": string | null; "version": number | null; "reserved_at": string | null; "duration_minutes": number | null; "party_size": number | null; "status": string | null; "table_label": string | null; "special_requests": string | null; "source": string | null; "booking_channel": string | null; "policy_evidence_captured": boolean | null; "last_revision": Json | null }[]
      };
      "service_reservation_lifecycle_head": {
        Args: {
          "p_location_id": string | null
          "p_reservation_id": string | null
        }
        Returns: Json
      };
      "service_reservation_pacing_snapshot": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_from": string | null
          "p_to": string | null
        }
        Returns: { "startsAt": string | null; "partySize": number | null; "kind": string | null }[]
      };
      "service_reservation_shift_snapshot": {
        Args: {
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_business_date": string | null
        }
        Returns: { "shiftId": string | null; "servicePeriodId": string | null; "name": string | null; "businessDate": string | null; "startsAt": string | null; "endsAt": string | null; "defaultDurationMinutes": number | null; "pacingIntervalMinutes": number | null; "pacingCoverLimit": number | null; "minPartySize": number | null; "maxPartySize": number | null; "onlineEnabled": boolean | null; "status": string | null; "configurationState": string | null; "exceptions": Json | null }[]
      };
      "service_save_guest": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_location_id": string | null
          "p_guest_id": string | null
          "p_first_name": string | null
          "p_last_name": string | null
          "p_display_name": string | null
          "p_email": string | null
          "p_phone": string | null
          "p_birthday": string | null
          "p_vip": boolean | null
          "p_preferences": string | null
          "p_allergies": string | null
          "p_notes": string | null
        }
        Returns: { "id": string | null; "display_name": string | null; "updated_at": string | null }[]
      };
      "service_validate_reservation_message_claim": {
        Args: {
          "p_id": string | null
          "p_claim_token": string | null
          "p_now": string | null
        }
        Returns: boolean
      };
      "set_chat_channel_archived": {
        Args: {
          "p_request_id": string | null
          "p_channel_id": string | null
          "p_archived": boolean | null
        }
        Returns: Database["public"]["Tables"]["chat_channels"]["Row"]
      };
      "set_delivery_receipt_link": {
        Args: {
          "p_request_id": string | null
          "p_delivery_id": string | null
          "p_receipt_id"?: string | null
        }
        Returns: Database["public"]["Tables"]["deliveries"]["Row"]
      };
      "set_expense_category_active": {
        Args: {
          "p_request_id": string | null
          "p_category_id": string | null
          "p_active": boolean | null
        }
        Returns: Database["public"]["Tables"]["expense_categories"]["Row"]
      };
      "set_expense_receipt_link": {
        Args: {
          "p_request_id": string | null
          "p_expense_id": string | null
          "p_receipt_id"?: string | null
        }
        Returns: Database["public"]["Tables"]["expenses"]["Row"]
      };
      "set_incident_status": {
        Args: {
          "p_request_id": string | null
          "p_incident_id": string | null
          "p_status": string | null
          "p_follow_up"?: string | null
        }
        Returns: Database["public"]["Tables"]["incidents"]["Row"]
      };
      "set_maintenance_status": {
        Args: {
          "p_request_id": string | null
          "p_maintenance_id": string | null
          "p_status": Database["public"]["Enums"]["task_status"] | null
          "p_assigned_to"?: string | null
          "p_vendor_id"?: string | null
          "p_estimated_cost_cents"?: number | null
          "p_actual_cost_cents"?: number | null
          "p_due_at"?: string | null
          "p_note"?: string | null
        }
        Returns: Database["public"]["Tables"]["maintenance_requests"]["Row"]
      };
      "set_notification_preference": {
        Args: {
          "p_request_id": string | null
          "p_organization_id": string | null
          "p_notification_type": string | null
          "p_in_app": boolean | null
          "p_email": boolean | null
          "p_push": boolean | null
          "p_quiet_hours"?: Json | null
        }
        Returns: Database["public"]["Tables"]["notification_preferences"]["Row"]
      };
      "set_private_chat_channel_members": {
        Args: {
          "p_request_id": string | null
          "p_channel_id": string | null
          "p_member_ids": string[] | null
        }
        Returns: Database["public"]["Tables"]["chat_channels"]["Row"]
      };
      "set_reservation_table_status": {
        Args: {
          "p_request_id": string | null
          "p_table_id": string | null
          "p_status": string | null
          "p_note": string | null
          "p_reservation_id": string | null
        }
        Returns: Json
      };
      "shares_active_org": {
        Args: {
          "p_other_user_id": string | null
        }
        Returns: boolean
      };
      "start_checklist_run": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_template_id": string | null
          "p_business_date": string | null
          "p_assigned_employee_id"?: string | null
        }
        Returns: Database["public"]["Tables"]["checklist_runs"]["Row"]
      };
      "start_time_break": {
        Args: {
          "p_request_id": string | null
          "p_time_entry_id": string | null
          "p_is_paid": boolean | null
        }
        Returns: Database["public"]["Tables"]["time_breaks"]["Row"]
      };
      "storage_chat_path_is_authorized": {
        Args: {
          "p_name": string | null
        }
        Returns: boolean
      };
      "storage_location_id": {
        Args: {
          "p_name": string | null
        }
        Returns: string
      };
      "storage_object_is_terminal_evidence": {
        Args: {
          "p_bucket_id": string | null
          "p_name": string | null
        }
        Returns: boolean
      };
      "storage_organization_id": {
        Args: {
          "p_name": string | null
        }
        Returns: string
      };
      "storage_path_scope_is_valid": {
        Args: {
          "p_name": string | null
        }
        Returns: boolean
      };
      "submit_inventory_count": {
        Args: {
          "p_submission_id": string | null
          "p_location_id": string | null
          "p_count_type": string | null
          "p_notes": string | null
          "p_lines": Json | null
        }
        Returns: Database["public"]["Tables"]["inventory_counts"]["Row"]
      };
      "submit_waste_record": {
        Args: {
          "p_request_id": string | null
          "p_location_id": string | null
          "p_inventory_item_id": string | null
          "p_unit_id": string | null
          "p_quantity": number | null
          "p_reason_code": string | null
          "p_occurred_at": string | null
          "p_notes": string | null
        }
        Returns: Database["public"]["Tables"]["waste_records"]["Row"]
      };
      "tip_run_derivation_hash": {
        Args: {
          "p_closeout_id": string | null
          "p_policy_version_id": string | null
        }
        Returns: string
      };
      "touch_updated_at": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "transition_reservation": {
        Args: {
          "p_request_id": string | null
          "p_reservation_id": string | null
          "p_target_status": string | null
          "p_note": string | null
        }
        Returns: Json
      };
      "transition_task": {
        Args: {
          "p_request_id": string | null
          "p_task_id": string | null
          "p_status": Database["public"]["Enums"]["task_status"] | null
          "p_note"?: string | null
        }
        Returns: Database["public"]["Tables"]["tasks"]["Row"]
      };
      "transition_waitlist_entry": {
        Args: {
          "p_request_id": string | null
          "p_waitlist_entry_id": string | null
          "p_target_status": string | null
          "p_note": string | null
        }
        Returns: Json
      };
      "update_employee_document_metadata": {
        Args: {
          "p_request_id": string | null
          "p_document_id": string | null
          "p_document_type": string | null
          "p_title": string | null
          "p_is_employee_visible": boolean | null
        }
        Returns: Database["public"]["Tables"]["employee_documents"]["Row"]
      };
      "update_employee_job_assignment": {
        Args: {
          "p_request_id": string | null
          "p_assignment_id": string | null
          "p_job_role_id": string | null
          "p_location_id": string | null
          "p_set_hourly_rate": boolean | null
          "p_hourly_rate_cents": number | null
          "p_effective_from": string | null
          "p_effective_to": string | null
          "p_is_primary": boolean | null
        }
        Returns: Database["public"]["Tables"]["employee_job_roles"]["Row"]
      };
      "update_job_role_definition": {
        Args: {
          "p_request_id": string | null
          "p_job_role_id": string | null
          "p_name": string | null
          "p_code": string | null
          "p_department": string | null
          "p_color": string | null
          "p_default_tip_points": number | null
          "p_is_tipped": boolean | null
        }
        Returns: Database["public"]["Tables"]["job_roles"]["Row"]
      };
      "update_sop_draft": {
        Args: {
          "p_request_id": string | null
          "p_sop_version_id": string | null
          "p_body": string | null
          "p_change_summary"?: string | null
        }
        Returns: Database["public"]["Tables"]["sop_versions"]["Row"]
      };
      "validate_employee_job_assignment": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      };
      "validate_human_ai_decision": {
        Args: Record<PropertyKey, never>
        Returns: unknown
      }
    }
    Enums: {
      "ai_run_kind": "receipt_extraction" | "natural_language_search" | "report_summary" | "anomaly_detection" | "forecast"
      "app_role": "owner" | "admin" | "manager" | "employee"
      "channel_kind": "all_staff" | "location" | "management" | "private"
      "consent_status": "unknown" | "granted" | "revoked"
      "integration_provider": "toast" | "resy" | "csv" | "manual" | "payroll" | "accounting" | "other"
      "inventory_transaction_kind": "purchase" | "count_adjustment" | "waste" | "transfer_in" | "transfer_out" | "recipe_usage" | "manual_adjustment"
      "job_status": "queued" | "running" | "succeeded" | "partially_succeeded" | "failed" | "cancelled"
      "membership_status": "invited" | "active" | "suspended"
      "request_status": "draft" | "pending" | "approved" | "denied" | "cancelled"
      "review_status": "pending" | "in_review" | "approved" | "rejected"
      "run_status": "draft" | "queued" | "running" | "calculated" | "review" | "approved" | "failed" | "cancelled"
      "schedule_status": "draft" | "published" | "archived"
      "shift_status": "scheduled" | "open" | "claimed" | "in_progress" | "completed" | "cancelled"
      "task_status": "open" | "in_progress" | "blocked" | "completed" | "cancelled"
      "time_entry_status": "open" | "submitted" | "approved" | "corrected" | "rejected"
      "tip_distribution_method": "hours" | "points" | "weighted_hours"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

export type PublicSchema = Database["public"];
export type TableName = keyof PublicSchema["Tables"];
export type ViewName = keyof PublicSchema["Views"];
export type FunctionName = keyof PublicSchema["Functions"];
export type EnumName = keyof PublicSchema["Enums"];
export type TableRow<Name extends TableName> = PublicSchema["Tables"][Name]["Row"];
export type TableInsert<Name extends TableName> = PublicSchema["Tables"][Name]["Insert"];
export type TableUpdate<Name extends TableName> = PublicSchema["Tables"][Name]["Update"];
export type ViewRow<Name extends ViewName> = PublicSchema["Views"][Name]["Row"];
export type EnumValue<Name extends EnumName> = PublicSchema["Enums"][Name];

export const DatabaseConstants = {
  public: {
    Enums: {
      "ai_run_kind": ["receipt_extraction","natural_language_search","report_summary","anomaly_detection","forecast"],
      "app_role": ["owner","admin","manager","employee"],
      "channel_kind": ["all_staff","location","management","private"],
      "consent_status": ["unknown","granted","revoked"],
      "integration_provider": ["toast","resy","csv","manual","payroll","accounting","other"],
      "inventory_transaction_kind": ["purchase","count_adjustment","waste","transfer_in","transfer_out","recipe_usage","manual_adjustment"],
      "job_status": ["queued","running","succeeded","partially_succeeded","failed","cancelled"],
      "membership_status": ["invited","active","suspended"],
      "request_status": ["draft","pending","approved","denied","cancelled"],
      "review_status": ["pending","in_review","approved","rejected"],
      "run_status": ["draft","queued","running","calculated","review","approved","failed","cancelled"],
      "schedule_status": ["draft","published","archived"],
      "shift_status": ["scheduled","open","claimed","in_progress","completed","cancelled"],
      "task_status": ["open","in_progress","blocked","completed","cancelled"],
      "time_entry_status": ["open","submitted","approved","corrected","rejected"],
      "tip_distribution_method": ["hours","points","weighted_hours"],
    },
  },
} as const;

export const DatabaseObjectNames = {
  public: {
    Tables: [
      "ai_action_proposals",
      "ai_citations",
      "ai_runs",
      "announcement_acknowledgements",
      "application_errors",
      "audit_events",
      "availability_rules",
      "backup_runs",
      "booking_api_clients",
      "capability_definitions",
      "chat_attachments",
      "chat_channel_members",
      "chat_channels",
      "chat_messages",
      "chat_reactions",
      "chat_read_receipts",
      "checklist_responses",
      "checklist_runs",
      "checklist_template_items",
      "checklist_templates",
      "closeout_attachments",
      "cogs_periods",
      "data_export_requests",
      "deliveries",
      "delivery_lines",
      "dining_areas",
      "employee_certifications",
      "employee_documents",
      "employee_emergency_contacts",
      "employee_job_roles",
      "employees",
      "expense_categories",
      "expenses",
      "export_jobs",
      "guest_consents",
      "guest_contacts",
      "guest_locations",
      "guest_merge_events",
      "guest_notes",
      "guest_tag_assignments",
      "guest_tags",
      "guest_visits",
      "guests",
      "import_jobs",
      "import_rows",
      "incident_attachments",
      "incidents",
      "income_sales_checks",
      "integration_connections",
      "integration_events",
      "integration_sync_jobs",
      "integration_sync_records",
      "inventory_categories",
      "inventory_count_lines",
      "inventory_counts",
      "inventory_items",
      "inventory_par_levels",
      "inventory_recipe_versions",
      "inventory_transactions",
      "inventory_transfer_lines",
      "inventory_transfers",
      "item_price_history",
      "job_role_capabilities",
      "job_roles",
      "location_memberships",
      "locations",
      "maintenance_requests",
      "manager_log_entries",
      "manager_log_versions",
      "measurement_units",
      "notification_preferences",
      "notifications",
      "organization_memberships",
      "organization_settings",
      "organizations",
      "payroll_exports",
      "preshift_acknowledgements",
      "preshifts",
      "profiles",
      "purchase_order_lines",
      "purchase_orders",
      "push_subscriptions",
      "receipt_duplicate_matches",
      "receipt_extractions",
      "receipt_files",
      "receipt_ocr_runs",
      "receipts",
      "recipe_ingredients",
      "recipes",
      "report_runs",
      "reservation_events",
      "reservation_message_outbox",
      "reservation_push_deliveries",
      "reservation_revisions",
      "reservation_service_periods",
      "reservation_settings",
      "reservation_table_allocations",
      "reservation_table_combination_members",
      "reservation_table_combinations",
      "reservation_tables",
      "reservation_turn_rules",
      "reservations",
      "retention_policies",
      "saved_reports",
      "schedule_template_shifts",
      "schedule_templates",
      "schedules",
      "service_availability_events",
      "service_shift_exceptions",
      "service_shifts",
      "shift_acknowledgements",
      "shift_closeouts",
      "shift_swap_offers",
      "shift_swap_requests",
      "shifts",
      "sop_acknowledgements",
      "sop_documents",
      "sop_versions",
      "table_status_events",
      "tasks",
      "time_breaks",
      "time_entries",
      "time_entry_corrections",
      "time_off_requests",
      "tip_adjustments",
      "tip_allocations",
      "tip_pool_eligibility_rules",
      "tip_pool_policies",
      "tip_pool_policy_versions",
      "tip_run_participants",
      "tip_runs",
      "tip_sources",
      "unit_conversions",
      "user_capability_overrides",
      "user_invitations",
      "vendor_items",
      "vendors",
      "waitlist_entries",
      "waste_records",
    ],
    Views: [
      "approved_labor_daily",
      "inventory_on_hand",
      "tip_run_totals",
    ],
    Functions: [
      "accept_my_invitation",
      "acknowledge_preshift",
      "acknowledge_sop",
      "add_guest_note",
      "administer_organization_member",
      "apply_time_entry_correction",
      "approve_closeout",
      "approve_inventory_count",
      "approve_le_yard_reservation_draft",
      "approve_tip_adjustment",
      "approve_tip_policy_version",
      "approve_tip_run",
      "assign_guest_tag",
      "assign_reservation_tables",
      "bind_verified_checklist_photo_response",
      "bind_verified_checklist_photo_response_aal2_legacy",
      "bootstrap_initial_tenant",
      "broadcast_reservation_change",
      "calculate_tip_run",
      "calculate_tip_run_unchecked",
      "can_access_channel",
      "can_access_location",
      "can_access_org",
      "can_access_storage_scope",
      "can_administer_membership_target",
      "can_manage_guest_profile_scope",
      "can_manage_location",
      "can_manage_org",
      "can_manage_report_scope",
      "can_manage_storage_scope",
      "can_operate_employee",
      "can_operate_org",
      "can_read_employee_management",
      "can_read_guest_note_scope",
      "can_read_guest_profile_scope",
      "can_read_management_location",
      "can_read_management_org",
      "can_read_management_storage_scope",
      "can_read_report_scope",
      "cancel_reservation",
      "cancel_time_off_request",
      "capture_audit_event",
      "claim_open_shift",
      "complete_checklist_run",
      "complete_report_export",
      "configure_inventory_catalog",
      "configure_job_role_capability",
      "configure_kitchen_foundation",
      "configure_operational_inventory_catalog",
      "configure_reservation_location",
      "configure_retention_policy",
      "configure_service_shift_exception",
      "configure_tip_pool_policy",
      "configure_user_capability_override",
      "create_chat_channel",
      "create_checklist_template_version",
      "create_employee_job_assignment",
      "create_incident",
      "create_inventory_transfer",
      "create_job_role_definition",
      "create_maintenance_request",
      "create_manual_csv_import",
      "create_purchase_order",
      "create_schedule_draft",
      "create_sop_draft",
      "create_sop_version",
      "create_task",
      "current_user_id",
      "deactivate_job_role_definition",
      "decide_shift_swap",
      "decide_time_off_request",
      "delete_availability_rule",
      "effective_capabilities",
      "employee_is_effectively_assigned",
      "end_employee_job_assignment",
      "end_time_break",
      "enforce_owner_role_assignment",
      "finalize_employee_document",
      "guard_active_owner_count",
      "guard_chat_message_scope",
      "guard_chat_read_position",
      "guard_closeout_attachment_mutation",
      "guard_closeout_mutation",
      "guard_employee_auth_identity",
      "guard_employee_hr_fields",
      "guard_guest_append_only_evidence",
      "guard_guest_profile_owned_fields",
      "guard_integration_job_evidence",
      "guard_inventory_count_line_mutation",
      "guard_inventory_count_mutation",
      "guard_inventory_transaction_evidence",
      "guard_inventory_transfer_line_mutation",
      "guard_inventory_transfer_mutation",
      "guard_notification_evidence",
      "guard_owner_invitation_target",
      "guard_owner_location_membership_target",
      "guard_owner_membership_target",
      "guard_published_shift_mutation",
      "guard_published_sop_evidence",
      "guard_receipt_child_mutation",
      "guard_receipt_duplicate_resolution",
      "guard_receipt_mutation",
      "guard_receipt_reference_link",
      "guard_receipt_terminal_duplicate_resolution",
      "guard_report_job_mutation",
      "guard_reservation_append_only",
      "guard_saved_report_scope",
      "guard_schedule_mutation",
      "guard_shift_acknowledgement",
      "guard_shift_swap_offer_scope",
      "guard_shift_swap_scope",
      "guard_terminal_operation_evidence",
      "guard_time_correction_decision_actor",
      "guard_time_correction_scope",
      "guard_tip_adjustment_approval_evidence",
      "guard_tip_eligibility_rule_version",
      "guard_tip_policy_operational_contract",
      "guard_tip_policy_version_approval_evidence",
      "guard_tip_run_financial_evidence",
      "guard_waste_review_mutation",
      "handle_new_auth_user",
      "has_any_capability",
      "has_any_location_capability",
      "has_capability",
      "has_current_location_capability",
      "has_org_role",
      "income_operating_snapshot",
      "ingest_income_sales_check",
      "install_le_yard_reservation_draft",
      "is_owner_pending_mfa",
      "is_self_employee",
      "jwt_aal",
      "manual_import_headers_are_valid",
      "mark_channel_read",
      "merge_guests",
      "modify_reservation",
      "notification_type_is_supported",
      "offer_shift_swap",
      "org_role",
      "prepare_tip_run_from_closeout",
      "prevent_approved_record_mutation",
      "prevent_audit_mutation",
      "prevent_ledger_mutation",
      "prevent_locked_tip_mutation",
      "provision_user_invitation",
      "provision_user_invitation_aal2_legacy",
      "publish_checklist_template",
      "publish_schedule",
      "publish_sop_version",
      "receive_inventory_delivery",
      "record_checklist_response",
      "record_clock_in",
      "record_clock_out",
      "record_guest_consent",
      "record_inventory_item_cost",
      "record_missed_time_entry",
      "record_receipt_fingerprint",
      "record_service_availability_event",
      "record_tip_payroll_export",
      "redact_audit_record",
      "remove_push_subscription",
      "reopen_shift",
      "report_filters_are_scope_safe",
      "report_filters_without_scope",
      "request_report_export",
      "request_shift_swap",
      "request_time_entry_correction",
      "reservation_capacity_snapshot",
      "resolve_receipt_duplicate",
      "retry_integration_sync_job",
      "review_inventory_transfer",
      "review_receipt",
      "review_time_entry",
      "review_waste_record",
      "revoke_service_shift_exception",
      "revoke_user_invitation",
      "save_availability_rule",
      "save_employee_certification",
      "save_employee_emergency_contact",
      "save_expense_category",
      "save_guest",
      "save_guest_contact",
      "save_manager_log_entry",
      "save_manager_recipe",
      "save_preshift",
      "save_push_subscription",
      "save_reservation",
      "save_reservation_with_guest",
      "save_schedule_template",
      "save_time_off_request",
      "save_tip_pool_policy_draft",
      "save_waitlist_entry",
      "save_waitlist_entry_v2",
      "search_guests",
      "search_receipts",
      "seat_waitlist_entry",
      "serialize_tip_labor_evidence",
      "service_add_guest_note",
      "service_cancel_public_reservation",
      "service_claim_booking_rate_limit",
      "service_claim_reservation_message_outbox",
      "service_complete_reservation_message_outbox",
      "service_confirm_public_reservation",
      "service_create_public_reservation",
      "service_day_business_date",
      "service_day_provider_health",
      "service_enqueue_reservation_reminders",
      "service_exchange_reservation_management",
      "service_expire_reservation_deadlines",
      "service_finalize_employee_document",
      "service_get_managed_reservation",
      "service_guest_profiles",
      "service_guest_sensitive_metrics",
      "service_guest_sensitive_notes",
      "service_guest_sensitive_profiles",
      "service_merge_guests",
      "service_modify_public_reservation",
      "service_record_guest_consent",
      "service_reservation_guest_summaries",
      "service_reservation_host_snapshot",
      "service_reservation_lifecycle_head",
      "service_reservation_pacing_snapshot",
      "service_reservation_shift_snapshot",
      "service_save_guest",
      "service_validate_reservation_message_claim",
      "set_chat_channel_archived",
      "set_delivery_receipt_link",
      "set_expense_category_active",
      "set_expense_receipt_link",
      "set_incident_status",
      "set_maintenance_status",
      "set_notification_preference",
      "set_private_chat_channel_members",
      "set_reservation_table_status",
      "shares_active_org",
      "start_checklist_run",
      "start_time_break",
      "storage_chat_path_is_authorized",
      "storage_location_id",
      "storage_object_is_terminal_evidence",
      "storage_organization_id",
      "storage_path_scope_is_valid",
      "submit_inventory_count",
      "submit_waste_record",
      "tip_run_derivation_hash",
      "touch_updated_at",
      "transition_reservation",
      "transition_task",
      "transition_waitlist_entry",
      "update_employee_document_metadata",
      "update_employee_job_assignment",
      "update_job_role_definition",
      "update_sop_draft",
      "validate_employee_job_assignment",
      "validate_human_ai_decision",
    ],
    Enums: [
      "ai_run_kind",
      "app_role",
      "channel_kind",
      "consent_status",
      "integration_provider",
      "inventory_transaction_kind",
      "job_status",
      "membership_status",
      "request_status",
      "review_status",
      "run_status",
      "schedule_status",
      "shift_status",
      "task_status",
      "time_entry_status",
      "tip_distribution_method",
    ],
  },
} as const;

