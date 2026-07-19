export interface Business {
  id: string;
  name: string;
  wa_phone_number: string;
  workflow_name: string | null;
  ai_system_prompt: string | null;
  knowledge_base: string | null;
  working_hours: Record<string, any>;
  subscription_plan: string;
  status: string;
  crm_settings: Record<string, any>;
  memory_settings: Record<string, any>;
  payment_config: Record<string, any>;
  api_keys: Record<string, any>;
  feature_flags: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface WhatsAppSession {
  id: string;
  business_id: string;
  phone_number: string | null;
  connection_status: 'disconnected' | 'connecting' | 'connected';
  last_connected_time: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Customer {
  id: string;
  business_id: string;
  phone: string;
  name: string | null;
  language: string;
  preferred_time: string | null;
  dietary_prefs: string[];
  visit_count: number;
  total_spent: number;
  loyalty_points: number;
  notes: string | null;
  contact_mode: 'ai' | 'manual';
  created_at?: string;
  updated_at?: string;
}

export interface Lead {
  id: string;
  business_id: string;
  customer_id: string;
  stage: 'new' | 'qualified' | 'converted' | 'lost';
  source: string;
  interest: string | null;
  follow_up_at: string | null;
  last_activity: string;
  created_at?: string;
}

export interface Reservation {
  id: string;
  business_id: string;
  customer_id: string;
  party_size: number;
  reserved_date: string;
  reserved_time: string;
  table_number: number | null;
  occasion: string | null;
  special_notes: string | null;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no-show';
  reminder_sent: boolean;
  created_at?: string;
  updated_at?: string;
  customers?: Customer;
}

export interface Order {
  id: string;
  business_id: string;
  customer_id: string;
  order_type: string;
  items: any[] | null;
  total_amount: number;
  status: string;
  payment_status: string;
  payment_link: string | null;
  delivery_addr: string | null;
  lead_stage: string;
  metadata: Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
}

export interface Ticket {
  id: string;
  business_id: string;
  customer_id: string;
  issue: string;
  category: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'escalated' | 'resolved' | 'closed';
  created_at?: string;
  updated_at?: string;
  customers?: Customer;
}

export interface Message {
  id: string;
  business_id: string;
  customer_id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  intent: string | null;
  wa_message_id: string | null;
  ai_response: Record<string, any> | null;
  created_at?: string;
}

export interface Reminder {
  id: string;
  business_id: string;
  customer_id: string;
  reservation_id: string | null;
  message: string;
  scheduled_at: string;
  sent: boolean;
  sent_at: string | null;
  created_at?: string;
  customers?: Customer;
}

export interface AutoReply {
  id: string;
  business_id: string;
  keyword: string;
  response: string;
  matchType: 'exact' | 'startsWith' | 'contains';
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardStats {
  totalCustomers: number;
  pipeline: Record<'new' | 'qualified' | 'converted' | 'lost', number>;
  confirmedReservations: number;
  openTickets: number;
}
