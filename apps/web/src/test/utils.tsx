import { render } from "@testing-library/react";
import { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

/**
 * Render component with MemoryRouter (for components using useNavigate/useParams).
 */
export function renderWithRouter(ui: ReactNode, route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>,
  );
}

/**
 * Re-export common testing utilities for convenience.
 */
export { screen, fireEvent, waitFor, within } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
