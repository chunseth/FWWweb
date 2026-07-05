import { useRef, useState } from "react";
import {
  checkUsername,
  saveProfile,
  USERNAME_MAX,
  validateUsernameFormat,
} from "../services/usernameService";
import type { StoredProfile } from "../services/usernameService";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "error"; text: string }
  | { kind: "ok"; text: string };

interface UsernameFormProps {
  onSaved: (profile: StoredProfile) => void;
  initialValue?: string;
}

/**
 * Username entry, checked against the database for uniqueness before play.
 * Falls back to a device-local (unverified) name when the backend is
 * unreachable so the game never hard-blocks.
 */
export const UsernameForm = ({ onSaved, initialValue = "" }: UsernameFormProps) => {
  const [value, setValue] = useState(initialValue);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const requestIdRef = useRef(0);

  const submit = async () => {
    const name = value.trim();
    const formatError = validateUsernameFormat(name);
    if (formatError) {
      setPhase({ kind: "error", text: formatError });
      return;
    }

    const requestId = ++requestIdRef.current;
    setPhase({ kind: "checking" });
    const result = await checkUsername(name);
    if (requestId !== requestIdRef.current) return; // stale response

    switch (result.status) {
      case "invalid":
        setPhase({ kind: "error", text: result.reason });
        return;
      case "taken":
        setPhase({ kind: "error", text: "That name is taken — try another." });
        return;
      case "available":
      case "unverified": {
        const profile: StoredProfile = {
          username: name,
          verified: result.status === "available",
          savedAtMs: Date.now(),
        };
        saveProfile(profile);
        setPhase({
          kind: "ok",
          text:
            result.status === "available"
              ? "Name is yours!"
              : result.reason,
        });
        onSaved(profile);
        return;
      }
    }
  };

  return (
    <div className="username-form">
      <label className="username-form__label" htmlFor="username-input">
        Pick a username
      </label>
      <div className="username-form__row">
        <input
          id="username-input"
          className="username-form__input"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={USERNAME_MAX}
          placeholder="3-20 letters, numbers, _"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setPhase({ kind: "idle" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <button
          className="btn btn--primary"
          onClick={() => void submit()}
          disabled={phase.kind === "checking" || value.trim().length === 0}
        >
          {phase.kind === "checking" ? "Checking…" : "Save"}
        </button>
      </div>
      <p
        className={`username-form__status${
          phase.kind === "error" ? " username-form__status--error" : ""
        }`}
      >
        {phase.kind === "error" || phase.kind === "ok" ? phase.text : " "}
      </p>
    </div>
  );
};
