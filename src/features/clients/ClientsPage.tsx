import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  createClient,
  deleteClient,
  listClients,
  setClientArchived,
  updateClient,
} from "./client.api";
import type { Client, CreateClientInput } from "./client.types";

type ClientStatusFilter = "active" | "archived";
type FormMode = { type: "create" } | { type: "edit"; clientId: number };

type ClientFormValues = {
  name: string;
  phone: string;
  email: string;
  identification: string;
  address: string;
  notes: string;
};

type ClientFormErrors = Partial<Record<keyof ClientFormValues, string>>;

const EMPTY_FORM: ClientFormValues = {
  name: "",
  phone: "",
  email: "",
  identification: "",
  address: "",
  notes: "",
};

const dateFormatter = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<ClientStatusFilter>("active");
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [formValues, setFormValues] =
    useState<ClientFormValues>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<ClientFormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [clientToArchive, setClientToArchive] = useState<Client | null>(null);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [actionClientId, setActionClientId] = useState<number | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadClients() {
      try {
        const storedClients = await listClients();

        if (isCurrent) {
          setClients(sortClients(storedClients));
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setPageError(getErrorMessage(error, "No se pudieron cargar los clientes."));
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadClients();

    return () => {
      isCurrent = false;
    };
  }, []);

  const activeClientCount = clients.filter((client) => !client.isArchived).length;
  const archivedClientCount = clients.length - activeClientCount;

  const visibleClients = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase("es");
    const showArchived = statusFilter === "archived";

    return clients.filter((client) => {
      if (client.isArchived !== showArchived) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [
        client.name,
        client.phone,
        client.email,
        client.identification,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) =>
          value.toLocaleLowerCase("es").includes(normalizedSearch),
        );
    });
  }, [clients, searchTerm, statusFilter]);

  function openCreateForm() {
    setFormMode({ type: "create" });
    setFormValues(EMPTY_FORM);
    setFormErrors({});
    setPageError(null);
    setSuccessMessage(null);
  }

  function openEditForm(client: Client) {
    setFormMode({ type: "edit", clientId: client.id });
    setFormValues({
      name: client.name,
      phone: client.phone ?? "",
      email: client.email ?? "",
      identification: client.identification ?? "",
      address: client.address ?? "",
      notes: client.notes ?? "",
    });
    setFormErrors({});
    setPageError(null);
    setSuccessMessage(null);
  }

  function closeForm() {
    if (isSaving) {
      return;
    }

    setFormMode(null);
    setFormValues(EMPTY_FORM);
    setFormErrors({});
  }

  function updateFormField(field: keyof ClientFormValues, value: string) {
    setFormValues((current) => ({ ...current, [field]: value }));

    if (formErrors[field]) {
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
    setPageError(null);
    setSuccessMessage(null);

    try {
      const input = toClientInput(formValues);
      const savedClient =
        formMode.type === "create"
          ? await createClient(input)
          : await updateClient(formMode.clientId, input);

      setClients((current) =>
        sortClients([
          ...current.filter((client) => client.id !== savedClient.id),
          savedClient,
        ]),
      );
      setSuccessMessage(
        formMode.type === "create"
          ? "Cliente creado correctamente."
          : "Cliente actualizado correctamente.",
      );
      setFormMode(null);
      setFormValues(EMPTY_FORM);
      setFormErrors({});
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo guardar el cliente."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleArchiveConfirmed() {
    if (!clientToArchive) {
      return;
    }

    setActionClientId(clientToArchive.id);
    setPageError(null);
    setSuccessMessage(null);

    try {
      const archivedClient = await setClientArchived(clientToArchive.id, true);
      replaceClient(archivedClient);
      setSuccessMessage("Cliente archivado correctamente.");
      setClientToArchive(null);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo archivar el cliente."));
    } finally {
      setActionClientId(null);
    }
  }

  async function handleRestore(client: Client) {
    setActionClientId(client.id);
    setPageError(null);
    setSuccessMessage(null);

    try {
      const restoredClient = await setClientArchived(client.id, false);
      replaceClient(restoredClient);
      setSuccessMessage("Cliente restaurado correctamente.");
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo restaurar el cliente."));
    } finally {
      setActionClientId(null);
    }
  }

  async function handleDeleteConfirmed() {
    if (!clientToDelete) {
      return;
    }

    setActionClientId(clientToDelete.id);
    setPageError(null);
    setSuccessMessage(null);

    try {
      await deleteClient(clientToDelete.id);
      setClients((current) =>
        current.filter((client) => client.id !== clientToDelete.id),
      );
      setSuccessMessage("Cliente eliminado definitivamente.");
      setClientToDelete(null);
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo eliminar el cliente."));
    } finally {
      setActionClientId(null);
    }
  }

  function replaceClient(updatedClient: Client) {
    setClients((current) =>
      sortClients(
        current.map((client) =>
          client.id === updatedClient.id ? updatedClient : client,
        ),
      ),
    );
  }

  const selectedStatusCount =
    statusFilter === "active" ? activeClientCount : archivedClientCount;

  return (
    <section className="clients-page">
      <header className="page-header clients-page-header">
        <div>
          <p className="eyebrow">Gestión de contactos</p>
          <h1>Clientes</h1>
          <p className="page-description">
            Consulta y administra la información de tus clientes.
          </p>
        </div>

        <button className="primary-button" type="button" onClick={openCreateForm}>
          Nuevo cliente
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

      {formMode && (
        <section className="client-form-card" aria-labelledby="client-form-title">
          <div className="client-form-header">
            <div>
              <p className="eyebrow">
                {formMode.type === "create" ? "Nuevo registro" : "Editar registro"}
              </p>
              <h2 id="client-form-title">
                {formMode.type === "create" ? "Agregar cliente" : "Editar cliente"}
              </h2>
            </div>

            <button className="secondary-button" type="button" onClick={closeForm}>
              Cancelar
            </button>
          </div>

          <form className="client-form" onSubmit={handleSubmit} noValidate>
            <div className="client-form-grid">
              <FormField
                label="Nombre o empresa"
                name="name"
                value={formValues.name}
                error={formErrors.name}
                maxLength={120}
                required
                autoFocus
                onChange={updateFormField}
              />
              <FormField
                label="Teléfono"
                name="phone"
                value={formValues.phone}
                error={formErrors.phone}
                maxLength={30}
                type="tel"
                onChange={updateFormField}
              />
              <FormField
                label="Correo electrónico"
                name="email"
                value={formValues.email}
                error={formErrors.email}
                maxLength={254}
                type="email"
                onChange={updateFormField}
              />
              <FormField
                label="Identificación"
                name="identification"
                value={formValues.identification}
                error={formErrors.identification}
                maxLength={50}
                onChange={updateFormField}
              />
              <TextAreaField
                label="Dirección"
                name="address"
                value={formValues.address}
                error={formErrors.address}
                maxLength={300}
                onChange={updateFormField}
              />
              <TextAreaField
                label="Notas"
                name="notes"
                value={formValues.notes}
                error={formErrors.notes}
                maxLength={2_000}
                onChange={updateFormField}
              />
            </div>

            <div className="client-form-actions">
              <button className="secondary-button" type="button" onClick={closeForm}>
                Cancelar
              </button>
              <button className="primary-button" type="submit" disabled={isSaving}>
                {isSaving ? "Guardando..." : "Guardar cliente"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="clients-toolbar" aria-label="Filtros de clientes">
        <label className="client-search">
          <span className="sr-only">Buscar clientes</span>
          <input
            type="search"
            value={searchTerm}
            placeholder="Buscar por nombre, teléfono, correo o identificación"
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
          />
        </label>

        <div className="status-filter" role="group" aria-label="Estado del cliente">
          <button
            className={statusFilter === "active" ? "active" : ""}
            type="button"
            aria-pressed={statusFilter === "active"}
            onClick={() => setStatusFilter("active")}
          >
            Activos <span>{activeClientCount}</span>
          </button>
          <button
            className={statusFilter === "archived" ? "active" : ""}
            type="button"
            aria-pressed={statusFilter === "archived"}
            onClick={() => setStatusFilter("archived")}
          >
            Archivados <span>{archivedClientCount}</span>
          </button>
        </div>
      </section>

      {!isLoading && (
        <p className="clients-result-count">
          {visibleClients.length} de {selectedStatusCount} clientes
        </p>
      )}

      {clientToArchive && (
        <section className="archive-confirmation" aria-labelledby="archive-title">
          <div>
            <h2 id="archive-title">¿Archivar a {clientToArchive.name}?</h2>
            <p>Dejará de aparecer entre los clientes activos, pero sus datos se conservarán.</p>
          </div>
          <div className="confirmation-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setClientToArchive(null)}
            >
              Cancelar
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={actionClientId === clientToArchive.id}
              onClick={() => void handleArchiveConfirmed()}
            >
              {actionClientId === clientToArchive.id ? "Archivando..." : "Archivar"}
            </button>
          </div>
        </section>
      )}

      {clientToDelete && (
        <section className="archive-confirmation" aria-labelledby="delete-title">
          <div>
            <h2 id="delete-title">¿Eliminar definitivamente a {clientToDelete.name}?</h2>
            <p>Esta acción es permanente y no se puede deshacer.</p>
          </div>
          <div className="confirmation-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setClientToDelete(null)}
            >
              Cancelar
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={actionClientId === clientToDelete.id}
              onClick={() => void handleDeleteConfirmed()}
            >
              {actionClientId === clientToDelete.id
                ? "Eliminando..."
                : "Eliminar definitivamente"}
            </button>
          </div>
        </section>
      )}

      {isLoading && <div className="loading-state">Cargando clientes...</div>}

      {!isLoading && selectedStatusCount === 0 && (
        <section className="empty-state clients-empty-state">
          <div className="empty-state-icon" aria-hidden="true">
            +
          </div>
          <p className="eyebrow">
            {statusFilter === "active" ? "Sin clientes" : "Archivo vacío"}
          </p>
          <h2>
            {statusFilter === "active"
              ? "Agrega tu primer cliente"
              : "No hay clientes archivados"}
          </h2>
          <p>
            {statusFilter === "active"
              ? "Los clientes que guardes aparecerán aquí."
              : "Los clientes archivados permanecerán disponibles en esta sección."}
          </p>
          {statusFilter === "active" && (
            <button className="primary-button" type="button" onClick={openCreateForm}>
              Nuevo cliente
            </button>
          )}
        </section>
      )}

      {!isLoading && selectedStatusCount > 0 && visibleClients.length === 0 && (
        <section className="empty-state clients-empty-state">
          <p className="eyebrow">Sin coincidencias</p>
          <h2>No encontramos clientes</h2>
          <p>Prueba con otro nombre, teléfono, correo o identificación.</p>
        </section>
      )}

      {!isLoading && visibleClients.length > 0 && (
        <div className="clients-table-card">
          <table className="clients-table">
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">Contacto</th>
                <th scope="col">Identificación</th>
                <th scope="col">Actualizado</th>
                <th scope="col" className="actions-column">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleClients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong className="client-name">{client.name}</strong>
                    {client.address && <span className="client-secondary">{client.address}</span>}
                  </td>
                  <td>
                    <span className="contact-value">{client.email ?? "Sin correo"}</span>
                    <span className="client-secondary">{client.phone ?? "Sin teléfono"}</span>
                  </td>
                  <td>{client.identification ?? <span className="client-secondary">—</span>}</td>
                  <td>{formatDate(client.updatedAt)}</td>
                  <td>
                    <div className="row-actions">
                      {!client.isArchived && (
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => openEditForm(client)}
                        >
                          Editar
                        </button>
                      )}
                      {client.isArchived ? (
                        <>
                          <button
                            className="text-button"
                            type="button"
                            disabled={actionClientId === client.id}
                            onClick={() => void handleRestore(client)}
                          >
                            {actionClientId === client.id ? "Restaurando..." : "Restaurar"}
                          </button>
                          <button
                            className="text-button danger-text"
                            type="button"
                            disabled={actionClientId === client.id}
                            onClick={() => {
                              setClientToArchive(null);
                              setClientToDelete(client);
                            }}
                          >
                            Eliminar
                          </button>
                        </>
                      ) : (
                        <button
                          className="text-button danger-text"
                          type="button"
                          onClick={() => {
                            setClientToDelete(null);
                            setClientToArchive(client);
                          }}
                        >
                          Archivar
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

type FormFieldProps = {
  label: string;
  name: keyof ClientFormValues;
  value: string;
  error?: string;
  maxLength: number;
  type?: "text" | "tel" | "email";
  required?: boolean;
  autoFocus?: boolean;
  onChange: (field: keyof ClientFormValues, value: string) => void;
};

function FormField({
  label,
  name,
  value,
  error,
  maxLength,
  type = "text",
  required = false,
  autoFocus = false,
  onChange,
}: FormFieldProps) {
  const errorId = `${name}-error`;

  return (
    <label className="form-field">
      <span>
        {label} {required && <small>Obligatorio</small>}
      </span>
      <input
        type={type}
        name={name}
        value={value}
        maxLength={maxLength}
        required={required}
        autoFocus={autoFocus}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(name, event.currentTarget.value)}
      />
      {error && (
        <small className="field-error" id={errorId}>
          {error}
        </small>
      )}
    </label>
  );
}

function TextAreaField({
  label,
  name,
  value,
  error,
  maxLength,
  onChange,
}: FormFieldProps) {
  const errorId = `${name}-error`;

  return (
    <label className="form-field form-field-wide">
      <span>{label}</span>
      <textarea
        name={name}
        value={value}
        maxLength={maxLength}
        rows={3}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(name, event.currentTarget.value)}
      />
      <small className="field-help">{value.length} / {maxLength}</small>
      {error && (
        <small className="field-error" id={errorId}>
          {error}
        </small>
      )}
    </label>
  );
}

function validateForm(values: ClientFormValues): ClientFormErrors {
  const errors: ClientFormErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();

  if (name.length < 2) {
    errors.name = "Escribe al menos 2 caracteres.";
  } else if (name.length > 120) {
    errors.name = "El nombre no puede superar 120 caracteres.";
  }

  if (values.phone.trim().length > 30) {
    errors.phone = "El teléfono no puede superar 30 caracteres.";
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Escribe un correo electrónico válido.";
  }

  if (values.identification.trim().length > 50) {
    errors.identification = "La identificación no puede superar 50 caracteres.";
  }

  if (values.address.trim().length > 300) {
    errors.address = "La dirección no puede superar 300 caracteres.";
  }

  if (values.notes.trim().length > 2_000) {
    errors.notes = "Las notas no pueden superar 2.000 caracteres.";
  }

  return errors;
}

function toClientInput(values: ClientFormValues): CreateClientInput {
  return {
    name: values.name.trim(),
    phone: optionalText(values.phone),
    email: optionalText(values.email),
    identification: optionalText(values.identification),
    address: optionalText(values.address),
    notes: optionalText(values.notes),
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

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "string" && error.trim() ? error : fallback;
}
