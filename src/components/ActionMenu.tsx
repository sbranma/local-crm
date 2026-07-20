import type { MouseEvent, ReactNode } from "react";
import { UiIcon } from "./UiIcon";

type ActionMenuProps = {
  children: ReactNode;
  label?: string;
};

export function ActionMenu({ children, label = "Más acciones" }: ActionMenuProps) {
  function closeAfterAction(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) {
      event.currentTarget.closest("details")?.removeAttribute("open");
    }
  }

  return (
    <details
      className="action-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          event.currentTarget.removeAttribute("open");
        }
      }}
    >
      <summary aria-label={label} title={label}>
        <UiIcon name="more" size={19} />
      </summary>
      <div className="action-menu-popover" onClick={closeAfterAction}>
        {children}
      </div>
    </details>
  );
}
