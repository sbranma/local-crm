export type CurrencyCode = "CRC" | "USD" | "EUR";

export type BusinessSettings = {
  businessName: string;
  identification: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: CurrencyCode;
  defaultTaxBasisPoints: number;
  defaultValidityDays: number;
  terms: string | null;
  logoMimeType: string | null;
  logoData: number[] | null;
  updatedAt: string;
};

export type LogoInput = {
  mimeType: string;
  data: number[];
};

export type BusinessSettingsInput = {
  businessName: string;
  identification: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: CurrencyCode;
  defaultTaxBasisPoints: number;
  defaultValidityDays: number;
  terms: string | null;
  logo: LogoInput | null;
  removeLogo: boolean;
};
