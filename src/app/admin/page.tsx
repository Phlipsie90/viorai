"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import TowerTemplateSettings from "@/components/admin/TowerTemplateSettings";
import { companySettingsRepository } from "@/features/company-settings/repository";
import type { CompanySettingsDraft } from "@/features/company-settings/types";
import {
  getDefaultLineItemsForServiceType,
  QUOTE_SERVICE_TYPE_LABELS,
  QUOTE_SERVICE_TYPE_OPTIONS,
  type QuoteServiceType,
} from "@/features/quotes/service-types";
import { createLineItem } from "@/lib/pricing/calculator";
import type { QuoteLineItem } from "@/types";

const DEFAULT_SETTINGS: CompanySettingsDraft = {
  companyName: "",
  logoUrl: "",
  letterhead: "",
  footer: "",
  address: "",
  contactPerson: "",
  email: "",
  phone: "",
  website: "",
  paymentTerms: "",
  defaultValidityDays: 14,
  legalTermsText: "",
  standardRuntimeMonths: 3,
  paymentDueDays: 14,
  vatRate: 0.19,
  currency: "EUR",
  introText: "",
  closingText: "",
  offerTextTemplates: {},
  aiPromptHints: {},
  primaryColor: "#2563eb",
  secondaryColor: "#0f172a",
  pricingTemplates: {},
};

const OFFER_TEXT_SERVICE_TYPES: QuoteServiceType[] = [
  "baustellenueberwachung",
  "objektschutz",
  "revierdienst",
  "empfangsdienst",
  "werkschutz",
  "intervention",
  "leitstelle",
];

export default function AdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeArea = searchParams.get("bereich") === "admin" ? "admin" : "voreinstellungen";
  const [formValues, setFormValues] = useState<CompanySettingsDraft>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialSetup, setIsInitialSetup] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftTemplateItems, setDraftTemplateItems] = useState<Partial<Record<QuoteServiceType, QuoteLineItem[]>>>({});
  const [editingTemplateItems, setEditingTemplateItems] = useState<Partial<Record<QuoteServiceType, Record<string, QuoteLineItem>>>>({});
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const settings = await companySettingsRepository.get();
        if (!isMounted) {
          return;
        }

        if (settings) {
          setIsInitialSetup(false);
          setFormValues({
            companyName: settings.companyName,
            logoUrl: settings.logoUrl ?? "",
            letterhead: settings.letterhead ?? "",
            footer: settings.footer ?? "",
            address: settings.address ?? "",
            contactPerson: settings.contactPerson ?? "",
            email: settings.email ?? "",
            phone: settings.phone ?? "",
            website: settings.website ?? "",
            paymentTerms: settings.paymentTerms ?? "",
            defaultValidityDays: settings.defaultValidityDays ?? 14,
            legalTermsText: settings.legalTermsText ?? "",
            standardRuntimeMonths: settings.standardRuntimeMonths ?? 3,
            paymentDueDays: inferPaymentDueDays(settings.paymentTerms),
            vatRate: settings.vatRate,
            currency: settings.currency ?? "EUR",
            introText: settings.introText ?? "",
            closingText: settings.closingText ?? "",
            offerTextTemplates: settings.offerTextTemplates ?? {},
            aiPromptHints: settings.aiPromptHints ?? {},
            primaryColor: settings.primaryColor ?? "#2563eb",
            secondaryColor: settings.secondaryColor ?? "#0f172a",
            pricingTemplates: ensurePricingTemplates(settings.pricingTemplates),
          });
        } else {
          setIsInitialSetup(true);
          setFormValues(DEFAULT_SETTINGS);
        }
      } catch (loadError) {
        if (!isMounted) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Firmeneinstellungen konnten nicht geladen werden.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogoSelection = async (file: File) => {
    const dataUrl = await fileToDataUrl(file);
    setFormValues((prev) => ({
      ...prev,
      logoUrl: dataUrl,
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      await companySettingsRepository.update({
        ...formValues,
        paymentTerms: resolvePaymentTerms(formValues),
        pricingTemplates: ensurePricingTemplates(formValues.pricingTemplates),
      });
      setMessage("Firmeneinstellungen gespeichert.");
      if (isInitialSetup) {
        router.replace("/dashboard");
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Speichern fehlgeschlagen.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavedTemplateFieldChange = (
    serviceType: QuoteServiceType,
    itemId: string,
    field: "label" | "quantity" | "unit" | "unitPrice",
    value: string
  ) => {
    setFormValues((prev) => ({
      ...prev,
      pricingTemplates: {
        ...prev.pricingTemplates,
        [serviceType]: (prev.pricingTemplates[serviceType] ?? []).map((item) =>
          item.id !== itemId
            ? item
            : {
                ...item,
                [field]:
                  field === "quantity" || field === "unitPrice"
                    ? Math.max(0, Number(value) || 0)
                    : value,
                totalPrice:
                  field === "quantity"
                    ? Math.max(0, Number(value) || 0) * item.unitPrice
                    : field === "unitPrice"
                      ? item.quantity * Math.max(0, Number(value) || 0)
                      : item.totalPrice,
              }
        ),
      },
    }));
  };

  const handleDraftTemplateFieldChange = (
    serviceType: QuoteServiceType,
    itemId: string,
    field: "label" | "quantity" | "unit" | "unitPrice",
    value: string
  ) => {
    setDraftTemplateItems((prev) => ({
      ...prev,
      [serviceType]: (prev[serviceType] ?? []).map((item) =>
        item.id !== itemId
          ? item
          : {
              ...item,
              [field]:
                field === "quantity" || field === "unitPrice"
                  ? Math.max(0, Number(value) || 0)
                  : value,
              totalPrice:
                field === "quantity"
                  ? Math.max(0, Number(value) || 0) * item.unitPrice
                  : field === "unitPrice"
                    ? item.quantity * Math.max(0, Number(value) || 0)
                    : item.totalPrice,
            }
      ),
    }));
  };

  const handleAddTemplateItem = (serviceType: QuoteServiceType) => {
    setDraftTemplateItems((prev) => ({
      ...prev,
      [serviceType]: [
        ...(prev[serviceType] ?? []),
        createLineItem({
          type: "custom",
          label: "Neue Position",
          quantity: 1,
          unit: "Stk",
          unitPrice: 0,
          billingMode: "one_time",
          interval: "once",
          category: "custom",
        }),
      ],
    }));
  };

  const handleSaveDraftTemplateItem = (serviceType: QuoteServiceType, itemId: string) => {
    const draftItem = (draftTemplateItems[serviceType] ?? []).find((item) => item.id === itemId);
    if (!draftItem) {
      return;
    }

    setFormValues((prev) => ({
      ...prev,
      pricingTemplates: {
        ...prev.pricingTemplates,
        [serviceType]: [...(prev.pricingTemplates[serviceType] ?? []), draftItem],
      },
    }));
    setDraftTemplateItems((prev) => ({
      ...prev,
      [serviceType]: (prev[serviceType] ?? []).filter((item) => item.id !== itemId),
    }));
  };

  const handleCancelDraftTemplateItem = (serviceType: QuoteServiceType, itemId: string) => {
    setDraftTemplateItems((prev) => ({
      ...prev,
      [serviceType]: (prev[serviceType] ?? []).filter((item) => item.id !== itemId),
    }));
  };

  const handleStartEditTemplateItem = (serviceType: QuoteServiceType, item: QuoteLineItem) => {
    setEditingTemplateItems((prev) => ({
      ...prev,
      [serviceType]: {
        ...(prev[serviceType] ?? {}),
        [item.id]: { ...item },
      },
    }));
  };

  const handleEditingTemplateFieldChange = (
    serviceType: QuoteServiceType,
    itemId: string,
    field: "label" | "quantity" | "unit" | "unitPrice",
    value: string
  ) => {
    setEditingTemplateItems((prev) => {
      const current = prev[serviceType]?.[itemId];
      if (!current) {
        return prev;
      }

      const nextValue =
        field === "quantity" || field === "unitPrice"
          ? Math.max(0, Number(value) || 0)
          : value;

      const nextItem: QuoteLineItem = {
        ...current,
        [field]: nextValue,
        totalPrice:
          field === "quantity"
            ? Math.max(0, Number(value) || 0) * current.unitPrice
            : field === "unitPrice"
              ? current.quantity * Math.max(0, Number(value) || 0)
              : current.totalPrice,
      };

      return {
        ...prev,
        [serviceType]: {
          ...(prev[serviceType] ?? {}),
          [itemId]: nextItem,
        },
      };
    });
  };

  const handleSaveEditedTemplateItem = (serviceType: QuoteServiceType, itemId: string) => {
    const editingItem = editingTemplateItems[serviceType]?.[itemId];
    if (!editingItem) {
      return;
    }

    setFormValues((prev) => ({
      ...prev,
      pricingTemplates: {
        ...prev.pricingTemplates,
        [serviceType]: (prev.pricingTemplates[serviceType] ?? []).map((item) =>
          item.id === itemId ? editingItem : item
        ),
      },
    }));
    setEditingTemplateItems((prev) => {
      const nextServiceState = { ...(prev[serviceType] ?? {}) };
      delete nextServiceState[itemId];
      return {
        ...prev,
        [serviceType]: nextServiceState,
      };
    });
  };

  const handleCancelEditTemplateItem = (serviceType: QuoteServiceType, itemId: string) => {
    setEditingTemplateItems((prev) => {
      const nextServiceState = { ...(prev[serviceType] ?? {}) };
      delete nextServiceState[itemId];
      return {
        ...prev,
        [serviceType]: nextServiceState,
      };
    });
  };

  const handleRemoveTemplateItem = (serviceType: QuoteServiceType, itemId: string) => {
    setFormValues((prev) => ({
      ...prev,
      pricingTemplates: {
        ...prev.pricingTemplates,
        [serviceType]: (prev.pricingTemplates[serviceType] ?? []).filter((item) => item.id !== itemId),
      },
    }));
  };

  const handleResetTemplate = (serviceType: QuoteServiceType) => {
    setFormValues((prev) => ({
      ...prev,
      pricingTemplates: {
        ...prev.pricingTemplates,
        [serviceType]: getDefaultLineItemsForServiceType(serviceType),
      },
    }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={activeArea === "admin" ? "Admin" : "Voreinstellungen"}
        description={
          activeArea === "admin"
            ? "Firmendaten, Branding und technische Stammdaten."
            : "Standardpreise, Standardtexte und Angebots-Defaults."
        }
      />

      <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
        {isLoading ? (
          <p className="text-sm text-slate-500">Lade Firmeneinstellungen...</p>
        ) : (
          <>
            {activeArea === "admin" && (
              <div>
              <label htmlFor="companyName" className="block text-sm font-medium text-slate-700 mb-1">
                Firmenname *
              </label>
              <input
                id="companyName"
                type="text"
                value={formValues.companyName}
                onChange={(event) => setFormValues((prev) => ({ ...prev, companyName: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              </div>
            )}

            {activeArea === "admin" && (
              <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Firmenlogo</p>
              <div className="flex items-center gap-3">
                <Button type="button" variant="secondary" onClick={() => logoInputRef.current?.click()}>
                  Logo auswählen
                </Button>
                {formValues.logoUrl && <span className="text-xs text-slate-500">Logo gesetzt</span>}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={async (event) => {
                  const inputElement = event.currentTarget;
                  const file = event.target.files?.[0];
                  if (file) {
                    await handleLogoSelection(file);
                  }
                  inputElement.value = "";
                }}
              />
              {formValues.logoUrl && (
                <div className="border border-slate-200 rounded p-2 inline-block">
                  <img src={formValues.logoUrl} alt="Firmenlogo" className="h-12 w-auto" />
                </div>
              )}
              </div>
            )}

            <div>
              <label htmlFor="letterhead" className="block text-sm font-medium text-slate-700 mb-1">
                Briefkopf
              </label>
              <textarea
                id="letterhead"
                rows={3}
                value={formValues.letterhead}
                onChange={(event) => setFormValues((prev) => ({ ...prev, letterhead: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="footer" className="block text-sm font-medium text-slate-700 mb-1">
                Fußzeile
              </label>
              <textarea
                id="footer"
                rows={3}
                value={formValues.footer}
                onChange={(event) => setFormValues((prev) => ({ ...prev, footer: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="address" className="block text-sm font-medium text-slate-700 mb-1">
                Firmenadresse
              </label>
              <textarea
                id="address"
                rows={2}
                value={formValues.address}
                onChange={(event) => setFormValues((prev) => ({ ...prev, address: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="contactPerson" className="block text-sm font-medium text-slate-700 mb-1">
                  Ansprechpartner
                </label>
                <input
                  id="contactPerson"
                  type="text"
                  value={formValues.contactPerson}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, contactPerson: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                  E-Mail
                </label>
                <input
                  id="email"
                  type="email"
                  value={formValues.email}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, email: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
                  Telefon
                </label>
                <input
                  id="phone"
                  type="text"
                  value={formValues.phone}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, phone: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="website" className="block text-sm font-medium text-slate-700 mb-1">
                  Website
                </label>
                <input
                  id="website"
                  type="text"
                  value={formValues.website}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, website: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="standardRuntimeMonths" className="block text-sm font-medium text-slate-700 mb-1">
                Standardlaufzeit (Monate)
              </label>
              <input
                id="standardRuntimeMonths"
                type="number"
                min={1}
                step={1}
                value={formValues.standardRuntimeMonths}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    standardRuntimeMonths: Math.max(1, Number(event.target.value) || 1),
                  }))
                }
                className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="paymentTerms" className="block text-sm font-medium text-slate-700 mb-1">
                Standard-Zahlungsbedingungen
              </label>
              <textarea
                id="paymentTerms"
                rows={2}
                value={formValues.paymentTerms}
                onChange={(event) => setFormValues((prev) => ({ ...prev, paymentTerms: event.target.value }))}
                placeholder="Zahlbar innerhalb von 14 Tagen ohne Abzug."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="defaultValidityDays" className="block text-sm font-medium text-slate-700 mb-1">
                  Standard-Angebotsgültigkeit (Tage)
                </label>
                <input
                  id="defaultValidityDays"
                  type="number"
                  min={1}
                  step={1}
                  value={formValues.defaultValidityDays}
                  onChange={(event) =>
                    setFormValues((prev) => ({
                      ...prev,
                      defaultValidityDays: Math.max(1, Number(event.target.value) || 1),
                    }))
                  }
                  className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="legalTermsText" className="block text-sm font-medium text-slate-700 mb-1">
                AGB-/Vertrags-/Datenschutztext (PDF)
              </label>
              <textarea
                id="legalTermsText"
                rows={4}
                value={formValues.legalTermsText}
                onChange={(event) => setFormValues((prev) => ({ ...prev, legalTermsText: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="paymentDueDays" className="block text-sm font-medium text-slate-700 mb-1">
                Zahlungsziel in Tagen (optional)
              </label>
              <input
                id="paymentDueDays"
                type="number"
                min={0}
                step={1}
                value={formValues.paymentDueDays ?? 14}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    paymentDueDays: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
                className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="vatRate" className="block text-sm font-medium text-slate-700 mb-1">
                Standard-MwSt (z. B. 0.19)
              </label>
              <input
                id="vatRate"
                type="number"
                min={0}
                step={0.01}
                value={formValues.vatRate}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    vatRate: Number.isFinite(Number(event.target.value)) ? Number(event.target.value) : 0.19,
                  }))
                }
                className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="currency" className="block text-sm font-medium text-slate-700 mb-1">
                Standard-Währung (ISO, z. B. EUR)
              </label>
              <input
                id="currency"
                type="text"
                value={formValues.currency}
                onChange={(event) => setFormValues((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))}
                className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="primaryColor" className="block text-sm font-medium text-slate-700 mb-1">
                Primärfarbe
              </label>
              <input
                id="primaryColor"
                type="color"
                value={formValues.primaryColor}
                onChange={(event) => setFormValues((prev) => ({ ...prev, primaryColor: event.target.value }))}
                className="h-10 w-24 rounded-md border border-slate-300 px-1 py-1 text-sm"
              />
            </div>

            <div>
              <label htmlFor="secondaryColor" className="block text-sm font-medium text-slate-700 mb-1">
                Sekundärfarbe
              </label>
              <input
                id="secondaryColor"
                type="color"
                value={formValues.secondaryColor}
                onChange={(event) => setFormValues((prev) => ({ ...prev, secondaryColor: event.target.value }))}
                className="h-10 w-24 rounded-md border border-slate-300 px-1 py-1 text-sm"
              />
            </div>

            <div>
              <label htmlFor="introText" className="block text-sm font-medium text-slate-700 mb-1">
                Standard-Einleitung
              </label>
              <textarea
                id="introText"
                rows={3}
                value={formValues.introText}
                onChange={(event) => setFormValues((prev) => ({ ...prev, introText: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="closingText" className="block text-sm font-medium text-slate-700 mb-1">
                Standard-Schlussformel
              </label>
              <textarea
                id="closingText"
                rows={3}
                value={formValues.closingText}
                onChange={(event) => setFormValues((prev) => ({ ...prev, closingText: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {activeArea === "voreinstellungen" && (
              <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-slate-700">Standard-Angebotstexte je Leistungsart</h3>
                <p className="text-xs text-slate-500">
                  Diese Texte werden im Angebots-Flow automatisch geladen und können dort weiter bearbeitet werden.
                </p>
              </div>
              <div className="space-y-3">
                {OFFER_TEXT_SERVICE_TYPES.map((serviceType) => (
                  <div key={`offer-text-${serviceType}`} className="rounded-md border border-slate-200 p-3 space-y-2">
                    <label
                      htmlFor={`offerTextTemplate-${serviceType}`}
                      className="block text-sm font-medium text-slate-700"
                    >
                      {getServiceTypeDisplayLabel(serviceType)}
                    </label>
                    <textarea
                      id={`offerTextTemplate-${serviceType}`}
                      rows={3}
                      value={formValues.offerTextTemplates[serviceType] ?? ""}
                      onChange={(event) =>
                        setFormValues((prev) => ({
                          ...prev,
                          offerTextTemplates: {
                            ...prev.offerTextTemplates,
                            [serviceType]: event.target.value,
                          },
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                ))}
              </div>
              </div>
            )}

            {activeArea === "voreinstellungen" && (
              <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-slate-700">Optionale KI-Hinweise je Leistungsart</h3>
                <p className="text-xs text-slate-500">
                  Nur für den Fall einer expliziten KI-Generierung („Mit KI anpassen“ / „Neu generieren“).
                </p>
              </div>
              <div className="space-y-3">
                {OFFER_TEXT_SERVICE_TYPES.map((serviceType) => (
                  <div key={`ai-hint-${serviceType}`} className="rounded-md border border-slate-200 p-3 space-y-2">
                    <label
                      htmlFor={`aiPromptHint-${serviceType}`}
                      className="block text-sm font-medium text-slate-700"
                    >
                      {getServiceTypeDisplayLabel(serviceType)}
                    </label>
                    <textarea
                      id={`aiPromptHint-${serviceType}`}
                      rows={2}
                      value={formValues.aiPromptHints[serviceType] ?? ""}
                      onChange={(event) =>
                        setFormValues((prev) => ({
                          ...prev,
                          aiPromptHints: {
                            ...prev.aiPromptHints,
                            [serviceType]: event.target.value,
                          },
                        }))
                      }
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                ))}
              </div>
              </div>
            )}

            {activeArea === "voreinstellungen" && (
              <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-slate-700">Standardpreise je Leistungsart</h3>
                <p className="text-xs text-slate-500">
                  Die Vorlagen werden direkt im Planer als Standardpositionen verwendet.
                </p>
              </div>

              {QUOTE_SERVICE_TYPE_OPTIONS.map(([serviceType, label]) => {
                const items = formValues.pricingTemplates[serviceType] ?? [];
                const draftItems = draftTemplateItems[serviceType] ?? [];
                return (
                  <div key={serviceType} className="rounded-md border border-slate-200 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-slate-800">{label}</h4>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => handleResetTemplate(serviceType)}>
                          Standard laden
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => handleAddTemplateItem(serviceType)}>
                          Position hinzufügen
                        </Button>
                      </div>
                    </div>

                    {items.length === 0 && draftItems.length === 0 ? (
                      <p className="text-sm text-slate-500">Noch keine Positionen hinterlegt.</p>
                    ) : (
                      <div className="space-y-3">
                        {items.map((item) => (
                          (() => {
                            const editingItem = editingTemplateItems[serviceType]?.[item.id];
                            return editingItem ? (
                              <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end rounded border border-amber-200 bg-amber-50 p-3">
                                <div className="md:col-span-5">
                                  <label className="block text-xs font-medium text-slate-600 mb-1">Bezeichnung</label>
                                  <input
                                    type="text"
                                    value={editingItem.label}
                                    onChange={(event) => handleEditingTemplateFieldChange(serviceType, item.id, "label", event.target.value)}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                  />
                                </div>
                                <div className="md:col-span-2">
                                  <label className="block text-xs font-medium text-slate-600 mb-1">Menge</label>
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={editingItem.quantity}
                                    onChange={(event) => handleEditingTemplateFieldChange(serviceType, item.id, "quantity", event.target.value)}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                  />
                                </div>
                                <div className="md:col-span-2">
                                  <label className="block text-xs font-medium text-slate-600 mb-1">Einheit</label>
                                  <input
                                    type="text"
                                    value={editingItem.unit}
                                    onChange={(event) => handleEditingTemplateFieldChange(serviceType, item.id, "unit", event.target.value)}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                  />
                                </div>
                                <div className="md:col-span-1">
                                  <label className="block text-xs font-medium text-slate-600 mb-1">Einzelpreis</label>
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    value={editingItem.unitPrice}
                                    onChange={(event) => handleEditingTemplateFieldChange(serviceType, item.id, "unitPrice", event.target.value)}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                  />
                                </div>
                                <div className="md:col-span-2 flex gap-2">
                                  <Button type="button" size="sm" variant="secondary" onClick={() => handleSaveEditedTemplateItem(serviceType, item.id)}>
                                    Speichern
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" onClick={() => handleCancelEditTemplateItem(serviceType, item.id)}>
                                    Abbrechen
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end rounded border border-slate-100 p-3">
                                <div className="md:col-span-5">
                                  <label className="block text-xs font-medium text-slate-600 mb-1">Bezeichnung</label>
                                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{item.label}</div>
                                </div>
                                <div className="md:col-span-2">
                                  <label className="block text-xs font-medium text-slate-600 mb-1">Menge</label>
                                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{item.quantity}</div>
                                </div>
                                <div className="md:col-span-2">
                                  <label className="block text-xs font-medium text-slate-600 mb-1">Einheit</label>
                                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{item.unit}</div>
                                </div>
                                <div className="md:col-span-1">
                                  <label className="block text-xs font-medium text-slate-600 mb-1">Einzelpreis</label>
                                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{item.unitPrice.toFixed(2)}</div>
                                </div>
                                <div className="md:col-span-2 flex gap-2">
                                  <Button type="button" size="sm" variant="secondary" onClick={() => handleStartEditTemplateItem(serviceType, item)}>
                                    Bearbeiten
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" onClick={() => handleRemoveTemplateItem(serviceType, item.id)}>
                                    Entfernen
                                  </Button>
                                </div>
                              </div>
                            );
                          })()
                        ))}
                        {draftItems.map((item) => (
                          <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end rounded border border-blue-200 bg-blue-50 p-3">
                            <div className="md:col-span-5">
                              <label className="block text-xs font-medium text-slate-600 mb-1">Bezeichnung</label>
                              <input
                                type="text"
                                value={item.label}
                                onChange={(event) => handleDraftTemplateFieldChange(serviceType, item.id, "label", event.target.value)}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="block text-xs font-medium text-slate-600 mb-1">Menge</label>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={item.quantity}
                                onChange={(event) => handleDraftTemplateFieldChange(serviceType, item.id, "quantity", event.target.value)}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="block text-xs font-medium text-slate-600 mb-1">Einheit</label>
                              <input
                                type="text"
                                value={item.unit}
                                onChange={(event) => handleDraftTemplateFieldChange(serviceType, item.id, "unit", event.target.value)}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="md:col-span-1">
                              <label className="block text-xs font-medium text-slate-600 mb-1">Einzelpreis</label>
                              <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={item.unitPrice}
                                onChange={(event) => handleDraftTemplateFieldChange(serviceType, item.id, "unitPrice", event.target.value)}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="md:col-span-2 flex gap-2">
                              <Button type="button" size="sm" variant="secondary" onClick={() => handleSaveDraftTemplateItem(serviceType, item.id)}>
                                Speichern
                              </Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => handleCancelDraftTemplateItem(serviceType, item.id)}>
                                Abbrechen
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="button" onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Speichern..." : "Firmeneinstellungen speichern"}
              </Button>
              {message && <p className="text-sm text-green-700">{message}</p>}
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </>
        )}
      </section>

      {activeArea === "voreinstellungen" && <TowerTemplateSettings />}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }

      reject(new Error("Logo konnte nicht gelesen werden."));
    };
    reader.onerror = () => reject(new Error("Logo konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function ensurePricingTemplates(
  pricingTemplates?: Partial<Record<QuoteServiceType, QuoteLineItem[]>>
): Partial<Record<QuoteServiceType, QuoteLineItem[]>> {
  const nextTemplates: Partial<Record<QuoteServiceType, QuoteLineItem[]>> = {};

  for (const [serviceType] of QUOTE_SERVICE_TYPE_OPTIONS) {
    const configuredItems = pricingTemplates?.[serviceType];
    nextTemplates[serviceType] =
      configuredItems && configuredItems.length > 0
        ? configuredItems.map((item) => ({
            ...item,
            totalPrice: item.quantity * item.unitPrice,
          }))
        : getDefaultLineItemsForServiceType(serviceType);
  }

  return nextTemplates;
}

function inferPaymentDueDays(paymentTerms?: string): number {
  if (!paymentTerms) {
    return 14;
  }

  const match = paymentTerms.match(/(\d{1,3})\s*Tage/i);
  if (!match) {
    return 14;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 14;
}

function resolvePaymentTerms(draft: CompanySettingsDraft): string {
  const direct = draft.paymentTerms.trim();
  if (direct.length > 0) {
    return direct;
  }

  const days = Number.isFinite(draft.paymentDueDays) ? Math.max(0, Number(draft.paymentDueDays)) : 14;
  return `Zahlbar innerhalb von ${days} Tagen ohne Abzug.`;
}

function getServiceTypeDisplayLabel(serviceType: QuoteServiceType): string {
  if (serviceType === "leitstelle") {
    return "Sicherheitstechnik";
  }

  return QUOTE_SERVICE_TYPE_LABELS[serviceType] ?? serviceType;
}
