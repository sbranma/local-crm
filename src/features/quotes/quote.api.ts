import { invoke } from "@tauri-apps/api/core";
import type { Quote, QuoteInput, QuoteStatus } from "./quote.types";

export function createQuote(input: QuoteInput): Promise<Quote> {
  return invoke<Quote>("create_quote", { input });
}

export function listQuotes(): Promise<Quote[]> {
  return invoke<Quote[]>("list_quotes");
}

export function getQuote(id: number): Promise<Quote> {
  return invoke<Quote>("get_quote", { id });
}

export function updateQuote(id: number, input: QuoteInput): Promise<Quote> {
  return invoke<Quote>("update_quote", { id, input });
}

export function setQuoteStatus(id: number, status: QuoteStatus): Promise<Quote> {
  return invoke<Quote>("set_quote_status", { id, status });
}

export function deleteQuote(id: number): Promise<void> {
  return invoke<void>("delete_quote", { id });
}

export function saveQuotePdf(path: string, bytes: number[]): Promise<void> {
  return invoke<void>("save_quote_pdf", { path, bytes });
}
