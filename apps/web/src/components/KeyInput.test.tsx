import { render, screen, fireEvent } from "@testing-library/react";
import KeyInput from "./KeyInput";

describe("KeyInput", () => {
  it("masks the value by default and shows the reveal toggle", () => {
    render(<KeyInput reveal={false} onToggle={vi.fn()} value="sk-secret" onChange={vi.fn()} />);
    const input = screen.getByDisplayValue("sk-secret");
    expect(input).toHaveClass("key-input__masked");
    expect(screen.getByText("显示")).toBeInTheDocument();
  });

  it("reveals the value and flips the toggle label when reveal is true", () => {
    render(<KeyInput reveal onToggle={vi.fn()} value="sk-secret" onChange={vi.fn()} />);
    const input = screen.getByDisplayValue("sk-secret");
    expect(input).not.toHaveClass("key-input__masked");
    expect(screen.getByText("隐藏")).toBeInTheDocument();
  });

  it("calls onToggle when the toggle button is clicked", () => {
    const onToggle = vi.fn();
    render(<KeyInput reveal={false} onToggle={onToggle} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText("显示"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("forwards the new value to onChange while typing", () => {
    const onChange = vi.fn();
    render(<KeyInput reveal={false} onToggle={vi.fn()} value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "sk-abc" } });
    expect(onChange).toHaveBeenCalledWith("sk-abc");
  });

  it("passes placeholder and disabled through to the input", () => {
    render(
      <KeyInput
        reveal={false}
        onToggle={vi.fn()}
        value=""
        onChange={vi.fn()}
        placeholder="API Key"
        disabled
      />,
    );
    const input = screen.getByPlaceholderText("API Key") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("opts out of browser and password-manager autofill", () => {
    render(<KeyInput reveal={false} onToggle={vi.fn()} value="" onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("data-lpignore", "true");
    expect(input).toHaveAttribute("data-1p-ignore", "true");
    expect(input).toHaveAttribute("data-form-type", "other");
  });
});
