import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { ModalDialog } from "../../components/ModalDialog";
import { listClients } from "../clients/client.api";
import type { Client } from "../clients/client.types";
import { getBusinessSettings } from "../settings/settings.api";
import type { BusinessSettings } from "../settings/settings.types";
import { listInventoryItems } from "../inventory/inventory.api";
import type { InventoryItem } from "../inventory/inventory.types";
import {
  createQuote,
  deleteQuote,
  getQuote,
  listQuotes,
  saveQuotePdf,
  setQuoteStatus,
  updateQuote,
} from "./quote.api";
import type {
  Quote,
  QuoteInput,
  QuoteItemInput,
  QuoteStatus,
} from "./quote.types";

type QuoteStatusFilter = "all" | QuoteStatus;
type FormMode = { type: "create" } | { type: "edit"; quoteId: number };

type QuoteItemForm = {
  key: string;
  inventoryItemId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};

type QuoteFormValues = {
  clientId: string;
  issueDate: string;
  validUntil: string;
  discount: string;
  tax: string;
  notes: string;
  terms: string;
  items: QuoteItemForm[];
};

const statusLabels: Record<QuoteStatus, string> = {
  draft: "Borrador",
  sent: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Vencida",
};

export function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuoteStatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [formValues, setFormValues] = useState<QuoteFormValues | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [actionQuoteId, setActionQuoteId] = useState<number | null>(null);
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadPageData() {
      try {
        const [storedQuotes, storedClients, storedSettings, storedInventoryItems] = await Promise.all([
          listQuotes(),
          listClients(),
          getBusinessSettings(),
          listInventoryItems(),
        ]);

        if (isCurrent) {
          setQuotes(sortQuotes(storedQuotes));
          setClients(sortClients(storedClients));
          setSettings(storedSettings);
          setInventoryItems(sortInventoryItems(storedInventoryItems));
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setPageError(getErrorMessage(error, "No se pudieron cargar las cotizaciones."));
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    void loadPageData();
    return () => {
      isCurrent = false;
    };
  }, []);

  const activeClients = clients.filter((client) => !client.isArchived);
  const businessIsConfigured = Boolean(settings && settings.businessName.trim().length >= 2);

  const counts = useMemo(
    () => ({
      draft: quotes.filter((quote) => quote.status === "draft").length,
      sent: quotes.filter((quote) => quote.status === "sent").length,
      accepted: quotes.filter((quote) => quote.status === "accepted").length,
      expired: quotes.filter((quote) => quote.status === "expired").length,
    }),
    [quotes],
  );

  const visibleQuotes = useMemo(() => {
    const search = searchTerm.trim().toLocaleLowerCase("es");

    return quotes.filter((quote) => {
      if (statusFilter !== "all" && quote.status !== statusFilter) return false;
      if (dateFrom && quote.issueDate < dateFrom) return false;
      if (dateTo && quote.issueDate > dateTo) return false;
      if (!search) return true;
      return [quote.quoteNumber, quote.clientName]
        .some((value) => value.toLocaleLowerCase("es").includes(search));
    });
  }, [dateFrom, dateTo, quotes, searchTerm, statusFilter]);

  const previewTotals = useMemo(
    () => (formValues ? calculateFormTotals(formValues) : null),
    [formValues],
  );

  function openCreateForm() {
    if (!settings || !businessIsConfigured || activeClients.length === 0) return;
    setFormMode({ type: "create" });
    setFormValues(createEmptyForm(settings));
    setIsFormDirty(false);
    setSelectedQuote(null);
    setFormError(null);
    clearFeedback();
  }

  async function openEditForm(quote: Quote) {
    setActionQuoteId(quote.id);
    clearFeedback();
    try {
      const detail = await getQuote(quote.id);
      setFormMode({ type: "edit", quoteId: quote.id });
      setFormValues(quoteToForm(detail));
      setIsFormDirty(false);
      setSelectedQuote(null);
      setFormError(null);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo abrir la cotización."));
    } finally {
      setActionQuoteId(null);
    }
  }

  async function openDuplicateForm(quote: Quote) {
    if (!settings || !businessIsConfigured) return;
    setActionQuoteId(quote.id);
    clearFeedback();
    try {
      const detail = await getQuote(quote.id);
      const today = localDateString(new Date());
      setFormMode({ type: "create" });
      setFormValues({
        ...quoteToForm(detail),
        clientId: detail.clientIsArchived ? "" : String(detail.clientId),
        issueDate: today,
        validUntil: addDays(today, settings.defaultValidityDays),
      });
      setSelectedQuote(null);
      setFormError(null);
      setIsFormDirty(true);
      setSuccessMessage("Se creó una copia editable. Guárdala para asignar un número nuevo.");
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo duplicar la cotización."));
    } finally {
      setActionQuoteId(null);
    }
  }

  function closeForm() {
    if (isSaving) return;
    if (isFormDirty && !window.confirm("¿Descartar los cambios sin guardar?")) return;
    setFormMode(null);
    setFormValues(null);
    setFormError(null);
    setIsFormDirty(false);
  }

  function updateForm<K extends keyof QuoteFormValues>(field: K, value: QuoteFormValues[K]) {
    setFormValues((current) => (current ? { ...current, [field]: value } : current));
    setIsFormDirty(true);
    setFormError(null);
  }

  function updateItem(key: string, field: keyof Omit<QuoteItemForm, "key">, value: string) {
    setFormValues((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.key === key ? { ...item, [field]: value } : item,
            ),
          }
        : current,
    );
    setIsFormDirty(true);
    setFormError(null);
  }

  function selectInventoryItem(key: string, inventoryItemId: string) {
    const selectedItem = inventoryItems.find((item) => item.id === Number(inventoryItemId));
    setFormValues((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.key === key
                ? selectedItem
                  ? {
                      ...item,
                      inventoryItemId,
                      description: selectedItem.name,
                      unit: selectedItem.unit,
                      unitPrice: String(selectedItem.salePriceMinor / 100),
                    }
                  : { ...item, inventoryItemId: "" }
                : item,
            ),
          }
        : current,
    );
    setIsFormDirty(true);
    setFormError(null);
  }

  function addItem() {
    setFormValues((current) =>
      current ? { ...current, items: [...current.items, emptyItem()] } : current,
    );
    setIsFormDirty(true);
  }

  function removeItem(key: string) {
    setFormValues((current) =>
      current && current.items.length > 1
        ? { ...current, items: current.items.filter((item) => item.key !== key) }
        : current,
    );
    setIsFormDirty(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formMode || !formValues) return;

    const validationError = validateQuoteForm(formValues);
    setFormError(validationError);
    if (validationError) return;

    setIsSaving(true);
    clearFeedback();
    try {
      const input = toQuoteInput(formValues);
      const savedQuote =
        formMode.type === "create"
          ? await createQuote(input)
          : await updateQuote(formMode.quoteId, input);
      replaceQuote(savedQuote);
      setFormMode(null);
      setFormValues(null);
      setIsFormDirty(false);
      setSuccessMessage(
        formMode.type === "create"
          ? `Cotización ${savedQuote.quoteNumber} creada correctamente.`
          : "Cotización actualizada correctamente.",
      );
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo guardar la cotización."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleView(quote: Quote) {
    setActionQuoteId(quote.id);
    clearFeedback();
    try {
      setSelectedQuote(await getQuote(quote.id));
      setFormMode(null);
      setFormValues(null);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo abrir el detalle."));
    } finally {
      setActionQuoteId(null);
    }
  }

  async function handleStatusChange(quote: Quote, status: QuoteStatus) {
    setActionQuoteId(quote.id);
    clearFeedback();
    try {
      const updated = await setQuoteStatus(quote.id, status);
      replaceQuote(updated);
      if (selectedQuote?.id === updated.id) setSelectedQuote(updated);
      setSuccessMessage(`Cotización marcada como ${statusLabels[status].toLocaleLowerCase("es")}.`);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo cambiar el estado."));
    } finally {
      setActionQuoteId(null);
    }
  }

  async function handleDownload(quote: Quote) {
    if (!settings) return;
    setActionQuoteId(quote.id);
    clearFeedback();

    try {
      const detail = quote.items.length > 0 ? quote : await getQuote(quote.id);
      const { generateQuotePdf, quotePdfFileName } = await import("./quote.pdf");
      const path = await save({
        defaultPath: quotePdfFileName(detail),
        filters: [{ name: "Documento PDF", extensions: ["pdf"] }],
      });

      if (!path) return;

      const bytes = await generateQuotePdf(detail, settings);
      await saveQuotePdf(path, Array.from(bytes));
      setSuccessMessage(`PDF guardado correctamente en ${path}`);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo generar el PDF."));
    } finally {
      setActionQuoteId(null);
    }
  }

  async function handleDeleteConfirmed() {
    if (!quoteToDelete) return;
    setActionQuoteId(quoteToDelete.id);
    clearFeedback();
    try {
      await deleteQuote(quoteToDelete.id);
      setQuotes((current) => current.filter((quote) => quote.id !== quoteToDelete.id));
      if (selectedQuote?.id === quoteToDelete.id) setSelectedQuote(null);
      setQuoteToDelete(null);
      setSuccessMessage("Borrador eliminado definitivamente.");
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo eliminar la cotización."));
    } finally {
      setActionQuoteId(null);
    }
  }

  function replaceQuote(updated: Quote) {
    setQuotes((current) =>
      sortQuotes([...current.filter((quote) => quote.id !== updated.id), updated]),
    );
  }

  function clearFeedback() {
    setPageError(null);
    setSuccessMessage(null);
  }

  if (formMode && formValues && settings) {
    return (
      <section className="quotes-page quote-editor-page">
        <header className="quote-editor-navigation">
          <button className="text-button back-button" type="button" onClick={closeForm}>
            ← Volver al historial
          </button>
          <span className="local-badge">
            {formMode.type === "create" ? "Nueva cotización" : "Editando borrador"}
          </span>
        </header>

        {pageError && <div className="feedback-banner error" role="alert">{pageError}</div>}

        <QuoteForm
          mode={formMode}
          values={formValues}
          clients={clients}
          inventoryItems={inventoryItems}
          currency={settings.currency}
          totals={previewTotals}
          error={formError}
          isSaving={isSaving}
          onUpdate={updateForm}
          onUpdateItem={updateItem}
          onSelectInventoryItem={selectInventoryItem}
          onAddItem={addItem}
          onRemoveItem={removeItem}
          onCancel={closeForm}
          onSubmit={handleSubmit}
        />
      </section>
    );
  }

  return (
    <section className="quotes-page">
      <header className="page-header clients-page-header">
        <div>
          <p className="eyebrow">Propuestas comerciales</p>
          <h1>Cotizaciones</h1>
          <p className="page-description">
            Crea, consulta y descarga propuestas profesionales para tus clientes.
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={!businessIsConfigured || activeClients.length === 0}
          onClick={openCreateForm}
        >
          Nueva cotización
        </button>
      </header>

      {!businessIsConfigured && (
        <div className="feedback-banner warning" role="status">
          Configura el nombre y los datos del negocio antes de crear cotizaciones.
        </div>
      )}
      {businessIsConfigured && activeClients.length === 0 && (
        <div className="feedback-banner warning" role="status">
          Necesitas al menos un cliente activo para crear una cotización.
        </div>
      )}
      {pageError && <div className="feedback-banner error" role="alert">{pageError}</div>}
      {successMessage && (
        <div className="feedback-banner success" role="status">{successMessage}</div>
      )}

      <section className="task-summary-grid" aria-label="Resumen de cotizaciones">
        <SummaryCard label="Borradores" value={counts.draft} />
        <SummaryCard label="Enviadas" value={counts.sent} />
        <SummaryCard label="Aceptadas" value={counts.accepted} />
        <SummaryCard label="Vencidas" value={counts.expired} warning />
      </section>

      {selectedQuote && (
        <ModalDialog
          className="detail-modal"
          labelledBy="quote-detail-title"
          onRequestClose={() => {
            if (actionQuoteId !== selectedQuote.id) setSelectedQuote(null);
          }}
        >
        <QuoteDetail
          quote={selectedQuote}
          isWorking={actionQuoteId === selectedQuote.id}
          onClose={() => setSelectedQuote(null)}
          onDownload={() => void handleDownload(selectedQuote)}
        />
        </ModalDialog>
      )}

      <section className="clients-toolbar quote-filters" aria-label="Filtros de cotizaciones">
        <label className="client-search">
          <span className="sr-only">Buscar cotizaciones</span>
          <input
            type="search"
            placeholder="Buscar por número o cliente"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
          />
        </label>
        <div className="task-filters quote-filter-group">
          <label className="task-filter">
            <span>Estado</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.currentTarget.value as QuoteStatusFilter)}
            >
              <option value="all">Todos</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="task-filter">
            <span>Desde</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.currentTarget.value)} />
          </label>
          <label className="task-filter">
            <span>Hasta</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.currentTarget.value)} />
          </label>
        </div>
      </section>
      <p className="clients-result-count">
        {visibleQuotes.length} {visibleQuotes.length === 1 ? "cotización visible" : "cotizaciones visibles"}
      </p>

      {quoteToDelete && (
        <ModalDialog
          className="confirmation-modal"
          labelledBy="delete-quote-title"
          onRequestClose={() => {
            if (actionQuoteId !== quoteToDelete.id) setQuoteToDelete(null);
          }}
        >
        <section className="archive-confirmation" aria-labelledby="delete-quote-title">
          <div>
            <h2 id="delete-quote-title">¿Eliminar {quoteToDelete.quoteNumber}?</h2>
            <p>El borrador y todos sus conceptos se eliminarán permanentemente.</p>
          </div>
          <div className="confirmation-actions">
            <button className="secondary-button" type="button" onClick={() => setQuoteToDelete(null)}>
              Cancelar
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={actionQuoteId === quoteToDelete.id}
              onClick={() => void handleDeleteConfirmed()}
            >
              {actionQuoteId === quoteToDelete.id ? "Eliminando..." : "Eliminar borrador"}
            </button>
          </div>
        </section>
        </ModalDialog>
      )}

      {isLoading && <div className="loading-state">Cargando cotizaciones...</div>}
      {!isLoading && quotes.length === 0 && (
        <section className="empty-state clients-empty-state">
          <div className="empty-state-icon" aria-hidden="true">+</div>
          <p className="eyebrow">Sin cotizaciones</p>
          <h2>Crea tu primera propuesta</h2>
          <p>Configura el negocio, elige un cliente y agrega los servicios que deseas cotizar.</p>
        </section>
      )}
      {!isLoading && quotes.length > 0 && visibleQuotes.length === 0 && (
        <section className="empty-state clients-empty-state">
          <p className="eyebrow">Sin coincidencias</p>
          <h2>No encontramos cotizaciones</h2>
          <p>Prueba con otro cliente, número, estado o rango de fechas.</p>
        </section>
      )}

      {!isLoading && visibleQuotes.length > 0 && (
        <div className="clients-table-card">
          <table className="clients-table quotes-table">
            <thead>
              <tr>
                <th scope="col">Número</th>
                <th scope="col">Cliente</th>
                <th scope="col">Emisión</th>
                <th scope="col">Vencimiento</th>
                <th scope="col">Estado</th>
                <th scope="col">Total</th>
                <th scope="col" className="actions-column">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibleQuotes.map((quote) => (
                <tr key={quote.id}>
                  <td><strong className="client-name">{quote.quoteNumber}</strong></td>
                  <td>
                    {quote.clientName}
                    {quote.clientIsArchived && <span className="client-secondary">Cliente archivado</span>}
                  </td>
                  <td>{formatDate(quote.issueDate)}</td>
                  <td>{formatDate(quote.validUntil)}</td>
                  <td><span className={`quote-status status-${quote.status}`}>{statusLabels[quote.status]}</span></td>
                  <td><strong>{formatMoney(quote.totalMinor, quote.currency)}</strong></td>
                  <td>
                    <div className="row-actions quote-row-actions">
                      <button className="text-button" type="button" onClick={() => void handleView(quote)}>Ver</button>
                      {quote.status === "draft" && (
                        <button className="text-button" type="button" onClick={() => void openEditForm(quote)}>Editar</button>
                      )}
                      <button
                        className="text-button"
                        type="button"
                        disabled={actionQuoteId === quote.id}
                        onClick={() => void handleDownload(quote)}
                      >
                        Descargar PDF
                      </button>
                      <button className="text-button" type="button" onClick={() => void openDuplicateForm(quote)}>
                        Duplicar
                      </button>
                      {quote.status === "draft" && (
                        <button className="text-button" type="button" onClick={() => void handleStatusChange(quote, "sent")}>
                          Marcar enviada
                        </button>
                      )}
                      {quote.status === "sent" && (
                        <>
                          <button className="text-button" type="button" onClick={() => void handleStatusChange(quote, "accepted")}>Marcar aceptada</button>
                          <button className="text-button danger-text" type="button" onClick={() => void handleStatusChange(quote, "rejected")}>Marcar rechazada</button>
                        </>
                      )}
                      {quote.status === "draft" && (
                        <button className="text-button danger-text" type="button" onClick={() => setQuoteToDelete(quote)}>
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type QuoteFormProps = {
  mode: FormMode;
  values: QuoteFormValues;
  clients: Client[];
  inventoryItems: InventoryItem[];
  currency: string;
  totals: FormTotals | null;
  error: string | null;
  isSaving: boolean;
  onUpdate: <K extends keyof QuoteFormValues>(field: K, value: QuoteFormValues[K]) => void;
  onUpdateItem: (key: string, field: keyof Omit<QuoteItemForm, "key">, value: string) => void;
  onSelectInventoryItem: (key: string, inventoryItemId: string) => void;
  onAddItem: () => void;
  onRemoveItem: (key: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

function QuoteForm({
  mode,
  values,
  clients,
  inventoryItems,
  currency,
  totals,
  error,
  isSaving,
  onUpdate,
  onUpdateItem,
  onSelectInventoryItem,
  onAddItem,
  onRemoveItem,
  onCancel,
  onSubmit,
}: QuoteFormProps) {
  const currentClientId = Number(values.clientId);
  const selectableClients = clients.filter(
    (client) => !client.isArchived || client.id === currentClientId,
  );

  return (
    <section className="quote-form-card" aria-labelledby="quote-form-title">
      <div className="client-form-header">
        <div>
          <p className="eyebrow">{mode.type === "create" ? "Nueva propuesta" : "Editar borrador"}</p>
          <h2 id="quote-form-title">{mode.type === "create" ? "Crear cotización" : "Editar cotización"}</h2>
        </div>
        <button className="secondary-button" type="button" onClick={onCancel}>Cancelar</button>
      </div>

      {error && <div className="feedback-banner error" role="alert">{error}</div>}

      <form onSubmit={(event) => void onSubmit(event)} noValidate>
        <div className="quote-metadata-grid">
          <label className="form-field">
            <span>Cliente <small>Obligatorio</small></span>
            <select value={values.clientId} onChange={(event) => onUpdate("clientId", event.currentTarget.value)}>
              <option value="">Selecciona un cliente</option>
              {selectableClients.map((client) => (
                <option value={client.id} key={client.id}>
                  {client.name}{client.isArchived ? " (archivado)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Fecha de emisión</span>
            <input type="date" value={values.issueDate} onChange={(event) => onUpdate("issueDate", event.currentTarget.value)} />
          </label>
          <label className="form-field">
            <span>Válida hasta</span>
            <input type="date" value={values.validUntil} onChange={(event) => onUpdate("validUntil", event.currentTarget.value)} />
          </label>
          <label className="form-field">
            <span>Descuento (%)</span>
            <input type="number" min="0" max="100" step="0.01" value={values.discount} onChange={(event) => onUpdate("discount", event.currentTarget.value)} />
          </label>
          <label className="form-field">
            <span>Impuesto (%)</span>
            <input type="number" min="0" max="100" step="0.01" value={values.tax} onChange={(event) => onUpdate("tax", event.currentTarget.value)} />
          </label>
        </div>

        <div className="quote-items-header">
          <div>
            <p className="eyebrow">Detalle económico</p>
            <h3>Conceptos</h3>
          </div>
          <button className="secondary-button" type="button" onClick={onAddItem}>Agregar concepto</button>
        </div>

        <div className="quote-items-editor">
          <div className="quote-item-labels" aria-hidden="true">
            <span>Descripción</span><span>Cantidad</span><span>Unidad</span><span>Precio unitario</span><span>Total</span><span />
          </div>
          {values.items.map((item) => {
            const itemTotal = calculateItemTotal(item);
            const selectedInventoryId = Number(item.inventoryItemId);
            const selectableInventoryItems = inventoryItems.filter(
              (inventoryItem) =>
                !inventoryItem.isArchived || inventoryItem.id === selectedInventoryId,
            );
            return (
              <div className="quote-item-editor" key={item.key}>
                <label className="quote-catalog-selector">
                  <span>Catálogo (opcional)</span>
                  <select
                    value={item.inventoryItemId}
                    onChange={(event) =>
                      onSelectInventoryItem(item.key, event.currentTarget.value)
                    }
                  >
                    <option value="">Concepto manual</option>
                    {selectableInventoryItems.map((inventoryItem) => (
                      <option value={inventoryItem.id} key={inventoryItem.id}>
                        {inventoryItem.name}
                        {inventoryItem.sku ? ` · ${inventoryItem.sku}` : ""}
                        {inventoryItem.isArchived ? " (archivado)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="quote-item-row">
                <input aria-label="Descripción" value={item.description} maxLength={300} placeholder="Servicio o producto" onChange={(event) => onUpdateItem(item.key, "description", event.currentTarget.value)} />
                <input aria-label="Cantidad" type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => onUpdateItem(item.key, "quantity", event.currentTarget.value)} />
                <input aria-label="Unidad" value={item.unit} maxLength={30} placeholder="unidad" onChange={(event) => onUpdateItem(item.key, "unit", event.currentTarget.value)} />
                <input aria-label="Precio unitario" type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => onUpdateItem(item.key, "unitPrice", event.currentTarget.value)} />
                <strong>{formatMoney(itemTotal, currency)}</strong>
                <button className="text-button danger-text" type="button" disabled={values.items.length === 1} onClick={() => onRemoveItem(item.key)} aria-label="Eliminar concepto">×</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="quote-form-bottom">
          <div className="quote-notes-grid">
            <label className="form-field">
              <span>Notas para el cliente</span>
              <textarea value={values.notes} maxLength={2_000} rows={4} onChange={(event) => onUpdate("notes", event.currentTarget.value)} />
            </label>
            <label className="form-field">
              <span>Condiciones</span>
              <textarea value={values.terms} maxLength={2_000} rows={4} onChange={(event) => onUpdate("terms", event.currentTarget.value)} />
            </label>
          </div>
          {totals && (
            <div className="quote-totals-preview">
              <TotalRow label="Subtotal" value={formatMoney(totals.subtotalMinor, currency)} />
              <TotalRow label="Descuento" value={`-${formatMoney(totals.discountMinor, currency)}`} />
              <TotalRow label="Impuesto" value={formatMoney(totals.taxMinor, currency)} />
              <TotalRow label="Total" value={formatMoney(totals.totalMinor, currency)} total />
            </div>
          )}
        </div>

        <div className="client-form-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={isSaving}>
            {isSaving ? "Guardando..." : "Guardar cotización"}
          </button>
        </div>
      </form>
    </section>
  );
}

function QuoteDetail({ quote, isWorking, onClose, onDownload }: { quote: Quote; isWorking: boolean; onClose: () => void; onDownload: () => void }) {
  return (
    <section className="quote-detail-card" aria-labelledby="quote-detail-title">
      <div className="client-form-header">
        <div>
          <p className="eyebrow">{statusLabels[quote.status]}</p>
          <h2 id="quote-detail-title">{quote.quoteNumber}</h2>
          <p className="page-description">{quote.clientName} · {formatDate(quote.issueDate)}</p>
        </div>
        <div className="confirmation-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cerrar</button>
          <button className="primary-button" type="button" disabled={isWorking} onClick={onDownload}>
            {isWorking ? "Generando..." : "Descargar PDF"}
          </button>
        </div>
      </div>
      <div className="quote-detail-items">
        {quote.items.map((item) => (
          <div key={item.id}>
            <span>{item.description}<small>{formatQuantity(item.quantityMillis)} {item.unit} × {formatMoney(item.unitPriceMinor, quote.currency)}</small></span>
            <strong>{formatMoney(item.totalMinor, quote.currency)}</strong>
          </div>
        ))}
      </div>
      <div className="quote-detail-total">
        <span>Total</span><strong>{formatMoney(quote.totalMinor, quote.currency)}</strong>
      </div>
    </section>
  );
}

function SummaryCard({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <article className={`task-summary-card${warning ? " overdue" : ""}`}><span>{label}</span><strong>{value}</strong></article>;
}

function TotalRow({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return <div className={total ? "quote-total-row grand-total" : "quote-total-row"}><span>{label}</span><strong>{value}</strong></div>;
}

type FormTotals = { subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number };

function createEmptyForm(settings: BusinessSettings): QuoteFormValues {
  const today = localDateString(new Date());
  return {
    clientId: "",
    issueDate: today,
    validUntil: addDays(today, settings.defaultValidityDays),
    discount: "0",
    tax: String(settings.defaultTaxBasisPoints / 100),
    notes: "",
    terms: settings.terms ?? "",
    items: [emptyItem()],
  };
}

function emptyItem(): QuoteItemForm {
  return {
    key: crypto.randomUUID(),
    inventoryItemId: "",
    description: "",
    quantity: "1",
    unit: "unidad",
    unitPrice: "0",
  };
}

function quoteToForm(quote: Quote): QuoteFormValues {
  return {
    clientId: String(quote.clientId),
    issueDate: quote.issueDate,
    validUntil: quote.validUntil,
    discount: String(quote.discountBasisPoints / 100),
    tax: String(quote.taxBasisPoints / 100),
    notes: quote.notes ?? "",
    terms: quote.terms ?? "",
    items: quote.items.map((item) => ({
      key: crypto.randomUUID(),
      inventoryItemId: item.inventoryItemId ? String(item.inventoryItemId) : "",
      description: item.description,
      quantity: String(item.quantityMillis / 1_000),
      unit: item.unit,
      unitPrice: String(item.unitPriceMinor / 100),
    })),
  };
}

function validateQuoteForm(values: QuoteFormValues): string | null {
  if (!values.clientId) return "Selecciona un cliente.";
  if (!values.issueDate || !values.validUntil) return "Selecciona las fechas de emisión y vencimiento.";
  if (values.validUntil < values.issueDate) return "La fecha de vencimiento no puede ser anterior a la emisión.";
  const discount = Number(values.discount);
  const tax = Number(values.tax);
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) return "El descuento debe estar entre 0% y 100%.";
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) return "El impuesto debe estar entre 0% y 100%.";
  for (const item of values.items) {
    if (item.description.trim().length < 2) return "Todos los conceptos necesitan una descripción.";
    if (!item.unit.trim()) return "Todos los conceptos necesitan una unidad.";
    const quantity = Number(item.quantity);
    const price = Number(item.unitPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) return "Todas las cantidades deben ser mayores que cero.";
    if (!Number.isFinite(price) || price < 0) return "Los precios no pueden ser negativos.";
  }
  return null;
}

function toQuoteInput(values: QuoteFormValues): QuoteInput {
  return {
    clientId: Number(values.clientId),
    issueDate: values.issueDate,
    validUntil: values.validUntil,
    discountBasisPoints: Math.round(Number(values.discount) * 100),
    taxBasisPoints: Math.round(Number(values.tax) * 100),
    notes: optionalText(values.notes),
    terms: optionalText(values.terms),
    items: values.items.map(toItemInput),
  };
}

function toItemInput(item: QuoteItemForm): QuoteItemInput {
  return {
    inventoryItemId: item.inventoryItemId ? Number(item.inventoryItemId) : null,
    description: item.description.trim(),
    quantityMillis: Math.round(Number(item.quantity) * 1_000),
    unit: item.unit.trim(),
    unitPriceMinor: Math.round(Number(item.unitPrice) * 100),
  };
}

function calculateFormTotals(values: QuoteFormValues): FormTotals {
  const subtotalMinor = values.items.reduce((total, item) => total + calculateItemTotal(item), 0);
  const discountMinor = Math.round(subtotalMinor * (Number(values.discount) || 0) / 100);
  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = Math.round(taxableMinor * (Number(values.tax) || 0) / 100);
  return { subtotalMinor, discountMinor, taxMinor, totalMinor: taxableMinor + taxMinor };
}

function calculateItemTotal(item: QuoteItemForm): number {
  const quantityMillis = Math.round((Number(item.quantity) || 0) * 1_000);
  const unitPriceMinor = Math.round((Number(item.unitPrice) || 0) * 100);
  return Math.round(quantityMillis * unitPriceMinor / 1_000);
}

function sortQuotes(quotes: Quote[]): Quote[] {
  return [...quotes].sort((first, second) =>
    second.issueDate.localeCompare(first.issueDate) || second.id - first.id,
  );
}

function sortClients(clients: Client[]): Client[] {
  return [...clients].sort((first, second) => first.name.localeCompare(second.name, "es", { sensitivity: "base" }));
}

function sortInventoryItems(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((first, second) =>
    first.name.localeCompare(second.name, "es", { sensitivity: "base" }),
  );
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "CRC" ? 0 : 2,
    maximumFractionDigits: currency === "CRC" ? 0 : 2,
  }).format(minor / 100);
}

function formatQuantity(quantityMillis: number): string {
  return new Intl.NumberFormat("es-CR", { maximumFractionDigits: 3 }).format(quantityMillis / 1_000);
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function localDateString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "string" && error.trim() ? error : fallback;
}
