export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export type QuoteItem = {
  id: number;
  inventoryItemId: number | null;
  description: string;
  quantityMillis: number;
  unit: string;
  unitPriceMinor: number;
  totalMinor: number;
};

export type Quote = {
  id: number;
  quoteNumber: string;
  clientId: number;
  clientName: string;
  clientIdentification: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  clientAddress: string | null;
  clientIsArchived: boolean;
  businessName: string;
  businessIdentification: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  businessAddress: string | null;
  currency: string;
  issueDate: string;
  validUntil: string;
  status: QuoteStatus;
  discountBasisPoints: number;
  taxBasisPoints: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  notes: string | null;
  terms: string | null;
  items: QuoteItem[];
  createdAt: string;
  updatedAt: string;
};

export type QuoteItemInput = {
  inventoryItemId: number | null;
  description: string;
  quantityMillis: number;
  unit: string;
  unitPriceMinor: number;
};

export type QuoteInput = {
  clientId: number;
  issueDate: string;
  validUntil: string;
  discountBasisPoints: number;
  taxBasisPoints: number;
  notes: string | null;
  terms: string | null;
  items: QuoteItemInput[];
};
