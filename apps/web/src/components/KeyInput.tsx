import { useTranslation } from "react-i18next";

interface Props {
  /** Whether the raw value is currently revealed (unmasked). */
  reveal: boolean;
  /** Toggle the masked/revealed state. */
  onToggle: () => void;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * A key input aligned with the model key style: masked by default with a
 * show/hide toggle. Also opts out of browser/password-manager autofill so
 * keys are never saved locally.
 */
export default function KeyInput({
  reveal,
  onToggle,
  value,
  onChange,
  placeholder,
  disabled,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="key-input">
      <input
        type="text"
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        data-form-type="other"
        disabled={disabled}
        className={reveal ? "" : "key-input__masked"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="link link--sm key-input__toggle"
        onClick={onToggle}
        tabIndex={-1}
      >
        {reveal ? t("settings:modelKeys.hide") : t("settings:modelKeys.show")}
      </button>
    </div>
  );
}