import { invoke } from "@tauri-apps/api/core";
import type { Client, CreateClientInput } from "./client.types";

export function createClient(input: CreateClientInput): Promise<Client> {
  return invoke<Client>("create_client", { input });
}

export function listClients(): Promise<Client[]> {
  return invoke<Client[]>("list_clients");
}

export function updateClient(
  id: number,
  input: CreateClientInput,
): Promise<Client> {
  return invoke<Client>("update_client", { id, input });
}

export function setClientArchived(
  id: number,
  isArchived: boolean,
): Promise<Client> {
  return invoke<Client>("set_client_archived", { id, isArchived });
}

export function deleteClient(id: number): Promise<void> {
  return invoke<void>("delete_client", { id });
}
