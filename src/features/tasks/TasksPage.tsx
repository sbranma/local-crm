import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ActionMenu } from "../../components/ActionMenu";
import { LoadErrorState } from "../../components/LoadErrorState";
import { ModalDialog } from "../../components/ModalDialog";
import { listClients } from "../clients/client.api";
import type { Client } from "../clients/client.types";
import {
  createTask,
  deleteTask,
  listTasks,
  setTaskStatus,
  updateTask,
} from "./task.api";
import type {
  Task,
  TaskInput,
  TaskPriority,
  TaskStatus,
} from "./task.types";

type TaskStatusFilter = "all" | TaskStatus;
type TaskPriorityFilter = "all" | TaskPriority;
type FormMode = { type: "create" } | { type: "edit"; taskId: number };

type TaskFormValues = {
  title: string;
  description: string;
  clientId: string;
  priority: TaskPriority;
  status: TaskStatus;
  scheduledAt: string;
};

type TaskFormErrors = Partial<Record<"title" | "description" | "scheduledAt", string>>;

const EMPTY_FORM: TaskFormValues = {
  title: "",
  description: "",
  clientId: "",
  priority: "normal",
  status: "pending",
  scheduledAt: "",
};

const dateTimeFormatter = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const statusLabels: Record<TaskStatus, string> = {
  pending: "Pendiente",
  in_progress: "En progreso",
  completed: "Completada",
};

const priorityLabels: Record<TaskPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
};

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriorityFilter>("all");
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [formValues, setFormValues] = useState<TaskFormValues>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<TaskFormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [actionTaskId, setActionTaskId] = useState<number | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadPageData() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [storedTasks, storedClients] = await Promise.all([
          listTasks(),
          listClients(),
        ]);

        if (isCurrent) {
          setTasks(sortTasks(storedTasks));
          setClients(sortClients(storedClients));
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setLoadError(getErrorMessage(error, "No se pudieron cargar las tareas."));
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadPageData();

    return () => {
      isCurrent = false;
    };
  }, [reloadKey]);

  const counts = useMemo(() => {
    const openTasks = tasks.filter((task) => task.status !== "completed");

    return {
      open: openTasks.length,
      inProgress: tasks.filter((task) => task.status === "in_progress").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      overdue: openTasks.filter(isTaskOverdue).length,
    };
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase("es");

    return tasks.filter((task) => {
      if (statusFilter !== "all" && task.status !== statusFilter) {
        return false;
      }

      if (priorityFilter !== "all" && task.priority !== priorityFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [task.title, task.description, task.clientName]
        .filter((value): value is string => Boolean(value))
        .some((value) =>
          value.toLocaleLowerCase("es").includes(normalizedSearch),
        );
    });
  }, [priorityFilter, searchTerm, statusFilter, tasks]);

  const selectableClients = clients.filter(
    (client) =>
      !client.isArchived ||
      (formMode?.type === "edit" && String(client.id) === formValues.clientId),
  );

  function openCreateForm() {
    setFormMode({ type: "create" });
    setFormValues(EMPTY_FORM);
    setIsFormDirty(false);
    setFormErrors({});
    clearFeedback();
  }

  function openEditForm(task: Task) {
    setFormMode({ type: "edit", taskId: task.id });
    setFormValues({
      title: task.title,
      description: task.description ?? "",
      clientId: task.clientId === null ? "" : String(task.clientId),
      priority: task.priority,
      status: task.status,
      scheduledAt: isoToLocalInput(task.scheduledAt),
    });
    setIsFormDirty(false);
    setFormErrors({});
    clearFeedback();
  }

  function closeForm() {
    if (isSaving) {
      return;
    }

    if (isFormDirty && !window.confirm("¿Descartar los cambios sin guardar?")) {
      return;
    }

    setFormMode(null);
    setFormValues(EMPTY_FORM);
    setFormErrors({});
    setIsFormDirty(false);
  }

  function updateFormField<K extends keyof TaskFormValues>(
    field: K,
    value: TaskFormValues[K],
  ) {
    setFormValues((current) => ({ ...current, [field]: value }));
    setIsFormDirty(true);

    if (field in formErrors) {
      setFormErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateForm(formValues);
    setFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0 || !formMode) {
      return;
    }

    setIsSaving(true);
    clearFeedback();

    try {
      const input = toTaskInput(formValues);
      const savedTask =
        formMode.type === "create"
          ? await createTask(input)
          : await updateTask(formMode.taskId, input);

      replaceTask(savedTask);
      setSuccessMessage(
        formMode.type === "create"
          ? "Tarea creada correctamente."
          : "Tarea actualizada correctamente.",
      );
      setFormMode(null);
      setFormValues(EMPTY_FORM);
      setFormErrors({});
      setIsFormDirty(false);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo guardar la tarea."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStatusChange(task: Task, status: TaskStatus) {
    setActionTaskId(task.id);
    clearFeedback();

    try {
      const updatedTask = await setTaskStatus(task.id, status);
      replaceTask(updatedTask);
      setSuccessMessage(
        status === "completed"
          ? "Tarea completada correctamente."
          : "Tarea reabierta correctamente.",
      );
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo cambiar el estado de la tarea."));
    } finally {
      setActionTaskId(null);
    }
  }

  async function handleDeleteConfirmed() {
    if (!taskToDelete) {
      return;
    }

    setActionTaskId(taskToDelete.id);
    clearFeedback();

    try {
      await deleteTask(taskToDelete.id);
      setTasks((current) => current.filter((task) => task.id !== taskToDelete.id));
      setSuccessMessage("Tarea eliminada definitivamente.");
      setTaskToDelete(null);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo eliminar la tarea."));
    } finally {
      setActionTaskId(null);
    }
  }

  function replaceTask(updatedTask: Task) {
    setTasks((current) =>
      sortTasks([
        ...current.filter((task) => task.id !== updatedTask.id),
        updatedTask,
      ]),
    );
  }

  function clearFeedback() {
    setPageError(null);
    setSuccessMessage(null);
  }

  return (
    <section className="tasks-page">
      <header className="page-header clients-page-header">
        <div>
          <p className="eyebrow">Organización del trabajo</p>
          <h1>Tareas</h1>
          <p className="page-description">
            Organiza actividades internas o relacionadas con tus clientes.
          </p>
        </div>

        <button className="primary-button" type="button" disabled={Boolean(loadError)} onClick={openCreateForm}>
          Nueva tarea
        </button>
      </header>

      {pageError && (
        <div className="feedback-banner error" role="alert">
          {pageError}
        </div>
      )}

      {successMessage && (
        <div className="feedback-banner success" role="status">
          {successMessage}
        </div>
      )}

      {loadError && <LoadErrorState message={loadError} onRetry={() => setReloadKey((key) => key + 1)} />}

      {!loadError && <section className="task-summary-grid" aria-label="Resumen de tareas">
        <article className="task-summary-card">
          <span>Abiertas</span>
          <strong>{counts.open}</strong>
        </article>
        <article className="task-summary-card">
          <span>En progreso</span>
          <strong>{counts.inProgress}</strong>
        </article>
        <article className="task-summary-card overdue">
          <span>Vencidas</span>
          <strong>{counts.overdue}</strong>
        </article>
        <article className="task-summary-card">
          <span>Completadas</span>
          <strong>{counts.completed}</strong>
        </article>
      </section>}

      {formMode && (
        <ModalDialog
          className="form-modal"
          labelledBy="task-form-title"
          onRequestClose={closeForm}
        >
        <section className="client-form-card" aria-labelledby="task-form-title">
          <div className="client-form-header">
            <div>
              <p className="eyebrow">
                {formMode.type === "create" ? "Nueva actividad" : "Editar actividad"}
              </p>
              <h2 id="task-form-title">
                {formMode.type === "create" ? "Agregar tarea" : "Editar tarea"}
              </h2>
            </div>
            <button className="secondary-button" type="button" onClick={closeForm}>
              Cancelar
            </button>
          </div>

          <form onSubmit={(event) => void handleSubmit(event)} noValidate>
            <div className="client-form-grid">
              <label className="form-field form-field-wide">
                <span>
                  Título <small>Obligatorio</small>
                </span>
                <input
                  type="text"
                  value={formValues.title}
                  maxLength={160}
                  autoFocus
                  required
                  aria-invalid={Boolean(formErrors.title)}
                  onChange={(event) => updateFormField("title", event.currentTarget.value)}
                />
                {formErrors.title && <small className="field-error">{formErrors.title}</small>}
              </label>

              <label className="form-field">
                <span>Cliente relacionado</span>
                <select
                  value={formValues.clientId}
                  onChange={(event) => updateFormField("clientId", event.currentTarget.value)}
                >
                  <option value="">Sin cliente</option>
                  {selectableClients.map((client) => (
                    <option value={client.id} key={client.id}>
                      {client.name}{client.isArchived ? " (archivado)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>Fecha y hora programada</span>
                <input
                  type="datetime-local"
                  value={formValues.scheduledAt}
                  aria-invalid={Boolean(formErrors.scheduledAt)}
                  onChange={(event) => updateFormField("scheduledAt", event.currentTarget.value)}
                />
                {formErrors.scheduledAt && (
                  <small className="field-error">{formErrors.scheduledAt}</small>
                )}
              </label>

              <label className="form-field">
                <span>Prioridad</span>
                <select
                  value={formValues.priority}
                  onChange={(event) =>
                    updateFormField("priority", event.currentTarget.value as TaskPriority)
                  }
                >
                  <option value="low">Baja</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                </select>
              </label>

              <label className="form-field">
                <span>Estado</span>
                <select
                  value={formValues.status}
                  onChange={(event) =>
                    updateFormField("status", event.currentTarget.value as TaskStatus)
                  }
                >
                  <option value="pending">Pendiente</option>
                  <option value="in_progress">En progreso</option>
                  <option value="completed">Completada</option>
                </select>
              </label>

              <label className="form-field form-field-wide">
                <span>Descripción</span>
                <textarea
                  value={formValues.description}
                  maxLength={2_000}
                  rows={3}
                  aria-invalid={Boolean(formErrors.description)}
                  onChange={(event) =>
                    updateFormField("description", event.currentTarget.value)
                  }
                />
                <small className="field-help">
                  {formValues.description.length} / 2000
                </small>
                {formErrors.description && (
                  <small className="field-error">{formErrors.description}</small>
                )}
              </label>
            </div>

            <div className="client-form-actions">
              <button className="secondary-button" type="button" onClick={closeForm}>
                Cancelar
              </button>
              <button className="primary-button" type="submit" disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar tarea"}
              </button>
            </div>
          </form>
        </section>
        </ModalDialog>
      )}

      {!loadError && <section className="clients-toolbar tasks-toolbar" aria-label="Filtros de tareas">
        <label className="client-search">
          <span className="sr-only">Buscar tareas</span>
          <input
            type="search"
            placeholder="Buscar por tarea, descripción o cliente"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
          />
        </label>

        <div className="task-filters">
          <label className="task-filter">
            <span>Estado</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.currentTarget.value as TaskStatusFilter)
              }
            >
              <option value="all">Todos</option>
              <option value="pending">Pendientes</option>
              <option value="in_progress">En progreso</option>
              <option value="completed">Completadas</option>
            </select>
          </label>
          <label className="task-filter">
            <span>Prioridad</span>
            <select
              value={priorityFilter}
              onChange={(event) =>
                setPriorityFilter(event.currentTarget.value as TaskPriorityFilter)
              }
            >
              <option value="all">Todas</option>
              <option value="high">Alta</option>
              <option value="normal">Normal</option>
              <option value="low">Baja</option>
            </select>
          </label>
        </div>
        {(searchTerm || statusFilter !== "all" || priorityFilter !== "all") && <button className="filter-reset-button" type="button" onClick={() => { setSearchTerm(""); setStatusFilter("all"); setPriorityFilter("all"); }}>Limpiar filtros</button>}
      </section>}

      {!loadError && <p className="clients-result-count">
        {visibleTasks.length} {visibleTasks.length === 1 ? "tarea visible" : "tareas visibles"}
      </p>}

      {taskToDelete && (
        <ModalDialog
          className="confirmation-modal"
          labelledBy="delete-task-title"
          onRequestClose={() => {
            if (actionTaskId !== taskToDelete.id) setTaskToDelete(null);
          }}
        >
        <section className="archive-confirmation" aria-labelledby="delete-task-title">
          <div>
            <h2 id="delete-task-title">¿Eliminar “{taskToDelete.title}”?</h2>
            <p>Esta acción es permanente y no se puede deshacer.</p>
          </div>
          <div className="confirmation-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setTaskToDelete(null)}
            >
              Cancelar
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={actionTaskId === taskToDelete.id}
              onClick={() => void handleDeleteConfirmed()}
            >
              {actionTaskId === taskToDelete.id ? "Eliminando..." : "Eliminar definitivamente"}
            </button>
          </div>
        </section>
        </ModalDialog>
      )}

      {isLoading && <div className="loading-state">Cargando tareas...</div>}

      {!isLoading && !loadError && tasks.length === 0 && (
        <section className="empty-state clients-empty-state">
          <div className="empty-state-icon" aria-hidden="true">+</div>
          <p className="eyebrow">Sin tareas</p>
          <h2>Agrega tu primera tarea</h2>
          <p>Las actividades internas y de tus clientes aparecerán aquí.</p>
          <button className="primary-button" type="button" onClick={openCreateForm}>
            Nueva tarea
          </button>
        </section>
      )}

      {!isLoading && !loadError && tasks.length > 0 && visibleTasks.length === 0 && (
        <section className="empty-state clients-empty-state">
          <p className="eyebrow">Sin coincidencias</p>
          <h2>No encontramos tareas</h2>
          <p>Prueba con otra búsqueda o cambia los filtros.</p>
        </section>
      )}

      {!isLoading && !loadError && visibleTasks.length > 0 && (
        <div className="clients-table-card">
          <table className="clients-table tasks-table">
            <thead>
              <tr>
                <th scope="col">Tarea</th>
                <th scope="col">Cliente</th>
                <th scope="col">Programada</th>
                <th scope="col">Prioridad</th>
                <th scope="col">Estado</th>
                <th scope="col" className="actions-column">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => {
                const overdue = isTaskOverdue(task);

                return (
                  <tr className={overdue ? "task-row-overdue" : undefined} key={task.id}>
                    <td>
                      <strong className="client-name">{task.title}</strong>
                      {task.description && (
                        <span className="client-secondary task-description">{task.description}</span>
                      )}
                    </td>
                    <td>
                      {task.clientName ?? <span className="client-secondary">Sin cliente</span>}
                      {task.clientIsArchived && (
                        <span className="client-secondary">Cliente archivado</span>
                      )}
                    </td>
                    <td>
                      {task.scheduledAt ? formatDateTime(task.scheduledAt) : (
                        <span className="client-secondary">Sin programar</span>
                      )}
                      {overdue && <span className="overdue-label">Vencida</span>}
                    </td>
                    <td>
                      <span className={`task-badge priority-${task.priority}`}>
                        {priorityLabels[task.priority]}
                      </span>
                    </td>
                    <td>
                      <span className={`task-badge status-${task.status}`}>
                        {statusLabels[task.status]}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions task-row-actions compact-row-actions">
                        <button className="text-button" type="button" onClick={() => openEditForm(task)}>
                          Editar
                        </button>
                        <button
                          className="text-button"
                          type="button"
                          disabled={actionTaskId === task.id}
                          onClick={() =>
                            void handleStatusChange(
                              task,
                              task.status === "completed" ? "pending" : "completed",
                            )
                          }
                        >
                          {actionTaskId === task.id
                            ? "Actualizando..."
                            : task.status === "completed"
                              ? "Reabrir"
                              : "Completar"}
                        </button>
                        <ActionMenu>
                          <button className="danger-text" type="button" onClick={() => setTaskToDelete(task)}>
                            Eliminar tarea
                          </button>
                        </ActionMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function validateForm(values: TaskFormValues): TaskFormErrors {
  const errors: TaskFormErrors = {};
  const title = values.title.trim();

  if (title.length < 2) {
    errors.title = "Escribe al menos 2 caracteres.";
  } else if (title.length > 160) {
    errors.title = "El título no puede superar 160 caracteres.";
  }

  if (values.description.trim().length > 2_000) {
    errors.description = "La descripción no puede superar 2.000 caracteres.";
  }

  if (values.scheduledAt && Number.isNaN(new Date(values.scheduledAt).getTime())) {
    errors.scheduledAt = "Selecciona una fecha y hora válidas.";
  }

  return errors;
}

function toTaskInput(values: TaskFormValues): TaskInput {
  return {
    title: values.title.trim(),
    description: optionalText(values.description),
    clientId: values.clientId ? Number(values.clientId) : null,
    priority: values.priority,
    status: values.status,
    scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : null,
  };
}

function optionalText(value: string): string | null {
  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function sortClients(clients: Client[]): Client[] {
  return [...clients].sort((first, second) =>
    first.name.localeCompare(second.name, "es", { sensitivity: "base" }),
  );
}

function sortTasks(tasks: Task[]): Task[] {
  const statusOrder: Record<TaskStatus, number> = {
    pending: 0,
    in_progress: 1,
    completed: 2,
  };
  const priorityOrder: Record<TaskPriority, number> = {
    high: 0,
    normal: 1,
    low: 2,
  };

  return [...tasks].sort((first, second) => {
    const statusDifference = statusOrder[first.status] - statusOrder[second.status];
    if (statusDifference !== 0) return statusDifference;

    if (first.scheduledAt && second.scheduledAt) {
      const dateDifference = first.scheduledAt.localeCompare(second.scheduledAt);
      if (dateDifference !== 0) return dateDifference;
    } else if (first.scheduledAt) {
      return -1;
    } else if (second.scheduledAt) {
      return 1;
    }

    const priorityDifference = priorityOrder[first.priority] - priorityOrder[second.priority];
    if (priorityDifference !== 0) return priorityDifference;

    return first.title.localeCompare(second.title, "es", { sensitivity: "base" });
  });
}

function isTaskOverdue(task: Task): boolean {
  return (
    task.status !== "completed" &&
    task.scheduledAt !== null &&
    new Date(task.scheduledAt).getTime() < Date.now()
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

function isoToLocalInput(value: string | null): string {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "string" && error.trim() ? error : fallback;
}
