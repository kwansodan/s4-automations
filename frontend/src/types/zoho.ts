export interface ZohoContact {
  contact_id: string;
  contact_name: string;
  company_name: string;
  email?: string;
  phone?: string;
}

export interface ZohoItem {
  item_id: string;
  name: string;
  rate: number;
  description: string;
}

export interface ZohoCatalogData {
  contacts_count: number;
  items_count: number;
  contacts: ZohoContact[];
  items: ZohoItem[];
}
