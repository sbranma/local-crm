import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ModalDialog } from "../../components/ModalDialog";
import { LoadErrorState } from "../../components/LoadErrorState";
import { exportBackup, inspectBackup, restoreBackup } from "./backup.api";
import type { RestoreCandidate } from "./backup.types";
import { getBusinessSettings, updateBusinessSettings } from "./settings.api";
import { getSystemInfo, openDataDirectory } from "./system.api";
import type {
  BusinessSettings,
  BusinessSettingsInput,
  CurrencyCode,
  LogoInput,
} from "./settings.types";
import type { SystemInfo } from "./system.types";

type SettingsFormValues = {
  businessName: string;
  identification: string;
  phone: string;
  email: string;
  address: string;
  currency: CurrencyCode;
  defaultTax: string;
  defaultValidityDays: string;
  terms: string;
};

type FormErrors = Partial<Record<keyof SettingsFormValues | "logo", string>>;

type PendingLogo = LogoInput & { fileName: string };

const EMPTY_FORM: SettingsFormValues = {
  businessName: "",
  identification: "",
  phone: "",
  email: "",
  address: "",
  currency: "CRC",
  defaultTax: "13",
  defaultValidityDays: "15",
  terms: "",
};

const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const RESTORE_SUCCESS_KEY = "local-crm-restore-success";

export function SettingsPage() {
  const [storedSettings, setStoredSettings] = useState<BusinessSettings | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [formValues, setFormValues] = useState<SettingsFormValues>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [pendingLogo, setPendingLogo] = useState<PendingLogo | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isBackupWorking, setIsBackupWorking] = useState(false);
  const [isOpeningDataDirectory, setIsOpeningDataDirectory] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<RestoreCandidate | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let isCurrent = true;

    const restoredBackup = sessionStorage.getItem(RESTORE_SUCCESS_KEY);
    if (restoredBackup) {
      sessionStorage.removeItem(RESTORE_SUCCESS_KEY);
      setSuccessMessage(restoredBackup);
    }

    async function loadSettings() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [settings, loadedSystemInfo] = await Promise.all([
          getBusinessSettings(),
          getSystemInfo(),
        ]);
        if (isCurrent) {
          setStoredSettings(settings);
          setSystemInfo(loadedSystemInfo);
          setFormValues(toFormValues(settings));
        }
      } catch (error: unknown) {
        if (isCurrent) {
          setLoadError(getErrorMessage(error, "No se pudo cargar la configuración."));
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    void loadSettings();
    return () => {
      isCurrent = false;
    };
  }, [reloadKey]);

  const logoPreview = useMemo(() => {
    if (pendingLogo) {
      return bytesToDataUrl(pendingLogo.data, pendingLogo.mimeType);
    }

    if (
      !removeLogo &&
      storedSettings?.logoData &&
      storedSettings.logoMimeType
    ) {
      return bytesToDataUrl(storedSettings.logoData, storedSettings.logoMimeType);
    }

    return null;
  }, [pendingLogo, removeLogo, storedSettings]);

  function updateField<K extends keyof SettingsFormValues>(
    field: K,
    value: SettingsFormValues[K],
  ) {
    setFormValues((current) => ({ ...current, [field]: value }));
    if (formErrors[field]) {
      setFormErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  async function handleLogoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setFormErrors((current) => ({ ...current, logo: undefined }));

    if (!file) return;

    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setFormErrors((current) => ({
        ...current,
        logo: "Selecciona un archivo PNG, JPG o WebP.",
      }));
      event.currentTarget.value = "";
      return;
    }

    if (file.size > LOGO_MAX_BYTES) {
      setFormErrors((current) => ({
        ...current,
        logo: "El logo debe pesar menos de 2 MB.",
      }));
      event.currentTarget.value = "";
      return;
    }

    try {
      const bitmap = await createImageBitmap(file);
      const dimensionsAreValid = bitmap.width <= 4_000 && bitmap.height <= 4_000;
      bitmap.close();

      if (!dimensionsAreValid) {
        throw new Error("dimensions");
      }

      const data = Array.from(new Uint8Array(await file.arrayBuffer()));
      setPendingLogo({ mimeType: file.type, data, fileName: file.name });
      setRemoveLogo(false);
    } catch {
      setFormErrors((current) => ({
        ...current,
        logo: "No se pudo leer la imagen o supera 4.000 × 4.000 píxeles.",
      }));
      event.currentTarget.value = "";
    }
  }

  function handleRemoveLogo() {
    setPendingLogo(null);
    setRemoveLogo(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateForm(formValues);
    setFormErrors((current) => ({ ...current, ...errors }));

    if (Object.keys(errors).length > 0) return;

    setIsSaving(true);
    setPageError(null);
    setSuccessMessage(null);

    try {
      const savedSettings = await updateBusinessSettings(toInput());
      setStoredSettings(savedSettings);
      setFormValues(toFormValues(savedSettings));
      setPendingLogo(null);
      setRemoveLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSuccessMessage("Configuración guardada correctamente.");
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo guardar la configuración."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExportBackup() {
    const destinationPath = await save({
      defaultPath: backupFileName(),
      filters: [{ name: "Respaldo de Local CRM", extensions: ["localcrm"] }],
    });
    if (!destinationPath) return;

    setIsBackupWorking(true);
    setPageError(null);
    setSuccessMessage(null);
    try {
      const backup = await exportBackup(destinationPath);
      setSystemInfo((current) => current
        ? { ...current, lastBackupAt: new Date().toISOString() }
        : current);
      setSuccessMessage(
        `Respaldo “${backup.fileName}” creado correctamente (${formatFileSize(backup.sizeBytes)}).`,
      );
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo crear el respaldo."));
    } finally {
      setIsBackupWorking(false);
    }
  }

  async function handleOpenDataDirectory() {
    setIsOpeningDataDirectory(true);
    setPageError(null);
    try {
      await openDataDirectory();
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "No se pudo abrir la carpeta de datos."));
    } finally {
      setIsOpeningDataDirectory(false);
    }
  }

  async function handleSelectBackup() {
    const sourcePath = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Respaldo de Local CRM", extensions: ["localcrm"] }],
    });
    if (typeof sourcePath !== "string") return;

    setIsBackupWorking(true);
    setPageError(null);
    setSuccessMessage(null);
    setRestoreError(null);
    try {
      const info = await inspectBackup(sourcePath);
      setRestoreCandidate({ path: sourcePath, info });
    } catch (error: unknown) {
      setPageError(getErrorMessage(error, "El archivo seleccionado no es un respaldo válido."));
    } finally {
      setIsBackupWorking(false);
    }
  }

  async function handleRestoreConfirmed() {
    if (!restoreCandidate) return;
    setIsBackupWorking(true);
    setRestoreError(null);
    try {
      const result = await restoreBackup(restoreCandidate.path);
      sessionStorage.setItem(
        RESTORE_SUCCESS_KEY,
        `Respaldo “${result.restoredBackup.fileName}” restaurado correctamente. La copia automática del estado anterior quedó en ${result.safetyBackupPath}`,
      );
      window.location.reload();
    } catch (error: unknown) {
      setRestoreError(getErrorMessage(error, "No se pudo restaurar el respaldo."));
      setIsBackupWorking(false);
    }
  }

  function toInput(): BusinessSettingsInput {
    return {
      businessName: formValues.businessName.trim(),
      identification: optionalText(formValues.identification),
      phone: optionalText(formValues.phone),
      email: optionalText(formValues.email),
      address: optionalText(formValues.address),
      currency: formValues.currency,
      defaultTaxBasisPoints: Math.round(Number(formValues.defaultTax) * 100),
      defaultValidityDays: Number(formValues.defaultValidityDays),
      terms: optionalText(formValues.terms),
      logo: pendingLogo
        ? { mimeType: pendingLogo.mimeType, data: pendingLogo.data }
        : null,
      removeLogo,
    };
  }

  if (isLoading) {
    return <div className="loading-state">Cargando configuración...</div>;
  }

  if (loadError) {
    return (
      <section className="settings-page">
        <header className="page-header">
          <div><p className="eyebrow">Identidad del documento</p><h1>Configuración</h1><p className="page-description">Administra la información de tu negocio y las copias de seguridad.</p></div>
        </header>
        <LoadErrorState message={loadError} onRetry={() => setReloadKey((key) => key + 1)} />
      </section>
    );
  }

  return (
    <section className="settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Identidad del documento</p>
          <h1>Configuración</h1>
          <p className="page-description">
            Estos datos aparecerán automáticamente en tus cotizaciones.
          </p>
        </div>
        <span className="local-badge">Guardado local</span>
      </header>

      {pageError && <div className="feedback-banner error" role="alert">{pageError}</div>}
      {successMessage && (
        <div className="feedback-banner success" role="status">{successMessage}</div>
      )}

      <form className="settings-layout" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <section className="settings-card">
          <div className="settings-card-header">
            <p className="eyebrow">Perfil comercial</p>
            <h2>Datos del negocio</h2>
          </div>

          <div className="client-form-grid">
            <SettingsField
              label="Nombre del negocio"
              value={formValues.businessName}
              error={formErrors.businessName}
              maxLength={120}
              required
              onChange={(value) => updateField("businessName", value)}
            />
            <SettingsField
              label="Identificación"
              value={formValues.identification}
              error={formErrors.identification}
              maxLength={50}
              onChange={(value) => updateField("identification", value)}
            />
            <SettingsField
              label="Teléfono"
              value={formValues.phone}
              error={formErrors.phone}
              maxLength={30}
              type="tel"
              onChange={(value) => updateField("phone", value)}
            />
            <SettingsField
              label="Correo electrónico"
              value={formValues.email}
              error={formErrors.email}
              maxLength={254}
              type="email"
              onChange={(value) => updateField("email", value)}
            />
            <label className="form-field form-field-wide">
              <span>Dirección</span>
              <input
                value={formValues.address}
                maxLength={300}
                onChange={(event) => updateField("address", event.currentTarget.value)}
              />
            </label>
          </div>
        </section>

        <aside className="settings-card logo-card">
          <div className="settings-card-header">
            <p className="eyebrow">Marca</p>
            <h2>Logotipo</h2>
          </div>

          <div className="logo-preview">
            {logoPreview ? (
              <img src={logoPreview} alt="Vista previa del logotipo" />
            ) : (
              <div className="logo-placeholder" aria-hidden="true">LOGO</div>
            )}
          </div>

          <p className="logo-help">PNG transparente recomendado. También JPG o WebP, máximo 2 MB.</p>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => void handleLogoSelected(event)}
          />
          <div className="logo-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              {logoPreview ? "Reemplazar logo" : "Seleccionar logo"}
            </button>
            {logoPreview && (
              <button className="text-button danger-text" type="button" onClick={handleRemoveLogo}>
                Quitar
              </button>
            )}
          </div>
          {pendingLogo && <small className="selected-file">{pendingLogo.fileName}</small>}
          {formErrors.logo && <small className="field-error">{formErrors.logo}</small>}
        </aside>

        <section className="settings-card settings-preferences">
          <div className="settings-card-header">
            <p className="eyebrow">Valores predeterminados</p>
            <h2>Cotizaciones</h2>
          </div>

          <div className="client-form-grid">
            <label className="form-field">
              <span>Moneda</span>
              <select
                value={formValues.currency}
                onChange={(event) => updateField("currency", event.currentTarget.value as CurrencyCode)}
              >
                <option value="CRC">Colón costarricense (CRC)</option>
                <option value="USD">Dólar estadounidense (USD)</option>
                <option value="EUR">Euro (EUR)</option>
              </select>
            </label>
            <SettingsField
              label="Impuesto predeterminado (%)"
              value={formValues.defaultTax}
              error={formErrors.defaultTax}
              maxLength={6}
              type="number"
              onChange={(value) => updateField("defaultTax", value)}
            />
            <SettingsField
              label="Validez predeterminada (días)"
              value={formValues.defaultValidityDays}
              error={formErrors.defaultValidityDays}
              maxLength={3}
              type="number"
              onChange={(value) => updateField("defaultValidityDays", value)}
            />
            <label className="form-field form-field-wide">
              <span>Condiciones predeterminadas</span>
              <textarea
                value={formValues.terms}
                maxLength={2_000}
                rows={4}
                onChange={(event) => updateField("terms", event.currentTarget.value)}
              />
              <small className="field-help">{formValues.terms.length} / 2000</small>
            </label>
          </div>
        </section>

        {systemInfo && (
          <section className="settings-card settings-storage">
            <div className="settings-card-header settings-section-heading">
              <div>
                <p className="eyebrow">Control local</p>
                <h2>Tus datos en este equipo</h2>
                <p className="page-description">
                  La aplicación y tus datos se guardan por separado para conservar la información durante las actualizaciones.
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={isOpeningDataDirectory}
                onClick={() => void handleOpenDataDirectory()}
              >
                {isOpeningDataDirectory ? "Abriendo..." : "Abrir carpeta de datos"}
              </button>
            </div>

            <div className="storage-path" title={systemInfo.dataDirectory}>
              <span>Ubicación principal</span>
              <code>{systemInfo.dataDirectory}</code>
            </div>

            <div className="storage-details-grid">
              <div>
                <span>Base de datos</span>
                <strong>local-crm.sqlite3</strong>
                <small title={systemInfo.databasePath}>{systemInfo.databasePath}</small>
              </div>
              <div>
                <span>Documentos privados</span>
                <strong>Carpeta documents</strong>
                <small title={systemInfo.documentsPath}>{systemInfo.documentsPath}</small>
              </div>
            </div>

            <div className="storage-notice" role="note">
              <strong>Información privada y sin cifrado.</strong>
              <p>No compartas esta carpeta y guarda los respaldos en una ubicación segura.</p>
            </div>
          </section>
        )}

        <section className="settings-card settings-backups">
          <div className="settings-card-header">
            <p className="eyebrow">Protección de datos</p>
            <h2>Respaldos</h2>
            <p className="page-description">
              Guarda o recupera toda la información local del CRM en un solo archivo.
            </p>
            <p className={systemInfo?.lastBackupAt ? "backup-status" : "backup-status pending"}>
              {systemInfo?.lastBackupAt
                ? `Último respaldo: ${formatDateTime(systemInfo.lastBackupAt)}`
                : "Todavía no se ha registrado ningún respaldo."}
            </p>
          </div>

          <div className="backup-actions-grid">
            <article className="backup-action-card">
              <span className="backup-action-icon" aria-hidden="true">↓</span>
              <div>
                <h3>Crear respaldo</h3>
                <p>Incluye clientes, tareas, agenda, cotizaciones, inventario, archivos, configuración y logotipo.</p>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isBackupWorking}
                  onClick={() => void handleExportBackup()}
                >
                  {isBackupWorking ? "Procesando..." : "Guardar respaldo"}
                </button>
              </div>
            </article>

            <article className="backup-action-card restore">
              <span className="backup-action-icon" aria-hidden="true">↻</span>
              <div>
                <h3>Restaurar respaldo</h3>
                <p>Primero validaremos el archivo y te mostraremos su contenido antes de reemplazar datos.</p>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isBackupWorking}
                  onClick={() => void handleSelectBackup()}
                >
                  {isBackupWorking ? "Validando..." : "Seleccionar respaldo"}
                </button>
              </div>
            </article>
          </div>

          <p className="backup-help">
            El respaldo contiene únicamente los datos ya guardados y usa la extensión <strong>.localcrm</strong>.
          </p>
        </section>

        {systemInfo && (
          <section className="settings-card settings-about">
            <div className="settings-card-header">
              <p className="eyebrow">Acerca del producto</p>
              <h2>Local CRM</h2>
              <p className="page-description">
                Aplicación de escritorio local construida con React, TypeScript, Tauri, Rust y SQLite.
              </p>
            </div>
            <div className="about-details-grid">
              <AboutMetric label="Versión" value={systemInfo.appVersion} />
              <AboutMetric label="Autor" value={systemInfo.author} />
              <AboutMetric label="Licencia" value={systemInfo.license} />
              <AboutMetric label="Modelo" value="Local · Un usuario" />
            </div>
          </section>
        )}

        <div className="settings-save-bar">
          <p>Las cotizaciones nuevas usarán estos datos.</p>
          <button className="primary-button" type="submit" disabled={isSaving}>
            {isSaving ? "Guardando..." : "Guardar configuración"}
          </button>
        </div>
      </form>

      {restoreCandidate && (
        <ModalDialog
          className="confirmation-modal backup-confirmation-modal"
          labelledBy="backup-restore-title"
          onRequestClose={() => {
            if (!isBackupWorking) setRestoreCandidate(null);
          }}
        >
          <section className="backup-restore-confirmation" aria-labelledby="backup-restore-title">
            <div className="client-form-header">
              <div>
                <p className="eyebrow">Respaldo validado</p>
                <h2 id="backup-restore-title">¿Restaurar “{restoreCandidate.info.fileName}”?</h2>
              </div>
            </div>

            {restoreError && <div className="feedback-banner error" role="alert">{restoreError}</div>}

            <div className="backup-preview-grid">
              <BackupMetric label="Negocio" value={restoreCandidate.info.businessName ?? "Sin configurar"} />
              <BackupMetric label="Tamaño" value={formatFileSize(restoreCandidate.info.sizeBytes)} />
              <BackupMetric label="Clientes" value={String(restoreCandidate.info.clientCount)} />
              <BackupMetric label="Tareas" value={String(restoreCandidate.info.taskCount)} />
              <BackupMetric label="Cotizaciones" value={String(restoreCandidate.info.quoteCount)} />
              <BackupMetric label="Eventos" value={String(restoreCandidate.info.calendarEventCount)} />
              <BackupMetric label="Inventario" value={String(restoreCandidate.info.inventoryItemCount)} />
              <BackupMetric label="Archivos" value={String(restoreCandidate.info.documentCount)} />
              <BackupMetric label="Versión" value={String(restoreCandidate.info.schemaVersion)} />
            </div>

            <div className="backup-warning" role="alert">
              <strong>Esta acción reemplazará todos los datos actuales.</strong>
              <p>Los cambios sin guardar se perderán. Antes de restaurar crearemos automáticamente una copia del estado actual.</p>
            </div>

            <div className="confirmation-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={isBackupWorking}
                onClick={() => setRestoreCandidate(null)}
              >
                Cancelar
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={isBackupWorking}
                onClick={() => void handleRestoreConfirmed()}
              >
                {isBackupWorking ? "Restaurando..." : "Sí, reemplazar y restaurar"}
              </button>
            </div>
          </section>
        </ModalDialog>
      )}
    </section>
  );
}

type SettingsFieldProps = {
  label: string;
  value: string;
  error?: string;
  maxLength: number;
  type?: "text" | "tel" | "email" | "number";
  required?: boolean;
  onChange: (value: string) => void;
};

function BackupMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AboutMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingsField({
  label,
  value,
  error,
  maxLength,
  type = "text",
  required = false,
  onChange,
}: SettingsFieldProps) {
  return (
    <label className="form-field">
      <span>{label} {required && <small>Obligatorio</small>}</span>
      <input
        type={type}
        value={value}
        maxLength={type === "number" ? undefined : maxLength}
        required={required}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

function validateForm(values: SettingsFormValues): FormErrors {
  const errors: FormErrors = {};
  const name = values.businessName.trim();
  const email = values.email.trim();
  const tax = Number(values.defaultTax);
  const validity = Number(values.defaultValidityDays);

  if (name.length < 2) errors.businessName = "Escribe al menos 2 caracteres.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Escribe un correo electrónico válido.";
  }
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
    errors.defaultTax = "El impuesto debe estar entre 0 y 100.";
  }
  if (!Number.isInteger(validity) || validity < 1 || validity > 365) {
    errors.defaultValidityDays = "La validez debe estar entre 1 y 365 días.";
  }

  return errors;
}

function toFormValues(settings: BusinessSettings): SettingsFormValues {
  return {
    businessName: settings.businessName,
    identification: settings.identification ?? "",
    phone: settings.phone ?? "",
    email: settings.email ?? "",
    address: settings.address ?? "",
    currency: settings.currency,
    defaultTax: formatPercentage(settings.defaultTaxBasisPoints),
    defaultValidityDays: String(settings.defaultValidityDays),
    terms: settings.terms ?? "",
  };
}

function formatPercentage(basisPoints: number): string {
  return String(basisPoints / 100);
}

function backupFileName(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `local-crm-backup-${year}-${month}-${day}.localcrm`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "fecha no disponible";
  return new Intl.DateTimeFormat("es-CR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}

export function bytesToDataUrl(data: number[], mimeType: string): string {
  let binary = "";
  const bytes = new Uint8Array(data);
  const chunkSize = 32_768;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return typeof error === "string" && error.trim() ? error : fallback;
}
