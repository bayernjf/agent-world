import { fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { RetryField, clampRetries } from "./shared";

const t = ((k: string) => k) as unknown as TFunction;

describe("clampRetries", () => {
  it("clamps to the schema's integer [0,10] range", () => {
    expect(clampRetries(0)).toBe(0);
    expect(clampRetries(3)).toBe(3);
    expect(clampRetries(99)).toBe(10);
    expect(clampRetries(-5)).toBe(0);
    expect(clampRetries(2.9)).toBe(2);
    expect(clampRetries(Number.NaN)).toBe(0);
    expect(clampRetries(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("RetryField", () => {
  it("renders the current cap and writes back clamped values", () => {
    const onChange = vi.fn();
    render(<RetryField value={2} onChange={onChange} t={t} />);

    const input = screen.getByLabelText("nodes:inspector.common.maxRetries") as HTMLInputElement;
    expect(input.value).toBe("2");
    expect(input.min).toBe("0");
    expect(input.max).toBe("10");

    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).toHaveBeenLastCalledWith(5);

    fireEvent.change(input, { target: { value: "99" } });
    expect(onChange).toHaveBeenLastCalledWith(10);

    fireEvent.change(input, { target: { value: "-5" } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});
