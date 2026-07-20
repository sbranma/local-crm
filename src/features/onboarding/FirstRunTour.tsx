import { useEffect, useState } from "react";
import { ModalDialog } from "../../components/ModalDialog";
import { UiIcon } from "../../components/UiIcon";
import type { UiIconName } from "../../components/UiIcon";
import { getOnboardingStatus, seedDemoData } from "./onboarding.api";
import type { OnboardingStatus } from "./onboarding.types";

const ONBOARDING_STORAGE_KEY = "local-crm-onboarding-v1";

type FirstRunTourProps = {
  onComplete: (demoDataCreated: boolean) => void;
};

const tourSteps = [
  {
    eyebrow: "Bienvenido",
    title: "Tu negocio, organizado en un solo lugar",
    description:
      "Local CRM funciona en esta computadora y reúne la operación diaria sin depender de una conexión a internet.",
    icon: "dashboard" as UiIconName,
  },
  {
    eyebrow: "Flujo de trabajo",
    title: "Cada módulo alimenta al siguiente",
    description:
      "Registra clientes, organiza compromisos, reutiliza tu catálogo y convierte esa información en cotizaciones profesionales.",
    icon: "tasks" as UiIconName,
  },
  {
    eyebrow: "Control local",
    title: "Tus datos permanecen bajo tu control",
    description:
      "Los registros y archivos se guardan localmente. Desde Configuración puedes crear un respaldo completo y restaurarlo cuando lo necesites.",
    icon: "files" as UiIconName,
  },
  {
    eyebrow: "Listo para comenzar",
    title: "Explora con ejemplos o inicia desde cero",
    description:
      "Los datos de demostración están claramente identificados, se relacionan entre módulos y puedes editarlos o eliminarlos después.",
    icon: "check" as UiIconName,
  },
] as const;

export function FirstRunTour({ onComplete }: FirstRunTourProps) {
  const [isOpen, setIsOpen] = useState(
    () => localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "completed",
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let isCurrent = true;

    async function loadStatus() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const storedStatus = await getOnboardingStatus();
        if (isCurrent) setStatus(storedStatus);
      } catch (error: unknown) {
        if (isCurrent) {
          setErrorMessage(getErrorMessage(error, "No se pudo revisar el estado inicial."));
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    void loadStatus();
    return () => {
      isCurrent = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const step = tourSteps[stepIndex];
  const isLastStep = stepIndex === tourSteps.length - 1;

  function finishWithoutExamples() {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "completed");
    setIsOpen(false);
    onComplete(false);
  }

  async function createExamples() {
    setIsSeeding(true);
    setErrorMessage(null);
    try {
      await seedDemoData();
      localStorage.setItem(ONBOARDING_STORAGE_KEY, "completed");
      setIsOpen(false);
      onComplete(true);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, "No se pudieron crear los ejemplos."));
    } finally {
      setIsSeeding(false);
    }
  }

  return (
    <ModalDialog
      className="onboarding-modal"
      labelledBy="first-run-tour-title"
      onRequestClose={() => setIsOpen(false)}
    >
      <section className="onboarding-card">
        <header className="onboarding-header">
          <div className="onboarding-brand"><UiIcon name="brand" size={22} /><span>Local CRM</span></div>
          <button className="onboarding-skip" type="button" disabled={isSeeding} onClick={() => setIsOpen(false)}>
            Ver después
          </button>
        </header>

        <div className="onboarding-progress" aria-label={`Paso ${stepIndex + 1} de ${tourSteps.length}`}>
          {tourSteps.map((item, index) => (
            <span className={index <= stepIndex ? "active" : undefined} key={item.title} />
          ))}
        </div>

        <div className="onboarding-content">
          <span className="onboarding-illustration" aria-hidden="true"><UiIcon name={step.icon} size={42} /></span>
          <p className="eyebrow">{step.eyebrow} · Paso {stepIndex + 1} de {tourSteps.length}</p>
          <h1 id="first-run-tour-title">{step.title}</h1>
          <p>{step.description}</p>

          {stepIndex === 1 && (
            <div className="tour-flow" aria-label="Flujo principal">
              <span>Clientes</span><b aria-hidden="true">→</b><span>Tareas y Agenda</span><b aria-hidden="true">→</b><span>Cotizaciones</span>
            </div>
          )}

          {stepIndex === 2 && (
            <div className="tour-note"><strong>Importante:</strong> los datos no están cifrados. Guarda tus respaldos en una ubicación segura.</div>
          )}

          {isLastStep && !isLoading && status && !status.databaseIsEmpty && (
            <div className="tour-note positive"><strong>Detectamos información existente.</strong> El recorrido no modificará esos datos.</div>
          )}

          {isLastStep && isLoading && <div className="tour-loading">Revisando la base local...</div>}
          {isLastStep && errorMessage && <div className="feedback-banner error" role="alert">{errorMessage}</div>}
        </div>

        <footer className="onboarding-actions">
          <button className="secondary-button" type="button" disabled={stepIndex === 0 || isSeeding} onClick={() => setStepIndex((current) => current - 1)}>
            Atrás
          </button>
          <div>
            {!isLastStep && (
              <button className="primary-button" type="button" onClick={() => setStepIndex((current) => current + 1)}>
                Siguiente
              </button>
            )}
            {isLastStep && status?.databaseIsEmpty && (
              <>
                <button className="secondary-button" type="button" disabled={isSeeding} onClick={finishWithoutExamples}>Empezar vacío</button>
                <button className="primary-button" type="button" disabled={isSeeding} onClick={() => void createExamples()}>
                  {isSeeding ? "Creando ejemplos..." : "Cargar ejemplos y comenzar"}
                </button>
              </>
            )}
            {isLastStep && status && !status.databaseIsEmpty && (
              <button className="primary-button" type="button" onClick={finishWithoutExamples}>Entrar al Dashboard</button>
            )}
            {isLastStep && !isLoading && !status && (
              <button className="secondary-button" type="button" onClick={() => setIsOpen(false)}>Cerrar por ahora</button>
            )}
          </div>
        </footer>
      </section>
    </ModalDialog>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return typeof error === "string" && error.trim() ? error : fallback;
}
