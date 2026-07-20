import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ActionMenu } from "../../components/ActionMenu";
import { LoadErrorState } from "../../components/LoadErrorState";
import { ModalDialog } from "../../components/ModalDialog";
import { getBusinessSettings } from "../settings/settings.api";
import type { CurrencyCode } from "../settings/settings.types";
import {
  createInventoryItem,
  createInventoryMovement,
  deleteInventoryItem,
  listInventoryItems,
  listInventoryMovements,
  setInventoryItemArchived,
  updateInventoryItem,
} from "./inventory.api";
import type {
  InventoryItem,
  InventoryItemInput,
  InventoryItemType,
  InventoryMovement,
  InventoryMovementInput,
  InventoryMovementType,
} from "./inventory.types";

type TypeFilter = "all" | InventoryItemType;
type StatusFilter = "active" | "archived";
type StockFilter = "all" | "low";
type ItemFormMode = { type: "create" } | { type: "edit"; itemId: number };

type ItemFormValues = {
  itemType: InventoryItemType;
  name: string;
  sku: string;
  category: string;
  description: string;
  unit: string;
  costPrice: string;
  salePrice: string;
  initialStock: string;
  minimumStock: string;
};

type ItemFormErrors = Partial<Record<keyof ItemFormValues, string>>;

type MovementFormValues = {
  movementType: InventoryMovementType;
  quantity: string;
  reason: string;
};

const EMPTY_ITEM_FORM: ItemFormValues = {
  itemType: "product",
  name: "",
  sku: "",
  category: "",
  description: "",
  unit: "unidad",
  costPrice: "0",
  salePrice: "0",
  initialStock: "0",
  minimumStock: "0",
};

const movementLabels: Record<InventoryMovementType, string> = {
  entry: "Entrada",
  exit: "Salida",
  adjustment: "Ajuste",
};

const dateTimeFormatter = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>("CRC");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [formMode, setFormMode] = useState<ItemFormMode | null>(null);
  const [formValues, setFormValues] = useState<ItemFormValues>(EMPTY_ITEM_FORM);
  const [formErrors, setFormErrors] = useState<ItemFormErrors>({});
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [itemToArchive, setItemToArchive] = useState<InventoryItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);
  const [movementItem, setMovementItem] = useState<InventoryItem | null>(null);
  const [movementValues, setMovementValues] = useState<MovementFormValues>({
    movementType: "entry",
    quantity: "1",
    reason: "",
  });
  const [movementError, setMovementError] = useState<string | null>(null);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [actionItemId, setActionItemId] = useState<number | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadPageData() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [storedItems, settings] = await Promise.all([
          listInventoryItems(),
          getBusinessSettings(),
        ]);
        if (isCurrent) {
          setItems(sortItems(storedItems));
          setCurrency(settings.currency);
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setLoadError(getErrorMessage(error, "No se pudo cargar el inventario."));
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    void loadPageData();
    return () => {
      isCurrent = false;
    };
  }, [reloadKey]);

  const categories = useMemo(
    () => Array.from(new Set(items.map((item) => item.category).filter((value): value is string => Boolean(value))))
      .sort((first, second) => first.localeCompare(second, "es", { sensitivity: "base" })),
    [items],
  );

  const counts = useMemo(() => {
    const activeItems = items.filter((item) => !item.isArchived);
    const products = activeItems.filter((item) => item.itemType === "product");
    return {
      products: products.length,
      services: activeItems.filter((item) => item.itemType === "service").length,
      lowStock: products.filter(isLowStock).length,
      stockValueMinor: products.reduce(
        (total, item) => total + Math.round(item.currentStockMillis * item.costPriceMinor / 1_000),
        0,
      ),
    };
  }, [items]);

  const visibleItems = useMemo(() => {
    const search = searchTerm.trim().toLocaleLowerCase("es");
    return items.filter((item) => {
      if (item.isArchived !== (statusFilter === "archived")) return false;
      if (typeFilter !== "all" && item.itemType !== typeFilter) return false;
      if (stockFilter === "low" && !isLowStock(item)) return false;
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (!search) return true;
      return [item.name, item.sku, item.category, item.description]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("es").includes(search));
    });
  }, [categoryFilter, items, searchTerm, statusFilter, stockFilter, typeFilter]);

  function clearFeedback() {
    setPageError(null);
    setSuccessMessage(null);
  }

  function openCreateForm() {
    setFormMode({ type: "create" });
    setFormValues(EMPTY_ITEM_FORM);
    setFormErrors({});
    setIsFormDirty(false);
    clearFeedback();
  }

  function openEditForm(item: InventoryItem) {
    setFormMode({ type: "edit", itemId: item.id });
    setFormValues({
      itemType: item.itemType,
      name: item.name,
      sku: item.sku ?? "",
      category: item.category ?? "",
      description: item.description ?? "",
      unit: item.unit,
      costPrice: String(item.costPriceMinor / 100),
      salePrice: String(item.salePriceMinor / 100),
      initialStock: "0",
      minimumStock: String(item.minimumStockMillis / 1_000),
    });
    setFormErrors({});
    setIsFormDirty(false);
    clearFeedback();
  }

  function closeForm() {
    if (isSaving) return;
    if (isFormDirty && !window.confirm("¿Descartar los cambios sin guardar?")) return;
    setFormMode(null);
    setFormValues(EMPTY_ITEM_FORM);
    setFormErrors({});
    setIsFormDirty(false);
  }

  function updateFormField<K extends keyof ItemFormValues>(field: K, value: ItemFormValues[K]) {
    setFormValues((current) => ({ ...current, [field]: value }));
    setIsFormDirty(true);
    if (field in formErrors) {
      setFormErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function changeItemType(itemType: InventoryItemType) {
    setFormValues((current) => ({
      ...current,
      itemType,
      unit: itemType === "service" && current.unit === "unidad" ? "servicio" : current.unit,
      initialStock: itemType === "service" ? "0" : current.initialStock,
      minimumStock: itemType === "service" ? "0" : current.minimumStock,
    }));
    setIsFormDirty(true);
  }

  async function handleItemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formMode) return;
    const nextErrors = validateItemForm(formValues, formMode);
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSaving(true);
    clearFeedback();
    try {
      const input = toItemInput(formValues, formMode);
      const savedItem = formMode.type === "create"
        ? await createInventoryItem(input)
        : await updateInventoryItem(formMode.itemId, input);
      replaceItem(savedItem);
      setSuccessMessage(
        formMode.type === "create"
          ? `${savedItem.itemType === "product" ? "Producto" : "Servicio"} creado correctamente.`
          : "Artículo actualizado correctamente.",
      );
      setFormMode(null);
      setFormValues(EMPTY_ITEM_FORM);
      setIsFormDirty(false);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo guardar el artículo."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleArchiveConfirmed() {
    if (!itemToArchive) return;
    setActionItemId(itemToArchive.id);
    clearFeedback();
    try {
      const updatedItem = await setInventoryItemArchived(itemToArchive.id, true);
      replaceItem(updatedItem);
      setItemToArchive(null);
      setSuccessMessage("Artículo archivado correctamente.");
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo archivar el artículo."));
    } finally {
      setActionItemId(null);
    }
  }

  async function handleRestore(item: InventoryItem) {
    setActionItemId(item.id);
    clearFeedback();
    try {
      const updatedItem = await setInventoryItemArchived(item.id, false);
      replaceItem(updatedItem);
      setSuccessMessage("Artículo restaurado correctamente.");
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo restaurar el artículo."));
    } finally {
      setActionItemId(null);
    }
  }

  async function handleDeleteConfirmed() {
    if (!itemToDelete) return;
    setActionItemId(itemToDelete.id);
    clearFeedback();
    try {
      await deleteInventoryItem(itemToDelete.id);
      setItems((current) => current.filter((item) => item.id !== itemToDelete.id));
      setItemToDelete(null);
      setSuccessMessage("Artículo eliminado definitivamente.");
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo eliminar el artículo."));
      setItemToDelete(null);
    } finally {
      setActionItemId(null);
    }
  }

  function openMovementForm(item: InventoryItem) {
    setMovementItem(item);
    setMovementValues({ movementType: "entry", quantity: "1", reason: "" });
    setMovementError(null);
    clearFeedback();
  }

  async function handleMovementSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!movementItem) return;
    const quantity = Number(movementValues.quantity);
    if (!Number.isFinite(quantity) || quantity < 0 || (movementValues.movementType !== "adjustment" && quantity === 0)) {
      setMovementError("Escribe una cantidad válida.");
      return;
    }
    if (movementValues.reason.trim().length < 2) {
      setMovementError("Escribe un motivo para el movimiento.");
      return;
    }

    const input: InventoryMovementInput = {
      itemId: movementItem.id,
      movementType: movementValues.movementType,
      quantityMillis: Math.round(quantity * 1_000),
      reason: movementValues.reason.trim(),
    };
    setIsSaving(true);
    setMovementError(null);
    clearFeedback();
    try {
      const result = await createInventoryMovement(input);
      replaceItem(result.item);
      setMovementItem(null);
      setSuccessMessage(`${movementLabels[result.movement.movementType]} registrada correctamente.`);
    } catch (error: unknown) {
      setMovementError(getErrorMessage(error, "No se pudo registrar el movimiento."));
    } finally {
      setIsSaving(false);
    }
  }

  async function openHistory(item: InventoryItem) {
    setHistoryItem(item);
    setMovements([]);
    setIsHistoryLoading(true);
    clearFeedback();
    try {
      setMovements(await listInventoryMovements(item.id));
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo cargar el historial."));
      setHistoryItem(null);
    } finally {
      setIsHistoryLoading(false);
    }
  }

  function replaceItem(updatedItem: InventoryItem) {
    setItems((current) => sortItems([
      ...current.filter((item) => item.id !== updatedItem.id),
      updatedItem,
    ]));
  }

  return (
    <section className="inventory-page">
      <header className="page-header clients-page-header">
        <div>
          <p className="eyebrow">Catálogo y existencias</p>
          <h1>Inventario</h1>
          <p className="page-description">Administra productos, servicios, precios y movimientos de stock.</p>
        </div>
        <button className="primary-button" type="button" disabled={Boolean(loadError)} onClick={openCreateForm}>Nuevo artículo</button>
      </header>

      {pageError && <div className="feedback-banner error" role="alert">{pageError}</div>}
      {successMessage && <div className="feedback-banner success" role="status">{successMessage}</div>}
      {loadError && <LoadErrorState message={loadError} onRetry={() => setReloadKey((key) => key + 1)} />}

      {!loadError && <section className="inventory-summary-grid" aria-label="Resumen de inventario">
        <SummaryCard label="Productos activos" value={String(counts.products)} />
        <SummaryCard label="Servicios activos" value={String(counts.services)} />
        <SummaryCard label="Bajo stock" value={String(counts.lowStock)} warning={counts.lowStock > 0} />
        <SummaryCard label="Valor al costo" value={formatMoney(counts.stockValueMinor, currency)} />
      </section>}

      {!loadError && <section className="inventory-toolbar" aria-label="Filtros de inventario">
        <label className="inventory-search">
          <span className="sr-only">Buscar inventario</span>
          <input type="search" placeholder="Buscar por nombre, SKU, categoría o descripción" value={searchTerm} onChange={(event) => setSearchTerm(event.currentTarget.value)} />
        </label>
        <label><span>Tipo</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.currentTarget.value as TypeFilter)}><option value="all">Todos</option><option value="product">Productos</option><option value="service">Servicios</option></select></label>
        <label><span>Categoría</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.currentTarget.value)}><option value="all">Todas</option>{categories.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
        <label><span>Existencias</span><select value={stockFilter} onChange={(event) => setStockFilter(event.currentTarget.value as StockFilter)}><option value="all">Todas</option><option value="low">Bajo stock</option></select></label>
        <div className="status-filter inventory-status-filter" role="group" aria-label="Estado del artículo">
          <button className={statusFilter === "active" ? "active" : undefined} type="button" aria-pressed={statusFilter === "active"} onClick={() => setStatusFilter("active")}>Activos</button>
          <button className={statusFilter === "archived" ? "active" : undefined} type="button" aria-pressed={statusFilter === "archived"} onClick={() => setStatusFilter("archived")}>Archivados</button>
        </div>
        {(searchTerm || typeFilter !== "all" || categoryFilter !== "all" || stockFilter !== "all" || statusFilter !== "active") && <button className="filter-reset-button" type="button" onClick={() => { setSearchTerm(""); setTypeFilter("all"); setCategoryFilter("all"); setStockFilter("all"); setStatusFilter("active"); }}>Limpiar filtros</button>}
      </section>}

      {!loadError && <p className="clients-result-count">{visibleItems.length} {visibleItems.length === 1 ? "artículo visible" : "artículos visibles"}</p>}
      {isLoading && <div className="loading-state">Cargando inventario...</div>}

      {!isLoading && !loadError && items.length === 0 && (
        <section className="empty-state clients-empty-state">
          <div className="empty-state-icon" aria-hidden="true">+</div>
          <p className="eyebrow">Catálogo vacío</p>
          <h2>Agrega tu primer producto o servicio</h2>
          <p>Luego podrás reutilizarlo rápidamente dentro de las cotizaciones.</p>
          <button className="primary-button" type="button" onClick={openCreateForm}>Nuevo artículo</button>
        </section>
      )}

      {!isLoading && !loadError && items.length > 0 && visibleItems.length === 0 && (
        <section className="empty-state clients-empty-state"><p className="eyebrow">Sin coincidencias</p><h2>No encontramos artículos</h2><p>Prueba con otros filtros.</p></section>
      )}

      {!isLoading && !loadError && visibleItems.length > 0 && (
        <div className="clients-table-card">
          <table className="clients-table inventory-table">
            <thead><tr><th>Artículo</th><th>Categoría</th><th>Precio de venta</th><th>Existencias</th><th>Estado</th><th className="actions-column">Acciones</th></tr></thead>
            <tbody>{visibleItems.map((item) => (
              <tr className={isLowStock(item) ? "inventory-low-stock-row" : undefined} key={item.id}>
                <td><strong className="client-name">{item.name}</strong><span className="client-secondary">{item.itemType === "product" ? "Producto" : "Servicio"}{item.sku ? ` · ${item.sku}` : ""}</span></td>
                <td>{item.category ?? <span className="client-secondary">Sin categoría</span>}</td>
                <td><strong>{formatMoney(item.salePriceMinor, currency)}</strong><span className="client-secondary">Costo {formatMoney(item.costPriceMinor, currency)}</span></td>
                <td>{item.itemType === "product" ? <><strong>{formatQuantity(item.currentStockMillis)} {item.unit}</strong><span className="client-secondary">Mínimo {formatQuantity(item.minimumStockMillis)}</span>{isLowStock(item) && <span className="inventory-low-stock-label">Bajo stock</span>}</> : <span className="client-secondary">No aplica</span>}</td>
                <td><span className={`inventory-status ${item.isArchived ? "archived" : "active"}`}>{item.isArchived ? "Archivado" : "Activo"}</span></td>
                <td><div className="row-actions inventory-row-actions compact-row-actions">
                  <button className="text-button" type="button" onClick={() => openEditForm(item)}>Editar</button>
                  {item.itemType === "product" && !item.isArchived && <button className="text-button" type="button" onClick={() => openMovementForm(item)}>Movimiento</button>}
                  <ActionMenu>
                    {item.itemType === "product" && <button type="button" onClick={() => void openHistory(item)}>Ver historial</button>}
                    {item.isArchived ? <><button type="button" disabled={actionItemId === item.id} onClick={() => void handleRestore(item)}>Restaurar</button><button className="danger-text" type="button" onClick={() => setItemToDelete(item)}>Eliminar definitivamente</button></> : <button type="button" onClick={() => setItemToArchive(item)}>Archivar artículo</button>}
                  </ActionMenu>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {formMode && (
        <ModalDialog className="form-modal" labelledBy="inventory-item-form-title" onRequestClose={closeForm}>
          <section className="client-form-card inventory-form-card" aria-labelledby="inventory-item-form-title">
            <div className="client-form-header"><div><p className="eyebrow">{formMode.type === "create" ? "Nuevo registro" : "Editar catálogo"}</p><h2 id="inventory-item-form-title">{formMode.type === "create" ? "Agregar artículo" : "Editar artículo"}</h2></div><button className="secondary-button" type="button" onClick={closeForm}>Cancelar</button></div>
            <form onSubmit={(event) => void handleItemSubmit(event)} noValidate>
              <div className="client-form-grid">
                <label className="form-field"><span>Tipo <small>Obligatorio</small></span><select value={formValues.itemType} disabled={formMode.type === "edit"} onChange={(event) => changeItemType(event.currentTarget.value as InventoryItemType)}><option value="product">Producto</option><option value="service">Servicio</option></select></label>
                <label className="form-field"><span>Nombre <small>Obligatorio</small></span><input autoFocus type="text" maxLength={160} value={formValues.name} aria-invalid={Boolean(formErrors.name)} onChange={(event) => updateFormField("name", event.currentTarget.value)} />{formErrors.name && <small className="field-error">{formErrors.name}</small>}</label>
                <label className="form-field"><span>SKU o código <small>Opcional y único</small></span><input type="text" maxLength={80} value={formValues.sku} aria-invalid={Boolean(formErrors.sku)} onChange={(event) => updateFormField("sku", event.currentTarget.value)} />{formErrors.sku && <small className="field-error">{formErrors.sku}</small>}</label>
                <label className="form-field"><span>Categoría</span><input type="text" maxLength={100} list="inventory-categories" value={formValues.category} onChange={(event) => updateFormField("category", event.currentTarget.value)} /><datalist id="inventory-categories">{categories.map((category) => <option value={category} key={category} />)}</datalist></label>
                <label className="form-field"><span>Unidad <small>Obligatorio</small></span><input type="text" maxLength={30} value={formValues.unit} aria-invalid={Boolean(formErrors.unit)} onChange={(event) => updateFormField("unit", event.currentTarget.value)} />{formErrors.unit && <small className="field-error">{formErrors.unit}</small>}</label>
                <label className="form-field"><span>Precio de costo</span><input type="number" min="0" step="0.01" value={formValues.costPrice} aria-invalid={Boolean(formErrors.costPrice)} onChange={(event) => updateFormField("costPrice", event.currentTarget.value)} /></label>
                <label className="form-field"><span>Precio de venta</span><input type="number" min="0" step="0.01" value={formValues.salePrice} aria-invalid={Boolean(formErrors.salePrice)} onChange={(event) => updateFormField("salePrice", event.currentTarget.value)} /></label>
                {formValues.itemType === "product" && formMode.type === "create" && <label className="form-field"><span>Existencia inicial</span><input type="number" min="0" step="0.001" value={formValues.initialStock} aria-invalid={Boolean(formErrors.initialStock)} onChange={(event) => updateFormField("initialStock", event.currentTarget.value)} /></label>}
                {formValues.itemType === "product" && <label className="form-field"><span>Stock mínimo</span><input type="number" min="0" step="0.001" value={formValues.minimumStock} aria-invalid={Boolean(formErrors.minimumStock)} onChange={(event) => updateFormField("minimumStock", event.currentTarget.value)} /></label>}
                <label className="form-field form-field-wide"><span>Descripción</span><textarea rows={3} maxLength={2_000} value={formValues.description} onChange={(event) => updateFormField("description", event.currentTarget.value)} /><small className="field-help">{formValues.description.length} / 2000</small></label>
              </div>
              {(formErrors.costPrice || formErrors.salePrice || formErrors.initialStock || formErrors.minimumStock) && <div className="inventory-form-error" role="alert">{formErrors.costPrice ?? formErrors.salePrice ?? formErrors.initialStock ?? formErrors.minimumStock}</div>}
              <div className="client-form-actions"><button className="secondary-button" type="button" onClick={closeForm}>Cancelar</button><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar artículo"}</button></div>
            </form>
          </section>
        </ModalDialog>
      )}

      {movementItem && (
        <ModalDialog className="form-modal inventory-movement-modal" labelledBy="inventory-movement-title" onRequestClose={() => { if (!isSaving) setMovementItem(null); }}>
          <section className="client-form-card" aria-labelledby="inventory-movement-title">
            <div className="client-form-header"><div><p className="eyebrow">Existencia actual: {formatQuantity(movementItem.currentStockMillis)} {movementItem.unit}</p><h2 id="inventory-movement-title">Movimiento de “{movementItem.name}”</h2></div><button className="secondary-button" type="button" onClick={() => setMovementItem(null)}>Cancelar</button></div>
            {movementError && <div className="feedback-banner error" role="alert">{movementError}</div>}
            <form onSubmit={(event) => void handleMovementSubmit(event)}>
              <div className="client-form-grid">
                <label className="form-field"><span>Tipo</span><select value={movementValues.movementType} onChange={(event) => setMovementValues((current) => ({ ...current, movementType: event.currentTarget.value as InventoryMovementType }))}><option value="entry">Entrada</option><option value="exit">Salida</option><option value="adjustment">Ajuste</option></select></label>
                <label className="form-field"><span>{movementValues.movementType === "adjustment" ? "Nueva existencia" : "Cantidad"}</span><input autoFocus type="number" min="0" step="0.001" value={movementValues.quantity} onChange={(event) => setMovementValues((current) => ({ ...current, quantity: event.currentTarget.value }))} /></label>
                <label className="form-field form-field-wide"><span>Motivo <small>Obligatorio</small></span><textarea rows={3} maxLength={300} placeholder="Compra, consumo, conteo físico..." value={movementValues.reason} onChange={(event) => setMovementValues((current) => ({ ...current, reason: event.currentTarget.value }))} /></label>
              </div>
              <div className="client-form-actions"><button className="secondary-button" type="button" onClick={() => setMovementItem(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "Registrando..." : "Registrar movimiento"}</button></div>
            </form>
          </section>
        </ModalDialog>
      )}

      {historyItem && (
        <ModalDialog className="detail-modal inventory-history-modal" labelledBy="inventory-history-title" onRequestClose={() => setHistoryItem(null)}>
          <section className="quote-detail-card" aria-labelledby="inventory-history-title">
            <div className="client-form-header"><div><p className="eyebrow">Historial de existencias</p><h2 id="inventory-history-title">{historyItem.name}</h2><p className="page-description">Existencia actual: {formatQuantity(items.find((item) => item.id === historyItem.id)?.currentStockMillis ?? historyItem.currentStockMillis)} {historyItem.unit}</p></div><button className="secondary-button" type="button" onClick={() => setHistoryItem(null)}>Cerrar</button></div>
            {isHistoryLoading ? <div className="loading-state">Cargando movimientos...</div> : movements.length === 0 ? <div className="calendar-day-empty"><strong>Sin movimientos</strong><p>Este producto todavía no tiene historial.</p></div> : <div className="inventory-movement-list">{movements.map((movement) => <article key={movement.id}><span className={`inventory-movement-icon ${movement.movementType}`}>{movement.quantityDeltaMillis > 0 ? "+" : "−"}</span><div><strong>{movementLabels[movement.movementType]} · {formatSignedQuantity(movement.quantityDeltaMillis)} {historyItem.unit}</strong><p>{movement.reason}</p><small>{dateTimeFormatter.format(new Date(movement.createdAt))} · {formatQuantity(movement.previousStockMillis)} → {formatQuantity(movement.newStockMillis)}</small></div></article>)}</div>}
          </section>
        </ModalDialog>
      )}

      {itemToArchive && <ConfirmationModal title={`¿Archivar “${itemToArchive.name}”?`} message="Dejará de aparecer como opción nueva en cotizaciones, pero conservará su historial." confirmLabel={actionItemId === itemToArchive.id ? "Archivando..." : "Archivar"} disabled={actionItemId === itemToArchive.id} onCancel={() => setItemToArchive(null)} onConfirm={() => void handleArchiveConfirmed()} />}
      {itemToDelete && <ConfirmationModal title={`¿Eliminar “${itemToDelete.name}”?`} message="Solo se eliminará si no tiene movimientos ni cotizaciones relacionadas." confirmLabel={actionItemId === itemToDelete.id ? "Eliminando..." : "Eliminar definitivamente"} disabled={actionItemId === itemToDelete.id} danger onCancel={() => setItemToDelete(null)} onConfirm={() => void handleDeleteConfirmed()} />}
    </section>
  );
}

function ConfirmationModal({ title, message, confirmLabel, disabled, danger = false, onCancel, onConfirm }: { title: string; message: string; confirmLabel: string; disabled: boolean; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <ModalDialog className="confirmation-modal" labelledBy="inventory-confirmation-title" onRequestClose={() => { if (!disabled) onCancel(); }}><section className="archive-confirmation" aria-labelledby="inventory-confirmation-title"><div><h2 id="inventory-confirmation-title">{title}</h2><p>{message}</p></div><div className="confirmation-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancelar</button><button className={danger ? "danger-button" : "primary-button"} type="button" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button></div></section></ModalDialog>;
}

function SummaryCard({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <article className={`task-summary-card${warning ? " overdue" : ""}`}><span>{label}</span><strong>{value}</strong></article>;
}

function validateItemForm(values: ItemFormValues, mode: ItemFormMode): ItemFormErrors {
  const errors: ItemFormErrors = {};
  if (values.name.trim().length < 2) errors.name = "Escribe al menos 2 caracteres.";
  if (values.sku.trim().length > 80) errors.sku = "El SKU no puede superar 80 caracteres.";
  if (!values.unit.trim()) errors.unit = "Indica una unidad.";
  const numericFields: Array<["costPrice" | "salePrice" | "initialStock" | "minimumStock", string]> = [
    ["costPrice", "El precio de costo no es válido."],
    ["salePrice", "El precio de venta no es válido."],
    ["initialStock", "La existencia inicial no es válida."],
    ["minimumStock", "El stock mínimo no es válido."],
  ];
  for (const [field, message] of numericFields) {
    const value = Number(values[field]);
    if (!Number.isFinite(value) || value < 0) errors[field] = message;
  }
  if (mode.type === "edit") delete errors.initialStock;
  return errors;
}

function toItemInput(values: ItemFormValues, mode: ItemFormMode): InventoryItemInput {
  return {
    itemType: values.itemType,
    name: values.name.trim(),
    sku: optionalText(values.sku),
    category: optionalText(values.category),
    description: optionalText(values.description),
    unit: values.unit.trim(),
    costPriceMinor: Math.round(Number(values.costPrice) * 100),
    salePriceMinor: Math.round(Number(values.salePrice) * 100),
    minimumStockMillis: values.itemType === "product" ? Math.round(Number(values.minimumStock) * 1_000) : 0,
    initialStockMillis: values.itemType === "product" && mode.type === "create" ? Math.round(Number(values.initialStock) * 1_000) : 0,
  };
}

function isLowStock(item: InventoryItem): boolean {
  return item.itemType === "product" && !item.isArchived && item.minimumStockMillis > 0 && item.currentStockMillis <= item.minimumStockMillis;
}

function sortItems(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((first, second) => Number(first.isArchived) - Number(second.isArchived) || first.itemType.localeCompare(second.itemType) || first.name.localeCompare(second.name, "es", { sensitivity: "base" }));
}

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("es-CR", { style: "currency", currency }).format(minor / 100);
}

function formatQuantity(millis: number): string {
  return new Intl.NumberFormat("es-CR", { maximumFractionDigits: 3 }).format(millis / 1_000);
}

function formatSignedQuantity(millis: number): string {
  const sign = millis > 0 ? "+" : "";
  return `${sign}${formatQuantity(millis)}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "string" && error.trim() ? error : fallback;
}
