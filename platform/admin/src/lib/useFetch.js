import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../api.js';

/**
 * Hook tải dữ liệu GET đơn giản: trả { data, loading, error, reload, setData }.
 * `path` là null ⇒ không gọi (dùng khi còn chờ tham số).
 */
export function useFetch(path, { auth = true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  const run = useCallback(async () => {
    if (!path) {
      setLoading(false);
      return;
    }
    reqId.current += 1;
    const id = reqId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await get(path, { auth });
      if (id === reqId.current) setData(result);
    } catch (err) {
      if (id === reqId.current) setError(err);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, auth]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  return { data, loading, error, reload: run, setData };
}
