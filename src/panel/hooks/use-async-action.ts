import { useCallback, useRef, useState } from "react";

export function readableError(value: unknown): string {
  return value instanceof Error && value.message ? value.message : "Unexpected operation failure";
}

export function useAsyncAction(onError: (message: string) => void, onBegin?: () => void) {
  const [submitting, setSubmitting] = useState(false);
  const running = useRef(false);

  const run = useCallback(
    (action: () => Promise<void>, onSuccess?: () => void): void => {
      if (running.current) return;
      running.current = true;
      setSubmitting(true);
      onBegin?.();
      Promise.resolve()
        .then(action)
        .then(() => onSuccess?.())
        .catch((error: unknown) => onError(readableError(error)))
        .finally(() => {
          running.current = false;
          setSubmitting(false);
        });
    },
    [onBegin, onError],
  );

  return { run, submitting };
}
