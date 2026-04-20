import type { IsoDateTimeString } from "@/types";
import type { QuoteLineItem } from "@/types";
import type { QuoteServiceType } from "@/features/quotes/service-types";

export type CompanyServiceTextMap = Partial<Record<QuoteServiceType, string>>;

export interface CompanySettings {
  id: string;
  tenantId?: string;
  companyName: string;
  logoUrl?: string;
  letterhead?: string;
  footer?: string;
  address?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  website?: string;
  paymentTerms?: string;
  defaultValidityDays?: number;
  legalTermsText?: string;
  standardRuntimeMonths?: number;
  vatRate: number;
  currency: string;
  introText?: string;
  closingText?: string;
  offerTextTemplates?: CompanyServiceTextMap;
  aiPromptHints?: CompanyServiceTextMap;
  primaryColor?: string;
  secondaryColor?: string;
  pricingTemplates?: Partial<Record<QuoteServiceType, QuoteLineItem[]>>;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface CompanySettingsDraft {
  companyName: string;
  logoUrl: string;
  letterhead: string;
  footer: string;
  address: string;
  contactPerson: string;
  email: string;
  phone: string;
  website: string;
  paymentTerms: string;
  defaultValidityDays: number;
  legalTermsText: string;
  standardRuntimeMonths: number;
  paymentDueDays?: number;
  vatRate: number;
  currency: string;
  introText: string;
  closingText: string;
  offerTextTemplates: CompanyServiceTextMap;
  aiPromptHints: CompanyServiceTextMap;
  primaryColor: string;
  secondaryColor: string;
  pricingTemplates: Partial<Record<QuoteServiceType, QuoteLineItem[]>>;
}
