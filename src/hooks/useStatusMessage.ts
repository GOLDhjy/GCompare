import { useCallback, useEffect, useRef, useState } from "react";

type StatusOptions = {
  defaultTimeout?: number;
};

export const useStatusMessage = (options: StatusOptions = {}) => {
  const { defaultTimeout = 2000 } = options;
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const showStatus = useCallback(
    (message: string, timeout = defaultTimeout) => {
      setStatusMessage(message);
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        setStatusMessage(null);
        timerRef.current = null;
      }, timeout);
    },
    [defaultTimeout],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { statusMessage, showStatus };
};
