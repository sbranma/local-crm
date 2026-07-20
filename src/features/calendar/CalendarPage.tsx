import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { LoadErrorState } from "../../components/LoadErrorState";
import { ModalDialog } from "../../components/ModalDialog";
import { listClients } from "../clients/client.api";
import type { Client } from "../clients/client.types";
import { listTasks, updateTask } from "../tasks/task.api";
import type { Task, TaskInput, TaskPriority, TaskStatus } from "../tasks/task.types";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from "./calendar.api";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventStatus,
  CalendarEventType,
} from "./calendar.types";

type CalendarView = "month" | "week" | "day";
type CalendarTypeFilter = "all" | "task" | CalendarEventType;
type CalendarStatusFilter = "all" | "active" | "completed" | "cancelled";
type CalendarPriorityFilter = "all" | TaskPriority;
type EventFormMode = { type: "create" } | { type: "edit"; eventId: number };

type EventFormValues = {
  title: string;
  description: string;
  clientId: string;
  eventType: CalendarEventType;
  status: CalendarEventStatus;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
};

type EventFormErrors = Partial<Record<"title" | "description" | "startsAt" | "endsAt", string>>;

type TaskEditor = {
  taskId: number;
  scheduledAt: string;
  status: TaskStatus;
};

type CalendarItem =
  | {
      source: "task";
      id: number;
      title: string;
      description: string | null;
      clientId: number | null;
      clientName: string | null;
      startsAt: string;
      endsAt: null;
      isAllDay: false;
      priority: TaskPriority;
      status: TaskStatus;
      eventType: null;
      record: Task;
    }
  | {
      source: "event";
      id: number;
      title: string;
      description: string | null;
      clientId: number | null;
      clientName: string | null;
      startsAt: string;
      endsAt: string | null;
      isAllDay: boolean;
      priority: null;
      status: CalendarEventStatus;
      eventType: CalendarEventType;
      record: CalendarEvent;
    };

const eventTypeLabels: Record<CalendarEventType, string> = {
  appointment: "Cita",
  meeting: "Reunión",
  call: "Llamada",
  reminder: "Recordatorio",
  other: "Otro",
};

const eventStatusLabels: Record<CalendarEventStatus, string> = {
  scheduled: "Programado",
  completed: "Completado",
  cancelled: "Cancelado",
};

const taskStatusLabels: Record<TaskStatus, string> = {
  pending: "Pendiente",
  in_progress: "En progreso",
  completed: "Completada",
};

const priorityLabels: Record<TaskPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
};

const weekdayLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const fullDateFormatter = new Intl.DateTimeFormat("es-CR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("es-CR", {
  month: "long",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
});

const timeFormatter = new Intl.DateTimeFormat("es-CR", {
  hour: "numeric",
  minute: "2-digit",
});

export function CalendarPage() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [anchorDate, setAnchorDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(localDateKey(today));
  const [view, setView] = useState<CalendarView>("month");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<CalendarTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<CalendarStatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<CalendarPriorityFilter>("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [eventFormMode, setEventFormMode] = useState<EventFormMode | null>(null);
  const [eventFormValues, setEventFormValues] = useState<EventFormValues | null>(null);
  const [eventFormErrors, setEventFormErrors] = useState<EventFormErrors>({});
  const [isEventFormDirty, setIsEventFormDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<CalendarEvent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [taskEditor, setTaskEditor] = useState<TaskEditor | null>(null);
  const [isTaskEditorDirty, setIsTaskEditorDirty] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    async function loadPageData() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [storedEvents, storedTasks, storedClients] = await Promise.all([
          listCalendarEvents(),
          listTasks(),
          listClients(),
        ]);

        if (isCurrent) {
          setEvents(sortEvents(storedEvents));
          setTasks(storedTasks);
          setClients(sortClients(storedClients));
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setLoadError(getErrorMessage(error, "No se pudo cargar la agenda."));
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

  const calendarItems = useMemo<CalendarItem[]>(() => {
    const taskItems: CalendarItem[] = tasks
      .filter((task) => task.scheduledAt !== null)
      .map((task) => ({
        source: "task",
        id: task.id,
        title: task.title,
        description: task.description,
        clientId: task.clientId,
        clientName: task.clientName,
        startsAt: task.scheduledAt as string,
        endsAt: null,
        isAllDay: false,
        priority: task.priority,
        status: task.status,
        eventType: null,
        record: task,
      }));

    const eventItems: CalendarItem[] = events.map((event) => ({
      source: "event",
      id: event.id,
      title: event.title,
      description: event.description,
      clientId: event.clientId,
      clientName: event.clientName,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      isAllDay: event.isAllDay,
      priority: null,
      status: event.status,
      eventType: event.eventType,
      record: event,
    }));

    return [...taskItems, ...eventItems].sort((first, second) =>
      first.startsAt.localeCompare(second.startsAt),
    );
  }, [events, tasks]);

  const visibleItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase("es");

    return calendarItems.filter((item) => {
      if (typeFilter === "task" && item.source !== "task") return false;
      if (typeFilter !== "all" && typeFilter !== "task") {
        if (item.source !== "event" || item.eventType !== typeFilter) return false;
      }

      if (statusFilter === "active" && isItemClosed(item)) return false;
      if (statusFilter === "completed" && !isItemCompleted(item)) return false;
      if (statusFilter === "cancelled") {
        if (item.source !== "event" || item.status !== "cancelled") return false;
      }

      if (priorityFilter !== "all") {
        if (item.source !== "task" || item.priority !== priorityFilter) return false;
      }

      if (clientFilter !== "all" && String(item.clientId) !== clientFilter) return false;

      if (!normalizedSearch) return true;

      return [item.title, item.description, item.clientName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("es").includes(normalizedSearch));
    });
  }, [calendarItems, clientFilter, priorityFilter, searchTerm, statusFilter, typeFilter]);

  const selectedDayItems = useMemo(
    () => itemsOnDate(visibleItems, selectedDate),
    [selectedDate, visibleItems],
  );

  const selectedDateValue = dateFromLocalKey(selectedDate);
  const currentTask = taskEditor
    ? tasks.find((task) => task.id === taskEditor.taskId) ?? null
    : null;
  const currentTaskClient = currentTask?.clientId
    ? clients.find((client) => client.id === currentTask.clientId) ?? null
    : null;
  const editingEvent = eventFormMode?.type === "edit"
    ? events.find((event) => event.id === eventFormMode.eventId) ?? null
    : null;
  const selectableClients = clients.filter(
    (client) => !client.isArchived || editingEvent?.clientId === client.id,
  );

  function clearFeedback() {
    setPageError(null);
    setSuccessMessage(null);
  }

  function chooseDate(date: Date) {
    setSelectedDate(localDateKey(date));
  }

  function changeView(nextView: CalendarView) {
    setView(nextView);
    setAnchorDate(dateFromLocalKey(selectedDate));
  }

  function movePeriod(direction: -1 | 1) {
    const nextDate = view === "month"
      ? addMonths(anchorDate, direction)
      : addDays(anchorDate, direction * (view === "week" ? 7 : 1));

    setAnchorDate(nextDate);
    setSelectedDate(localDateKey(nextDate));
  }

  function goToToday() {
    const nextToday = startOfDay(new Date());
    setAnchorDate(nextToday);
    setSelectedDate(localDateKey(nextToday));
  }

  function openCreateEvent() {
    const start = dateFromLocalKey(selectedDate);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(10, 0, 0, 0);

    setEventFormMode({ type: "create" });
    setEventFormValues({
      title: "",
      description: "",
      clientId: "",
      eventType: "appointment",
      status: "scheduled",
      startsAt: dateToLocalInput(start),
      endsAt: dateToLocalInput(end),
      isAllDay: false,
    });
    setEventFormErrors({});
    setIsEventFormDirty(false);
    clearFeedback();
  }

  function openEditEvent(event: CalendarEvent) {
    setEventFormMode({ type: "edit", eventId: event.id });
    setEventFormValues({
      title: event.title,
      description: event.description ?? "",
      clientId: event.clientId === null ? "" : String(event.clientId),
      eventType: event.eventType,
      status: event.status,
      startsAt: isoToLocalInput(event.startsAt),
      endsAt: isoToLocalInput(event.endsAt),
      isAllDay: event.isAllDay,
    });
    setEventFormErrors({});
    setIsEventFormDirty(false);
    clearFeedback();
  }

  function closeEventForm() {
    if (isSaving) return;
    if (isEventFormDirty && !window.confirm("¿Descartar los cambios sin guardar?")) return;

    setEventFormMode(null);
    setEventFormValues(null);
    setEventFormErrors({});
    setIsEventFormDirty(false);
  }

  function updateEventField<K extends keyof EventFormValues>(
    field: K,
    value: EventFormValues[K],
  ) {
    setEventFormValues((current) => current ? { ...current, [field]: value } : current);
    setIsEventFormDirty(true);
    if (field in eventFormErrors) {
      setEventFormErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function handleAllDayChange(isAllDay: boolean) {
    setEventFormValues((current) => {
      if (!current) return current;
      return {
        ...current,
        isAllDay,
        startsAt: isAllDay ? `${current.startsAt.slice(0, 10)}T00:00` : current.startsAt,
        endsAt: isAllDay && current.endsAt
          ? `${current.endsAt.slice(0, 10)}T23:59`
          : current.endsAt,
      };
    });
    setIsEventFormDirty(true);
  }

  async function handleEventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eventFormValues || !eventFormMode) return;

    const nextErrors = validateEventForm(eventFormValues);
    setEventFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSaving(true);
    clearFeedback();

    try {
      const input = toCalendarEventInput(eventFormValues);
      const savedEvent = eventFormMode.type === "create"
        ? await createCalendarEvent(input)
        : await updateCalendarEvent(eventFormMode.eventId, input);

      setEvents((current) => sortEvents([
        ...current.filter((storedEvent) => storedEvent.id !== savedEvent.id),
        savedEvent,
      ]));
      const savedDate = startOfDay(new Date(savedEvent.startsAt));
      setAnchorDate(savedDate);
      setSelectedDate(localDateKey(savedDate));
      setSuccessMessage(
        eventFormMode.type === "create"
          ? "Evento creado correctamente."
          : "Evento actualizado correctamente.",
      );
      setEventFormMode(null);
      setEventFormValues(null);
      setEventFormErrors({});
      setIsEventFormDirty(false);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo guardar el evento."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteEvent() {
    if (!eventToDelete) return;
    setIsDeleting(true);
    clearFeedback();

    try {
      await deleteCalendarEvent(eventToDelete.id);
      setEvents((current) => current.filter((event) => event.id !== eventToDelete.id));
      setSuccessMessage("Evento eliminado definitivamente.");
      setEventToDelete(null);
      setEventFormMode(null);
      setEventFormValues(null);
      setIsEventFormDirty(false);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo eliminar el evento."));
    } finally {
      setIsDeleting(false);
    }
  }

  function openTaskEditor(task: Task) {
    setTaskEditor({
      taskId: task.id,
      scheduledAt: isoToLocalInput(task.scheduledAt),
      status: task.status,
    });
    setIsTaskEditorDirty(false);
    clearFeedback();
  }

  function closeTaskEditor() {
    if (isSaving) return;
    if (isTaskEditorDirty && !window.confirm("¿Descartar los cambios sin guardar?")) return;
    setTaskEditor(null);
    setIsTaskEditorDirty(false);
  }

  async function handleTaskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskEditor || !currentTask) return;

    if (!taskEditor.scheduledAt || Number.isNaN(new Date(taskEditor.scheduledAt).getTime())) {
      setPageError("Selecciona una fecha y hora válidas para la tarea.");
      return;
    }

    setIsSaving(true);
    clearFeedback();

    const input: TaskInput = {
      title: currentTask.title,
      description: currentTask.description,
      clientId: currentTask.clientId,
      priority: currentTask.priority,
      status: taskEditor.status,
      scheduledAt: new Date(taskEditor.scheduledAt).toISOString(),
    };

    try {
      const updatedTask = await updateTask(currentTask.id, input);
      setTasks((current) => current.map((task) =>
        task.id === updatedTask.id ? updatedTask : task,
      ));
      const savedDate = startOfDay(new Date(updatedTask.scheduledAt as string));
      setAnchorDate(savedDate);
      setSelectedDate(localDateKey(savedDate));
      setSuccessMessage("Tarea actualizada desde la agenda.");
      setTaskEditor(null);
      setIsTaskEditorDirty(false);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo actualizar la tarea."));
    } finally {
      setIsSaving(false);
    }
  }

  function openCalendarItem(item: CalendarItem) {
    if (item.source === "task") openTaskEditor(item.record);
    else openEditEvent(item.record);
  }

  return (
    <section className="calendar-page">
      <header className="page-header clients-page-header">
        <div>
          <p className="eyebrow">Tiempo y compromisos</p>
          <h1>Agenda</h1>
          <p className="page-description">
            Consulta tareas programadas y organiza citas, reuniones y recordatorios.
          </p>
        </div>
        <button className="primary-button" type="button" disabled={Boolean(loadError)} onClick={openCreateEvent}>
          Nuevo evento
        </button>
      </header>

      {pageError && <div className="feedback-banner error" role="alert">{pageError}</div>}
      {successMessage && (
        <div className="feedback-banner success" role="status">{successMessage}</div>
      )}
      {loadError && <LoadErrorState message={loadError} onRetry={() => setReloadKey((key) => key + 1)} />}

      {!loadError && <section className="calendar-toolbar" aria-label="Controles de agenda">
        <div className="calendar-navigation">
          <button className="secondary-button calendar-arrow" type="button" onClick={() => movePeriod(-1)} aria-label="Periodo anterior">‹</button>
          <button className="secondary-button" type="button" onClick={goToToday}>Hoy</button>
          <button className="secondary-button calendar-arrow" type="button" onClick={() => movePeriod(1)} aria-label="Periodo siguiente">›</button>
          <h2>{calendarTitle(view, anchorDate)}</h2>
        </div>

        <div className="calendar-view-switch" role="group" aria-label="Vista de agenda">
          {(["month", "week", "day"] as const).map((calendarView) => (
            <button
              className={view === calendarView ? "active" : undefined}
              type="button"
              aria-pressed={view === calendarView}
              onClick={() => changeView(calendarView)}
              key={calendarView}
            >
              {calendarView === "month" ? "Mes" : calendarView === "week" ? "Semana" : "Día"}
            </button>
          ))}
        </div>
      </section>}

      {!loadError && <section className="calendar-filters" aria-label="Filtros de agenda">
        <label className="calendar-search">
          <span className="sr-only">Buscar en agenda</span>
          <input
            type="search"
            placeholder="Buscar por título, descripción o cliente"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Tipo</span>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.currentTarget.value as CalendarTypeFilter)}>
            <option value="all">Todos</option>
            <option value="task">Tareas</option>
            <option value="appointment">Citas</option>
            <option value="meeting">Reuniones</option>
            <option value="call">Llamadas</option>
            <option value="reminder">Recordatorios</option>
            <option value="other">Otros</option>
          </select>
        </label>
        <label>
          <span>Estado</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as CalendarStatusFilter)}>
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="completed">Completados</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </label>
        <label>
          <span>Prioridad</span>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.currentTarget.value as CalendarPriorityFilter)}>
            <option value="all">Todas</option>
            <option value="high">Alta</option>
            <option value="normal">Normal</option>
            <option value="low">Baja</option>
          </select>
        </label>
        <label>
          <span>Cliente</span>
          <select value={clientFilter} onChange={(event) => setClientFilter(event.currentTarget.value)}>
            <option value="all">Todos</option>
            {clients.map((client) => (
              <option value={client.id} key={client.id}>{client.name}</option>
            ))}
          </select>
        </label>
        {(searchTerm || typeFilter !== "all" || statusFilter !== "all" || priorityFilter !== "all" || clientFilter !== "all") && <button className="filter-reset-button" type="button" onClick={() => { setSearchTerm(""); setTypeFilter("all"); setStatusFilter("all"); setPriorityFilter("all"); setClientFilter("all"); }}>Limpiar filtros</button>}
      </section>}

      {isLoading && <div className="loading-state">Cargando agenda...</div>}

      {!isLoading && !loadError && (
        <div className={view === "day" ? "calendar-workspace calendar-workspace-day" : "calendar-workspace"}>
          <section className="calendar-board" aria-label={`Vista de ${view === "month" ? "mes" : view === "week" ? "semana" : "día"}`}>
            {view === "month" && (
              <MonthView
                anchorDate={anchorDate}
                selectedDate={selectedDate}
                items={visibleItems}
                onChooseDate={chooseDate}
                onOpenItem={openCalendarItem}
              />
            )}
            {view === "week" && (
              <WeekView
                anchorDate={anchorDate}
                selectedDate={selectedDate}
                items={visibleItems}
                onChooseDate={chooseDate}
                onOpenItem={openCalendarItem}
              />
            )}
            {view === "day" && (
              <DayView
                date={anchorDate}
                items={itemsOnDate(visibleItems, localDateKey(anchorDate))}
                onOpenItem={openCalendarItem}
                onCreateEvent={openCreateEvent}
              />
            )}
          </section>

          {view !== "day" && <aside className="calendar-day-panel" aria-label="Elementos del día seleccionado">
            <div className="calendar-day-panel-header">
              <div>
                <p className="eyebrow">Día seleccionado</p>
                <h2>{capitalize(fullDateFormatter.format(selectedDateValue))}</h2>
              </div>
              <button className="text-button" type="button" onClick={openCreateEvent}>+ Evento</button>
            </div>

            {selectedDayItems.length === 0 ? (
              <div className="calendar-day-empty">
                <strong>Sin compromisos</strong>
                <p>No hay tareas ni eventos para este día.</p>
              </div>
            ) : (
              <div className="calendar-day-list">
                {selectedDayItems.map((item) => (
                  <CalendarItemButton item={item} detailed onOpen={openCalendarItem} key={`${item.source}-${item.id}`} />
                ))}
              </div>
            )}
          </aside>}
        </div>
      )}

      {eventFormMode && eventFormValues && (
        <ModalDialog className="form-modal" labelledBy="calendar-event-form-title" onRequestClose={closeEventForm}>
          <section className="client-form-card calendar-form-card" aria-labelledby="calendar-event-form-title">
            <div className="client-form-header">
              <div>
                <p className="eyebrow">{eventFormMode.type === "create" ? "Nuevo compromiso" : "Editar compromiso"}</p>
                <h2 id="calendar-event-form-title">{eventFormMode.type === "create" ? "Agregar evento" : "Editar evento"}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={closeEventForm}>Cancelar</button>
            </div>

            <form onSubmit={(event) => void handleEventSubmit(event)} noValidate>
              <div className="client-form-grid">
                <label className="form-field form-field-wide">
                  <span>Título <small>Obligatorio</small></span>
                  <input type="text" autoFocus required maxLength={160} value={eventFormValues.title} aria-invalid={Boolean(eventFormErrors.title)} onChange={(event) => updateEventField("title", event.currentTarget.value)} />
                  {eventFormErrors.title && <small className="field-error">{eventFormErrors.title}</small>}
                </label>
                <label className="form-field">
                  <span>Tipo</span>
                  <select value={eventFormValues.eventType} onChange={(event) => updateEventField("eventType", event.currentTarget.value as CalendarEventType)}>
                    {Object.entries(eventTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Cliente relacionado</span>
                  <select value={eventFormValues.clientId} onChange={(event) => updateEventField("clientId", event.currentTarget.value)}>
                    <option value="">Sin cliente</option>
                    {selectableClients.map((client) => <option value={client.id} key={client.id}>{client.name}{client.isArchived ? " (archivado)" : ""}</option>)}
                  </select>
                </label>
                <label className="form-field calendar-all-day-field">
                  <span>Duración</span>
                  <span className="checkbox-field">
                    <input type="checkbox" checked={eventFormValues.isAllDay} onChange={(event) => handleAllDayChange(event.currentTarget.checked)} />
                    Todo el día
                  </span>
                </label>
                <label className="form-field">
                  <span>Estado</span>
                  <select value={eventFormValues.status} onChange={(event) => updateEventField("status", event.currentTarget.value as CalendarEventStatus)}>
                    {Object.entries(eventStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Inicio <small>Obligatorio</small></span>
                  <input
                    type={eventFormValues.isAllDay ? "date" : "datetime-local"}
                    required
                    value={eventFormValues.isAllDay ? eventFormValues.startsAt.slice(0, 10) : eventFormValues.startsAt}
                    aria-invalid={Boolean(eventFormErrors.startsAt)}
                    onChange={(event) => updateEventField("startsAt", eventFormValues.isAllDay ? `${event.currentTarget.value}T00:00` : event.currentTarget.value)}
                  />
                  {eventFormErrors.startsAt && <small className="field-error">{eventFormErrors.startsAt}</small>}
                </label>
                <label className="form-field">
                  <span>Final <small>Opcional</small></span>
                  <input
                    type={eventFormValues.isAllDay ? "date" : "datetime-local"}
                    value={eventFormValues.isAllDay ? eventFormValues.endsAt.slice(0, 10) : eventFormValues.endsAt}
                    aria-invalid={Boolean(eventFormErrors.endsAt)}
                    onChange={(event) => updateEventField("endsAt", eventFormValues.isAllDay && event.currentTarget.value ? `${event.currentTarget.value}T23:59` : event.currentTarget.value)}
                  />
                  {eventFormErrors.endsAt && <small className="field-error">{eventFormErrors.endsAt}</small>}
                </label>
                <label className="form-field form-field-wide">
                  <span>Descripción</span>
                  <textarea rows={3} maxLength={2_000} value={eventFormValues.description} aria-invalid={Boolean(eventFormErrors.description)} onChange={(event) => updateEventField("description", event.currentTarget.value)} />
                  <small className="field-help">{eventFormValues.description.length} / 2000</small>
                  {eventFormErrors.description && <small className="field-error">{eventFormErrors.description}</small>}
                </label>
              </div>

              <div className="client-form-actions calendar-form-actions">
                {editingEvent && (
                  <button className="danger-button calendar-delete-button" type="button" onClick={() => setEventToDelete(editingEvent)}>Eliminar</button>
                )}
                <button className="secondary-button" type="button" onClick={closeEventForm}>Cancelar</button>
                <button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar evento"}</button>
              </div>
            </form>
          </section>
        </ModalDialog>
      )}

      {eventToDelete && (
        <ModalDialog className="confirmation-modal" labelledBy="delete-calendar-event-title" onRequestClose={() => { if (!isDeleting) setEventToDelete(null); }}>
          <section className="archive-confirmation" aria-labelledby="delete-calendar-event-title">
            <div>
              <h2 id="delete-calendar-event-title">¿Eliminar “{eventToDelete.title}”?</h2>
              <p>Esta acción es permanente y no afectará las tareas.</p>
            </div>
            <div className="confirmation-actions">
              <button className="secondary-button" type="button" onClick={() => setEventToDelete(null)}>Cancelar</button>
              <button className="danger-button" type="button" disabled={isDeleting} onClick={() => void handleDeleteEvent()}>{isDeleting ? "Eliminando..." : "Eliminar definitivamente"}</button>
            </div>
          </section>
        </ModalDialog>
      )}

      {taskEditor && currentTask && (
        <ModalDialog className="form-modal task-agenda-modal" labelledBy="agenda-task-title" onRequestClose={closeTaskEditor}>
          <section className="client-form-card" aria-labelledby="agenda-task-title">
            <div className="client-form-header">
              <div>
                <p className="eyebrow">Tarea programada</p>
                <h2 id="agenda-task-title">{currentTask.title}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={closeTaskEditor}>Cancelar</button>
            </div>

            <div className="agenda-task-details">
              <div><span>Cliente</span><strong>{currentTask.clientName ?? "Sin cliente"}</strong></div>
              <div><span>Prioridad</span><strong>{priorityLabels[currentTask.priority]}</strong></div>
              {currentTaskClient && (
                <div className="agenda-task-contact">
                  <span>Contacto</span>
                  <strong>{currentTaskClient.phone ?? currentTaskClient.email ?? "Sin datos de contacto"}</strong>
                </div>
              )}
            </div>
            {currentTask.description && <p className="agenda-task-description">{currentTask.description}</p>}

            <form onSubmit={(event) => void handleTaskSubmit(event)}>
              <div className="client-form-grid">
                <label className="form-field">
                  <span>Fecha y hora programada</span>
                  <input type="datetime-local" required value={taskEditor.scheduledAt} onChange={(event) => { setTaskEditor((current) => current ? { ...current, scheduledAt: event.currentTarget.value } : current); setIsTaskEditorDirty(true); }} />
                </label>
                <label className="form-field">
                  <span>Estado</span>
                  <select value={taskEditor.status} onChange={(event) => { setTaskEditor((current) => current ? { ...current, status: event.currentTarget.value as TaskStatus } : current); setIsTaskEditorDirty(true); }}>
                    {Object.entries(taskStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
              </div>
              <div className="client-form-actions">
                <button className="secondary-button" type="button" onClick={closeTaskEditor}>Cancelar</button>
                <button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "Guardando..." : "Actualizar tarea"}</button>
              </div>
            </form>
          </section>
        </ModalDialog>
      )}
    </section>
  );
}

type CalendarViewProps = {
  items: CalendarItem[];
  onOpenItem: (item: CalendarItem) => void;
};

function MonthView({
  anchorDate,
  selectedDate,
  items,
  onChooseDate,
  onOpenItem,
}: CalendarViewProps & {
  anchorDate: Date;
  selectedDate: string;
  onChooseDate: (date: Date) => void;
}) {
  const monthDays = calendarMonthDays(anchorDate);
  const currentMonth = anchorDate.getMonth();

  return (
    <div className="calendar-month">
      <div className="calendar-weekday-row" aria-hidden="true">
        {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="calendar-month-grid">
        {monthDays.map((date) => {
          const key = localDateKey(date);
          const dayItems = itemsOnDate(items, key);
          const isSelected = key === selectedDate;
          const isToday = key === localDateKey(new Date());

          return (
            <article className={`calendar-day-cell${date.getMonth() !== currentMonth ? " outside-month" : ""}${isSelected ? " selected" : ""}`} key={key}>
              <button className={isToday ? "calendar-day-number today" : "calendar-day-number"} type="button" aria-label={`Seleccionar ${fullDateFormatter.format(date)}`} onClick={() => onChooseDate(date)}>{date.getDate()}</button>
              <div className="calendar-cell-items">
                {dayItems.slice(0, 3).map((item) => <CalendarItemButton compact item={item} onOpen={onOpenItem} key={`${item.source}-${item.id}`} />)}
                {dayItems.length > 3 && <button className="calendar-more-button" type="button" onClick={() => onChooseDate(date)}>+{dayItems.length - 3} más</button>}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  anchorDate,
  selectedDate,
  items,
  onChooseDate,
  onOpenItem,
}: CalendarViewProps & {
  anchorDate: Date;
  selectedDate: string;
  onChooseDate: (date: Date) => void;
}) {
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchorDate), index));

  return (
    <div className="calendar-week-grid">
      {weekDays.map((date) => {
        const key = localDateKey(date);
        const dayItems = itemsOnDate(items, key);
        return (
          <article className={`calendar-week-column${key === selectedDate ? " selected" : ""}`} key={key}>
            <button className="calendar-week-heading" type="button" onClick={() => onChooseDate(date)}>
              <span>{weekdayLabels[(date.getDay() + 6) % 7]}</span>
              <strong>{date.getDate()}</strong>
            </button>
            <div className="calendar-week-items">
              {dayItems.length === 0 ? <span className="calendar-week-empty">Libre</span> : dayItems.map((item) => <CalendarItemButton compact item={item} onOpen={onOpenItem} key={`${item.source}-${item.id}`} />)}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function DayView({ date, items, onOpenItem, onCreateEvent }: CalendarViewProps & { date: Date; onCreateEvent: () => void }) {
  return (
    <div className="calendar-single-day">
      <div className="calendar-single-day-header">
        <div><p className="eyebrow">Agenda del día</p><h3>{capitalize(fullDateFormatter.format(date))}</h3></div>
        <button className="secondary-button" type="button" onClick={onCreateEvent}>Agregar evento</button>
      </div>
      {items.length === 0 ? (
        <div className="calendar-single-day-empty"><strong>Día disponible</strong><p>No hay actividades programadas.</p></div>
      ) : (
        <div className="calendar-timeline">
          {items.map((item) => <CalendarItemButton detailed item={item} onOpen={onOpenItem} key={`${item.source}-${item.id}`} />)}
        </div>
      )}
    </div>
  );
}

function CalendarItemButton({ item, onOpen, compact = false, detailed = false }: {
  item: CalendarItem;
  onOpen: (item: CalendarItem) => void;
  compact?: boolean;
  detailed?: boolean;
}) {
  const overdue = isTaskOverdue(item);
  const className = [
    "calendar-item",
    `calendar-item-${item.source === "task" ? "task" : item.eventType}`,
    isItemCompleted(item) ? "completed" : "",
    item.source === "event" && item.status === "cancelled" ? "cancelled" : "",
    overdue ? "overdue" : "",
    compact ? "compact" : "",
    detailed ? "detailed" : "",
  ].filter(Boolean).join(" ");

  return (
    <button className={className} type="button" onClick={() => onOpen(item)} title={item.title}>
      <span className="calendar-item-time">{item.isAllDay ? "Todo el día" : timeFormatter.format(new Date(item.startsAt))}</span>
      <strong>{item.title}</strong>
      {detailed && (
        <>
          <span className="calendar-item-kind">{item.source === "task" ? `Tarea · ${priorityLabels[item.priority]}` : eventTypeLabels[item.eventType]}</span>
          {item.clientName && <span className="calendar-item-client">{item.clientName}</span>}
        </>
      )}
    </button>
  );
}

function validateEventForm(values: EventFormValues): EventFormErrors {
  const errors: EventFormErrors = {};
  if (values.title.trim().length < 2) errors.title = "Escribe al menos 2 caracteres.";
  else if (values.title.trim().length > 160) errors.title = "El título no puede superar 160 caracteres.";
  if (values.description.trim().length > 2_000) errors.description = "La descripción no puede superar 2.000 caracteres.";

  const start = new Date(values.startsAt);
  const end = values.endsAt ? new Date(values.endsAt) : null;
  if (!values.startsAt || Number.isNaN(start.getTime())) errors.startsAt = "Selecciona una fecha de inicio válida.";
  if (end && Number.isNaN(end.getTime())) errors.endsAt = "Selecciona una fecha final válida.";
  else if (end && !Number.isNaN(start.getTime()) && end.getTime() <= start.getTime()) errors.endsAt = "La fecha final debe ser posterior al inicio.";
  return errors;
}

function toCalendarEventInput(values: EventFormValues): CalendarEventInput {
  return {
    title: values.title.trim(),
    description: optionalText(values.description),
    clientId: values.clientId ? Number(values.clientId) : null,
    eventType: values.eventType,
    status: values.status,
    startsAt: new Date(values.startsAt).toISOString(),
    endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
    isAllDay: values.isAllDay,
  };
}

function itemsOnDate(items: CalendarItem[], dateKey: string): CalendarItem[] {
  const dayStart = dateFromLocalKey(dateKey).getTime();
  const dayEnd = addDays(dateFromLocalKey(dateKey), 1).getTime();

  return items.filter((item) => {
    const start = new Date(item.startsAt).getTime();
    if (item.source === "task" || !item.endsAt) return start >= dayStart && start < dayEnd;
    const end = new Date(item.endsAt).getTime();
    return start < dayEnd && end >= dayStart;
  }).sort((first, second) => first.startsAt.localeCompare(second.startsAt));
}

function isItemClosed(item: CalendarItem): boolean {
  return item.source === "task"
    ? item.status === "completed"
    : item.status === "completed" || item.status === "cancelled";
}

function isItemCompleted(item: CalendarItem): boolean {
  return item.status === "completed";
}

function isTaskOverdue(item: CalendarItem): boolean {
  return item.source === "task" && item.status !== "completed" && new Date(item.startsAt).getTime() < Date.now();
}

function calendarMonthDays(anchorDate: Date): Date[] {
  const firstDay = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const firstVisibleDay = startOfWeek(firstDay);
  return Array.from({ length: 42 }, (_, index) => addDays(firstVisibleDay, index));
}

function calendarTitle(view: CalendarView, anchorDate: Date): string {
  if (view === "month") return capitalize(monthFormatter.format(anchorDate));
  if (view === "day") return capitalize(fullDateFormatter.format(anchorDate));
  const firstDay = startOfWeek(anchorDate);
  const lastDay = addDays(firstDay, 6);
  return `${shortDateFormatter.format(firstDay)} – ${shortDateFormatter.format(lastDay)}`;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfWeek(value: Date): Date {
  const date = startOfDay(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return date;
}

function addDays(value: Date, amount: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function addMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function localDateKey(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function dateFromLocalKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateToLocalInput(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${localDateKey(value)}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function isoToLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateToLocalInput(date);
}

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

function sortClients(clients: Client[]): Client[] {
  return [...clients].sort((first, second) => first.name.localeCompare(second.name, "es", { sensitivity: "base" }));
}

function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((first, second) => first.startsAt.localeCompare(second.startsAt));
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase("es") + value.slice(1);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "string" && error.trim() ? error : fallback;
}
