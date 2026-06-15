export interface User {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "operator" | "auditor" | "user";
  mfa_enabled: boolean;
  status: "active" | "suspended";
  created_at: string;
  updated_at?: string;
}

export interface BusinessCard {
  id: string;
  owner_user_id: string;
  image_url: string;
  original_file_url?: string;
  processing_status: "queued" | "processing" | "pending_verification" | "success" | "failed" | "manual_review";
  confidence_score: number;
  source_type: "web" | "ios" | "android";
  batch_id?: string;
  created_at: string;
  updated_at?: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BusinessCardField {
  id: string;
  business_card_id: string;
  field_name: "full_name" | "title" | "company" | "department" | "email" | "phone" | "mobile_phone" | "website" | "address" | "city" | "country" | "linkedin" | "tax_info" | "notes";
  field_value: string;
  confidence_score: number;
  bounding_box_x: number;
  bounding_box_y: number;
  bounding_box_width: number;
  bounding_box_height: number;
  is_verified: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Contact {
  id: string;
  business_card_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  title: string;
  company: string;
  department: string;
  email: string;
  phone: string;
  mobile_phone: string;
  website: string;
  address: string;
  city: string;
  country: string;
  linkedin: string;
  notes: string;
  owner_id: string;
  is_deleted?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Batch {
  id: string;
  created_by: string;
  total_files: number;
  processed_files: number;
  failed_files: number;
  status: "queued" | "processing" | "completed";
  created_at: string;
  completed_at?: string;
}

export interface ExportLog {
  id: string;
  created_by: string;
  export_type: string;
  file_url: string;
  record_count: number;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: string;
  new_value: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_by: string;
  created_at: string;
}

export interface CardWithRelationships extends BusinessCard {
  fields: BusinessCardField[];
  contact?: Contact;
  tags: Tag[];
}
