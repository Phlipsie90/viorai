"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import { localCustomerRepository } from "@/features/customers/repository";
import { localQuoteRepository } from "@/features/quotes/repository";
import type { Quote } from "@/features/quotes/types";
import type { Customer } from "@/types";

interface CustomerFormValues {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  billingAddress: string;
  notes: string;
}

const EMPTY_FORM_VALUES: CustomerFormValues = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  billingAddress: "",
  notes: "",
};

function toFormValues(customer: Customer): CustomerFormValues {
  return {
    companyName: customer.companyName,
    contactName: customer.contactName ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    address: customer.address ?? "",
    billingAddress: customer.billingAddress ?? "",
    notes: customer.notes ?? "",
  };
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<CustomerFormValues>(EMPTY_FORM_VALUES);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        const [savedCustomers, savedSelectedCustomerId, savedQuotes] = await Promise.all([
          localCustomerRepository.list(),
          localCustomerRepository.getSelectedCustomerId(),
          localQuoteRepository.getAllQuotes(),
        ]);

        if (!isMounted) {
          return;
        }

        setCustomers(savedCustomers);
        setSelectedCustomerId(savedSelectedCustomerId);
        setQuotes(savedQuotes);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        if (error instanceof Error) {
          setFormError(error.message);
        } else {
          setFormError("Kundendaten konnten nicht geladen werden.");
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredCustomers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    if (normalizedQuery.length === 0) {
      return customers;
    }

    return customers.filter((customer) => customer.companyName.toLowerCase().includes(normalizedQuery));
  }, [customers, searchQuery]);

  const editingCustomer = useMemo(
    () => customers.find((customer) => customer.id === editingCustomerId) ?? null,
    [customers, editingCustomerId]
  );
  const profileCustomerId = editingCustomerId ?? selectedCustomerId;
  const customerQuotes = useMemo(
    () =>
      quotes
        .filter((quote) => quote.customerId === profileCustomerId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [profileCustomerId, quotes]
  );

  const handleStartCreate = () => {
    setEditingCustomerId(null);
    setFormValues(EMPTY_FORM_VALUES);
    setFormError(null);
  };

  const handleStartEdit = (customer: Customer) => {
    setEditingCustomerId(customer.id);
    setFormValues(toFormValues(customer));
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (formValues.companyName.trim().length === 0) {
      setFormError("Firmenname ist ein Pflichtfeld.");
      return;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      if (editingCustomerId) {
        await localCustomerRepository.update(editingCustomerId, formValues);
      } else {
        await localCustomerRepository.create(formValues);
      }

      const [refreshedCustomers, refreshedQuotes] = await Promise.all([
        localCustomerRepository.list(),
        localQuoteRepository.getAllQuotes(),
      ]);
      setCustomers(refreshedCustomers);
      setQuotes(refreshedQuotes);

      if (!editingCustomerId) {
        setFormValues(EMPTY_FORM_VALUES);
      }
    } catch (error) {
      if (error instanceof Error) {
        setFormError(error.message);
      } else {
        setFormError("Speichern fehlgeschlagen.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectCustomer = async (customerId: string) => {
    setSelectedCustomerId(customerId);
    await localCustomerRepository.setSelectedCustomerId(customerId);
  };

  const formTitle = editingCustomer ? `Kunde bearbeiten: ${editingCustomer.companyName}` : "Neuen Kunden anlegen";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kunden"
        description="Kunden anlegen, bearbeiten und für spätere Projektzuweisung auswählen."
        action={<Button onClick={handleStartCreate}>+ Neuen Kunden anlegen</Button>}
      />

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <label htmlFor="customer-search" className="block text-sm font-medium text-slate-700 mb-2">
          Suche nach Firmenname
        </label>
        <input
          id="customer-search"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="z. B. Musterkunde GmbH"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 grid grid-cols-5 gap-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
          <span>Firma</span>
          <span>Ansprechpartner</span>
          <span>E-Mail</span>
          <span>Telefon</span>
          <span>Aktionen</span>
        </div>

        {filteredCustomers.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">Keine passenden Kunden gefunden.</div>
        ) : (
          <ul>
            {filteredCustomers.map((customer) => {
              const isSelected = selectedCustomerId === customer.id;

              return (
                <li
                  key={customer.id}
                  className="px-5 py-3 border-b border-slate-100 last:border-b-0 grid grid-cols-5 gap-3 items-center"
                >
                  <span className="text-sm font-medium text-slate-800">{customer.companyName}</span>
                  <span className="text-sm text-slate-600">{customer.contactName ?? "-"}</span>
                  <span className="text-sm text-slate-600">{customer.email ?? "-"}</span>
                  <span className="text-sm text-slate-600">{customer.phone ?? "-"}</span>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => handleStartEdit(customer)}>
                      Bearbeiten
                    </Button>
                    <Button size="sm" variant={isSelected ? "primary" : "ghost"} onClick={() => handleSelectCustomer(customer.id)}>
                      {isSelected ? "Ausgewählt" : "Auswählen"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <h3 className="text-base font-semibold text-slate-800 mb-4">{formTitle}</h3>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="companyName" className="block text-sm font-medium text-slate-700 mb-1">
              Firmenname *
            </label>
            <input
              id="companyName"
              type="text"
              value={formValues.companyName}
              onChange={(event) => setFormValues((prev) => ({ ...prev, companyName: event.target.value }))}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="contactName" className="block text-sm font-medium text-slate-700 mb-1">
                Ansprechpartner
              </label>
              <input
                id="contactName"
                type="text"
                value={formValues.contactName}
                onChange={(event) => setFormValues((prev) => ({ ...prev, contactName: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
                Telefon
              </label>
              <input
                id="phone"
                type="tel"
                value={formValues.phone}
                onChange={(event) => setFormValues((prev) => ({ ...prev, phone: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                E-Mail
              </label>
              <input
                id="email"
                type="email"
                value={formValues.email}
                onChange={(event) => setFormValues((prev) => ({ ...prev, email: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="address" className="block text-sm font-medium text-slate-700 mb-1">
              Adresse
            </label>
            <textarea
              id="address"
              rows={3}
              value={formValues.address}
              onChange={(event) => setFormValues((prev) => ({ ...prev, address: event.target.value }))}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="billingAddress" className="block text-sm font-medium text-slate-700 mb-1">
              Rechnungsadresse
            </label>
            <textarea
              id="billingAddress"
              rows={3}
              value={formValues.billingAddress}
              onChange={(event) => setFormValues((prev) => ({ ...prev, billingAddress: event.target.value }))}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-slate-700 mb-1">
              Notizen
            </label>
            <textarea
              id="notes"
              rows={3}
              value={formValues.notes}
              onChange={(event) => setFormValues((prev) => ({ ...prev, notes: event.target.value }))}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Speichern..." : editingCustomerId ? "Änderungen speichern" : "Kunden anlegen"}
            </Button>

            {editingCustomerId && (
              <Button type="button" variant="ghost" onClick={handleStartCreate}>
                Abbrechen
              </Button>
            )}
          </div>
        </form>
      </div>

      {profileCustomerId && (
        <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
          <h3 className="text-base font-semibold text-slate-800">Angebotshistorie</h3>
          {customerQuotes.length === 0 ? (
            <p className="text-sm text-slate-500">Für diesen Kunden sind noch keine Angebote gespeichert.</p>
          ) : (
            <ul className="space-y-2">
              {customerQuotes.map((quote) => (
                <li key={quote.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-slate-800">{quote.number ?? "Ohne Nummer"}</div>
                    <div className="text-slate-500">{formatCustomerHistoryDate(quote.updatedAt)}</div>
                  </div>
                  <div className="text-slate-700">{quote.pricing.netTotal.toFixed(2)} EUR</div>
                  <div className="text-slate-700">{quote.status}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatCustomerHistoryDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}
