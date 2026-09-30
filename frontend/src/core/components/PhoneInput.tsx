/**
 * PhoneInput — auto-formats to ###-###-#### as the user types.
 *
 * Accepts and emits the formatted string (with dashes).
 * Strips non-digits, caps at 10 digits, then re-formats on every keystroke.
 *
 * Usage:
 *   <PhoneInput value={phone} onChange={(v) => setPhone(v)} style={...} />
 */
import { type ChangeEvent } from "react";

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> {
  value: string;
  onChange: (formatted: string) => void;
}

/** Format up to 10 digits as ###-###-#### */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function PhoneInput({ value, onChange, ...rest }: Props) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(formatPhone(e.target.value));
  }

  return (
    <input
      {...rest}
      type="tel"
      value={value}
      onChange={handleChange}
      placeholder="555-867-5309"
      maxLength={12}   // ###-###-#### = 12 chars
    />
  );
}
