export type Client = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  identification: string | null;
  address: string | null;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateClientInput = {
  name: string;
  phone: string | null;
  email: string | null;
  identification: string | null;
  address: string | null;
  notes: string | null;
};