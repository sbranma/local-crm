import { UiIcon } from "./UiIcon";

type LoadErrorStateProps = {
  message: string;
  onRetry: () => void;
};

export function LoadErrorState({ message, onRetry }: LoadErrorStateProps) {
  return (
    <section className="load-error-state" role="alert">
      <span className="load-error-icon" aria-hidden="true"><UiIcon name="refresh" size={24} /></span>
      <div>
        <p className="eyebrow">No pudimos mostrar esta sección</p>
        <h2>Revisa la conexión local</h2>
        <p>{message} Tus datos no se consideran vacíos ni fueron eliminados.</p>
      </div>
      <button className="secondary-button" type="button" onClick={onRetry}>
        Reintentar
      </button>
    </section>
  );
}
