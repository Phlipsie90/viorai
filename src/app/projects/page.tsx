"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import { localCustomerRepository } from "@/features/customers/repository";
import { localProjectRepository, type ProjectDraft } from "@/features/projects/repository";
import type { Customer, Project } from "@/types";

interface ProjectFormValues {
  customerId: string;
  name: string;
  siteAddress: string;
  runtimeMonths: number;
  startDate: string;
  description: string;
}

const EMPTY_FORM_VALUES: ProjectFormValues = {
  customerId: "",
  name: "",
  siteAddress: "",
  runtimeMonths: 3,
  startDate: "",
  description: "",
};

function toFormValues(project: Project): ProjectFormValues {
  return {
    customerId: project.customerId,
    name: project.name,
    siteAddress: project.siteAddress ?? project.location,
    runtimeMonths: parseRuntimeMonths(project.runtimeLabel),
    startDate: project.startDate ?? "",
    description: project.description ?? "",
  };
}

function parseRuntimeMonths(runtimeLabel?: string): number {
  if (!runtimeLabel) {
    return 3;
  }

  const match = runtimeLabel.match(/\d+/);
  return match ? Math.max(1, Number(match[0]) || 3) : 3;
}

function toRuntimeLabel(runtimeMonths: number): string {
  const safeMonths = Math.max(1, Math.floor(runtimeMonths || 1));
  return `${safeMonths} Monat${safeMonths === 1 ? "" : "e"}`;
}

function toProjectDraft(formValues: ProjectFormValues): ProjectDraft {
  return {
    customerId: formValues.customerId,
    name: formValues.name,
    location: formValues.siteAddress,
    siteAddress: formValues.siteAddress,
    description: formValues.description,
    startDate: formValues.startDate,
    endDate: "",
    runtimeLabel: toRuntimeLabel(formValues.runtimeMonths),
  };
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<ProjectFormValues>(EMPTY_FORM_VALUES);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      const [projectsResult, customersResult, selectedProjectIdResult] = await Promise.allSettled([
        localProjectRepository.list(),
        localCustomerRepository.list(),
        localProjectRepository.getSelectedProjectId(),
      ]);

      if (!isMounted) {
        return;
      }

      if (projectsResult.status === "fulfilled") {
        setProjects(projectsResult.value);
      } else {
        setProjects([]);
      }

      if (customersResult.status === "fulfilled") {
        setCustomers(customersResult.value);
        if (customersResult.value.length > 0) {
          setFormValues((prev) => {
            const currentCustomerStillExists = customersResult.value.some((customer) => customer.id === prev.customerId);
            return {
              ...prev,
              customerId: currentCustomerStillExists ? prev.customerId : customersResult.value[0].id,
            };
          });
        } else {
          setFormValues((prev) => ({
            ...prev,
            customerId: "",
          }));
        }
      } else {
        setCustomers([]);
      }

      if (selectedProjectIdResult.status === "fulfilled") {
        setSelectedProjectId(selectedProjectIdResult.value);
      } else {
        setSelectedProjectId(null);
      }

      const errors = [
        projectsResult.status === "rejected" ? projectsResult.reason : null,
        customersResult.status === "rejected" ? customersResult.reason : null,
        selectedProjectIdResult.status === "rejected" ? selectedProjectIdResult.reason : null,
      ].filter(Boolean);

      if (errors.length > 0) {
        const firstError = errors[0];
        if (firstError instanceof Error) {
          setFormError(firstError.message);
        } else {
          setFormError("Projektdaten konnten nicht geladen werden.");
        }
      } else {
        setFormError(null);
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const customerNameById = useMemo(() => {
    return new Map(customers.map((customer) => [customer.id, customer.companyName]));
  }, [customers]);

  const editingProject = useMemo(
    () => projects.find((project) => project.id === editingProjectId) ?? null,
    [projects, editingProjectId]
  );

  const handleStartCreate = () => {
    setEditingProjectId(null);
    setFormValues({
      ...EMPTY_FORM_VALUES,
      customerId: customers[0]?.id ?? "",
    });
    setFormError(null);
  };

  const handleStartEdit = (project: Project) => {
    setEditingProjectId(project.id);
    setFormValues(toFormValues(project));
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (formValues.customerId.trim().length === 0) {
      setFormError("Kunde muss ausgewählt sein.");
      return;
    }

    if (formValues.name.trim().length === 0) {
      setFormError("Projektname ist ein Pflichtfeld.");
      return;
    }

    if (formValues.siteAddress.trim().length === 0) {
      setFormError("Baustellenadresse ist ein Pflichtfeld.");
      return;
    }

    setFormError(null);
    setIsSaving(true);

    try {
      if (editingProjectId) {
        await localProjectRepository.update(editingProjectId, toProjectDraft(formValues));
      } else {
        const createdProject = await localProjectRepository.create(toProjectDraft(formValues));
        await localProjectRepository.setSelectedProjectId(createdProject.id);
        setSelectedProjectId(createdProject.id);
      }

      const refreshed = await localProjectRepository.list();
      setProjects(refreshed);

      if (!editingProjectId) {
        setFormValues({
          ...EMPTY_FORM_VALUES,
          customerId: customers[0]?.id ?? "",
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        setFormError(error.message);
      } else {
        setFormError("Projekt konnte nicht gespeichert werden.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenInPlanner = async (projectId: string) => {
    await localProjectRepository.setSelectedProjectId(projectId);
    setSelectedProjectId(projectId);
    router.push("/planner");
  };

  const formTitle = editingProject ? `Projekt bearbeiten: ${editingProject.name}` : "Neues Angebot anlegen";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projekte"
        description="Angebote und Projekte anlegen, bearbeiten und im Angebotseditor öffnen."
        action={<Button onClick={handleStartCreate}>+ Neues Angebot anlegen</Button>}
      />

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 grid grid-cols-6 gap-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
          <span>Projektname</span>
          <span>Kunde</span>
          <span>Baustellenadresse</span>
          <span>Start</span>
          <span>Laufzeit</span>
          <span>Aktionen</span>
        </div>

        {projects.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">Noch keine Projekte angelegt.</div>
        ) : (
          <ul>
            {projects.map((project) => {
              const isSelected = selectedProjectId === project.id;
              return (
                <li
                  key={project.id}
                  className="px-5 py-3 border-b border-slate-100 last:border-b-0 grid grid-cols-6 gap-3 items-center"
                >
                  <span className="text-sm font-medium text-slate-800">{project.name}</span>
                  <span className="text-sm text-slate-600">{customerNameById.get(project.customerId) ?? "Unbekannt"}</span>
                  <span className="text-sm text-slate-600">{project.siteAddress ?? project.location}</span>
                  <span className="text-sm text-slate-600">{project.startDate || "-"}</span>
                  <span className="text-sm text-slate-600">{project.runtimeLabel || "-"}</span>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => handleStartEdit(project)}>
                      Bearbeiten
                    </Button>
                    <Button size="sm" variant={isSelected ? "primary" : "ghost"} onClick={() => handleOpenInPlanner(project.id)}>
                      {isSelected ? "Im Angebotseditor geöffnet" : "Im Angebotseditor öffnen"}
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

        {customers.length === 0 ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Bitte zuerst einen Kunden unter /customers anlegen.
          </p>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="customerId" className="block text-sm font-medium text-slate-700 mb-1">
                Kunde *
              </label>
              <select
                id="customerId"
                value={formValues.customerId}
                onChange={(event) => setFormValues((prev) => ({ ...prev, customerId: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.companyName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
                Projektname *
              </label>
              <input
                id="name"
                type="text"
                value={formValues.name}
                onChange={(event) => setFormValues((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="siteAddress" className="block text-sm font-medium text-slate-700 mb-1">
                Baustellenadresse *
              </label>
              <textarea
                id="siteAddress"
                rows={3}
                value={formValues.siteAddress}
                onChange={(event) => setFormValues((prev) => ({ ...prev, siteAddress: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="runtimeMonths" className="block text-sm font-medium text-slate-700 mb-1">
                  Geplante Laufzeit (Monate)
                </label>
                <input
                  id="runtimeMonths"
                  type="number"
                  min={1}
                  value={formValues.runtimeMonths}
                  onChange={(event) =>
                    setFormValues((prev) => ({
                      ...prev,
                      runtimeMonths: Math.max(1, Number(event.target.value) || 1),
                    }))
                  }
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="startDate" className="block text-sm font-medium text-slate-700 mb-1">
                  Geplanter Starttermin
                </label>
                <input
                  id="startDate"
                  type="date"
                  value={formValues.startDate}
                  onChange={(event) => setFormValues((prev) => ({ ...prev, startDate: event.target.value }))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1">
                Notizen
              </label>
              <textarea
                id="description"
                rows={4}
                value={formValues.description}
                onChange={(event) => setFormValues((prev) => ({ ...prev, description: event.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Speichern..." : editingProjectId ? "Änderungen speichern" : "Projekt anlegen"}
              </Button>

              {editingProjectId && (
                <Button type="button" variant="ghost" onClick={handleStartCreate}>
                  Abbrechen
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
