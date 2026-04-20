"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import PageHeader from "@/components/ui/PageHeader";
import PlannerCanvas from "@/components/planner/PlannerCanvas";
import PlannerToolbar from "@/components/planner/PlannerToolbar";
import PlacedTowersSidebar from "@/components/planner/PlacedTowersSidebar";
import { localCustomerRepository } from "@/features/customers/repository";
import { localProjectRepository } from "@/features/projects/repository";
import { localQuoteRepository } from "@/features/quotes/repository";
import { companySettingsRepository } from "@/features/company-settings/repository";
import { towerTemplateRepository } from "@/features/tower-templates/repository";
import { toPlannerTowerTemplate } from "@/features/tower-templates/types";
import type { Quote as StoredQuote, QuoteStatus } from "@/features/quotes/types";
import type { CompanySettings } from "@/features/company-settings/types";
import type {
  Customer,
  Project,
  QuoteLineItem,
  TowerConnectivityType,
  TowerPowerType,
  TowerSlotCameraType,
  TowerTemplate,
} from "@/types";
import type {
  DayNightMode,
  PlannerAsset,
  PlannerCalibration,
  PlannerPlacedTower,
  PlannerPlacedTowerCameraConfiguration,
  PlannerSelectedCamera,
  PlannerViewState,
} from "@/components/planner/types";
import {
  getPlannerCameraZoneDefaults,
  normalizePlannerCameraConfiguration,
} from "@/components/planner/types";
import {
  getLineItemsForQuickTemplate,
  getQuickTemplateById,
  getQuickTemplatesForServiceType,
  getDefaultLineItemsForServiceType,
  QUOTE_SERVICE_TYPE_LABELS,
  QUOTE_SERVICE_TYPE_OPTIONS,
  type QuoteQuickTemplateId,
  type QuoteServiceType,
} from "@/features/quotes/service-types";
import {
  calculatePixelDistance,
  calculatePixelsPerMeterFromReference,
  calculatePixelsPerMeterFromScale,
} from "@/lib/calibration/calculator";
import {
  calculateQuoteTotals,
  createLineItem,
  createStandardQuoteLineItems,
  DEFAULT_PRICE_CONFIG,
  DEFAULT_STANDARD_ONE_TIME_COSTS,
} from "@/lib/pricing/calculator";
import { buildQuotePdfFileName, downloadPdf, generateQuotePdf } from "@/lib/pdf/generator";
import { getSupabaseClient, getSupabaseUserSafe } from "@/lib/supabase/client";
import { tryResolveTenantContext } from "@/lib/supabase/tenant-context";

// ─── Hilfstabellen für UI-Labels ─────────────────────────────────────────────

const BILLING_MODE_LABELS: Record<string, string> = {
  one_time: "Einmalig",
  recurring: "Wiederkehrend",
};

const INTERVAL_LABELS: Record<string, string> = {
  once: "Einmalig",
  hourly: "Stündlich",
  daily: "Täglich",
  weekly: "Wöchentlich",
  monthly: "Monatlich",
  custom: "Individuell",
};

const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Entwurf",
  sent: "Gesendet",
  accepted: "Angenommen",
  rejected: "Abgelehnt",
};

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "operations", label: "Einsatz" },
  { value: "personell", label: "Personal" },
  { value: "logistics", label: "Logistik" },
  { value: "monitoring", label: "Leitstelle" },
  { value: "connectivity", label: "Konnektivität" },
  { value: "deployment", label: "Inbetriebnahme" },
  { value: "equipment", label: "Ausstattung" },
  { value: "energy", label: "Energie" },
  { value: "optional", label: "Optional" },
  { value: "custom", label: "Individuell" },
];

interface AiGuidanceInput {
  specialContext: string;
  relevantTechnology: string;
  importantServices: string;
  customerNotes: string;
  otherRequirements: string;
}

const EMPTY_AI_GUIDANCE: AiGuidanceInput = {
  specialContext: "",
  relevantTechnology: "",
  importantServices: "",
  customerNotes: "",
  otherRequirements: "",
};

type VideotowerPlanMode = "undecided" | "with-plan" | "without-plan";
type ContractTermMode = "until_revocation" | "indefinite" | "fixed";

const SUPPORTED_PLAN_TYPES = ["image/jpeg", "image/png", "application/pdf"];

interface TemplateTechnicalAddon {
  key: string;
  label: string;
  unitPrice: number;
  billingMode: QuoteLineItem["billingMode"];
  interval: QuoteLineItem["interval"];
  category: string;
  quantity?: number;
  unit?: string;
}

const PLANNER_STATE_STORAGE_PREFIX = "security-suite.planner-state.";

interface SerializedPlannerAsset {
  id: string;
  name: string;
  sourceType: PlannerAsset["sourceType"];
  sourceDataUrl: string;
  width: number;
  height: number;
  calibration: PlannerCalibration;
}

interface SerializedPlannerState {
  currentPlan: SerializedPlannerAsset | null;
  placedTowers: PlannerPlacedTower[];
  selectedTowerTemplateId: string | null;
  dayNightMode: DayNightMode;
}

interface LoadedPlannerAsset {
  image: HTMLImageElement;
  sourceDataUrl: string;
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────────

export default function PlannerPage() {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const quickOfferSectionRef = useRef<HTMLElement | null>(null);
  const snapshotResolverRef = useRef<((value: string | null) => void) | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);
  const [activeQuoteId, setActiveQuoteId] = useState<string | null>(null);
  const [activeQuoteNumber, setActiveQuoteNumber] = useState<string | null>(null);
  const [activeQuoteStatus, setActiveQuoteStatus] = useState<QuoteStatus>("draft");
  const [isProjectContextLoading, setIsProjectContextLoading] = useState(true);
  const [isQuickOfferMode, setIsQuickOfferMode] = useState(false);
  const [didAutoFocusQuickOffer, setDidAutoFocusQuickOffer] = useState(false);
  const [currentPlan, setCurrentPlan] = useState<PlannerAsset | null>(null);
  const [viewState, setViewState] = useState<PlannerViewState>({
    zoomLevel: 1,
    position: { x: 0, y: 0 },
  });
  const [scaleDenominatorInput, setScaleDenominatorInput] = useState("500");
  const [referenceMetersInput, setReferenceMetersInput] = useState("10");
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [placedTowers, setPlacedTowers] = useState<PlannerPlacedTower[]>([]);
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<PlannerSelectedCamera | null>(null);
  const [selectedTowerTemplateId, setSelectedTowerTemplateId] = useState<string | null>(null);
  const [isPlacementModeActive, setIsPlacementModeActive] = useState(false);
  const [isMultiPlacementMode, setIsMultiPlacementMode] = useState(false);
  const [enabledTemplateAddonKeys, setEnabledTemplateAddonKeys] = useState<string[]>([]);
  const [towerTemplatesCatalog, setTowerTemplatesCatalog] = useState<TowerTemplate[]>([]);
  const [towerTemplateLoadError, setTowerTemplateLoadError] = useState<string | null>(null);
  const [dayNightMode, setDayNightMode] = useState<DayNightMode>("day");
  const [snapshotRequestId, setSnapshotRequestId] = useState(0);
  const [resetCounter, setResetCounter] = useState(0);
  const [towerPlanMode, setTowerPlanMode] = useState<VideotowerPlanMode>("undecided");
  const [isVideotowerPlanningCompleted, setIsVideotowerPlanningCompleted] = useState(true);
  const [customerName, setCustomerName] = useState("Musterkunde GmbH");
  const [projectName, setProjectName] = useState("Sicherungsprojekt");
  const [durationMonths, setDurationMonths] = useState(1);
  const [contractTermMode, setContractTermMode] = useState<ContractTermMode>("until_revocation");
  const [serviceHoursInput, setServiceHoursInput] = useState("");
  const [billingDaysPerMonth, setBillingDaysPerMonth] = useState(30);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [vatRate, setVatRate] = useState(DEFAULT_PRICE_CONFIG.vatRate);
  const [serviceType, setServiceType] = useState<QuoteServiceType | null>(null);
  const [quickServiceType, setQuickServiceType] = useState<QuoteServiceType>("objektschutz");
  const [quickTemplateId, setQuickTemplateId] = useState<QuoteQuickTemplateId>("objektschutz_standard");
  const [quoteLineItems, setQuoteLineItems] = useState<QuoteLineItem[]>([]);
  const [generatedText, setGeneratedText] = useState("");
  const [conceptText, setConceptText] = useState("");
  const [aiGuidance, setAiGuidance] = useState<AiGuidanceInput>(EMPTY_AI_GUIDANCE);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isManualPricingOpen, setIsManualPricingOpen] = useState(false);
  const [isOnDemandSectionOpen, setIsOnDemandSectionOpen] = useState(false);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [signatureDisplayName, setSignatureDisplayName] = useState<string>("");
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailText, setEmailText] = useState("");
  const [isQuoteSaving, setIsQuoteSaving] = useState(false);
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isTextGenerating, setIsTextGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [restoredPlannerStateKey, setRestoredPlannerStateKey] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadProjectContext = async () => {
      try {
        setIsProjectContextLoading(true);
        setTowerTemplateLoadError(null);
        const quoteIdFromQuery =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("quoteId")
            : null;
        const quickOfferModeFromQuery =
          typeof window !== "undefined"
            ? (() => {
                const params = new URLSearchParams(window.location.search);
                return (
                  params.get("mode") === "schnellangebot"
                  || params.get("quick") === "1"
                  || params.get("quickOffer") === "1"
                );
              })()
            : false;
        setIsQuickOfferMode(quickOfferModeFromQuery);

        let mappedTowerTemplates: TowerTemplate[] = [];
        let mappedTowerTemplatesError: string | null = null;
        try {
          const tenantTemplates = await towerTemplateRepository.list();
          mappedTowerTemplates = tenantTemplates.map((template) => toPlannerTowerTemplate(template));
        } catch (templateLoadError) {
          mappedTowerTemplatesError =
            templateLoadError instanceof Error
              ? templateLoadError.message
              : "Turmvorlagen konnten nicht geladen werden.";
        }

        const [selectedProjectId, projects, customers, selectedQuote, companySettings] = await Promise.all([
          localProjectRepository.getSelectedProjectId(),
          localProjectRepository.list(),
          localCustomerRepository.list(),
          quoteIdFromQuery ? localQuoteRepository.getQuoteById(quoteIdFromQuery) : Promise.resolve(null),
          companySettingsRepository.get(),
        ]);
        const contextProjectId = selectedQuote?.projectId ?? selectedProjectId;
        if (!contextProjectId) {
          if (!isMounted) return;
          setActiveProject(null);
          setActiveCustomer(null);
          setTowerTemplatesCatalog(mappedTowerTemplates);
          setTowerTemplateLoadError(mappedTowerTemplatesError);
          setIsProjectContextLoading(false);
          return;
        }
        if (!isMounted) return;
        if (selectedQuote?.projectId && selectedQuote.projectId !== selectedProjectId) {
          await localProjectRepository.setSelectedProjectId(selectedQuote.projectId);
        }
        const project = projects.find((entry) => entry.id === contextProjectId) ?? null;
        const customer = project ? customers.find((entry) => entry.id === project.customerId) ?? null : null;
        setActiveProject(project);
        setActiveCustomer(customer);
        setCompanySettings(companySettings);
        setTowerTemplatesCatalog(mappedTowerTemplates);
        setTowerTemplateLoadError(mappedTowerTemplatesError);
        setIsProjectContextLoading(false);
        setErrorMessage(null);
        if (project) {
          setProjectName(project.name);
          const runtimeContext = resolveContractTermContext(
            project.runtimeLabel,
            companySettings?.standardRuntimeMonths
          );
          setDurationMonths(runtimeContext.months);
          setContractTermMode(runtimeContext.mode);
        }
        if (customer) {
          setCustomerName(customer.companyName);
          setEmailRecipient(customer.email ?? "");
        }
        if (selectedQuote) {
          setActiveQuoteId(selectedQuote.id);
          setActiveQuoteNumber(selectedQuote.number ?? null);
          setActiveQuoteStatus(selectedQuote.status);
          setServiceType(selectedQuote.serviceType ?? null);
          if (selectedQuote.serviceType === "baustellenueberwachung") {
            setTowerPlanMode("without-plan");
            setIsVideotowerPlanningCompleted(true);
          } else {
            setTowerPlanMode("undecided");
            setIsVideotowerPlanningCompleted(true);
          }
          setQuoteLineItems(selectedQuote.positions);
          setDiscountAmount(selectedQuote.pricing.discountAmount);
          setVatRate(selectedQuote.pricing.vatRate ?? companySettings?.vatRate ?? DEFAULT_PRICE_CONFIG.vatRate);
          setGeneratedText(selectedQuote.generatedText ?? "");
          setConceptText(selectedQuote.conceptText ?? "");
          setAiGuidance(parseAiInputSummary(selectedQuote.aiInputSummary));
          setEmailSubject(buildDefaultEmailSubject(selectedQuote.number, project?.name ?? projectName));
          setEmailText(buildDefaultEmailText(selectedQuote.number, customer?.companyName ?? customerName));
          const quoteCustomer = customers.find((entry) => entry.id === selectedQuote.customerId);
          if (quoteCustomer) setCustomerName(quoteCustomer.companyName);
        } else {
          setActiveQuoteId(null);
          setActiveQuoteNumber(null);
          setActiveQuoteStatus("draft");
          setContractTermMode("until_revocation");
          setTowerPlanMode("undecided");
          setIsVideotowerPlanningCompleted(true);
          setVatRate(companySettings?.vatRate ?? DEFAULT_PRICE_CONFIG.vatRate);
          setGeneratedText(companySettings?.introText ?? "");
          setConceptText("");
          setAiGuidance(EMPTY_AI_GUIDANCE);
          setEmailSubject(buildDefaultEmailSubject(undefined, project?.name));
          setEmailText(buildDefaultEmailText(undefined, customer?.companyName));
        }
      } catch (loadError) {
        if (!isMounted) return;
        setErrorMessage(loadError instanceof Error ? loadError.message : "Projektkontext konnte nicht geladen werden.");
        setIsProjectContextLoading(false);
      }
    };
    loadProjectContext();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!isQuickOfferMode || isProjectContextLoading || !activeProject || didAutoFocusQuickOffer) {
      return;
    }

    quickOfferSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    setDidAutoFocusQuickOffer(true);
  }, [activeProject, didAutoFocusQuickOffer, isProjectContextLoading, isQuickOfferMode]);

  useEffect(() => {
    let isMounted = true;

    const loadSignatureName = async () => {
      const resolvedName = await resolveCurrentUserSignatureName(companySettings);
      if (!isMounted) {
        return;
      }

      setSignatureDisplayName(resolvedName);
    };

    void loadSignatureName();

    return () => {
      isMounted = false;
    };
  }, [companySettings]);

  const handleSelectServiceType = useCallback(
    (type: QuoteServiceType, forceReload = false) => {
      const isSwitchingType = serviceType !== type;
      setServiceType(type);
      setIsManualPricingOpen(false);
      setContractTermMode("until_revocation");
      setServiceHoursInput("");
      const runtimeMonths = getDefaultRuntimeMonths(companySettings?.standardRuntimeMonths);
      setDurationMonths(runtimeMonths);

      if (isSwitchingType) {
        setTowerPlanMode("undecided");
        setIsVideotowerPlanningCompleted(type !== "baustellenueberwachung");
        setCurrentPlan(null);
        setMeasurePoints([]);
        setIsMeasuring(false);
        setPlacedTowers([]);
        setSelectedTowerId(null);
        setSelectedCamera(null);
        setSelectedTowerTemplateId(null);
        setIsPlacementModeActive(false);
        setIsMultiPlacementMode(false);
        setEnabledTemplateAddonKeys([]);
        setViewState({ zoomLevel: 1, position: { x: 0, y: 0 } });
        setResetCounter((prev) => prev + 1);
      }

      setQuoteLineItems((prev) => {
        if (!forceReload && !isSwitchingType) {
          return prev;
        }

        if (type === "baustellenueberwachung") {
          return [];
        }

        return enforceMonthlyRecurringLineItems(
          getDefaultLineItemsForServiceType(type, companySettings?.pricingTemplates)
        );
      });

      if (forceReload || isSwitchingType) {
        setGeneratedText(
          buildDefaultOfferText({
            serviceType: type,
            customer: activeCustomer,
            companySettings,
            signatureName: signatureDisplayName,
            project: activeProject,
            durationLabel: `${runtimeMonths} Monate`,
          })
        );
      }
    },
    [
      activeCustomer,
      activeProject,
      companySettings,
      companySettings?.pricingTemplates,
      companySettings?.standardRuntimeMonths,
      serviceType,
      signatureDisplayName,
    ]
  );

  const handleQuickOfferStart = useCallback(() => {
    const selectedTemplate = getQuickTemplateById(quickTemplateId);
    if (!selectedTemplate || selectedTemplate.serviceType !== quickServiceType) {
      setErrorMessage("Bitte eine gültige Template-Auswahl treffen.");
      return;
    }

    setErrorMessage(null);
    setServiceType(selectedTemplate.serviceType);
    setIsManualPricingOpen(false);
    setContractTermMode("until_revocation");
    setServiceHoursInput("");
    const quickDurationMonths = Math.max(
      1,
      Number(companySettings?.standardRuntimeMonths ?? selectedTemplate.defaultDurationMonths ?? 1)
    );
    setDurationMonths(quickDurationMonths);
    setQuoteLineItems(
      enforceMonthlyRecurringLineItems(
        getLineItemsForQuickTemplate(selectedTemplate.id, companySettings?.pricingTemplates)
      )
    );
    setGeneratedText(
      buildDefaultOfferText({
        serviceType: selectedTemplate.serviceType,
        customer: activeCustomer,
        companySettings,
        signatureName: signatureDisplayName,
        project: activeProject,
        durationLabel: `${quickDurationMonths} Monate`,
      })
    );
    setConceptText((prev) => (prev.trim().length > 0 ? prev : companySettings?.closingText ?? ""));

    if (selectedTemplate.serviceType === "baustellenueberwachung") {
      const fallbackTemplateId =
        towerTemplatesCatalog.find((template) => template.isActive !== false)?.id ?? null;
      setSelectedTowerTemplateId(fallbackTemplateId);
      setTowerPlanMode("without-plan");
      setIsVideotowerPlanningCompleted(true);
      setIsPlacementModeActive(false);
      setIsMultiPlacementMode(false);
      setPlacedTowers([]);
      setSelectedTowerId(null);
      setSelectedCamera(null);
      setCurrentPlan(null);
      setViewState({ zoomLevel: 1, position: { x: 0, y: 0 } });
      setResetCounter((prev) => prev + 1);
    } else {
      setTowerPlanMode("undecided");
      setIsVideotowerPlanningCompleted(true);
    }

    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document.getElementById("planner-kalkulation")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }, [
    companySettings?.closingText,
    companySettings?.introText,
    companySettings?.pricingTemplates,
    companySettings?.standardRuntimeMonths,
    quickServiceType,
    quickTemplateId,
    activeCustomer,
    activeProject,
    signatureDisplayName,
    towerTemplatesCatalog,
  ]);

  const isVideotowerService = serviceType === "baustellenueberwachung";

  const quickTemplates = useMemo(() => {
    return getQuickTemplatesForServiceType(quickServiceType);
  }, [quickServiceType]);

  useEffect(() => {
    if (quickTemplates.length === 0) {
      return;
    }

    if (!quickTemplates.some((template) => template.id === quickTemplateId)) {
      setQuickTemplateId(quickTemplates[0].id);
    }
  }, [quickTemplateId, quickTemplates]);

  const activeTowerTemplates = useMemo(() => {
    return towerTemplatesCatalog.filter((template) => template.isActive !== false);
  }, [towerTemplatesCatalog]);

  const towerTemplateById = useMemo(() => {
    return new Map(towerTemplatesCatalog.map((template) => [template.id, template]));
  }, [towerTemplatesCatalog]);

  const selectedTowerTemplate = useMemo<TowerTemplate | null>(() => {
    if (!selectedTowerTemplateId) {
      return null;
    }

    return activeTowerTemplates.find((template) => template.id === selectedTowerTemplateId) ?? null;
  }, [activeTowerTemplates, selectedTowerTemplateId]);

  const selectedTowerTemplateCameraSummary = useMemo(() => {
    if (!selectedTowerTemplate) {
      return [] as Array<{ type: TowerSlotCameraType; count: number }>;
    }

    return summarizeTemplateCameraTypes(selectedTowerTemplate);
  }, [selectedTowerTemplate]);

  const selectedTowerTemplateAddons = useMemo(() => {
    if (!selectedTowerTemplate) {
      return [] as TemplateTechnicalAddon[];
    }

    return buildTemplateTechnicalAddons(selectedTowerTemplate);
  }, [selectedTowerTemplate]);

  const selectedTowerTemplateConnectivityLabels = useMemo(() => {
    if (!selectedTowerTemplate) {
      return [] as string[];
    }

    return (selectedTowerTemplate.connectivityTypes ?? []).map((type) => getConnectivityLabel(type));
  }, [selectedTowerTemplate]);

  const selectedTowerTemplateComponentLabels = useMemo(() => {
    if (!selectedTowerTemplate) {
      return [] as string[];
    }

    return (selectedTowerTemplate.components ?? [])
      .filter((component) => component.isActive)
      .map((component) => getComponentLabel(component.name));
  }, [selectedTowerTemplate]);

  const selectedTemplateEnabledAddonLabels = useMemo(() => {
    if (!selectedTowerTemplate) {
      return [] as string[];
    }

    return selectedTowerTemplateAddons
      .filter((addon) => enabledTemplateAddonKeys.includes(addon.key))
      .map((addon) => addon.label);
  }, [enabledTemplateAddonKeys, selectedTowerTemplate, selectedTowerTemplateAddons]);

  const selectedTowerTemplateActiveSlots = useMemo(() => {
    if (!selectedTowerTemplate) {
      return 0;
    }

    return selectedTowerTemplate.cameraSlots.filter(
      (slot) => slot.isActive !== false && resolveSlotCameraType(slot) !== "none"
    ).length;
  }, [selectedTowerTemplate]);

  const towerSelections = useMemo(() => {
    const towerSelectionsMap = new Map<string, number>();
    for (const tower of placedTowers) {
      towerSelectionsMap.set(tower.templateId, (towerSelectionsMap.get(tower.templateId) ?? 0) + 1);
    }

    return Array.from(towerSelectionsMap.entries()).map(([templateId, quantity]) => ({
      templateId,
      quantity,
    }));
  }, [placedTowers]);

  const towerBasedLineItems = useMemo(() => {
    if (!selectedTowerTemplate) {
      return createStandardQuoteLineItems(
        {
          towerSelections,
          oneTimeCosts: DEFAULT_STANDARD_ONE_TIME_COSTS,
        },
        DEFAULT_PRICE_CONFIG,
        towerTemplatesCatalog
      );
    }

    const placedTemplateCount = placedTowers.filter(
      (tower) => tower.templateId === selectedTowerTemplate.id
    ).length;
    const effectiveTemplateCount = towerPlanMode === "with-plan"
      ? Math.max(placedTemplateCount, 1)
      : Math.max(placedTemplateCount, 1);

    const baseLineItems = createStandardQuoteLineItems(
      {
        towerSelections: [{ templateId: selectedTowerTemplate.id, quantity: effectiveTemplateCount }],
        oneTimeCosts: DEFAULT_STANDARD_ONE_TIME_COSTS,
      },
      DEFAULT_PRICE_CONFIG,
      towerTemplatesCatalog
    );

    const selectedAddons = selectedTowerTemplateAddons.filter((addon) =>
      enabledTemplateAddonKeys.includes(addon.key)
    );

    const addonLineItems = selectedAddons.map((addon) =>
      createLineItem({
        type: "custom",
        label: addon.label,
        quantity: addon.quantity ?? 1,
        unit: addon.unit ?? "Monat",
        unitPrice: addon.unitPrice,
        billingMode: addon.billingMode,
        interval: addon.interval,
        category: addon.category,
        metadata: {
          towerTemplateId: selectedTowerTemplate.id,
          addonKey: addon.key,
        },
      })
    );

    return [...baseLineItems, ...addonLineItems];
  }, [enabledTemplateAddonKeys, placedTowers, selectedTowerTemplate, selectedTowerTemplateAddons, towerPlanMode, towerSelections, towerTemplatesCatalog]);

  useEffect(() => {
    if (!selectedTowerTemplateId) {
      setEnabledTemplateAddonKeys([]);
    }
  }, [selectedTowerTemplateId]);

  useEffect(() => {
    if (serviceType !== "baustellenueberwachung") {
      return;
    }

    if (!selectedTowerTemplate || activeQuoteId || quoteLineItems.length > 0) {
      return;
    }

    setQuoteLineItems(towerBasedLineItems);
  }, [activeQuoteId, quoteLineItems.length, selectedTowerTemplate, serviceType, towerBasedLineItems]);

  const measuredPixelDistance = useMemo(() => {
    if (measurePoints.length !== 2) {
      return null;
    }

    return calculatePixelDistance(measurePoints[0], measurePoints[1]);
  }, [measurePoints]);

  const toolbarSubtitle = useMemo(() => {
    if (!currentPlan) {
      return "";
    }

    return `${currentPlan.name} (${currentPlan.sourceType.toUpperCase()})`;
  }, [currentPlan]);

  const selectedTower = useMemo(() => {
    if (!selectedTowerId) {
      return null;
    }

    const tower = placedTowers.find((entry) => entry.id === selectedTowerId);
    if (!tower) {
      return null;
    }

    const template = towerTemplateById.get(tower.templateId);
    return {
      ...tower,
      templateLabel: template?.label ?? tower.templateId,
    };
  }, [placedTowers, selectedTowerId, towerTemplateById]);

  const selectedTowerTemplateDefinition = useMemo<TowerTemplate | null>(() => {
    if (!selectedTower) {
      return null;
    }

    return towerTemplateById.get(selectedTower.templateId) ?? null;
  }, [selectedTower, towerTemplateById]);

  const placedTowerEntries = useMemo(() => {
    return placedTowers.map((tower) => {
      return {
        ...tower,
        templateLabel: towerTemplateById.get(tower.templateId)?.label ?? tower.templateId,
        cameraCount: tower.cameraConfigurations.filter(
          (camera) => camera.active && camera.cameraType !== "none"
        ).length,
      };
    });
  }, [placedTowers, towerTemplateById]);

  const canShowQuoteSections = !isVideotowerService || isVideotowerPlanningCompleted;

  useEffect(() => {
    setRestoredPlannerStateKey(null);
  }, [activeProject?.id, serviceType]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const projectId = activeProject?.id;
    if (!projectId || serviceType !== "baustellenueberwachung" || restoredPlannerStateKey === projectId) {
      return;
    }

    let cancelled = false;

    const restorePlannerState = async () => {
      try {
        const rawState = window.localStorage.getItem(getPlannerStateStorageKey(projectId));
        if (!rawState) {
          setCurrentPlan(null);
          setPlacedTowers([]);
          setSelectedTowerTemplateId(null);
          setSelectedTowerId(null);
          setSelectedCamera(null);
          setDayNightMode("day");
          return;
        }

        const parsedState = JSON.parse(rawState) as SerializedPlannerState;
        if (parsedState.currentPlan?.sourceDataUrl) {
          const restoredImage = await loadImageFromUrl(parsedState.currentPlan.sourceDataUrl);
          if (cancelled) {
            return;
          }

          setCurrentPlan({
            ...parsedState.currentPlan,
            image: restoredImage,
          });
        } else {
          setCurrentPlan(null);
        }

        if (cancelled) {
          return;
        }

        setPlacedTowers(
          Array.isArray(parsedState.placedTowers)
            ? parsedState.placedTowers.map((tower) => ({
                ...tower,
                cameraConfigurations: Array.isArray(tower.cameraConfigurations)
                  ? tower.cameraConfigurations.map((configuration) =>
                      normalizePlannerCameraConfiguration(configuration)
                    )
                  : [],
              }))
            : []
        );
        setSelectedTowerTemplateId(parsedState.selectedTowerTemplateId ?? null);
        setDayNightMode(parsedState.dayNightMode === "night" ? "night" : "day");
        setSelectedTowerId(null);
        setSelectedCamera(null);
      } catch {
        window.localStorage.removeItem(getPlannerStateStorageKey(projectId));
      } finally {
        if (!cancelled) {
          setRestoredPlannerStateKey(projectId);
        }
      }
    };

    void restorePlannerState();

    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, restoredPlannerStateKey, serviceType]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const projectId = activeProject?.id;
    if (!projectId || serviceType !== "baustellenueberwachung" || restoredPlannerStateKey !== projectId) {
      return;
    }

    const serializablePlan = currentPlan?.sourceDataUrl
      ? {
          id: currentPlan.id,
          name: currentPlan.name,
          sourceType: currentPlan.sourceType,
          sourceDataUrl: currentPlan.sourceDataUrl,
          width: currentPlan.width,
          height: currentPlan.height,
          calibration: currentPlan.calibration,
        }
      : null;

    const serializableState: SerializedPlannerState = {
      currentPlan: serializablePlan,
      placedTowers,
      selectedTowerTemplateId,
      dayNightMode,
    };

    window.localStorage.setItem(
      getPlannerStateStorageKey(projectId),
      JSON.stringify(serializableState)
    );
  }, [
    activeProject?.id,
    currentPlan,
    dayNightMode,
    placedTowers,
    restoredPlannerStateKey,
    selectedTowerTemplateId,
    serviceType,
  ]);

  const handleUpload = useCallback(async (file: File) => {
    setErrorMessage(null);

    if (!SUPPORTED_PLAN_TYPES.includes(file.type)) {
      setErrorMessage("Nur JPG, PNG oder PDF werden unterstützt.");
      return;
    }

    try {
      const loadedAsset = file.type === "application/pdf"
        ? await renderPdfFirstPage(file)
        : await loadImageFromFile(file);

      setCurrentPlan({
        id: `plan-${Date.now()}`,
        name: file.name,
        sourceType: file.type === "application/pdf" ? "pdf" : "image",
        sourceDataUrl: loadedAsset.sourceDataUrl,
        image: loadedAsset.image,
        width: loadedAsset.image.width,
        height: loadedAsset.image.height,
        calibration: {
          status: "not-calibrated",
          pixelsPerMeter: null,
          referenceLine: null,
          scaleDenominator: null,
        },
      });

      setTowerPlanMode("with-plan");
      setIsVideotowerPlanningCompleted(false);
      setViewState({ zoomLevel: 1, position: { x: 0, y: 0 } });
      setMeasurePoints([]);
      setIsMeasuring(false);
      setPlacedTowers([]);
      setSelectedTowerId(null);
      setSelectedCamera(null);
      setIsPlacementModeActive(false);
      setResetCounter((prev) => prev + 1);
    } catch {
      setErrorMessage("Datei konnte nicht geladen werden.");
    }
  }, []);

  const handleUploadButtonClick = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  const handleUploadInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const inputElement = event.currentTarget;
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      void handleUpload(selectedFile);
    }

    inputElement.value = "";
  }, [handleUpload]);

  const handleResetTowerView = useCallback(() => {
    setViewState({ zoomLevel: 1, position: { x: 0, y: 0 } });
    setResetCounter((prev) => prev + 1);
  }, []);

  const handleApplyScale = useCallback(() => {
    if (!currentPlan) {
      return;
    }

    setErrorMessage(null);
    const denominator = Number(scaleDenominatorInput);

    try {
      const pixelsPerMeter = calculatePixelsPerMeterFromScale({
        scaleDenominator: denominator,
      });

      setCurrentPlan((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          calibration: {
            ...prev.calibration,
            status: "scale-set",
            scaleDenominator: denominator,
            pixelsPerMeter,
          },
        };
      });
    } catch {
      setErrorMessage("Maßstab ungültig. Bitte einen Wert größer 0 eingeben.");
    }
  }, [currentPlan, scaleDenominatorInput]);

  const handleToggleMeasuring = useCallback(() => {
    setErrorMessage(null);
    setMeasurePoints([]);
    setIsMeasuring((prev) => !prev);
  }, []);

  const handleMeasurePoint = useCallback((point: { x: number; y: number }) => {
    if (!isMeasuring) {
      return;
    }

    if (measurePoints.length === 0) {
      setMeasurePoints([point]);
      return;
    }

    if (measurePoints.length === 1) {
      setMeasurePoints([measurePoints[0], point]);
      setIsMeasuring(false);
      return;
    }

    setMeasurePoints([point]);
    setIsMeasuring(true);
  }, [isMeasuring, measurePoints]);

  const handleApplyReferenceDistance = useCallback(() => {
    if (!currentPlan || measuredPixelDistance === null) {
      return;
    }

    setErrorMessage(null);
    const realDistanceMeters = Number(referenceMetersInput);

    try {
      const pixelsPerMeter = calculatePixelsPerMeterFromReference({
        pixelDistance: measuredPixelDistance,
        realDistanceMeters,
      });

      setCurrentPlan((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          calibration: {
            ...prev.calibration,
            status: "calibrated",
            pixelsPerMeter,
            referenceLine: {
              start: measurePoints[0],
              end: measurePoints[1],
              pixelDistance: measuredPixelDistance,
              realDistanceMeters,
            },
          },
        };
      });
    } catch {
      setErrorMessage("Referenzstrecke ungültig. Bitte Meter größer 0 eingeben.");
    }
  }, [currentPlan, measuredPixelDistance, measurePoints, referenceMetersInput]);

  const handleSelectTowerTemplate = useCallback((templateId: string) => {
    setErrorMessage(null);
    if (selectedTowerTemplateId === templateId) {
      return;
    }

    setSelectedTowerTemplateId(templateId);
    setIsPlacementModeActive(false);
    setEnabledTemplateAddonKeys([]);

    if (placedTowers.length > 0) {
      setPlacedTowers([]);
      setSelectedTowerId(null);
      setSelectedCamera(null);
    }
  }, [placedTowers.length, selectedTowerTemplateId]);

  const handleToggleTemplateAddon = useCallback((addonKey: string, enabled: boolean) => {
    setEnabledTemplateAddonKeys((prev) => {
      if (enabled) {
        return prev.includes(addonKey) ? prev : [...prev, addonKey];
      }
      return prev.filter((entry) => entry !== addonKey);
    });
  }, []);

  const getPrimaryActiveCameraSelection = useCallback((
    towerId: string,
    towerOverride?: PlannerPlacedTower,
  ): PlannerSelectedCamera | null => {
    const tower = towerOverride ?? placedTowers.find((entry) => entry.id === towerId);
    if (!tower) {
      return null;
    }

    const template = towerTemplateById.get(tower.templateId);
    if (!template) {
      return null;
    }

    for (const slot of template.cameraSlots) {
      const configuredCamera = tower.cameraConfigurations.find((entry) => entry.slotId === slot.slotId);
      const active = configuredCamera?.active ?? slot.isActive !== false;
      const cameraType = configuredCamera?.cameraType ?? resolveSlotCameraType(slot);
      if (active && cameraType !== "none") {
        return { towerId: tower.id, slotId: slot.slotId };
      }
    }

    return null;
  }, [placedTowers, towerTemplateById]);

  const handlePlaceTower = useCallback((point: { x: number; y: number }) => {
    if (!selectedTowerTemplate || !isPlacementModeActive) {
      return;
    }

    const now = new Date().toISOString();

    setPlacedTowers((prev) => {
      const nextNumber = prev.length + 1;
      const newTowerId = `tower-${Date.now()}-${nextNumber}`;
      const nextTower: PlannerPlacedTower = {
        id: newTowerId,
        sitePlanId: currentPlan?.id ?? "no-plan",
        templateId: selectedTowerTemplate.id,
        cameraConfigurations: createPlacedCameraConfigurations(selectedTowerTemplate),
        label: `T-${String(nextNumber).padStart(2, "0")}`,
        displayName: getDefaultTowerDisplayName(selectedTowerTemplate, prev),
        x: point.x,
        y: point.y,
        rotationDeg: 0,
        createdAt: now,
        updatedAt: now,
      };

      setSelectedTowerId(newTowerId);
      setSelectedCamera(getPrimaryActiveCameraSelection(newTowerId, nextTower));

      return [
        ...prev,
        nextTower,
      ];
    });

    if (!isMultiPlacementMode) {
      setIsPlacementModeActive(false);
    }
  }, [currentPlan?.id, getPrimaryActiveCameraSelection, isMultiPlacementMode, isPlacementModeActive, selectedTowerTemplate]);

  const handleActivatePlacementMode = useCallback(() => {
    if (!selectedTowerTemplate) {
      setErrorMessage("Bitte zuerst eine Turmvorlage auswählen.");
      return;
    }
    setErrorMessage(null);
    setIsPlacementModeActive(true);
  }, [selectedTowerTemplate]);

  const handleMultiPlacementToggle = useCallback((enabled: boolean) => {
    setIsMultiPlacementMode(enabled);
    if (!enabled) {
      setIsPlacementModeActive(false);
    } else if (selectedTowerTemplate) {
      setIsPlacementModeActive(true);
    }
  }, [selectedTowerTemplate]);

  const selectTower = useCallback((towerId: string) => {
    setSelectedTowerId(towerId);
    setSelectedCamera((prev) => {
      if (prev?.towerId === towerId) {
        return prev;
      }

      return getPrimaryActiveCameraSelection(towerId);
    });
  }, [getPrimaryActiveCameraSelection]);

  const clearTowerSelection = useCallback(() => {
    setSelectedTowerId(null);
    setSelectedCamera(null);
  }, []);

  const removeTower = useCallback((towerId: string) => {
    setPlacedTowers((prev) => prev.filter((tower) => tower.id !== towerId));
    setSelectedTowerId((prev) => (prev === towerId ? null : prev));
    setSelectedCamera((prev) => (prev?.towerId === towerId ? null : prev));
  }, []);

  const renameTower = useCallback((towerId: string, displayName: string) => {
    const safeName = displayName.trim();

    setPlacedTowers((prev) =>
      prev.map((tower) =>
        tower.id === towerId
          ? {
              ...tower,
              displayName: safeName.length > 0 ? safeName : tower.displayName,
              updatedAt: new Date().toISOString(),
            }
          : tower
      )
    );
  }, []);

  const removeSelectedTower = useCallback(() => {
    if (!selectedTowerId) {
      return;
    }

    removeTower(selectedTowerId);
  }, [removeTower, selectedTowerId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" || !selectedTowerId || !isVideotowerService) {
        return;
      }

      event.preventDefault();
      removeTower(selectedTowerId);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVideotowerService, removeTower, selectedTowerId]);

  const handleMoveTower = useCallback((towerId: string, x: number, y: number) => {
    const now = new Date().toISOString();

    setPlacedTowers((prev) =>
      prev.map((tower) =>
        tower.id === towerId
          ? {
              ...tower,
              x,
              y,
              updatedAt: now,
            }
          : tower
      )
    );
  }, []);

  const handleRotateTower = useCallback((towerId: string, rotationDeg: number) => {
    const now = new Date().toISOString();

    setPlacedTowers((prev) =>
      prev.map((tower) =>
        tower.id === towerId
          ? {
              ...tower,
              rotationDeg,
              updatedAt: now,
            }
          : tower
      )
    );
  }, []);

  const updateTowerCameraConfiguration = useCallback((
    towerId: string,
    slotId: string,
    patch: Partial<PlannerPlacedTowerCameraConfiguration>
  ) => {
    setPlacedTowers((prev) =>
      prev.map((tower) => {
        if (tower.id !== towerId) {
          return tower;
        }

        let hasSlotConfiguration = false;
        const nextConfigurations = tower.cameraConfigurations.map((cameraConfiguration) => {
          if (cameraConfiguration.slotId !== slotId) {
            return cameraConfiguration;
          }

          hasSlotConfiguration = true;
          return normalizePlannerCameraConfiguration({
            ...cameraConfiguration,
            ...patch,
          });
        });

        if (!hasSlotConfiguration) {
          const fallbackSlot = towerTemplateById
            .get(tower.templateId)
            ?.cameraSlots.find((slot) => slot.slotId === slotId);
          nextConfigurations.push(normalizePlannerCameraConfiguration({
            slotId,
            cameraType: fallbackSlot ? resolveSlotCameraType(fallbackSlot) : "none",
            active: true,
            customRotationDeg: 0,
            ...patch,
          }));
        }

        return {
          ...tower,
          cameraConfigurations: nextConfigurations,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }, [towerTemplateById]);

  const updateTowerCameraRotation = useCallback((towerId: string, slotId: string, customRotationDeg: number) => {
    updateTowerCameraConfiguration(towerId, slotId, { customRotationDeg });
  }, [updateTowerCameraConfiguration]);

  const handleSelectCamera = useCallback((nextCamera: PlannerSelectedCamera | null) => {
    setSelectedCamera(nextCamera);
    if (nextCamera) {
      setSelectedTowerId(nextCamera.towerId);
    }
  }, []);

  useEffect(() => {
    if (!selectedCamera) {
      return;
    }

    const tower = placedTowers.find((entry) => entry.id === selectedCamera.towerId);
    if (!tower) {
      setSelectedCamera(null);
      return;
    }

    const template = towerTemplateById.get(tower.templateId);
    const slot = template?.cameraSlots.find((entry) => entry.slotId === selectedCamera.slotId);
    if (!template || !slot) {
      setSelectedCamera(getPrimaryActiveCameraSelection(tower.id, tower));
      return;
    }

    const configuredCamera = tower.cameraConfigurations.find((entry) => entry.slotId === slot.slotId);
    const active = configuredCamera?.active ?? slot.isActive !== false;
    const cameraType = configuredCamera?.cameraType ?? resolveSlotCameraType(slot);
    if (!active || cameraType === "none") {
      setSelectedCamera(getPrimaryActiveCameraSelection(tower.id, tower));
    }
  }, [getPrimaryActiveCameraSelection, placedTowers, selectedCamera, towerTemplateById]);

  const handleSetTowerCameraActive = useCallback((towerId: string, slotId: string, active: boolean) => {
    updateTowerCameraConfiguration(towerId, slotId, { active });
  }, [updateTowerCameraConfiguration]);

  const handleSnapshotCaptured = useCallback((dataUrl: string | null) => {
    if (!snapshotResolverRef.current) {
      return;
    }

    snapshotResolverRef.current(dataUrl);
    snapshotResolverRef.current = null;
  }, []);

  const requestCanvasSnapshot = useCallback(() => {
    return new Promise<string | null>((resolve) => {
      snapshotResolverRef.current = resolve;
      setSnapshotRequestId((prev) => prev + 1);
    });
  }, []);

  const handleApplyTowerItemsToQuote = useCallback(() => {
    if (!selectedTowerTemplate) {
      setErrorMessage("Bitte zuerst eine Turmvorlage auswählen.");
      return;
    }

    setErrorMessage(null);
    setQuoteLineItems(towerBasedLineItems);
  }, [selectedTowerTemplate, towerBasedLineItems]);

  const proceedToCalculation = useCallback(() => {
    if (!selectedTowerTemplate) {
      setErrorMessage("Bitte zuerst eine Turmvorlage auswählen.");
      return;
    }

    setIsVideotowerPlanningCompleted(true);

    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document.getElementById("planner-kalkulation")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }, [selectedTowerTemplate]);

  const handleContinueWithoutPlan = useCallback(() => {
    if (!selectedTowerTemplate) {
      setErrorMessage("Bitte zuerst eine Turmvorlage auswählen.");
      return;
    }

    setErrorMessage(null);
    setTowerPlanMode("without-plan");
    setIsVideotowerPlanningCompleted(true);
    setIsPlacementModeActive(false);
    setIsMultiPlacementMode(false);
  }, [selectedTowerTemplate]);

  const effectiveDurationMonths = contractTermMode === "fixed" ? durationMonths : 1;

  const calculatedLineItems = useMemo(
    () => quoteLineItems.filter((item) => !isOnDemandLineItem(item)),
    [quoteLineItems]
  );
  const onDemandLineItems = useMemo(
    () => quoteLineItems.filter((item) => isOnDemandLineItem(item)),
    [quoteLineItems]
  );

  const quoteTotals = useMemo(() => {
    return calculateQuoteTotals({ lineItems: calculatedLineItems, durationMonths: effectiveDurationMonths, discountAmount, vatRate });
  }, [calculatedLineItems, discountAmount, effectiveDurationMonths, vatRate]);

  const durationLabel = useMemo(() => {
    if (contractTermMode === "until_revocation") {
      return "Bis auf Widerruf";
    }
    if (contractTermMode === "indefinite") {
      return "Unbefristet";
    }
    return `${durationMonths} Monate`;
  }, [contractTermMode, durationMonths]);

  const previewInputConfig = useMemo(() => {
    if (serviceType === "baustellenueberwachung") {
      return { label: "Tage", placeholder: "z. B. 30" };
    }
    if (serviceType === "revierdienst") {
      return { label: "Kontrollen", placeholder: "z. B. 4" };
    }
    if (serviceType === "leitstelle") {
      return { label: "Aufschaltungen", placeholder: "z. B. 12" };
    }
    return { label: "Stunden", placeholder: "z. B. 24h" };
  }, [serviceType]);

  const serviceInputValue = useMemo(() => parseHourInputValue(serviceHoursInput), [serviceHoursInput]);

  const previewUnitRate = useMemo(() => {
    if (!serviceType) {
      return 0;
    }

    if (serviceType === "revierdienst") {
      const controlItem = quoteTotals.lineItems.find((item) => item.type === "control_run");
      return controlItem?.preisProKontrolle ?? controlItem?.unitPrice ?? 0;
    }

    if (serviceType === "leitstelle") {
      const recurringServiceItems = quoteTotals.lineItems.filter(
        (item) => item.billingMode === "recurring" && item.type === "service"
      );
      const preferred = recurringServiceItems.find((item) => item.label.toLowerCase().includes("aufschaltung"));
      return preferred?.unitPrice ?? recurringServiceItems[0]?.unitPrice ?? 0;
    }

    if (serviceType === "baustellenueberwachung") {
      const recurringTotal = quoteTotals.lineItems
        .filter((item) => item.billingMode === "recurring")
        .reduce((sum, item) => sum + item.totalPrice, 0);
      return roundMoney(recurringTotal / Math.max(1, billingDaysPerMonth));
    }

    const guardItem = quoteTotals.lineItems.find(
      (item) => item.type === "guard_hour" && item.billingMode === "recurring"
    );
    return guardItem?.unitPrice ?? 0;
  }, [billingDaysPerMonth, quoteTotals.lineItems, serviceType]);

  const previewDailyPrice = useMemo(() => {
    if (serviceType === "leitstelle") {
      return previewUnitRate;
    }
    if (serviceType === "baustellenueberwachung") {
      return previewUnitRate;
    }
    return roundMoney(serviceInputValue * previewUnitRate);
  }, [previewUnitRate, serviceInputValue, serviceType]);

  const previewMonthlyPrice = useMemo(() => {
    if (serviceType === "leitstelle") {
      return roundMoney(serviceInputValue * previewUnitRate);
    }
    if (serviceType === "baustellenueberwachung") {
      return roundMoney(serviceInputValue * previewUnitRate);
    }
    return roundMoney(previewDailyPrice * billingDaysPerMonth);
  }, [billingDaysPerMonth, previewDailyPrice, previewUnitRate, serviceInputValue, serviceType]);

  const offerPreviewFacts = useMemo(() => {
    if (!serviceType) {
      return [] as string[];
    }

    if (serviceType === "revierdienst") {
      return [
        serviceInputValue > 0 ? `${serviceInputValue.toFixed(0)} Kontrollen/Tag` : "Kontrollen/Tag nicht gesetzt",
        `Laufzeit: ${durationLabel}`,
      ];
    }

    if (serviceType === "baustellenueberwachung") {
      return [
        serviceInputValue > 0 ? `${serviceInputValue.toFixed(0)} Tage` : "Tage nicht gesetzt",
        towerPlanMode === "with-plan" ? "Mit Platzierung" : "Ohne Platzierung",
      ];
    }

    if (serviceType === "leitstelle") {
      return [
        serviceInputValue > 0 ? `${serviceInputValue.toFixed(0)} Aufschaltungen` : "Aufschaltungen nicht gesetzt",
        `Laufzeit: ${durationLabel}`,
      ];
    }

    return [
      serviceInputValue > 0 ? `${serviceInputValue.toFixed(1)} Std./Tag` : "Stunden/Tag nicht gesetzt",
      `Laufzeit: ${durationLabel}`,
    ];
  }, [durationLabel, serviceInputValue, serviceType, towerPlanMode]);

  const selectedTemplateProfileSummary = useMemo(() => {
    if (!selectedTowerTemplate) {
      return undefined;
    }

    const cameraTypesLabel = selectedTowerTemplateCameraSummary
      .map((entry) => `${getCameraTypeLabel(entry.type)}: ${entry.count}`)
      .join(", ");
    const connectivityLabel = selectedTowerTemplateConnectivityLabels.length > 0
      ? selectedTowerTemplateConnectivityLabels.join(", ")
      : "Keine";
    const componentsLabel = selectedTowerTemplateComponentLabels.length > 0
      ? selectedTowerTemplateComponentLabels.join(", ")
      : "Keine";
    const selectedAddonsLabel = selectedTemplateEnabledAddonLabels.length > 0
      ? selectedTemplateEnabledAddonLabels.join(", ")
      : "Keine";

    return [
      `Vorlage: ${selectedTowerTemplate.label}`,
      `Energieart: ${getPowerTypeLabel(selectedTowerTemplate)}`,
      `Aktive Slots: ${selectedTowerTemplateActiveSlots}`,
      `Kameratypen: ${cameraTypesLabel || "Keine"}`,
      `Konnektivitaet: ${connectivityLabel}`,
      `Komponenten: ${componentsLabel}`,
      `Ausgewählte Zusatzpositionen: ${selectedAddonsLabel}`,
    ].join("\n");
  }, [selectedTemplateEnabledAddonLabels, selectedTowerTemplate, selectedTowerTemplateActiveSlots, selectedTowerTemplateCameraSummary, selectedTowerTemplateComponentLabels, selectedTowerTemplateConnectivityLabels]);

  const buildStoredAiSummary = useCallback(() => {
    const guidanceSummary = serializeAiInputSummary(aiGuidance);
    if (!selectedTemplateProfileSummary) {
      return guidanceSummary;
    }

    const templateSection = `Turmvorlagen-Profil:\n${selectedTemplateProfileSummary}`;
    return guidanceSummary ? `${guidanceSummary}\n\n${templateSection}` : templateSection;
  }, [aiGuidance, selectedTemplateProfileSummary]);

  const aiPromptTechnicalSpecifications = useMemo(() => {
    const parts: string[] = [];
    const technicalDetails = aiGuidance.relevantTechnology.trim();
    if (technicalDetails.length > 0) {
      parts.push(technicalDetails);
    }
    if (selectedTemplateProfileSummary) {
      parts.push(selectedTemplateProfileSummary);
    }

    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }, [aiGuidance.relevantTechnology, selectedTemplateProfileSummary]);

  const aiPromptAdditionalNotes = useMemo(() => {
    const notes = buildAiAdditionalNotes(aiGuidance);
    if (!selectedTemplateProfileSummary) {
      return notes;
    }

    return notes
      ? `${notes}\nVorlagenprofil berücksichtigen: ${selectedTowerTemplate?.label}`
      : `Vorlagenprofil berücksichtigen: ${selectedTowerTemplate?.label}`;
  }, [aiGuidance, selectedTemplateProfileSummary, selectedTowerTemplate?.label]);

  const filledAiHintCount = useMemo(() => {
    return countFilledAiHints(aiGuidance);
  }, [aiGuidance]);

  const handleAddQuoteLineItem = useCallback(() => {
    setQuoteLineItems((prev) => [
      ...prev,
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
    ]);
  }, []);

  const handleUpdateQuoteLineItem = useCallback(
    (
      itemId: string,
      patch: Partial<
        Pick<
          QuoteLineItem,
          | "label"
          | "description"
          | "type"
          | "quantity"
          | "unit"
          | "unitPrice"
          | "stundenProTag"
          | "nachtStundenProTag"
          | "tageProMonat"
          | "tageSamstag"
          | "tageSonntag"
          | "tageFeiertag"
          | "preisProKontrolle"
          | "kontrollenProTagWerktag"
          | "kontrollenProTagSamstag"
          | "kontrollenProTagSonntag"
          | "kontrollenProTagFeiertag"
          | "nachtKontrollenProTag"
          | "kontrollenProTagWochenende"
          | "tageWerktage"
          | "tageWochenende"
          | "samstagZuschlagPercent"
          | "sonntagZuschlagPercent"
          | "feiertagZuschlagPercent"
          | "nachtZuschlagPercent"
          | "billingMode"
          | "interval"
          | "category"
        >
      >
    ) => {
      setQuoteLineItems((prev) => prev.map((item) => item.id !== itemId ? item : { ...item, ...patch }));
    },
    []
  );

  const handleDeleteQuoteLineItem = useCallback((itemId: string) => {
    setQuoteLineItems((prev) => prev.filter((item) => item.id !== itemId));
  }, []);

  const handleAddOnDemandPreset = useCallback((preset: "intervention" | "wachdienst" | "sonderkontrolle" | "schluesseltausch") => {
    const byPreset: Record<typeof preset, QuoteLineItem[]> = {
      intervention: [
        createLineItem({
          type: "custom",
          label: "Intervention",
          description: "Erste Stunde",
          quantity: 1,
          unit: "Einsatz",
          unitPrice: 120,
          billingMode: "one_time",
          interval: "once",
          category: "on_demand",
          metadata: { onDemand: true },
        }),
        createLineItem({
          type: "custom",
          label: "Intervention",
          description: "Jede weitere 30 Minuten",
          quantity: 1,
          unit: "Takt",
          unitPrice: 25,
          billingMode: "one_time",
          interval: "once",
          category: "on_demand",
          metadata: { onDemand: true },
        }),
      ],
      wachdienst: [
        createLineItem({
          type: "guard_hour",
          label: "Wachmann auf Anforderung",
          quantity: 1,
          unit: "Std",
          unitPrice: 28,
          billingMode: "one_time",
          interval: "once",
          category: "on_demand",
          metadata: { onDemand: true },
        }),
      ],
      sonderkontrolle: [
        createLineItem({
          type: "control_run",
          label: "Sonderkontrollen",
          quantity: 1,
          unit: "Kontrolle",
          unitPrice: 10,
          billingMode: "one_time",
          interval: "once",
          category: "on_demand",
          metadata: { onDemand: true },
        }),
      ],
      schluesseltausch: [
        createLineItem({
          type: "service",
          label: "Schlüsseltausch",
          quantity: 1,
          unit: "einmalig",
          unitPrice: 50,
          billingMode: "one_time",
          interval: "once",
          category: "on_demand",
          metadata: { onDemand: true },
        }),
      ],
    };

    setQuoteLineItems((prev) => [...prev, ...byPreset[preset]]);
  }, []);

  const handleServiceHoursInputChange = useCallback((rawValue: string) => {
    setServiceHoursInput(rawValue);

    const parsedHours = parseHourInputValue(rawValue);
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      return;
    }

    setQuoteLineItems((prev) => {
      if (!isHourBasedServiceType(serviceType)) {
        return prev;
      }

      const firstGuardIndex = prev.findIndex(
        (item) => item.type === "guard_hour" && item.billingMode === "recurring"
      );

      if (firstGuardIndex < 0) {
        return prev;
      }

      return prev.map((item, index) => {
        if (item.type !== "guard_hour" || item.billingMode !== "recurring") {
          return item;
        }

        if (index !== firstGuardIndex) {
          return {
            ...item,
            stundenProTag: 0,
            nachtStundenProTag: 0,
            tageWerktage: billingDaysPerMonth,
            tageSamstag: 0,
            tageSonntag: 0,
            tageFeiertag: 0,
          };
        }

        return {
          ...item,
          stundenProTag: parsedHours,
          nachtStundenProTag: 0,
          tageWerktage: billingDaysPerMonth,
          tageSamstag: 0,
          tageSonntag: 0,
          tageFeiertag: 0,
          billingMode: "recurring",
          interval: "monthly",
        };
      });
    });
  }, [billingDaysPerMonth, serviceType]);

  useEffect(() => {
    if (serviceHoursInput.trim().length === 0) {
      return;
    }
    if (!isHourBasedServiceType(serviceType)) {
      return;
    }

    setQuoteLineItems((prev) => prev.map((item) => (
      item.type === "guard_hour" && item.billingMode === "recurring"
        ? { ...item, tageWerktage: billingDaysPerMonth }
        : item
    )));
  }, [billingDaysPerMonth, serviceHoursInput, serviceType]);

  const saveCurrentQuote = useCallback(async (): Promise<StoredQuote> => {
    if (!activeProject || !activeCustomer) {
      throw new Error("Projekt- und Kundendaten konnten nicht geladen werden.");
    }

    if (!serviceType) {
      throw new Error("Bitte zuerst eine Leistungsart auswählen.");
    }
    const existingQuote = activeQuoteId ? await localQuoteRepository.getQuoteById(activeQuoteId) : null;
    const now = new Date().toISOString();
    const nextQuote: StoredQuote = {
      id: activeQuoteId ?? crypto.randomUUID(),
      number: existingQuote?.number,
      customerId: activeCustomer.id,
      projectId: activeProject.id,
      serviceType,
      positions: quoteLineItems,
      pricing: {
        monthlyTotal: quoteTotals.monthlyTotal,
        oneTimeTotal: quoteTotals.oneTimeTotal,
        subtotal: quoteTotals.subtotal,
        netTotal: quoteTotals.totalNet,
        grossTotal: quoteTotals.totalGross,
        discountAmount: quoteTotals.discountAmount,
        vatRate: quoteTotals.vatRate,
      },
      status: existingQuote?.status ?? "draft",
      generatedText,
      conceptText,
      aiInputSummary: buildStoredAiSummary(),
      validUntil: existingQuote?.validUntil ?? createDefaultValidUntil(companySettings?.defaultValidityDays),
      sentAt: existingQuote?.sentAt,
      createdAt: existingQuote?.createdAt ?? now,
      updatedAt: now,
    };

    const persisted = activeQuoteId
      ? await localQuoteRepository.updateQuote(nextQuote)
      : await localQuoteRepository.saveQuote(nextQuote);

    setActiveQuoteId(persisted.id);
    setActiveQuoteNumber(persisted.number ?? null);
    setActiveQuoteStatus(persisted.status);
    setEmailSubject(buildDefaultEmailSubject(persisted.number, activeProject.name));
    setEmailText((prev) => (prev.trim().length > 0 ? prev : buildDefaultEmailText(persisted.number, activeCustomer.companyName)));
    return persisted;
  }, [activeCustomer, activeProject, activeQuoteId, buildStoredAiSummary, companySettings?.defaultValidityDays, conceptText, generatedText, quoteLineItems, quoteTotals, serviceType]);

  const handleSaveQuote = useCallback(async () => {
    setErrorMessage(null);
    setIsQuoteSaving(true);
    try {
      await saveCurrentQuote();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Angebot konnte nicht gespeichert werden.");
    } finally {
      setIsQuoteSaving(false);
    }
  }, [saveCurrentQuote]);

  const handleDownloadPdf = useCallback(async () => {
    setErrorMessage(null);
    setIsPdfGenerating(true);
    try {
      if (isVideotowerService && towerPlanMode === "with-plan" && !currentPlan) {
        throw new Error("Bitte zuerst einen Lageplan hochladen oder ohne Plan fortfahren.");
      }

      const persistedQuote = await saveCurrentQuote();
      const quoteNumber = persistedQuote.number ?? `AN-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
      const planSnapshotDataUrl = isVideotowerService && towerPlanMode === "with-plan" && currentPlan
        ? await requestCanvasSnapshot()
        : null;
      const towersForPdf = isVideotowerService
        ? placedTowers.map((tower) => {
            const template = towerTemplateById.get(tower.templateId);
            return {
              label: tower.displayName,
              templateLabel: template?.label ?? tower.templateId,
              rotationDeg: tower.rotationDeg,
            };
          })
        : [];

      const pdfBytes = await generateQuotePdf({
        quoteNumber,
        issueDate: new Date().toISOString().slice(0, 10),
        validUntil: persistedQuote.validUntil ?? createDefaultValidUntil(companySettings?.defaultValidityDays),
        notes: buildStoredAiSummary(),
        customer: {
          customerId: activeCustomer?.id,
          name: customerName,
          address: activeCustomer?.billingAddress,
          contactPerson: activeCustomer?.contactName,
          email: activeCustomer?.email,
          phone: activeCustomer?.phone,
        },
        project: {
          name: projectName,
          location: activeProject?.siteAddress ?? activeProject?.location ?? projectName,
          durationMonths: effectiveDurationMonths,
        },
        towers: towersForPdf,
        lineItems: quoteTotals.lineItems,
        onDemandLineItems,
        monthlyTotal: quoteTotals.monthlyTotal,
        oneTimeTotal: quoteTotals.oneTimeTotal,
        subtotal: quoteTotals.subtotal,
        discountAmount: quoteTotals.discountAmount,
        totalNet: quoteTotals.totalNet,
        totalGross: quoteTotals.totalGross,
        vatRate: quoteTotals.vatRate,
        generatedText,
        conceptText,
        signerName: signatureDisplayName,
        planSnapshotDataUrl,
      });
      downloadPdf(pdfBytes, buildQuotePdfFileName({ quoteNumber, customerName, projectName }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "PDF konnte nicht erstellt werden.");
    } finally {
      setIsPdfGenerating(false);
    }
  }, [activeCustomer, activeProject, buildStoredAiSummary, companySettings?.defaultValidityDays, currentPlan, customerName, conceptText, effectiveDurationMonths, generatedText, isVideotowerService, onDemandLineItems, placedTowers, projectName, quoteTotals, requestCanvasSnapshot, saveCurrentQuote, signatureDisplayName, towerPlanMode, towerTemplateById]);

  const handleSendQuote = useCallback(async () => {
    if (!emailRecipient.trim()) {
      setErrorMessage("Bitte eine Empfänger-E-Mail angeben.");
      return;
    }

    setErrorMessage(null);
    setIsSending(true);
    try {
      if (isVideotowerService && towerPlanMode === "with-plan" && !currentPlan) {
        throw new Error("Bitte zuerst einen Lageplan hochladen oder ohne Plan fortfahren.");
      }

      const persistedQuote = await saveCurrentQuote();
      const quoteNumber = persistedQuote.number ?? "";
      const planSnapshotDataUrl = isVideotowerService && towerPlanMode === "with-plan" && currentPlan
        ? await requestCanvasSnapshot()
        : null;
      const towersForPdf = isVideotowerService
        ? placedTowers.map((tower) => {
            const template = towerTemplateById.get(tower.templateId);
            return {
              label: tower.displayName,
              templateLabel: template?.label ?? tower.templateId,
              rotationDeg: tower.rotationDeg,
            };
          })
        : [];

      const pdfBytes = await generateQuotePdf({
        quoteNumber,
        issueDate: new Date().toISOString().slice(0, 10),
        validUntil: persistedQuote.validUntil ?? createDefaultValidUntil(companySettings?.defaultValidityDays),
        notes: buildStoredAiSummary(),
        customer: {
          customerId: activeCustomer?.id,
          name: customerName,
          address: activeCustomer?.billingAddress,
          contactPerson: activeCustomer?.contactName,
          email: activeCustomer?.email,
          phone: activeCustomer?.phone,
        },
        project: {
          name: projectName,
          location: activeProject?.siteAddress ?? activeProject?.location ?? projectName,
          durationMonths: effectiveDurationMonths,
        },
        towers: towersForPdf,
        lineItems: quoteTotals.lineItems,
        onDemandLineItems,
        monthlyTotal: quoteTotals.monthlyTotal,
        oneTimeTotal: quoteTotals.oneTimeTotal,
        subtotal: quoteTotals.subtotal,
        discountAmount: quoteTotals.discountAmount,
        totalNet: quoteTotals.totalNet,
        totalGross: quoteTotals.totalGross,
        vatRate: quoteTotals.vatRate,
        generatedText,
        conceptText,
        signerName: signatureDisplayName,
        planSnapshotDataUrl,
      });

      const response = await fetch("/api/quotes/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          to: emailRecipient.trim(),
          subject: emailSubject.trim() || buildDefaultEmailSubject(quoteNumber, projectName),
          text: emailText.trim() || buildDefaultEmailText(quoteNumber, customerName),
          fileName: buildQuotePdfFileName({ quoteNumber, customerName, projectName }),
          pdfBase64: bytesToBase64(pdfBytes),
        }),
      });

      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "E-Mail konnte nicht versendet werden.");
      }

      const sentQuote = await localQuoteRepository.markQuoteSent(persistedQuote.id);
      setActiveQuoteStatus(sentQuote.status);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "E-Mail konnte nicht versendet werden.");
    } finally {
      setIsSending(false);
    }
  }, [activeCustomer, activeProject, buildStoredAiSummary, companySettings?.defaultValidityDays, currentPlan, conceptText, customerName, effectiveDurationMonths, emailRecipient, emailSubject, emailText, generatedText, isVideotowerService, onDemandLineItems, placedTowers, projectName, quoteTotals, requestCanvasSnapshot, saveCurrentQuote, signatureDisplayName, towerPlanMode, towerTemplateById]);

  const handleGenerateText = useCallback(async () => {
    if (!serviceType) {
      setErrorMessage("Bitte zuerst eine Leistungsart auswählen.");
      return;
    }

    if (generatedText.trim().length > 0) {
      const shouldOverwrite = window.confirm("Der vorhandene Angebotstext wird überschrieben. Fortfahren?");
      if (!shouldOverwrite) {
        return;
      }
    }

    setErrorMessage(null);
    setIsTextGenerating(true);

    try {
      const response = await fetch("/api/ai/generate-offer-text", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          customerName: activeCustomer?.companyName ?? customerName,
          projectName: activeProject?.name ?? projectName,
          location: activeProject?.siteAddress ?? activeProject?.location ?? projectName,
          serviceType: mapServiceTypeForPrompt(serviceType),
          duration: durationLabel,
          projectStartDate: activeProject?.startDate,
          positions: quoteTotals.lineItems,
          technicalSpecifications: aiPromptTechnicalSpecifications,
          additionalNotes: aiPromptAdditionalNotes,
          serviceSpecificGuidance: companySettings?.aiPromptHints?.[serviceType],
          companyName: companySettings?.companyName,
          paymentTerms: companySettings?.paymentTerms,
          agbReference: companySettings?.companyName
            ? `Es gelten die allgemeinen Geschäftsbedingungen der ${companySettings.companyName}.`
            : undefined,
          companyIntroText: companySettings?.introText,
          companyClosingText: buildClosingWithSignature(companySettings, signatureDisplayName),
        }),
      });

      const result = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Angebotstext konnte nicht generiert werden.");
      }

      const nextText = result?.text?.trim();
      if (!nextText) {
        throw new Error("ViorAI hat keinen nutzbaren Angebotstext geliefert.");
      }

      setGeneratedText(nextText);
      setIsAiModalOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Angebotstext konnte nicht generiert werden.");
    } finally {
      setIsTextGenerating(false);
    }
  }, [
    activeCustomer?.companyName,
    activeProject?.location,
    activeProject?.name,
    activeProject?.siteAddress,
    activeProject?.startDate,
    aiPromptAdditionalNotes,
    aiPromptTechnicalSpecifications,
    companySettings?.closingText,
    companySettings?.companyName,
    companySettings?.introText,
    companySettings?.paymentTerms,
    companySettings?.aiPromptHints,
    customerName,
    durationLabel,
    generatedText,
    projectName,
    quoteTotals.lineItems,
    signatureDisplayName,
    serviceType,
  ]);

  const actionButtons = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void handleSaveQuote()} disabled={isQuoteSaving || !canShowQuoteSections} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50">
        {isQuoteSaving ? "Speichert..." : "Angebot speichern"}
      </button>
      <button type="button" onClick={() => void handleSendQuote()} disabled={isSending || !canShowQuoteSections} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
        {isSending ? "Sendet..." : "Angebot senden"}
      </button>
      <button type="button" onClick={() => void handleDownloadPdf()} disabled={isPdfGenerating || !canShowQuoteSections} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50">
        {isPdfGenerating ? "PDF wird erstellt..." : "PDF herunterladen"}
      </button>
    </div>
  );

  if (isProjectContextLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Angebotseditor" description="Projektkontext wird geladen..." />
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="space-y-4">
        <PageHeader title="Angebotseditor" description="Bitte zuerst ein Projekt anlegen und aus der Projektliste öffnen." />
        <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-3">
          <span>Kein Projekt ausgewählt. Der Angebotseditor arbeitet immer im Kontext eines Projekts.</span>
          <Link href="/projects" className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 text-sm">
            Zu Projekten
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Angebotseditor"
        description={`Angebotsnummer: ${activeQuoteNumber ?? "Neu"} | Kunde: ${activeCustomer?.companyName ?? customerName} | Projekt: ${activeProject.name} | Status: ${activeQuoteId ? QUOTE_STATUS_LABELS[activeQuoteStatus] : "Neu"}`}
        action={actionButtons}
      />

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        onChange={handleUploadInputChange}
      />

      <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Angebotsnummer</p>
            <p className="text-sm font-semibold text-slate-800">{activeQuoteNumber ?? "Neu"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Kunde</p>
            <p className="text-sm font-semibold text-slate-800">{activeCustomer?.companyName ?? customerName}</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Projekt</p>
            <p className="text-sm font-semibold text-slate-800">{activeProject.name}</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
            <p className="text-sm font-semibold text-slate-800">{activeQuoteId ? QUOTE_STATUS_LABELS[activeQuoteStatus] : "Neu"}</p>
          </div>
        </div>

        <section
          id="schnell-angebot-flow"
          ref={quickOfferSectionRef}
          className={`rounded-xl border p-4 space-y-3 transition-colors ${
            isQuickOfferMode
              ? "border-sky-300 bg-sky-50 shadow-[0_0_0_4px_rgba(14,165,233,0.08)]"
              : "border-sky-100 bg-sky-50/60"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Schnell-Angebot</h3>
              <p className="text-sm text-slate-600">Standardwerte aus dem Admin werden automatisch übernommen.</p>
            </div>
            {isQuickOfferMode && (
              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-sky-700 border border-sky-200">
                Direkt aus dem Dashboard geöffnet
              </span>
            )}
            <button
              type="button"
              onClick={handleQuickOfferStart}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
            >
              Schnell-Angebot starten
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs text-slate-600">
              Kunde
              <input
                type="text"
                value={activeCustomer?.companyName ?? customerName}
                disabled
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700"
              />
            </label>
            <label className="text-xs text-slate-600">
              Leistungsart
              <select
                value={quickServiceType}
                onChange={(event) => setQuickServiceType(event.target.value as QuoteServiceType)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700"
              >
                {QUOTE_SERVICE_TYPE_OPTIONS
                  .filter(([value]) =>
                    value === "objektschutz" || value === "revierdienst" || value === "baustellenueberwachung"
                  )
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Vorlage
              <select
                value={quickTemplateId}
                onChange={(event) => setQuickTemplateId(event.target.value as QuoteQuickTemplateId)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700"
              >
                {quickTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          {QUOTE_SERVICE_TYPE_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => handleSelectServiceType(value)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                serviceType === value
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {serviceType && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Angebotsvorschau</h3>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500">Leistungsart</p>
              <p className="text-sm font-semibold text-slate-800">{QUOTE_SERVICE_TYPE_LABELS[serviceType]}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500">Dauer</p>
              <div className="mt-1 space-y-1">
                <select
                  value={contractTermMode}
                  onChange={(event) => setContractTermMode(event.target.value as ContractTermMode)}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 bg-white"
                >
                  <option value="until_revocation">Bis auf Widerruf</option>
                  <option value="indefinite">Unbefristet</option>
                  <option value="fixed">Befristet</option>
                </select>
                {contractTermMode === "fixed" ? (
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={durationMonths}
                    onChange={(event) => setDurationMonths(Math.max(1, Math.round(parseNonNegativeNumber(event.target.value) || 1)))}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 bg-white"
                  />
                ) : (
                  <p className="text-xs font-medium text-slate-600">Monatliche Abrechnung</p>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500">{previewInputConfig.label}</p>
              <input
                type="text"
                value={serviceHoursInput}
                onChange={(event) => handleServiceHoursInputChange(event.target.value)}
                placeholder={previewInputConfig.placeholder}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 bg-white"
              />
              <p className="mt-2 text-xs text-slate-500">Abrechnungstage / Monat</p>
              <input
                type="number"
                min={1}
                max={31}
                step={1}
                value={billingDaysPerMonth}
                onChange={(event) => setBillingDaysPerMonth(Math.min(31, Math.max(1, Math.round(parseNonNegativeNumber(event.target.value) || 1))))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 bg-white"
              />
              <p className="text-xs text-slate-600">{offerPreviewFacts[0] ?? "-"}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500">
                {serviceType === "revierdienst"
                  ? "Preis / Tag"
                  : serviceType === "leitstelle"
                    ? "Preis / Aufschaltung"
                    : "Preis / Tag"}
              </p>
              <p className="text-sm font-semibold text-slate-800">
                {previewUnitRate > 0 ? `${previewDailyPrice.toFixed(2)} EUR` : "-"}
              </p>
            </div>
            <div className="rounded-xl bg-slate-900 border border-slate-900 px-3 py-2">
              <p className="text-xs text-slate-300">Preis / Monat</p>
              <p className="text-sm font-semibold text-white">
                {previewUnitRate > 0 ? `${previewMonthlyPrice.toFixed(2)} EUR` : "-"}
              </p>
              {serviceType !== "leitstelle" && (
                <p className="text-xs text-slate-300/80">{billingDaysPerMonth} Tage/Monat</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Videoturm: Lageplan & Einzeichnung vor Kalkulation ──────────── */}
      {serviceType === "baustellenueberwachung" && (
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Lageplan & Einzeichnung</h3>
            <p className="text-sm text-slate-500">
              Für Videoturm-Angebote erfolgt zuerst die Planbearbeitung. Danach geht es in die Kalkulation.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-slate-800">Schritt 1: Turmvorlage wählen</h4>
              {selectedTowerTemplate && (
                <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                  Gewählt: {selectedTowerTemplate.label}
                </span>
              )}
            </div>

            {towerTemplateLoadError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                Turmvorlagen konnten nicht geladen werden: {towerTemplateLoadError}
              </p>
            )}

            {!towerTemplateLoadError && activeTowerTemplates.length === 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Keine aktiven Turmvorlagen vorhanden. Bitte zuerst im Admin-Bereich Turmkonfigurationen anlegen.
              </p>
            )}

            {!towerTemplateLoadError && activeTowerTemplates.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {activeTowerTemplates.map((template) => {
                  const cameraTypeSummary = summarizeTemplateCameraTypes(template);
                  const componentLabels = (template.components ?? [])
                    .filter((component) => component.isActive)
                    .map((component) => getComponentLabel(component.name));
                  const connectivityLabels = (template.connectivityTypes ?? []).map((type) =>
                    getConnectivityLabel(type)
                  );
                  const isSelected = selectedTowerTemplateId === template.id;

                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => handleSelectTowerTemplate(template.id)}
                      className={`text-left rounded-md border px-3 py-3 transition-colors ${
                        isSelected
                          ? "border-blue-400 bg-blue-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-800">{template.label}</p>
                      <p className="text-xs text-slate-600 mt-1">Energieart: {getPowerTypeLabel(template)}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Aktive Kameras: {cameraTypeSummary.length > 0
                          ? cameraTypeSummary.map((entry) => `${getCameraTypeLabel(entry.type)} (${entry.count})`).join(", ")
                          : "Keine"}
                      </p>
                      <p className="text-xs text-slate-600 mt-1">
                        Konnektivitaet: {connectivityLabels.length > 0 ? connectivityLabels.join(", ") : "Keine"}
                      </p>
                      <p className="text-xs text-slate-600 mt-1">
                        Komponenten: {componentLabels.length > 0 ? componentLabels.join(", ") : "Keine"}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedTowerTemplate && selectedTowerTemplateAddons.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-2">
              <h4 className="text-sm font-semibold text-slate-800">Schritt 2: Optionale Technikpositionen</h4>
              <p className="text-xs text-slate-600">
                Diese Positionen werden bei Aktivierung in die Kalkulation übernommen.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {selectedTowerTemplateAddons.map((addon) => {
                  const isEnabled = enabledTemplateAddonKeys.includes(addon.key);
                  const billingModeLabel = BILLING_MODE_LABELS[addon.billingMode] ?? addon.billingMode;
                  const intervalLabel = INTERVAL_LABELS[addon.interval] ?? addon.interval;

                  return (
                    <label
                      key={addon.key}
                      className={`flex items-start gap-2 rounded border px-3 py-2 cursor-pointer ${
                        isEnabled ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(event) => handleToggleTemplateAddon(addon.key, event.target.checked)}
                      />
                      <span className="text-xs text-slate-700">
                        <span className="block font-medium text-slate-800">{addon.label}</span>
                        <span className="block">
                          {addon.unitPrice.toFixed(2)} EUR | {billingModeLabel} | {intervalLabel}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {towerPlanMode === "undecided" && (
            <div className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-3">
              <p className="text-sm text-slate-700">
                Du kannst zuerst den Lageplan hochladen oder ohne Plan direkt in die Kalkulation gehen.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUploadButtonClick}
                  className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 text-sm"
                >
                  Plan hochladen
                </button>
                <button
                  type="button"
                  onClick={handleContinueWithoutPlan}
                  disabled={!selectedTowerTemplate}
                  className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 text-sm"
                >
                  Ohne Plan fortfahren
                </button>
              </div>
            </div>
          )}

          {towerPlanMode === "with-plan" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUploadButtonClick}
                  className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 text-sm"
                >
                  Plan wechseln
                </button>
                <button
                  type="button"
                  onClick={handleContinueWithoutPlan}
                  disabled={!selectedTowerTemplate}
                  className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 text-sm"
                >
                  Ohne Plan fortfahren
                </button>
                <button
                  type="button"
                  onClick={handleApplyTowerItemsToQuote}
                  disabled={!selectedTowerTemplate || placedTowers.length === 0}
                  className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 text-sm disabled:opacity-50"
                >
                  Mengen aus Einzeichnung übernehmen
                </button>
                <button
                  type="button"
                  onClick={handleActivatePlacementMode}
                  disabled={!currentPlan || !selectedTowerTemplate}
                  className={`inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 px-4 py-2 text-sm disabled:opacity-50 ${
                    isPlacementModeActive
                      ? "bg-blue-700 text-white hover:bg-blue-800"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  Turm platzieren
                </button>
                <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={isMultiPlacementMode}
                    onChange={(event) => handleMultiPlacementToggle(event.target.checked)}
                    disabled={!currentPlan || !selectedTowerTemplate}
                  />
                  Mehrfach platzieren
                </label>
                <button
                  type="button"
                  onClick={proceedToCalculation}
                  disabled={!currentPlan || !selectedTowerTemplate}
                  className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-emerald-600 text-white hover:bg-emerald-700 px-4 py-2 text-sm disabled:opacity-50"
                >
                  Weiter zur Kalkulation
                </button>
              </div>
              {isPlacementModeActive && (
                <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                  Platzierungsmodus aktiv. Der nächste Klick auf freie Fläche setzt einen Turm.
                </p>
              )}

              {!selectedTowerTemplate && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Bitte zuerst eine Turmvorlage auswählen, bevor Einheiten platziert werden.
                </p>
              )}

              {!currentPlan && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Noch kein Lageplan geladen. Unterstützte Formate: PDF, PNG, JPG.
                </p>
              )}

              {currentPlan && (
                <div className="flex gap-4 min-h-[560px]">
                  <PlannerToolbar
                    zoomLevel={viewState.zoomLevel}
                    planLabel={toolbarSubtitle}
                    calibration={currentPlan.calibration}
                    scaleDenominatorInput={scaleDenominatorInput}
                    referenceMetersInput={referenceMetersInput}
                    measuredPixelDistance={measuredPixelDistance}
                    isMeasuring={isMeasuring}
                    towerTemplates={selectedTowerTemplate ? [selectedTowerTemplate] : []}
                    selectedTowerTemplateId={selectedTowerTemplateId}
                    placedTowerCount={placedTowers.length}
                    dayNightMode={dayNightMode}
                    customerName={customerName}
                    projectName={projectName}
                    durationMonths={durationMonths}
                    isPdfGenerating={isPdfGenerating}
                    isQuoteSaving={isQuoteSaving}
                    selectedTower={selectedTower}
                    selectedCamera={selectedCamera}
                    selectedTowerTemplate={selectedTowerTemplateDefinition}
                    onResetView={handleResetTowerView}
                    onScaleDenominatorInputChange={setScaleDenominatorInput}
                    onReferenceMetersInputChange={setReferenceMetersInput}
                    onApplyScale={handleApplyScale}
                    onToggleMeasuring={handleToggleMeasuring}
                    onApplyReferenceDistance={handleApplyReferenceDistance}
                    onSelectTowerTemplate={handleSelectTowerTemplate}
                    onDayNightModeChange={setDayNightMode}
                    onCustomerNameChange={setCustomerName}
                    onProjectNameChange={setProjectName}
                    onDurationMonthsChange={setDurationMonths}
                    onSaveQuote={() => void handleSaveQuote()}
                    onDownloadPdf={() => void handleDownloadPdf()}
                    onRemoveSelectedTower={removeSelectedTower}
                    onSelectCamera={(towerId, slotId) => handleSelectCamera({ towerId, slotId })}
                    onSetTowerCameraCustomRotation={updateTowerCameraRotation}
                    onSetTowerCameraActive={handleSetTowerCameraActive}
                    onUpdateTowerCameraConfiguration={updateTowerCameraConfiguration}
                    showOfferSection={false}
                  />

                  <PlannerCanvas
                    currentPlan={currentPlan}
                    viewState={viewState}
                    onViewStateChange={setViewState}
                    isMeasuring={isMeasuring}
                    measurePoints={measurePoints}
                    onMeasurePoint={handleMeasurePoint}
                    selectedTowerTemplate={selectedTowerTemplate}
                    isPlacementModeActive={isPlacementModeActive}
                    towerTemplates={towerTemplatesCatalog}
                    placedTowers={placedTowers}
                    dayNightMode={dayNightMode}
                    selectedTowerId={selectedTowerId}
                    selectedCamera={selectedCamera}
                    onPlaceTower={handlePlaceTower}
                    onMoveTower={handleMoveTower}
                    onRotateTower={handleRotateTower}
                    onSelectCamera={handleSelectCamera}
                    updateTowerCameraRotation={updateTowerCameraRotation}
                    onUpdateTowerCameraConfiguration={updateTowerCameraConfiguration}
                    onSelectTower={selectTower}
                    onClearTowerSelection={clearTowerSelection}
                    snapshotRequestId={snapshotRequestId}
                    onSnapshotCaptured={handleSnapshotCaptured}
                    resetCounter={resetCounter}
                  />

                  <PlacedTowersSidebar
                    towers={placedTowerEntries}
                    selectedTowerId={selectedTowerId}
                    onSelectTower={selectTower}
                    onRenameTower={renameTower}
                    onDeleteTower={removeTower}
                  />
                </div>
              )}
            </div>
          )}

          {towerPlanMode === "without-plan" && (
            <div className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-3">
              {selectedTowerTemplate && (
                <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-2 space-y-1">
                  <p className="font-medium text-slate-800">Aktive Turmvorlage: {selectedTowerTemplate.label}</p>
                  <p>Energieart: {getPowerTypeLabel(selectedTowerTemplate)}</p>
                  <p>
                    Kameratypen: {selectedTowerTemplateCameraSummary.length > 0
                      ? selectedTowerTemplateCameraSummary.map((entry) => `${getCameraTypeLabel(entry.type)} (${entry.count})`).join(", ")
                      : "Keine"}
                  </p>
                  <p>
                    Zusatzpositionen: {selectedTemplateEnabledAddonLabels.length > 0
                      ? selectedTemplateEnabledAddonLabels.join(", ")
                      : "Keine"}
                  </p>
                </div>
              )}

              <p className="text-sm text-slate-700">
                Du arbeitest ohne Lageplan. Die Kalkulation ist aktiv, technische Details kannst du später optional manuell in den Angebots-Hinweisen erfassen.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUploadButtonClick}
                  className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 text-sm"
                >
                  Plan hochladen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (currentPlan) {
                      setTowerPlanMode("with-plan");
                      setIsVideotowerPlanningCompleted(false);
                    }
                  }}
                  disabled={!currentPlan}
                  className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 text-sm disabled:opacity-50"
                >
                  Vorhandenen Plan verwenden
                </button>
                <button
                  type="button"
                  onClick={handleApplyTowerItemsToQuote}
                  disabled={!selectedTowerTemplate}
                  className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 text-sm disabled:opacity-50"
                >
                  Positionen aus Vorlage übernehmen
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Kalkulation ──────────────────────────────────────────────────── */}
      {serviceType && canShowQuoteSections && (
        <section id="planner-kalkulation" className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Preisübersicht</h3>
              <p className="text-sm text-slate-500">
                {QUOTE_SERVICE_TYPE_LABELS[serviceType]} | {offerPreviewFacts.join(" | ")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsManualPricingOpen((prev) => !prev)}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              {isManualPricingOpen ? "Manuelle Preise ausblenden" : "Preise manuell anpassen"}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Monatspreis</p>
              <p className="text-xl font-semibold text-slate-900">{quoteTotals.monthlyTotal.toFixed(2)} EUR</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Einmalig</p>
              <p className="text-xl font-semibold text-slate-900">{quoteTotals.oneTimeTotal.toFixed(2)} EUR</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Gesamt netto</p>
              <p className="text-xl font-semibold text-slate-900">{quoteTotals.totalNet.toFixed(2)} EUR</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2">
              <p className="text-xs text-slate-300">Gesamt brutto</p>
              <p className="text-xl font-semibold text-white">{quoteTotals.totalGross.toFixed(2)} EUR</p>
            </div>
          </div>

          {isManualPricingOpen && (
            <>
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSelectServiceType(serviceType, true)}
                className="px-3 py-2 rounded text-sm bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Standardpositionen zurücksetzen
              </button>
              <button type="button" onClick={handleAddQuoteLineItem} className="px-3 py-2 rounded text-sm bg-blue-600 text-white hover:bg-blue-700">
                Position hinzufügen
              </button>
              </div>
              <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2 border-b border-slate-200">Bezeichnung</th>
                  <th className="text-left px-3 py-2 border-b border-slate-200">Beschreibung</th>
                  <th className="text-left px-3 py-2 border-b border-slate-200">Menge</th>
                  <th className="text-left px-3 py-2 border-b border-slate-200">Einheit</th>
                  <th className="text-left px-3 py-2 border-b border-slate-200">
                    {serviceType === "revierdienst" ? "Preis pro Kontrolle (EUR)" : "Einzelpreis (EUR)"}
                  </th>
                  <th className="text-left px-3 py-2 border-b border-slate-200">Leistungs-Kalkulation</th>
                  <th className="text-left px-3 py-2 border-b border-slate-200">Abrechnung</th>
                  <th className="text-left px-3 py-2 border-b border-slate-200">Intervall</th>
                  <th className="text-left px-3 py-2 border-b border-slate-200">Bereich</th>
                  <th className="text-right px-3 py-2 border-b border-slate-200">Gesamt (EUR)</th>
                  <th className="text-right px-3 py-2 border-b border-slate-200">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {quoteTotals.lineItems.map((item) => {
                  const isRevierdienstPosition = isRevierdienstCalculationPosition(item, serviceType);
                  const revierBreakdown = calculateRevierdienstBreakdown(item);
                  const isPersonnelPosition = isPersonnelCalculationPosition(item, serviceType);
                  const personnelBreakdown = calculatePersonnelBreakdown(item);
                  const showSurchargeFields = isRevierdienstPosition || isPersonnelPosition;

                  return (
                    <tr key={item.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-3 py-2"><input type="text" value={item.label} onChange={(e) => handleUpdateQuoteLineItem(item.id, { label: e.target.value })} className="w-full border border-slate-300 rounded px-2 py-1.5" /></td>
                      <td className="px-3 py-2"><input type="text" value={item.description ?? ""} onChange={(e) => handleUpdateQuoteLineItem(item.id, { description: e.target.value })} className="w-full border border-slate-300 rounded px-2 py-1.5" /></td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={item.quantity}
                          onChange={(e) => handleUpdateQuoteLineItem(item.id, { quantity: parseNonNegativeNumber(e.target.value) })}
                          disabled={isRevierdienstPosition}
                          className="w-full border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </td>
                      <td className="px-3 py-2"><input type="text" value={item.unit} onChange={(e) => handleUpdateQuoteLineItem(item.id, { unit: e.target.value })} className="w-full border border-slate-300 rounded px-2 py-1.5" /></td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={isRevierdienstPosition ? item.preisProKontrolle ?? item.unitPrice : item.unitPrice}
                          onChange={(e) => {
                            const nextPrice = parseNonNegativeNumber(e.target.value);
                            handleUpdateQuoteLineItem(item.id, isRevierdienstPosition
                              ? { unitPrice: nextPrice, preisProKontrolle: nextPrice }
                              : { unitPrice: nextPrice });
                          }}
                          className="w-full border border-slate-300 rounded px-2 py-1.5"
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        {isRevierdienstPosition ? (
                          <div className="space-y-2 min-w-[340px]">
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs text-slate-600">
                                Kontrollen/Tag (Werktag)
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.kontrollenProTagWerktag ?? 2}
                                  onChange={(e) => handleUpdateQuoteLineItem(item.id, { kontrollenProTagWerktag: parseNonNegativeNumber(e.target.value) })}
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Kontrollen/Tag (Samstag)
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.kontrollenProTagSamstag ?? item.kontrollenProTagWochenende ?? 1}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      kontrollenProTagSamstag: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Kontrollen/Tag (Sonntag)
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.kontrollenProTagSonntag ?? item.kontrollenProTagWochenende ?? 1}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      kontrollenProTagSonntag: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Kontrollen/Tag (Feiertag)
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.kontrollenProTagFeiertag ?? 1}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      kontrollenProTagFeiertag: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Nachtkontrollen/Tag
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.nachtKontrollenProTag ?? 0}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      nachtKontrollenProTag: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Tage Werktage
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.tageWerktage ?? 30}
                                  onChange={(e) => handleUpdateQuoteLineItem(item.id, { tageWerktage: parseNonNegativeNumber(e.target.value) })}
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Tage Samstag
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.tageSamstag ?? Math.floor((item.tageWochenende ?? 0) / 2)}
                                  onChange={(e) => handleUpdateQuoteLineItem(item.id, { tageSamstag: parseNonNegativeNumber(e.target.value) })}
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Tage Sonntag
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.tageSonntag ?? Math.ceil((item.tageWochenende ?? 0) / 2)}
                                  onChange={(e) => handleUpdateQuoteLineItem(item.id, { tageSonntag: parseNonNegativeNumber(e.target.value) })}
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Tage Feiertag
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.tageFeiertag ?? 0}
                                  onChange={(e) => handleUpdateQuoteLineItem(item.id, { tageFeiertag: parseNonNegativeNumber(e.target.value) })}
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                            </div>
                            {showSurchargeFields && (
                              <div className="grid grid-cols-2 gap-2">
                                <label className="text-xs text-slate-600">
                                  Samstag-Zuschlag (%)
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={item.samstagZuschlagPercent ?? 25}
                                    onChange={(e) => handleUpdateQuoteLineItem(item.id, { samstagZuschlagPercent: parseNonNegativeNumber(e.target.value) })}
                                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                  />
                                </label>
                                <label className="text-xs text-slate-600">
                                  Sonntag-Zuschlag (%)
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={item.sonntagZuschlagPercent ?? 50}
                                    onChange={(e) => handleUpdateQuoteLineItem(item.id, { sonntagZuschlagPercent: parseNonNegativeNumber(e.target.value) })}
                                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                  />
                                </label>
                                <label className="text-xs text-slate-600">
                                  Feiertag-Zuschlag (%)
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={item.feiertagZuschlagPercent ?? 100}
                                    onChange={(e) => handleUpdateQuoteLineItem(item.id, { feiertagZuschlagPercent: parseNonNegativeNumber(e.target.value) })}
                                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                  />
                                </label>
                                <label className="text-xs text-slate-600">
                                  Nacht-Zuschlag (%)
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={item.nachtZuschlagPercent ?? 25}
                                    onChange={(e) => handleUpdateQuoteLineItem(item.id, { nachtZuschlagPercent: parseNonNegativeNumber(e.target.value) })}
                                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                  />
                                </label>
                              </div>
                            )}
                            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 space-y-0.5">
                              <p className="flex justify-between"><span>Tagespreis Werktag</span><span>{revierBreakdown.dailyWeekdayPrice.toFixed(2)} EUR</span></p>
                              <p className="flex justify-between"><span>Tagespreis Samstag</span><span>{revierBreakdown.dailySaturdayPrice.toFixed(2)} EUR</span></p>
                              <p className="flex justify-between"><span>Tagespreis Sonntag</span><span>{revierBreakdown.dailySundayPrice.toFixed(2)} EUR</span></p>
                              <p className="flex justify-between"><span>Tagespreis Feiertag</span><span>{revierBreakdown.dailyHolidayPrice.toFixed(2)} EUR</span></p>
                              <p className="flex justify-between"><span>Nachtzuschlag/Tag</span><span>{revierBreakdown.dailyNightPrice.toFixed(2)} EUR</span></p>
                              <p className="flex justify-between font-semibold text-slate-800"><span>Monatspreis</span><span>{revierBreakdown.monthlyPrice.toFixed(2)} EUR</span></p>
                            </div>
                          </div>
                        ) : isPersonnelPosition ? (
                          <div className="space-y-2 min-w-[340px]">
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs text-slate-600">
                                Std/Tag
                                <input
                                  type="number"
                                  min={0}
                                  step={0.5}
                                  value={item.stundenProTag ?? 8}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      stundenProTag: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Nachtstunden/Tag
                                <input
                                  type="number"
                                  min={0}
                                  step={0.5}
                                  value={item.nachtStundenProTag ?? 0}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      nachtStundenProTag: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Tage Werktage
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.tageWerktage ?? 30}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      tageWerktage: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Tage Samstag
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.tageSamstag ?? 0}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      tageSamstag: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Tage Sonntag
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.tageSonntag ?? 0}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      tageSonntag: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Tage Feiertag
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.tageFeiertag ?? 0}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      tageFeiertag: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs text-slate-600">
                                Samstag-Zuschlag (%)
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.samstagZuschlagPercent ?? 25}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      samstagZuschlagPercent: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Sonntag-Zuschlag (%)
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.sonntagZuschlagPercent ?? 50}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      sonntagZuschlagPercent: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Feiertag-Zuschlag (%)
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.feiertagZuschlagPercent ?? 100}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      feiertagZuschlagPercent: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                              <label className="text-xs text-slate-600">
                                Nacht-Zuschlag (%)
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={item.nachtZuschlagPercent ?? 25}
                                  onChange={(e) =>
                                    handleUpdateQuoteLineItem(item.id, {
                                      nachtZuschlagPercent: parseNonNegativeNumber(e.target.value),
                                    })
                                  }
                                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5"
                                />
                              </label>
                            </div>
                            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                              <p className="flex justify-between">
                                <span>Tagespreis Werktag</span>
                                <span>{personnelBreakdown.dailyWeekdayPrice.toFixed(2)} EUR</span>
                              </p>
                              <p className="flex justify-between">
                                <span>Tagespreis Samstag</span>
                                <span>{personnelBreakdown.dailySaturdayPrice.toFixed(2)} EUR</span>
                              </p>
                              <p className="flex justify-between">
                                <span>Tagespreis Sonntag</span>
                                <span>{personnelBreakdown.dailySundayPrice.toFixed(2)} EUR</span>
                              </p>
                              <p className="flex justify-between">
                                <span>Tagespreis Feiertag</span>
                                <span>{personnelBreakdown.dailyHolidayPrice.toFixed(2)} EUR</span>
                              </p>
                              <p className="flex justify-between">
                                <span>Nachtzuschlag/Tag</span>
                                <span>{personnelBreakdown.dailyNightPrice.toFixed(2)} EUR</span>
                              </p>
                              <p className="flex justify-between font-medium text-slate-800">
                                <span>Monatspreis</span>
                                <span>{personnelBreakdown.monthlyPrice.toFixed(2)} EUR</span>
                              </p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={item.billingMode}
                          onChange={(e) =>
                            handleUpdateQuoteLineItem(item.id, { billingMode: e.target.value as QuoteLineItem["billingMode"] })
                          }
                          disabled={isRevierdienstPosition}
                          className="w-full border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          {Object.entries(BILLING_MODE_LABELS).map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={item.interval}
                          onChange={(e) =>
                            handleUpdateQuoteLineItem(item.id, { interval: e.target.value as QuoteLineItem["interval"] })
                          }
                          disabled={isRevierdienstPosition}
                          className="w-full border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          {Object.entries(INTERVAL_LABELS).map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={item.category ?? "custom"}
                          onChange={(e) => handleUpdateQuoteLineItem(item.id, { category: e.target.value })}
                          className="w-full border border-slate-300 rounded px-2 py-1.5"
                        >
                          {CATEGORY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                          {!CATEGORY_OPTIONS.some((option) => option.value === item.category) && item.category && (
                            <option value={item.category}>{item.category}</option>
                          )}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700 font-medium">{item.totalPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right"><button type="button" onClick={() => handleDeleteQuoteLineItem(item.id)} className="px-2 py-1.5 rounded text-xs bg-red-50 text-red-700 hover:bg-red-100">Löschen</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <div>
              <label htmlFor="discountAmount" className="block text-sm font-medium text-slate-700 mb-1">Rabatt (EUR)</label>
              <input id="discountAmount" type="number" min={0} step={0.01} value={discountAmount} onChange={(e) => setDiscountAmount(parseNonNegativeNumber(e.target.value))} className="w-full max-w-xs border border-slate-300 rounded px-3 py-2" />
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1 text-sm">
              <p className="flex justify-between"><span>Wiederkehrend</span><span>{quoteTotals.monthlyTotal.toFixed(2)} EUR</span></p>
              <p className="flex justify-between"><span>Einmalig</span><span>{quoteTotals.oneTimeTotal.toFixed(2)} EUR</span></p>
              <p className="flex justify-between"><span>Zwischensumme</span><span>{quoteTotals.subtotal.toFixed(2)} EUR</span></p>
              <p className="flex justify-between"><span>Rabatt</span><span>- {quoteTotals.discountAmount.toFixed(2)} EUR</span></p>
              <p className="flex justify-between font-semibold text-slate-800"><span>Gesamt netto</span><span>{quoteTotals.totalNet.toFixed(2)} EUR</span></p>
              <p className="flex justify-between font-semibold text-slate-800"><span>Gesamt brutto</span><span>{quoteTotals.totalGross.toFixed(2)} EUR</span></p>
            </div>
          </div>
            </>
          )}
        </section>
      )}

      {serviceType && canShowQuoteSections && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Zusatzleistungen</h3>
              <p className="text-sm text-slate-500">
                Bedarfsleistungen auf Anforderung, nicht Teil der laufenden Monatskalkulation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOnDemandSectionOpen((prev) => !prev)}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              {isOnDemandSectionOpen ? "Zusatzleistungen ausblenden" : "Zusatzleistungen hinzufügen"}
            </button>
          </div>

          {isOnDemandSectionOpen && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => handleAddOnDemandPreset("intervention")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Intervention</button>
              <button type="button" onClick={() => handleAddOnDemandPreset("wachdienst")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Wachmann auf Anforderung</button>
              <button type="button" onClick={() => handleAddOnDemandPreset("sonderkontrolle")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Sonderkontrollen</button>
              <button type="button" onClick={() => handleAddOnDemandPreset("schluesseltausch")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Schlüsseltausch</button>
            </div>
          )}

          {onDemandLineItems.length > 0 && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-3 px-4 py-3 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>Leistung</span>
                <span>Abrechnung</span>
                <span className="text-right">Preis</span>
                <span />
              </div>
              {onDemandLineItems.map((item) => (
                <div key={item.id} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-3 px-4 py-3 border-t border-slate-100 items-center">
                  <span className="text-sm text-slate-800">{item.description ? `${item.label} - ${item.description}` : item.label}</span>
                  <span className="text-sm text-slate-600">{item.unit}</span>
                  <span className="text-sm text-slate-800 text-right">{item.unitPrice.toFixed(2)} EUR</span>
                  <button type="button" onClick={() => handleDeleteQuoteLineItem(item.id)} className="text-xs rounded bg-rose-50 text-rose-700 px-2 py-1 hover:bg-rose-100">Entfernen</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Angebotstexte ─────────────────────────────────────────────────── */}
      {serviceType && canShowQuoteSections && (
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-800">Angebotstexte</h3>
              <p className="text-sm text-slate-500">Automatisch oder manuell erstellte Texte für das Angebotsdokument.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAiModalOpen(true)}
                className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 text-sm"
              >
                Mit KI verfeinern
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateText()}
                disabled={isTextGenerating}
                className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 text-sm disabled:opacity-50"
              >
                {isTextGenerating ? "Generiert..." : "Neu generieren"}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Hinterlegte ViorAI-Hinweise: {filledAiHintCount} von 5 Feldern.
          </p>
          <div>
            <label htmlFor="generatedText" className="block text-sm font-medium text-slate-700 mb-1">Angebotstext</label>
            <textarea id="generatedText" rows={5} value={generatedText} onChange={(e) => setGeneratedText(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="conceptText" className="block text-sm font-medium text-slate-700 mb-1">Konzepttext</label>
            <textarea id="conceptText" rows={5} value={conceptText} onChange={(e) => setConceptText(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </section>
      )}

      {serviceType && canShowQuoteSections && (
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Versand</h3>
            <p className="text-sm text-slate-500">Angebot per E-Mail mit PDF-Anhang versenden.</p>
          </div>
          <div>
            <label htmlFor="emailRecipient" className="block text-sm font-medium text-slate-700 mb-1">Empfänger</label>
            <input id="emailRecipient" type="email" value={emailRecipient} onChange={(e) => setEmailRecipient(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="emailSubject" className="block text-sm font-medium text-slate-700 mb-1">Betreff</label>
            <input id="emailSubject" type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="emailText" className="block text-sm font-medium text-slate-700 mb-1">Text</label>
            <textarea id="emailText" rows={5} value={emailText} onChange={(e) => setEmailText(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </section>
      )}

      {serviceType && isAiModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
          <div className="w-full max-w-2xl bg-white rounded-lg border border-slate-200 shadow-xl p-4 space-y-4">
            <div>
              <h4 id="ai-modal-title" className="text-base font-semibold text-slate-800">Angebotstext mit KI anpassen</h4>
              <p className="text-sm text-slate-500">Erfasse 4-5 kurze Hinweise. Diese Angaben fließen direkt in die ViorAI-Textgenerierung ein.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="aiSpecialContext" className="block text-sm font-medium text-slate-700 mb-1">Besonderheiten des Einsatzes</label>
                <textarea
                  id="aiSpecialContext"
                  rows={3}
                  value={aiGuidance.specialContext}
                  onChange={(e) => setAiGuidance((prev) => ({ ...prev, specialContext: e.target.value }))}
                  placeholder="z. B. Nachtbaustelle, hohe Publikumsfrequenz, sensible Zufahrten"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="aiRelevantTechnology" className="block text-sm font-medium text-slate-700 mb-1">Relevante Technik / Ausstattung</label>
                <textarea
                  id="aiRelevantTechnology"
                  rows={3}
                  value={aiGuidance.relevantTechnology}
                  onChange={(e) => setAiGuidance((prev) => ({ ...prev, relevantTechnology: e.target.value }))}
                  placeholder="z. B. Videoturm, PTZ-Kamera, Zutrittskontrolle, NSL-Aufschaltung"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="aiImportantServices" className="block text-sm font-medium text-slate-700 mb-1">Wichtige Leistungen</label>
                <textarea
                  id="aiImportantServices"
                  rows={3}
                  value={aiGuidance.importantServices}
                  onChange={(e) => setAiGuidance((prev) => ({ ...prev, importantServices: e.target.value }))}
                  placeholder="z. B. Revierfahrten, Interventionszeiten, Berichtswesen"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="aiCustomerNotes" className="block text-sm font-medium text-slate-700 mb-1">Kundenrelevante Hinweise</label>
                <textarea
                  id="aiCustomerNotes"
                  rows={3}
                  value={aiGuidance.customerNotes}
                  onChange={(e) => setAiGuidance((prev) => ({ ...prev, customerNotes: e.target.value }))}
                  placeholder="z. B. gewünschter Starttermin, Ansprechpartner, Abstimmungsrhythmus"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="aiOtherRequirements" className="block text-sm font-medium text-slate-700 mb-1">Sonstige Vorgaben</label>
              <textarea
                id="aiOtherRequirements"
                rows={3}
                value={aiGuidance.otherRequirements}
                onChange={(e) => setAiGuidance((prev) => ({ ...prev, otherRequirements: e.target.value }))}
                placeholder="z. B. Tonalität, Ausschluss bestimmter Formulierungen, Compliance-Hinweise"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAiModalOpen(false)}
                disabled={isTextGenerating}
                className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-4 py-2 text-sm disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateText()}
                disabled={isTextGenerating}
                className="inline-flex items-center gap-2 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 text-sm disabled:opacity-50"
              >
                {isTextGenerating ? "Generiert..." : "Neu generieren"}
              </button>
            </div>
          </div>
        </div>
      )}

      {serviceType && canShowQuoteSections && (
        <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <p className="mb-3 text-sm font-medium text-slate-700">Aktionen</p>
          {actionButtons}
        </section>
      )}

      {errorMessage && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{errorMessage}</p>
      )}
    </div>
  );
}

function parseNonNegativeNumber(value: string): number {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function parseHourInputValue(value: string): number {
  const normalized = value.replace(",", ".").trim().toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return 0;
  }

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function buildDefaultOfferText(input: {
  serviceType: QuoteServiceType;
  customer: Customer | null;
  project?: Project | null;
  durationLabel?: string;
  companySettings: CompanySettings | null;
  signatureName?: string;
}): string {
  const salutation = input.customer?.contactName?.trim()
    ? `Guten Tag ${input.customer.contactName.trim()},`
    : "Sehr geehrte Damen und Herren,";

  const standardServiceText = input.companySettings?.offerTextTemplates?.[input.serviceType]?.trim();
  const fallbackIntro = input.companySettings?.introText?.trim();
  const body =
    standardServiceText
    || fallbackIntro
    || `vielen Dank für Ihre Anfrage. Nachfolgend erhalten Sie unser Angebot für ${QUOTE_SERVICE_TYPE_LABELS[input.serviceType]}.`;
  const bodyWithPlaceholders = applyOfferTextPlaceholders(body, {
    customerName: input.customer?.companyName,
    contactName: input.customer?.contactName,
    serviceLabel: QUOTE_SERVICE_TYPE_LABELS[input.serviceType],
    projectName: input.project?.name,
    projectLocation: input.project?.siteAddress ?? input.project?.location,
    startDate: input.project?.startDate,
    durationLabel: input.durationLabel,
  });

  const closing = buildClosingWithSignature(input.companySettings, input.signatureName);

  return `${salutation}\n\n${bodyWithPlaceholders}\n\n${closing}`.trim();
}

function buildClosingWithSignature(
  companySettings: CompanySettings | null,
  signatureName?: string
): string {
  const closingLine = companySettings?.closingText?.trim() || "Mit freundlichen Grüßen";
  const signer = signatureName?.trim()
    || companySettings?.contactPerson?.trim()
    || companySettings?.companyName?.trim()
    || "Ihr Team";

  return `${closingLine}\n\n${signer}`;
}

async function resolveCurrentUserSignatureName(
  companySettings: CompanySettings | null
): Promise<string> {
  try {
    const supabase = getSupabaseClient();
    const [{ data: userResult }, tenantContext] = await Promise.all([
      getSupabaseUserSafe(supabase),
      tryResolveTenantContext(supabase),
    ]);

    const user = userResult.user;
    if (user?.id && tenantContext?.tenantId) {
      const { data: tenantUser } = await supabase
        .from("tenant_users")
        .select("full_name")
        .eq("tenant_id", tenantContext.tenantId)
        .eq("auth_user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const fullName = normalizePersonName((tenantUser as { full_name?: string | null } | null)?.full_name);
      if (fullName) {
        return fullName;
      }
    }

    const metadataName = resolveAuthMetadataName(user?.user_metadata as Record<string, unknown> | undefined);
    if (metadataName) {
      return metadataName;
    }
  } catch {
    // fall through to company fallback
  }

  return (
    normalizePersonName(companySettings?.contactPerson)
    || normalizePersonName(companySettings?.companyName)
    || "Ihr Team"
  );
}

function resolveAuthMetadataName(metadata?: Record<string, unknown>): string | null {
  if (!metadata) {
    return null;
  }

  const candidates = [
    metadata.full_name,
    metadata.name,
    metadata.display_name,
  ];

  for (const candidate of candidates) {
    const normalized = normalizePersonName(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizePersonName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseRuntimeMonths(runtimeLabel?: string): number {
  if (!runtimeLabel) return 1;
  const match = runtimeLabel.match(/\d+/);
  return match ? Math.max(1, Number(match[0]) || 1) : 1;
}

function applyOfferTextPlaceholders(
  text: string,
  context: {
    customerName?: string;
    contactName?: string;
    serviceLabel: string;
    projectName?: string;
    projectLocation?: string;
    startDate?: string;
    durationLabel?: string;
  }
): string {
  const replacements: Record<string, string> = {
    EINSATZORT: context.projectLocation ?? "-",
    KUNDE: context.customerName ?? "-",
    ANSPRECHPARTNER: context.contactName ?? "-",
    LEISTUNGSART: context.serviceLabel,
    PROJEKT: context.projectName ?? "-",
    STARTDATUM: context.startDate ?? "-",
    LAUFZEIT: context.durationLabel ?? "monatliche Abrechnung",
  };

  let result = text;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(`\\[${key}\\]`, "gi"), value);
  }

  return result;
}

function getDefaultRuntimeMonths(standardRuntimeMonths?: number): number {
  if (Number.isFinite(standardRuntimeMonths)) {
    return Math.max(1, Number(standardRuntimeMonths));
  }

  return 1;
}

function resolveContractTermContext(
  runtimeLabel?: string,
  standardRuntimeMonths?: number
): { mode: ContractTermMode; months: number } {
  const normalized = runtimeLabel?.toLowerCase().trim() ?? "";
  if (!normalized) {
    return { mode: "until_revocation", months: getDefaultRuntimeMonths(standardRuntimeMonths) };
  }

  if (normalized.includes("widerruf")) {
    return { mode: "until_revocation", months: 1 };
  }

  if (normalized.includes("unbefristet")) {
    return { mode: "indefinite", months: 1 };
  }

  const months = runtimeLabel
    ? parseRuntimeMonths(runtimeLabel)
    : getDefaultRuntimeMonths(standardRuntimeMonths);

  return { mode: "fixed", months };
}

function isHourBasedServiceType(serviceType: QuoteServiceType | null): boolean {
  return serviceType === "objektschutz"
    || serviceType === "empfangsdienst"
    || serviceType === "sonderdienste"
    || serviceType === "werkschutz"
    || serviceType === "intervention";
}

function createDefaultValidUntil(defaultValidityDays?: number): string {
  const validUntil = new Date();
  const days = Number.isFinite(defaultValidityDays) ? Math.max(1, Number(defaultValidityDays)) : 14;
  validUntil.setDate(validUntil.getDate() + days);
  return validUntil.toISOString().slice(0, 10);
}

async function loadImageFromFile(file: File): Promise<LoadedPlannerAsset> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageFromUrl(objectUrl);
    const sourceDataUrl = await readFileAsDataUrl(file);
    return {
      image,
      sourceDataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderPdfFirstPage(file: File): Promise<LoadedPlannerAsset> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.6 });
  const renderCanvas = document.createElement("canvas");
  const ctx = renderCanvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas context could not be created.");
  }

  renderCanvas.width = Math.ceil(viewport.width);
  renderCanvas.height = Math.ceil(viewport.height);

  await page.render({ canvas: renderCanvas, canvasContext: ctx, viewport }).promise;

  const imageDataUrl = renderCanvas.toDataURL("image/png");
  const image = await loadImageFromUrl(imageDataUrl);

  pdf.cleanup();
  await loadingTask.destroy();

  return {
    image,
    sourceDataUrl: imageDataUrl,
  };
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load failed"));
    image.src = url;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Datei konnte nicht als Data URL gelesen werden."));
    };
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function getPlannerStateStorageKey(projectId: string): string {
  return `${PLANNER_STATE_STORAGE_PREFIX}${projectId}`;
}

function getDefaultTowerDisplayName(
  template: TowerTemplate,
  placedTowers: PlannerPlacedTower[]
): string {
  const baseName = template.label.split("(")[0]?.trim() || "Turm";
  const neutralName = baseName === "Turm" ? "Einheit" : baseName;
  const sameTemplateCount = placedTowers.filter((tower) => tower.templateId === template.id).length;
  return `${neutralName} ${sameTemplateCount + 1}`;
}

function createPlacedCameraConfigurations(
  template: TowerTemplate
): PlannerPlacedTowerCameraConfiguration[] {
  return template.cameraSlots
    .map((slot) => {
      const cameraType = resolveSlotCameraType(slot);
      const defaults = getPlannerCameraZoneDefaults(cameraType);
      return normalizePlannerCameraConfiguration({
        slotId: slot.slotId,
        cameraType,
        active: slot.isActive !== false,
        customRotationDeg: 0,
        fieldOfViewDeg: defaults.fieldOfViewDeg,
        alarmRangeMeters: defaults.alarmRangeMeters,
        detectionRangeMeters: defaults.detectionRangeMeters,
        observationRangeMeters: defaults.observationRangeMeters,
      });
    });
}

function resolveSlotCameraType(
  slot: TowerTemplate["cameraSlots"][number]
): TowerSlotCameraType {
  if (slot.cameraType) {
    return slot.cameraType;
  }

  const legacyModel = slot.defaultCameraModelId?.toLowerCase() ?? "";
  if (legacyModel.includes("thermal")) {
    return "thermal";
  }
  if (legacyModel.includes("bullet")) {
    return "bullet";
  }
  if (legacyModel.includes("dome")) {
    return "dome";
  }
  if (legacyModel.includes("ptz")) {
    return "ptz";
  }

  return "none";
}

function resolveTemplatePowerType(template: TowerTemplate): TowerPowerType | null {
  if (template.powerType) {
    return template.powerType;
  }

  if (template.powerMode === "grid") {
    return "grid";
  }

  if (template.powerMode === "autark" || template.autark) {
    return "hybrid";
  }

  return null;
}

function getPowerTypeLabel(template: TowerTemplate): string {
  const powerType = resolveTemplatePowerType(template);
  switch (powerType) {
    case "grid":
      return "Netz";
    case "battery":
      return "Batterie";
    case "efoy":
      return "EFOY";
    case "diesel":
      return "Diesel";
    case "solar":
      return "Solar";
    case "hybrid":
      return "Hybrid";
    default:
      return "Nicht definiert";
  }
}

function getCameraTypeLabel(cameraType: TowerSlotCameraType): string {
  switch (cameraType) {
    case "ptz":
      return "PTZ";
    case "bullet":
      return "Bullet";
    case "thermal":
      return "Thermal";
    case "dome":
      return "Dome";
    default:
      return "Keine";
  }
}

function normalizeStandardComponentKey(value: string): "led" | "speaker" | "siren" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "led") {
    return "led";
  }
  if (normalized === "speaker" || normalized === "lautsprecher") {
    return "speaker";
  }
  if (normalized === "siren" || normalized === "sirene") {
    return "siren";
  }
  return null;
}

function normalizeConnectivityLabel(value: string): TowerConnectivityType | null {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "lte":
      return "lte";
    case "5g":
      return "5g";
    case "wlan":
    case "wifi":
      return "wlan";
    case "satellite":
    case "sat":
      return "satellite";
    case "lan":
      return "lan";
    default:
      return null;
  }
}

function getConnectivityLabel(type: TowerConnectivityType): string {
  switch (type) {
    case "lte":
      return "LTE";
    case "5g":
      return "5G";
    case "wlan":
      return "WLAN";
    case "satellite":
      return "Satellit";
    case "lan":
      return "LAN";
    default:
      return type;
  }
}

function getComponentLabel(name: string): string {
  const standard = normalizeStandardComponentKey(name);
  if (standard === "led") {
    return "LED";
  }
  if (standard === "speaker") {
    return "Lautsprecher";
  }
  if (standard === "siren") {
    return "Sirene";
  }

  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : "Komponente";
}

function summarizeTemplateCameraTypes(
  template: TowerTemplate
): Array<{ type: TowerSlotCameraType; count: number }> {
  const counts = new Map<TowerSlotCameraType, number>();
  for (const slot of template.cameraSlots) {
    if (slot.isActive === false) {
      continue;
    }
    const type = resolveSlotCameraType(slot);
    if (type === "none") {
      continue;
    }
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
}

function buildTemplateTechnicalAddons(template: TowerTemplate): TemplateTechnicalAddon[] {
  const addons: TemplateTechnicalAddon[] = [];

  const connectivityTypes = Array.from(new Set(template.connectivityTypes ?? []));
  for (const connectivityType of connectivityTypes) {
    const pricingByConnectivity: Record<TowerConnectivityType, number> = {
      lte: 69,
      "5g": 89,
      wlan: 39,
      satellite: 179,
      lan: 29,
    };

    addons.push({
      key: `connectivity-${connectivityType}`,
      label: `${getConnectivityLabel(connectivityType)}-Konnektivitaet`,
      unitPrice: pricingByConnectivity[connectivityType],
      billingMode: "recurring",
      interval: "monthly",
      category: "connectivity",
    });
  }

  const activeComponents = (template.components ?? []).filter((component) => component.isActive);
  const includedComponentKeys = new Set<string>();

  for (const component of activeComponents) {
    const standardKey = normalizeStandardComponentKey(component.name);
    const componentKey = (standardKey ?? component.name.trim().toLowerCase()).replace(/\s+/g, "-");

    if (!componentKey || includedComponentKeys.has(componentKey)) {
      continue;
    }

    if (normalizeConnectivityLabel(component.name)) {
      continue;
    }

    includedComponentKeys.add(componentKey);

    if (standardKey === "led") {
      addons.push({
        key: "component-led",
        label: "LED-Ausleuchtung",
        unitPrice: 90,
        billingMode: "one_time",
        interval: "once",
        category: "deployment",
        unit: "Turm",
      });
      continue;
    }

    if (standardKey === "speaker") {
      addons.push({
        key: "component-speaker",
        label: "Lautsprecheransprache",
        unitPrice: 59,
        billingMode: "recurring",
        interval: "monthly",
        category: "monitoring",
      });
      continue;
    }

    if (standardKey === "siren") {
      addons.push({
        key: "component-siren",
        label: "Sirenenmodul",
        unitPrice: 49,
        billingMode: "recurring",
        interval: "monthly",
        category: "monitoring",
      });
      continue;
    }

    addons.push({
      key: `component-${componentKey}`,
      label: `${getComponentLabel(component.name)} (Zusatzkomponente)`,
      unitPrice: 35,
      billingMode: "one_time",
      interval: "once",
      category: "equipment",
      unit: "Turm",
    });
  }

  const powerType = resolveTemplatePowerType(template);
  if (powerType && powerType !== "grid") {
    const powerPricing: Record<Exclude<TowerPowerType, "grid">, number> = {
      battery: 120,
      efoy: 179,
      diesel: 149,
      solar: 129,
      hybrid: 169,
    };

    addons.push({
      key: `energy-${powerType}`,
      label: `${getPowerTypeLabel(template)}-Energiepaket`,
      unitPrice: powerPricing[powerType],
      billingMode: "recurring",
      interval: "monthly",
      category: "energy",
    });
  }

  return addons;
}

function buildDefaultEmailSubject(quoteNumber?: string, projectName?: string): string {
  return `${quoteNumber ?? "Angebot"}${projectName ? ` | ${projectName}` : ""}`;
}

function buildDefaultEmailText(quoteNumber?: string, customerName?: string): string {
  const salutation = customerName ? `Guten Tag ${customerName},` : "Guten Tag,";
  return `${salutation}\n\nanbei erhalten Sie unser Angebot${quoteNumber ? ` ${quoteNumber}` : ""} als PDF-Anhang.\n\nFür Rückfragen stehen wir Ihnen gern zur Verfügung.\n`;
}

function serializeAiInputSummary(input: AiGuidanceInput): string | undefined {
  const sections: string[] = [];

  if (input.specialContext.trim()) {
    sections.push(`Besonderheiten des Einsatzes:\n${input.specialContext.trim()}`);
  }
  if (input.relevantTechnology.trim()) {
    sections.push(`Relevante Technik / Ausstattung:\n${input.relevantTechnology.trim()}`);
  }
  if (input.importantServices.trim()) {
    sections.push(`Wichtige Leistungen:\n${input.importantServices.trim()}`);
  }
  if (input.customerNotes.trim()) {
    sections.push(`Kundenrelevante Hinweise:\n${input.customerNotes.trim()}`);
  }
  if (input.otherRequirements.trim()) {
    sections.push(`Sonstige Vorgaben:\n${input.otherRequirements.trim()}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

function parseAiInputSummary(value?: string): AiGuidanceInput {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return EMPTY_AI_GUIDANCE;
  }

  const parsed: AiGuidanceInput = {
    specialContext: extractLabeledSection(raw, "Besonderheiten des Einsatzes", [
      "Relevante Technik / Ausstattung",
      "Wichtige Leistungen",
      "Kundenrelevante Hinweise",
      "Sonstige Vorgaben",
    ]),
    relevantTechnology: extractLabeledSection(raw, "Relevante Technik / Ausstattung", [
      "Besonderheiten des Einsatzes",
      "Wichtige Leistungen",
      "Kundenrelevante Hinweise",
      "Sonstige Vorgaben",
    ]),
    importantServices: extractLabeledSection(raw, "Wichtige Leistungen", [
      "Besonderheiten des Einsatzes",
      "Relevante Technik / Ausstattung",
      "Kundenrelevante Hinweise",
      "Sonstige Vorgaben",
    ]),
    customerNotes: extractLabeledSection(raw, "Kundenrelevante Hinweise", [
      "Besonderheiten des Einsatzes",
      "Relevante Technik / Ausstattung",
      "Wichtige Leistungen",
      "Sonstige Vorgaben",
    ]),
    otherRequirements: extractLabeledSection(raw, "Sonstige Vorgaben", [
      "Besonderheiten des Einsatzes",
      "Relevante Technik / Ausstattung",
      "Wichtige Leistungen",
      "Kundenrelevante Hinweise",
    ]),
  };

  if (countFilledAiHints(parsed) > 0) {
    return parsed;
  }

  const technicalMatch = raw.match(/Technische Details:\s*([\s\S]*?)(?:\n\s*Zusätzliche Hinweise:|$)/);
  const notesMatch = raw.match(/Zusätzliche Hinweise:\s*([\s\S]*?)$/);

  if (!technicalMatch && !notesMatch) {
    return {
      ...EMPTY_AI_GUIDANCE,
      otherRequirements: raw,
    };
  }

  return {
    ...EMPTY_AI_GUIDANCE,
    relevantTechnology: technicalMatch?.[1]?.trim() ?? "",
    otherRequirements: notesMatch?.[1]?.trim() ?? "",
  };
}

function buildAiAdditionalNotes(input: AiGuidanceInput): string | undefined {
  const sections: string[] = [];

  if (input.specialContext.trim()) {
    sections.push(`Besonderheiten des Einsatzes: ${input.specialContext.trim()}`);
  }
  if (input.importantServices.trim()) {
    sections.push(`Wichtige Leistungen: ${input.importantServices.trim()}`);
  }
  if (input.customerNotes.trim()) {
    sections.push(`Kundenrelevante Hinweise: ${input.customerNotes.trim()}`);
  }
  if (input.otherRequirements.trim()) {
    sections.push(`Sonstige Vorgaben: ${input.otherRequirements.trim()}`);
  }

  return sections.length > 0 ? sections.join("\n") : undefined;
}

function countFilledAiHints(input: AiGuidanceInput): number {
  return [
    input.specialContext,
    input.relevantTechnology,
    input.importantServices,
    input.customerNotes,
    input.otherRequirements,
  ].filter((value) => value.trim().length > 0).length;
}

function extractLabeledSection(raw: string, label: string, otherLabels: string[]): string {
  const escapedLabel = escapeRegExp(label);
  const escapedOthers = otherLabels.map(escapeRegExp).join("|");
  const pattern = escapedOthers.length > 0
    ? new RegExp(`${escapedLabel}:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${escapedOthers}):|$)`)
    : new RegExp(`${escapedLabel}:\\s*([\\s\\S]*?)$`);

  return pattern.exec(raw)?.[1]?.trim() ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapServiceTypeForPrompt(serviceType: QuoteServiceType): string {
  switch (serviceType) {
    case "baustellenueberwachung":
      return "Videotürme";
    case "objektschutz":
      return "Objektschutz";
    case "revierdienst":
      return "Revierdienst";
    case "leitstelle":
      return "Sicherheitstechnik";
    case "empfangsdienst":
      return "Empfangsdienst";
    case "sonderdienste":
      return "Werkschutz";
    default:
      return QUOTE_SERVICE_TYPE_LABELS[serviceType] ?? serviceType;
  }
}

function isPersonnelCalculationPosition(
  item: QuoteLineItem,
  serviceType: QuoteServiceType
): boolean {
  if (isRevierdienstCalculationPosition(item, serviceType)) {
    return false;
  }

  if (item.type === "guard_hour") {
    return true;
  }

  const category = (item.category ?? "").toLowerCase();
  if (category === "personell" || category === "personnel") {
    return true;
  }

  if (
    serviceType === "objektschutz" ||
    serviceType === "empfangsdienst" ||
    serviceType === "sonderdienste"
  ) {
    return item.billingMode === "recurring";
  }

  return false;
}

function isRevierdienstCalculationPosition(
  item: QuoteLineItem,
  serviceType: QuoteServiceType
): boolean {
  return serviceType === "revierdienst" && item.type === "control_run";
}

function calculateRevierdienstBreakdown(item: QuoteLineItem): {
  dailyWeekdayPrice: number;
  dailySaturdayPrice: number;
  dailySundayPrice: number;
  dailyHolidayPrice: number;
  dailyNightPrice: number;
  monthlyPrice: number;
} {
  const preisProKontrolle = Math.max(0, Number(item.preisProKontrolle ?? item.unitPrice));
  const kontrollenProTagWerktag = Math.max(0, Number(item.kontrollenProTagWerktag ?? 2));
  const kontrollenProTagSamstag = Math.max(
    0,
    Number(item.kontrollenProTagSamstag ?? item.kontrollenProTagWochenende ?? 1)
  );
  const kontrollenProTagSonntag = Math.max(
    0,
    Number(item.kontrollenProTagSonntag ?? item.kontrollenProTagWochenende ?? 1)
  );
  const kontrollenProTagFeiertag = Math.max(0, Number(item.kontrollenProTagFeiertag ?? 1));
  const nachtKontrollenProTag = Math.max(0, Number(item.nachtKontrollenProTag ?? 0));
  const tageWerktage = Math.max(0, Number(item.tageWerktage ?? 30));
  const tageSamstag = Math.max(0, Number(item.tageSamstag ?? Math.floor((item.tageWochenende ?? 0) / 2)));
  const tageSonntag = Math.max(0, Number(item.tageSonntag ?? Math.ceil((item.tageWochenende ?? 0) / 2)));
  const tageFeiertag = Math.max(0, Number(item.tageFeiertag ?? 0));
  const samstagFactor = 1 + Math.max(0, Number(item.samstagZuschlagPercent ?? 25)) / 100;
  const sonntagFactor = 1 + Math.max(0, Number(item.sonntagZuschlagPercent ?? 50)) / 100;
  const feiertagFactor = 1 + Math.max(0, Number(item.feiertagZuschlagPercent ?? 100)) / 100;
  const nachtFactor = 1 + Math.max(0, Number(item.nachtZuschlagPercent ?? 25)) / 100;

  const dailyWeekdayPrice = roundMoney(preisProKontrolle * kontrollenProTagWerktag);
  const dailySaturdayPrice = roundMoney(preisProKontrolle * kontrollenProTagSamstag * samstagFactor);
  const dailySundayPrice = roundMoney(preisProKontrolle * kontrollenProTagSonntag * sonntagFactor);
  const dailyHolidayPrice = roundMoney(preisProKontrolle * kontrollenProTagFeiertag * feiertagFactor);
  const dailyNightPrice = roundMoney(preisProKontrolle * nachtKontrollenProTag * nachtFactor);
  const monthlyPrice = roundMoney(
    dailyWeekdayPrice * tageWerktage
    + dailySaturdayPrice * tageSamstag
    + dailySundayPrice * tageSonntag
    + dailyHolidayPrice * tageFeiertag
    + dailyNightPrice * (tageWerktage + tageSamstag + tageSonntag + tageFeiertag)
  );

  return {
    dailyWeekdayPrice,
    dailySaturdayPrice,
    dailySundayPrice,
    dailyHolidayPrice,
    dailyNightPrice,
    monthlyPrice,
  };
}

function calculatePersonnelBreakdown(item: QuoteLineItem): {
  dailyWeekdayPrice: number;
  dailySaturdayPrice: number;
  dailySundayPrice: number;
  dailyHolidayPrice: number;
  dailyNightPrice: number;
  monthlyPrice: number;
} {
  const hoursPerDay = Math.max(0, Number(item.stundenProTag ?? 8));
  const nightHoursPerDay = Math.max(0, Number(item.nachtStundenProTag ?? 0));
  const tageWerktage = Math.max(0, Number(item.tageWerktage ?? 30));
  const tageSamstag = Math.max(0, Number(item.tageSamstag ?? 0));
  const tageSonntag = Math.max(0, Number(item.tageSonntag ?? 0));
  const tageFeiertag = Math.max(0, Number(item.tageFeiertag ?? 0));
  const samstagFactor = 1 + Math.max(0, Number(item.samstagZuschlagPercent ?? 25)) / 100;
  const sonntagFactor = 1 + Math.max(0, Number(item.sonntagZuschlagPercent ?? 50)) / 100;
  const feiertagFactor = 1 + Math.max(0, Number(item.feiertagZuschlagPercent ?? 100)) / 100;
  const nachtFactor = 1 + Math.max(0, Number(item.nachtZuschlagPercent ?? 25)) / 100;

  const dailyWeekdayPrice = roundMoney(item.unitPrice * hoursPerDay);
  const dailySaturdayPrice = roundMoney(item.unitPrice * hoursPerDay * samstagFactor);
  const dailySundayPrice = roundMoney(item.unitPrice * hoursPerDay * sonntagFactor);
  const dailyHolidayPrice = roundMoney(item.unitPrice * hoursPerDay * feiertagFactor);
  const dailyNightPrice = roundMoney(item.unitPrice * nightHoursPerDay * nachtFactor);
  const monthlyPrice = roundMoney(
    dailyWeekdayPrice * tageWerktage
    + dailySaturdayPrice * tageSamstag
    + dailySundayPrice * tageSonntag
    + dailyHolidayPrice * tageFeiertag
    + dailyNightPrice * (tageWerktage + tageSamstag + tageSonntag + tageFeiertag)
  );

  return {
    dailyWeekdayPrice,
    dailySaturdayPrice,
    dailySundayPrice,
    dailyHolidayPrice,
    dailyNightPrice,
    monthlyPrice,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function enforceMonthlyRecurringLineItems(items: QuoteLineItem[]): QuoteLineItem[] {
  return items.map((item) => (
    item.billingMode === "recurring"
      ? { ...item, interval: "monthly" }
      : item
  ));
}

function isOnDemandLineItem(item: QuoteLineItem): boolean {
  return item.category === "on_demand" || item.metadata?.onDemand === true;
}
